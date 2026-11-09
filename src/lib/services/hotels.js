import { createHash, randomUUID } from 'node:crypto';
import { json } from '../db';
import { bad, conflict, forbidden, HttpError, nowIso, audit, getSetting } from '../util';
import { loadTrip } from './trips';
import { validateHotelSearch, hotelParameters } from '../hotel-search';
import { fetchGoogleHotels, rateLimitSerpApi } from '../providers/serpapi';
import { normalizeHotel, publicHotel } from '../providers/hotels';
import { evaluateHotel } from './policy';
import { saveService } from './services';

const pending = new WeakMap();
function tripFor(db, user, id, write = false) {
  const n = Number(id); if (!Number.isSafeInteger(n) || n <= 0) throw bad('Select a valid trip');
  const trip = loadTrip(db, user, n);
  if (write && trip.traveller_id !== user.id && trip.created_by !== user.id && !['admin', 'travel_desk'].includes(user.role)) throw forbidden('Only the traveller, requester or travel desk can request this hotel');
  return trip;
}
const active = (trip) => { if (!['Approved', 'Booking In Progress', 'Travel In Progress'].includes(trip.status)) throw conflict('Hotel searches require an approved, active trip'); };
function readSearch(db, user, id) {
  if (typeof id !== 'string' || id.length > 100) throw bad('Select a valid hotel search');
  const row = db.get('SELECT * FROM hotel_searches WHERE id=? AND user_id=?', id, user.id);
  if (!row) throw new HttpError(404, 'Hotel search not found');
  tripFor(db, user, row.trip_id);
  if (row.expires_at <= nowIso()) throw new HttpError(410, 'This hotel search has expired. Search again for current rates.');
  return row;
}
function propertyFor(row, id) {
  const item = json(row.payload, {}).properties?.find((p) => p.view.id === id);
  if (!item) throw bad('Select a hotel from this search');
  return item;
}
function assess(db, trip, criteria, hotel, rate) {
  const nightly = rate ? rate.nightly.amount : hotel.nightly.amount; const total = rate ? rate.total.amount : hotel.total.amount;
  if (nightly === null) return { status: 'Review Required', checks: [{ detail: 'A nightly quote was not supplied. Ask the travel desk to verify this option.' }], issues: ['Nightly quote unavailable'] };
  const policy = evaluateHotel(db, { hotel: { city: criteria.q, pricePerNight: nightly, star: hotel.stars }, travelType: trip.travel_type, destCountry: trip.dest_country });
  const used = db.get("SELECT COALESCE(SUM(amount),0) s FROM bookings WHERE trip_id=? AND status!='Cancelled'", trip.id).s;
  const issues = policy.checks.filter((c) => !c.ok).map((c) => c.detail);
  if (total === null) issues.push('Total stay quote unavailable; verify the approved budget with the travel desk');
  else if (used + total > trip.est_budget * (1 + getSetting(db, 'price_tolerance_pct', 10) / 100)) issues.push('This quote exceeds the remaining approved trip budget');
  if (criteria.rooms > 1) issues.push('Multiple-room allocation and the combined total require travel desk verification');
  return { ...policy, status: issues.length ? 'Exception Required' : policy.status, issues };
}
function publicResult(db, user, row) {
  const trip = tripFor(db, user, row.trip_id); const criteria = json(row.criteria, {}); const payload = json(row.payload, {});
  return { search_id: row.id, criteria, created_at: row.created_at, expires_at: row.expires_at, currency: 'INR', page: payload.page, has_next: !!payload.next_page_token,
    properties: payload.properties.map(({ view }) => {
      const hotel = publicHotel(view); hotel.policy = assess(db, trip, criteria, view);
      hotel.rates = hotel.rates.map((rate, index) => ({ ...rate, policy: assess(db, trip, criteria, view, view.rates[index]) }));
      return hotel;
    }) };
}
async function run(db, user, trip, criteria, selection, mode, page = 1) {
  const fingerprint = createHash('sha256').update(JSON.stringify({ user: user.id, trip: trip.id, criteria, selection, mode })).digest('hex');
  const cached = db.get('SELECT * FROM hotel_searches WHERE fingerprint=? AND created_at>? AND expires_at>? ORDER BY created_at DESC LIMIT 1', fingerprint, new Date(Date.now() - 300000).toISOString(), nowIso());
  if (cached) return publicResult(db, user, cached);
  let work = pending.get(db); if (!work) { work = new Map(); pending.set(db, work); }
  if (work.has(fingerprint)) return work.get(fingerprint);
  const request = Promise.resolve().then(async () => {
    rateLimitSerpApi(db, user);
    const raw = await fetchGoogleHotels({ ...hotelParameters(criteria, mode === 'details'), ...(selection ? { [mode === 'details' ? 'property_token' : 'next_page_token']: selection } : {}) });
    if (mode === 'details' && !raw.name) throw new HttpError(410, 'Property details are unavailable. Search again or choose another hotel.');
    const rows = mode === 'details' ? [raw] : Array.isArray(raw.properties) ? raw.properties : [];
    const payload = { page, properties: rows.map((p) => ({ token: typeof p.property_token === 'string' ? p.property_token : null, view: normalizeHotel(p, randomUUID()) })), next_page_token: mode !== 'details' && typeof raw.serpapi_pagination?.next_page_token === 'string' ? raw.serpapi_pagination.next_page_token : null };
    const id = randomUUID();
    db.run('INSERT INTO hotel_searches(id,user_id,trip_id,fingerprint,criteria,payload,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)', id, user.id, trip.id, fingerprint, criteria, payload, nowIso(), new Date(Date.now() + 900000).toISOString());
    db.run('DELETE FROM hotel_searches WHERE created_at<?', new Date(Date.now() - 30 * 86400000).toISOString());
    return publicResult(db, user, db.get('SELECT * FROM hotel_searches WHERE id=?', id));
  }).finally(() => work.delete(fingerprint));
  work.set(fingerprint, request); return request;
}
export async function searchHotels(db, user, input) {
  const trip = tripFor(db, user, input?.trip_id); active(trip);
  let criteria; try { criteria = validateHotelSearch(input); } catch (e) { throw bad(e.message); }
  return run(db, user, trip, criteria, null, 'search');
}
export async function nextHotelPage(db, user, input) {
  const row = readSearch(db, user, input?.search_id); const trip = tripFor(db, user, row.trip_id); active(trip);
  const payload = json(row.payload, {});
  if (!payload.next_page_token) throw conflict('There are no more hotel results');
  return run(db, user, trip, json(row.criteria, {}), payload.next_page_token, 'page', payload.page + 1);
}
export async function hotelDetails(db, user, input) {
  const row = readSearch(db, user, input?.search_id); const trip = tripFor(db, user, row.trip_id); active(trip);
  const hotel = propertyFor(row, input.property_id);
  if (!hotel.token) throw conflict('The provider did not supply a property details token');
  return run(db, user, trip, json(row.criteria, {}), hotel.token, 'details');
}
export function hotelHistory(db, user, id) {
  const trip = tripFor(db, user, id);
  return { searches: db.all('SELECT id,criteria,created_at,expires_at FROM hotel_searches WHERE user_id=? AND trip_id=? ORDER BY created_at DESC LIMIT 20', user.id, trip.id).map((r) => ({ ...r, criteria: json(r.criteria, {}) })) };
}
export function resumeHotels(db, user, id) { return publicResult(db, user, readSearch(db, user, id)); }
export function redirectHotel(db, user, query) {
  const row = readSearch(db, user, query.search_id); const trip = tripFor(db, user, row.trip_id); active(trip);
  const hotel = propertyFor(row, query.property_id).view; const rate = hotel.rates.find((r) => r.id === query.rate_id);
  if (!rate?.link) throw bad('This provider did not supply a booking link');
  const policy = assess(db, trip, json(row.criteria, {}), hotel, rate);
  if (policy.status !== 'Compliant') throw conflict('This option requires travel desk review before continuing to the provider.');
  audit(db, user, 'hotel.provider.visit', 'trip', trip.id, 'Opened a hotel provider; reservation not confirmed');
  return new Response(null, { status: 302, headers: { location: rate.link, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
export function requestHotel(db, user, input) {
  const row = readSearch(db, user, input?.search_id); const trip = tripFor(db, user, row.trip_id, true); active(trip);
  const criteria = json(row.criteria, {}); const hotel = propertyFor(row, input.property_id).view;
  const rate = input.rate_id ? hotel.rates.find((r) => r.id === input.rate_id) : null;
  if (input.rate_id && !rate) throw bad('Choose a rate returned for this hotel');
  const policy = assess(db, trip, criteria, hotel, rate);
  const justification = String(input.justification || '').trim();
  if (policy.status !== 'Compliant' && justification.length < 10) throw bad('Add a justification of at least 10 characters for travel desk review');
  if (justification.length > 1000) throw bad('Justification is limited to 1000 characters');
  const hotel_selection_key = createHash('sha256').update(JSON.stringify({ criteria, name: hotel.name, address: hotel.address, provider: rate?.source, nightly: rate?.nightly || hotel.nightly, total: rate?.total || hotel.total })).digest('hex');
  return db.tx(() => {
    const existing = db.get("SELECT id,srv_no,status FROM services WHERE trip_id=? AND created_by=? AND json_extract(details,'$.hotel_selection_key')=? AND status!='Cancelled'", trip.id, user.id, hotel_selection_key);
    if (existing) return { ...existing, duplicate: true };
    return saveService(db, user, trip.id, { type: 'hotel', channel: 'agency', comment: input.comment, details: {
      city: criteria.q, check_in: criteria.check_in_date, check_out: criteria.check_out_date, rooms: criteria.rooms, guests: criteria.adults + criteria.children,
      adults: criteria.adults, children: criteria.children, children_ages: criteria.children_ages.join(', '), hotel_name: hotel.name, hotel_address: hotel.address, hotel_stars: hotel.stars,
      selected_provider: rate?.source || 'Not selected', quoted_nightly: (rate?.nightly || hotel.nightly).amount ?? 'Not provided', quoted_total: (rate?.total || hotel.total).amount ?? 'Not provided',
      quote_currency: 'INR', policy_status: policy.status, policy_issues: policy.issues?.join('; ') || '', justification, hotel_selection_key,
      source: 'SerpApi Google Hotels', reservation_status: 'Not reserved - travel desk review requested',
    } });
  });
}
