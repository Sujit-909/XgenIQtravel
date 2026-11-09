import { HttpError } from '../util';

// Only this server module reads the key. Never return upstream metadata or URLs.
async function fetchSerpApi(engine, parameters, { fetcher = fetch, timeoutMs = 25000 } = {}) {
  const noun = engine === 'google_hotels' ? 'Hotel' : 'Flight';
  const selection = parameters.booking_token || parameters.departure_token || parameters.property_token || parameters.next_page_token;
  const key = process.env.SERPAPI_API_KEY;
  if (!key?.trim()) throw new HttpError(503, `${noun} search is not configured. Ask your administrator to configure SerpApi.`);
  const url = new URL('https://serpapi.com/search.json');
  const safe = { ...parameters, engine, currency: 'INR', hl: 'en', gl: 'in', api_key: key };
  for (const [k, value] of Object.entries(safe)) if (value !== undefined) url.searchParams.set(k, String(value));
  try {
    const response = await fetcher(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      if (response.status === 429) throw new HttpError(429, `${noun} provider quota reached. Please try again later.`);
      if ([400, 404].includes(response.status) && selection) throw new HttpError(410, `This ${noun.toLowerCase()} selection has expired or is unavailable. Search again.`);
      if (response.status === 400) throw new HttpError(400, `The ${noun.toLowerCase()} provider rejected the search parameters. Check the search and try again.`);
      throw new HttpError(502, `The ${noun.toLowerCase()} provider could not process this search. Please try again.`);
    }
    const body = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(502, `The ${noun.toLowerCase()} provider returned an invalid response.`);
    if (body.error || body.search_metadata?.status === 'Error') {
      // Do not echo upstream messages: they can contain request URLs or secrets.
      if (/no (flights|hotels|properties|results)|hasn.t returned any results/i.test(String(body.error))) return engine === 'google_hotels' ? { properties: [] } : { best_flights: [], other_flights: [] };
      throw new HttpError(selection ? 410 : 502, selection ? `This ${noun.toLowerCase()} selection has expired or is unavailable. Search again.` : `The ${noun.toLowerCase()} provider rejected this search. Check the destination and dates, or try again later.`);
    }
    for (const field of engine === 'google_hotels' ? ['properties'] : ['best_flights', 'other_flights', 'selected_flights', 'booking_options']) {
      if (Array.isArray(body[field])) body[field] = body[field].filter((row) => row && typeof row === 'object' && !Array.isArray(row));
    }
    return body;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new HttpError(504, `${noun} search timed out. Please try again.`);
    throw new HttpError(502, `Unable to reach the ${noun.toLowerCase()} provider. Please try again.`);
  }
}

export const fetchGoogleFlights = (parameters, options) => fetchSerpApi('google_flights', parameters, options);
export const fetchGoogleHotels = (parameters, options) => fetchSerpApi('google_hotels', parameters, options);

export const safeExternalUrl = (value) => {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.searchParams.has('api_key') && !u.hostname.endsWith('serpapi.com') && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ? u.href : null; } catch { return null; }
};
const text = (v) => typeof v === 'string' ? v.slice(0, 2000) : '';
const amount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const strings = (v) => (Array.isArray(v) ? v : []).filter((s) => typeof s === 'string').slice(0, 30);
const airport = (v) => ({ id: text(v?.id), name: text(v?.name), time: text(v?.time) });
export function normalizeItinerary(raw, id, recommended = false) {
  return {
    id, recommended, price: amount(raw.price), duration: amount(raw.total_duration),
    logo: safeExternalUrl(raw.airline_logo),
    segments: (Array.isArray(raw.flights) ? raw.flights : []).filter((f) => f && typeof f === 'object').map((f) => ({
      departure: airport(f.departure_airport), arrival: airport(f.arrival_airport), airline: text(f.airline), logo: safeExternalUrl(f.airline_logo),
      flight_number: text(f.flight_number), cabin: text(f.travel_class), duration: amount(f.duration), airplane: text(f.airplane), extensions: strings(f.extensions),
    })),
    stops: Math.max(0, (Array.isArray(raw.flights) ? raw.flights.filter((f) => f && typeof f === 'object') : []).length - 1),
    layovers: (Array.isArray(raw.layovers) ? raw.layovers : []).filter((l) => l && typeof l === 'object').map((l) => ({ name: text(l.name), id: text(l.id), duration: amount(l.duration), overnight: !!l.overnight })),
    extensions: strings(raw.extensions),
    canContinue: !!raw.departure_token, canBook: !!raw.booking_token,
  };
}
export function normalizeBookingOptions(body) {
  const out = [];
  for (const [i, option] of (Array.isArray(body.booking_options) ? body.booking_options : []).entries()) {
    if (!option || typeof option !== 'object') continue;
    // Separate tickets must be shown separately, never as one guaranteed fare.
    for (const group of ['together', 'departing', 'returning']) {
      const entries = Array.isArray(option[group]) ? option[group] : option[group] ? [option[group]] : [];
      for (const [j, b] of entries.entries()) {
        if (!b || typeof b !== 'object') continue;
        const url = safeExternalUrl(b.booking_request?.url);
        const postData = b.booking_request?.post_data;
        out.push({ id: `${i}-${group}-${j}`, provider: text(b.book_with) || 'Booking provider', airline: typeof b.airline === 'boolean' ? b.airline : null, price: amount(b.price),
          separate: !!option.separate_tickets, leg: group, phone: text(b.booking_phone), baggage: strings(b.baggage_prices),
          marketed_as: strings(b.marketed_as), logo: safeExternalUrl(b.airline_logos?.[0]),
          request: url ? { url, fields: typeof postData === 'string' && postData ? [...new URLSearchParams(postData)].map(([name, value]) => ({ name, value })) : null } : null });
      }
    }
  }
  return out;
}

export function rateLimitSerpApi(db, user) {
  const minute = Math.floor(Date.now() / 60000);
  db.tx(() => {
    db.run('DELETE FROM flight_rate_limits WHERE window<?', minute - 1);
    for (const [bucket, limit] of [[`user:${user.id}`, 10], ['provider', 60]]) {
      const count = db.get('SELECT count FROM flight_rate_limits WHERE bucket=? AND window=?', bucket, minute)?.count || 0;
      if (count >= limit) throw new HttpError(429, 'Too many travel searches. Please wait a minute and try again.');
      db.run('INSERT INTO flight_rate_limits(bucket,window,count) VALUES(?,?,1) ON CONFLICT(bucket,window) DO UPDATE SET count=count+1', bucket, minute);
    }
  });
}
