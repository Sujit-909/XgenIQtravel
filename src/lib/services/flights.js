import { createHash, randomUUID } from 'node:crypto';
import { json } from '../db';
import { HttpError, bad, conflict, forbidden, nowIso, audit } from '../util';
import { loadTrip } from './trips';
import { validateFlightSearch, CABINS } from '../flight-search';
import { fetchGoogleFlights, normalizeItinerary, normalizeBookingOptions, rateLimitSerpApi as rateLimit } from '../providers/serpapi';
import { evaluateFlight } from './policy';

const TTL = 15 * 60 * 1000;
const CACHE_MS = 5 * 60 * 1000;
const pending = new WeakMap();
const tripId = (value) => { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw bad('Select a valid trip'); return n; };
function tripFor(db, user, id, writable = false) {
  const trip = loadTrip(db, user, tripId(id));
  if (writable && trip.traveller_id !== user.id && trip.created_by !== user.id && !['admin', 'travel_desk'].includes(user.role)) throw forbidden('Only the traveller, requester or travel desk can save options for this trip');
  return trip;
}
const active = (trip) => { if (!['Approved', 'Booking In Progress', 'Travel In Progress'].includes(trip.status)) throw conflict('Flight searches require an approved, active trip'); };
function parameters(criteria) {
  const { legs, ...rest } = criteria;
  return legs ? { ...rest, multi_city_json: JSON.stringify(legs) } : rest;
}
function publicSearch(row) {
  const body = json(row.payload, {});
  return { search_id: row.id, criteria: json(row.criteria, {}), stage: body.stage, selected: body.selected || [], rows: (body.offers || []).map((o) => o.view),
    booking_options: body.booking_options || null, created_at: row.created_at, expires_at: row.expires_at, currency: 'INR' };
}
function readSearch(db, user, id) {
  if (typeof id !== 'string' || id.length > 100) throw bad('Invalid flight search');
  const row = db.get('SELECT * FROM flight_searches WHERE id=? AND user_id=?', id, user.id);
  if (!row) throw new HttpError(404, 'Flight search not found');
  tripFor(db, user, row.trip_id);
  if (row.expires_at <= nowIso()) throw new HttpError(410, 'This flight selection has expired. Search again for current prices.');
  return row;
}
function getOffer(row, offerId) {
  const offer = json(row.payload, {}).offers?.find((o) => o.view.id === offerId);
  if (!offer) throw bad('Select a flight from this search');
  return offer;
}
function policyFor(db, trip, criteria, view) {
  if (view.price === null) return null;
  const traveller = db.get('SELECT grade FROM users WHERE id=?', trip.traveller_id);
  return evaluateFlight(db, { offer: { fare: view.price, cabin: CABINS[criteria.travel_class - 1], duration: view.duration ?? undefined, date: criteria.outbound_date || criteria.legs?.[0].date }, travelType: trip.travel_type, destCountry: trip.dest_country, grade: traveller?.grade });
}
async function run(db, user, trip, criteria, token, stage, selected, mode) {
  const fingerprint = createHash('sha256').update(JSON.stringify({ user: user.id, trip: trip.id, criteria, token, mode })).digest('hex');
  const cached = db.get('SELECT * FROM flight_searches WHERE fingerprint=? AND created_at>? AND expires_at>? ORDER BY created_at DESC LIMIT 1', fingerprint, new Date(Date.now() - CACHE_MS).toISOString(), nowIso());
  if (cached) return publicSearch(cached);
  let requests = pending.get(db); if (!requests) { requests = new Map(); pending.set(db, requests); }
  if (requests.has(fingerprint)) return requests.get(fingerprint);
  // Defer execution so simultaneous requests share the same promise, including failures.
  const work = Promise.resolve().then(async () => {
    rateLimit(db, user);
    const raw = await fetchGoogleFlights({ ...parameters(criteria), ...(token ? { [mode === 'booking' ? 'booking_token' : 'departure_token']: token } : {}) });
    const id = randomUUID(); const offers = [];
    if (mode !== 'booking') {
      for (const [group, recommended] of [['best_flights', true], ['other_flights', false]]) {
        for (const f of Array.isArray(raw[group]) ? raw[group] : []) {
          if (!Array.isArray(f.flights) || !f.flights.length) continue;
          const view = normalizeItinerary(f, randomUUID(), recommended);
          view.policy = policyFor(db, trip, criteria, view);
          offers.push({ view, departure_token: typeof f.departure_token === 'string' ? f.departure_token : null, booking_token: typeof f.booking_token === 'string' ? f.booking_token : null });
        }
      }
    }
    const verifiedSelected = mode === 'booking' && Array.isArray(raw.selected_flights) && raw.selected_flights.length
      ? raw.selected_flights.map((f) => normalizeItinerary(f, randomUUID())) : selected;
    const payload = { stage, selected: verifiedSelected, offers, booking_options: mode === 'booking' ? normalizeBookingOptions(raw) : null };
    const created = nowIso(); const expires = new Date(Date.now() + TTL).toISOString();
    db.run('INSERT INTO flight_searches(id,user_id,trip_id,fingerprint,criteria,payload,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)', id, user.id, trip.id, fingerprint, criteria, payload, created, expires);
    db.run('DELETE FROM flight_searches WHERE created_at<?', new Date(Date.now() - 30 * 86400000).toISOString());
    return publicSearch(db.get('SELECT * FROM flight_searches WHERE id=?', id));
  }).finally(() => requests.delete(fingerprint));
  requests.set(fingerprint, work);
  return work;
}
export async function searchFlights(db, user, input) {
  const trip = tripFor(db, user, input?.trip_id); active(trip);
  let criteria; try { criteria = validateFlightSearch(input); } catch (e) { throw bad(e.message); }
  return run(db, user, trip, criteria, null, 0, [], 'search');
}
export async function nextFlights(db, user, input) {
  const row = readSearch(db, user, input?.search_id); const trip = tripFor(db, user, row.trip_id); active(trip);
  const body = json(row.payload, {}); const criteria = json(row.criteria, {}); const offer = getOffer(row, input.offer_id);
  if (!offer.departure_token) throw conflict('This itinerary has no further flight selection');
  const maxStages = criteria.type === 1 ? 2 : criteria.type === 3 ? criteria.legs.length : 1;
  if (body.stage + 1 >= maxStages) throw conflict('All itinerary legs have already been selected');
  return run(db, user, trip, criteria, offer.departure_token, body.stage + 1, [...body.selected, offer.view], 'next');
}
export async function bookingOptions(db, user, input) {
  const row = readSearch(db, user, input?.search_id); const trip = tripFor(db, user, row.trip_id); active(trip);
  const body = json(row.payload, {}); const criteria = json(row.criteria, {}); const offer = getOffer(row, input.offer_id);
  const legs = criteria.type === 1 ? 2 : criteria.type === 3 ? criteria.legs.length : 1;
  if (body.stage !== legs - 1 || !offer.booking_token) throw conflict('Select all itinerary legs before viewing booking options');
  return run(db, user, trip, criteria, offer.booking_token, body.stage, [...body.selected, offer.view], 'booking');
}
export function saveFlightOption(db, user, input) {
  const row = readSearch(db, user, input?.search_id); const trip = tripFor(db, user, row.trip_id, true); active(trip);
  const body = json(row.payload, {}); const criteria = json(row.criteria, {});
  let selected; let price;
  if (body.booking_options !== null && body.booking_options !== undefined) {
    selected = body.selected;
    // The selected itinerary price from the provider remains indicative, never a confirmed charge.
    const combined = body.booking_options.filter((o) => !o.separate && o.price !== null).map((o) => o.price);
    price = combined.length ? Math.min(...combined) : null;
  } else {
    const offer = getOffer(row, input?.offer_id);
    selected = [...body.selected, offer.view]; price = offer.view.price;
  }
  if (!selected?.length) throw bad('Select a flight itinerary');
  const snapshot = { criteria, selected, indicative_price: price, currency: 'INR', selected_legs: selected.length, total_legs: criteria.type === 1 ? 2 : criteria.type === 3 ? criteria.legs.length : 1 };
  const fingerprint = createHash('sha256').update(JSON.stringify({ criteria, flights: selected.map((o) => o.segments), price })).digest('hex');
  return db.tx(() => {
    const existing = db.get('SELECT id FROM flight_options WHERE trip_id=? AND user_id=? AND fingerprint=?', trip.id, user.id, fingerprint);
    if (existing) return { id: existing.id, status: 'Saved option', duplicate: true };
    const id = randomUUID();
    db.run('INSERT INTO flight_options(id,trip_id,user_id,fingerprint,snapshot,created_at) VALUES(?,?,?,?,?,?)', id, trip.id, user.id, fingerprint, snapshot, nowIso());
    audit(db, user, 'flight.option.save', 'trip', trip.id, 'Saved a flight travel option; no reservation or ticket issued');
    return { id, status: 'Saved option' };
  });
}
export function flightHistory(db, user, id) {
  const trip = tripFor(db, user, id);
  const searches = db.all('SELECT id,criteria,created_at,expires_at FROM flight_searches WHERE trip_id=? AND user_id=? ORDER BY created_at DESC LIMIT 20', trip.id, user.id).map((r) => ({ ...r, criteria: json(r.criteria, {}) }));
  const options = db.all('SELECT id,snapshot,created_at FROM flight_options WHERE trip_id=? ORDER BY created_at DESC', trip.id).map((r) => ({ ...r, snapshot: json(r.snapshot, {}), status: 'Saved option' }));
  return { searches, options };
}
export function resumeFlightSearch(db, user, id) { return publicSearch(readSearch(db, user, id)); }
