import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { fresh, api, raw, EMAILS, d } from './helpers';
import { validateFlightSearch, airportCode, filterFlights } from '@/lib/flight-search';
import { fetchGoogleFlights, normalizeBookingOptions, normalizeItinerary } from '@/lib/providers/serpapi';
import { searchFlights, nextFlights, bookingOptions, saveFlightOption, flightHistory } from '@/lib/services/flights';
import FlightPortal from '@/views/flight-portal';

// Provider-shaped test responses; these never enter production inventory.
const flight = (tokens = {}) => ({ price: 12345, total_duration: 145, airline_logo: 'https://www.gstatic.com/flights/airline_logos/70px/AI.png', flights: [{ departure_airport: { id: 'BBI', name: 'Bhubaneswar', time: `${d(30)} 08:10` }, arrival_airport: { id: 'BOM', name: 'Mumbai', time: `${d(30)} 10:35` }, duration: 145, airline: 'Air India', travel_class: 'Economy', flight_number: 'AI 123' }], ...tokens });
const query = (trip_id, type = 2) => ({ trip_id, type, departure_id: 'BBI', arrival_id: 'BOM', outbound_date: d(30), return_date: d(35), adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0, travel_class: 1, legs: [{ departure_id: 'BBI', arrival_id: 'BOM', date: d(30) }, { departure_id: 'BOM', arrival_id: 'DEL', date: d(32) }, { departure_id: 'DEL', arrival_id: 'BBI', date: d(35) }] });
function setup() {
  const db = fresh(); const user = db.get('SELECT * FROM users WHERE email=?', EMAILS.emp);
  const trip = db.get('SELECT * FROM trips WHERE traveller_id=? LIMIT 1', user.id);
  db.run("UPDATE trips SET status='Approved',dep_date=?,ret_date=? WHERE id=?", d(30), d(35), trip.id);
  return { db, user, trip: { ...trip, status: 'Approved', dep_date: d(30), ret_date: d(35) } };
}
async function provider(responses, run) {
  const oldFetch = global.fetch; const oldKey = process.env.SERPAPI_API_KEY; const calls = [];
  process.env.SERPAPI_API_KEY = 'test-only-provider-key';
  global.fetch = async (url) => { calls.push(new URL(url)); const body = responses.shift(); if (body instanceof Error) throw body; return new Response(JSON.stringify(body ?? {}), { status: 200 }); };
  try { await run(calls); } finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.SERPAPI_API_KEY; else process.env.SERPAPI_API_KEY = oldKey; }
}

test('flight validation covers cities, trip types, passengers, cabins and invalid dates', () => {
  assert.equal(airportCode('Mumbai'), 'BOM'); assert.equal(airportCode('Delhi (DEL)'), 'DEL');
  for (const type of [1, 2, 3]) for (const travel_class of [1, 2, 3, 4]) {
    const c = validateFlightSearch({ ...query(1, type), travel_class, children: 2, infants_in_seat: 1, infants_on_lap: 1 });
    assert.equal(c.travel_class, travel_class); assert.equal(c.children, 2);
    if (type === 2) assert.equal(c.return_date, undefined);
    if (type === 3) assert.equal(c.legs.length, 3);
  }
  for (const patch of [{ departure_id: 'INVALID' }, { arrival_id: 'BBI' }, { outbound_date: '2026-02-30' }, { outbound_date: d(-1) }, { type: 1, return_date: d(29) }, { adults: 0 }, { adults: 1.5 }, { infants_on_lap: 2 }, { adults: 9, children: 1 }, { travel_class: 5 }, { type: 9 }, { type: 3, legs: [] }]) assert.throws(() => validateFlightSearch({ ...query(1), ...patch }));
});

test('null provider rows and optional flight details do not crash discovery', async () => {
  const {db,user,trip}=setup();
  const offer=flight();offer.flights.push(null);offer.layovers=[null];
  await provider([{best_flights:[null,offer],other_flights:[null]}],async()=>{
    const found=await searchFlights(db,user,query(trip.id));assert.equal(found.rows.length,1);assert.equal(found.rows[0].segments.length,1);assert.equal(found.rows[0].stops,0);assert.deepEqual(found.rows[0].layovers,[]);
  });
  assert.deepEqual(normalizeBookingOptions({booking_options:[null,{together:[null]}]}),[]);
});

test('one-way discovery is deduplicated, cached, private and saves server prices without bookings', async () => {
  const { db, user, trip } = setup();
  await provider([{ best_flights: [flight({ booking_token: 'private-booking-token' })], search_parameters: { api_key: 'must-never-reach-client' } }], async (calls) => {
    const [a, b] = await Promise.all([searchFlights(db, user, query(trip.id)), searchFlights(db, user, query(trip.id))]);
    assert.equal(a.search_id, b.search_id); assert.equal(calls.length, 1);
    assert.equal((await searchFlights(db, user, query(trip.id))).search_id, a.search_id);
    assert.equal(calls.length, 1); assert.equal(calls[0].searchParams.get('engine'), 'google_flights');
    assert.equal(calls[0].searchParams.get('type'), '2'); assert.equal(calls[0].searchParams.has('return_date'), false);
    assert.equal(calls[0].searchParams.get('currency'), 'INR'); assert.equal(calls[0].searchParams.get('gl'), 'in');
    assert.doesNotMatch(JSON.stringify(a), /private-booking-token|api_key|must-never-reach-client/);
    const before = db.get('SELECT COUNT(*) c FROM bookings').c;
    const saved = saveFlightOption(db, user, { search_id: a.search_id, offer_id: a.rows[0].id, price: 1, status: 'Confirmed' });
    assert.equal(saved.status, 'Saved option'); assert.equal(db.get('SELECT COUNT(*) c FROM bookings').c, before);
    assert.equal(flightHistory(db, user, trip.id).options[0].snapshot.indicative_price, 12345);
    assert.equal(saveFlightOption(db, user, { search_id: a.search_id, offer_id: a.rows[0].id }).duplicate, true);
    const other = db.get("SELECT * FROM users WHERE role='employee' AND id!=? LIMIT 1", user.id);
    await assert.rejects(() => nextFlights(db, other, { search_id: a.search_id, offer_id: a.rows[0].id }), (e) => e.status === 404);
    assert.throws(() => saveFlightOption(db, user, { search_id: a.search_id, offer_id: 'tampered' }), (e) => e.status === 400);
    db.run('UPDATE flight_searches SET expires_at=? WHERE id=?', '2000-01-01', a.search_id);
    assert.throws(() => saveFlightOption(db, user, { search_id: a.search_id, offer_id: a.rows[0].id }), (e) => e.status === 410);
  });
});

test('round-trip sends the outbound departure token and uses booking token only after return selection', async () => {
  const { db, user, trip } = setup();
  await provider([{ best_flights: [flight({ departure_token: 'outbound-token' })] }, { other_flights: [flight({ booking_token: 'return-booking-token' })] }, { selected_flights: [flight(), flight()], booking_options: [{ together: { book_with: 'Air India', airline: true, price: 22000, booking_request: { url: 'https://www.google.com/travel/clk/f', post_data: 'u=some%2Bvalue&source=flights' } } }] }], async (calls) => {
    const a = await searchFlights(db, user, query(trip.id, 1));
    await assert.rejects(() => bookingOptions(db, user, { search_id: a.search_id, offer_id: a.rows[0].id }), (e) => e.status === 409);
    const b = await nextFlights(db, user, { search_id: a.search_id, offer_id: a.rows[0].id });
    assert.equal(b.stage, 1); assert.equal(b.selected.length, 1);
    assert.equal(calls[1].searchParams.get('departure_token'), 'outbound-token');
    assert.equal(calls[1].searchParams.get('return_date'), d(35));
    const c = await bookingOptions(db, user, { search_id: b.search_id, offer_id: b.rows[0].id });
    assert.equal(c.selected.length, 2); assert.equal(c.booking_options[0].price, 22000);
    assert.equal(c.booking_options[0].request.fields[0].value, 'some+value');
    assert.equal(calls[2].searchParams.get('booking_token'), 'return-booking-token');
    assert.equal(calls[2].searchParams.has('departure_token'), false);
    saveFlightOption(db, user, { search_id: c.search_id });
    assert.equal(flightHistory(db, user, trip.id).options[0].snapshot.indicative_price, 22000);
  });
});

test('multi-city follows each departure token while retaining all original legs', async () => {
  const { db, user, trip } = setup();
  await provider([{ best_flights: [flight({ departure_token: 'leg-one' })] }, { best_flights: [flight({ departure_token: 'leg-two' })] }, { other_flights: [flight({ booking_token: 'all-legs' })] }, { booking_options: [] }], async (calls) => {
    let a = await searchFlights(db, user, query(trip.id, 3));
    for (let i = 0; i < 2; i++) a = await nextFlights(db, user, { search_id: a.search_id, offer_id: a.rows[0].id });
    assert.equal(a.stage, 2); assert.equal(a.selected.length, 2);
    const final = await bookingOptions(db, user, { search_id: a.search_id, offer_id: a.rows[0].id });
    assert.equal(final.selected.length, 3); assert.deepEqual(final.booking_options, []);
    for (const url of calls) { assert.equal(JSON.parse(url.searchParams.get('multi_city_json')).length, 3); assert.equal(url.searchParams.has('outbound_date'), false); assert.equal(url.searchParams.has('return_date'), false); }
  });
});

test('provider failures, empty results, missing fields, separate tickets and unsafe links are handled', async () => {
  const { db, user, trip } = setup();
  await provider([{ best_flights: [], other_flights: [] }], async () => { assert.deepEqual((await searchFlights(db, user, query(trip.id))).rows, []); });
  await provider([{ error: 'An upstream URL containing api_key=secret' }, { error: 'Expired token' }], async () => {
    await assert.rejects(() => fetchGoogleFlights({}), (e) => e.status === 502 && !/secret|api_key/.test(e.message));
    await assert.rejects(() => fetchGoogleFlights({ departure_token: 'expired' }), (e) => e.status === 410);
  });
  await provider([new DOMException('timeout', 'TimeoutError')], async () => { await assert.rejects(() => fetchGoogleFlights({}), (e) => e.status === 504); });
  await provider([], async () => {
    await assert.rejects(() => fetchGoogleFlights({}, { fetcher: async () => new Response('{}', { status: 429 }) }), (e) => e.status === 429);
    await assert.rejects(() => fetchGoogleFlights({ booking_token: 'expired' }, { fetcher: async () => new Response('{}', { status: 400 }) }), (e) => e.status === 410);
    await assert.rejects(() => fetchGoogleFlights({}, { fetcher: async () => new Response('{}', { status: 400 }) }), (e) => e.status === 400);
    await assert.rejects(() => fetchGoogleFlights({}, { fetcher: async () => new Response('invalid json') }), (e) => e.status === 502);
  });
  assert.equal(normalizeItinerary({ flights: [{}] }, 'id').price, null);
  const options = normalizeBookingOptions({ booking_options: [{ separate_tickets: true, departing: { book_with: 'A', airline: true, booking_request: { url: 'javascript:alert(1)' } }, returning: { book_with: 'B', booking_phone: '123' } }] });
  assert.equal(options.length, 2); assert.equal(options[0].request, null); assert.equal(options[1].separate, true);
  const rows = [normalizeItinerary(flight(), 'one'), normalizeItinerary({ ...flight(), price: 999, total_duration: 200 }, 'two')];
  assert.equal(filterFlights(rows, { stops: '', sort: 'cheapest' })[0].id, 'two');
  assert.equal(filterFlights(rows, { stops: '', max_duration: '150' }).length, 1);
  assert.equal(filterFlights(rows, { stops: '1' }).length, 0);
});

test('flight endpoints require authentication, trip access, valid status and a configured server key', async () => {
  const { db, user, trip } = setup();
  assert.equal((await raw('POST', '/flights/search', { body: query(trip.id) })).status, 401);
  const otherTrip = db.get('SELECT id FROM trips WHERE traveller_id!=? AND created_by!=? LIMIT 1', user.id, user.id);
  assert.equal((await api('emp', 'POST', '/flights/search', query(otherTrip.id))).status, 403);
  db.run("UPDATE trips SET status='Draft' WHERE id=?", trip.id);
  assert.equal((await api('emp', 'POST', '/flights/search', query(trip.id))).status, 409);
  db.run("UPDATE trips SET status='Approved' WHERE id=?", trip.id);
  const key = process.env.SERPAPI_API_KEY; delete process.env.SERPAPI_API_KEY;
  try { assert.equal((await api('emp', 'POST', '/flights/search', query(trip.id))).status, 503); } finally { if (key !== undefined) process.env.SERPAPI_API_KEY = key; }
  const html = renderToString(React.createElement(FlightPortal, { trip }));
  assert.match(html, /Search Flights/); assert.match(html, /Multi-city/); assert.match(html, /Infants \(on lap\)/); assert.doesNotMatch(html, /api_key|test-only-provider-key|Confirm Booking/);
});

test('rate limit is shared in SQLite and prevents excess provider requests', async () => {
  const { db, user, trip } = setup();
  db.run('INSERT INTO flight_rate_limits(bucket,window,count) VALUES(?,?,10)', `user:${user.id}`, Math.floor(Date.now() / 60000));
  await provider([], async (calls) => { await assert.rejects(() => searchFlights(db, user, query(trip.id)), (e) => e.status === 429); assert.equal(calls.length, 0); });
});
