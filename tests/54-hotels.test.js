import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { fresh, EMAILS, d, raw, api } from './helpers';
import { validateHotelSearch, hotelParameters } from '@/lib/hotel-search';
import { normalizeHotel, publicHotel } from '@/lib/providers/hotels';
import { fetchGoogleHotels } from '@/lib/providers/serpapi';
import { searchHotels, nextHotelPage, hotelDetails, hotelHistory, redirectHotel, requestHotel } from '@/lib/services/hotels';
import { deskAction, travellerRespond } from '@/lib/services/desk';
import { decide } from '@/lib/services/approvals';
import HotelPortal from '@/views/hotel-portal';

// Test-only responses follow the provider's documented shape.
const hotel = () => ({ name: 'Test property', property_token: 'server-property-token', address: 'Mumbai, India', type: 'hotel', hotel_class: '4-star hotel', extracted_hotel_class: 4, overall_rating: 4.4, reviews: 200,
  images: [{ thumbnail: 'https://example.com/hotel.jpg' }], amenities: ['Free Wi-Fi', 'Pool'], rate_per_night: { lowest: '₹10,000', extracted_lowest: 10000 }, total_rate: { lowest: '₹20,000', extracted_lowest: 20000 },
  prices: [{ source: 'Provider', link: 'https://example.com/book?stay=2', official: false, rate_per_night: { extracted_lowest: 10000 }, total_rate: { extracted_lowest: 20000 }, free_cancellation: true, free_cancellation_until_date: 'Dec 1' }] });
const input = (trip_id) => ({ trip_id, q: 'Mumbai', check_in_date: d(30), check_out_date: d(32), adults: 2, children: 1, children_ages: [8], rooms: 1 });
function setup() {
  const db = fresh(); const user = db.get('SELECT * FROM users WHERE email=?', EMAILS.emp); const trip = db.get('SELECT * FROM trips WHERE traveller_id=? LIMIT 1', user.id);
  db.run("UPDATE trips SET status='Approved',dep_date=?,ret_date=?,est_budget=1000000 WHERE id=?", d(30), d(32), trip.id);
  db.run("UPDATE policy_rules SET conditions=? WHERE type='Hotel'", { tier: 'Metro', maxPerNight: 50000 });
  return { db, user, trip };
}
async function mockProvider(responses, fn) {
  const old = global.fetch; const key = process.env.SERPAPI_API_KEY; const calls = [];
  process.env.SERPAPI_API_KEY = 'hotel-test-only-key';
  global.fetch = async (url) => { calls.push(new URL(url)); const body = responses.shift(); if (body instanceof Error) throw body; return new Response(JSON.stringify(body ?? {})); };
  try { await fn(calls); } finally { global.fetch = old; if (key === undefined) delete process.env.SERPAPI_API_KEY; else process.env.SERPAPI_API_KEY = key; }
}

test('null property rows and optional hotel details do not crash discovery', async () => {
  const {db,user,trip}=setup();const property=hotel();property.images.push(null);property.prices.push(null);property.amenities.push(null);
  await mockProvider([{properties:[null,property]}],async()=>{const found=await searchHotels(db,user,input(trip.id));assert.equal(found.properties.length,1);assert.equal(found.properties[0].name,'Test property');assert.ok(found.properties[0].images.length);});
});

test('hotel validation and parameter mapping use only supported optional fields', () => {
  const criteria = validateHotelSearch({ ...input(1), sort_by: 3, rating: 8, hotel_class: 4, amenities: [35, 9], property_types: 17, free_cancellation: true, special_offers: true });
  const p = hotelParameters(criteria);
  assert.equal(p.children_ages, '8'); assert.equal(p.amenities, '9,35'); assert.equal(p.sort_by, 3); assert.equal(p.rating, 8); assert.equal(p.property_types, 17);
  assert.equal(p.rooms, undefined); assert.equal(p.free_cancellation, true); assert.equal(p.special_offers, true);
  assert.deepEqual(Object.keys(hotelParameters(criteria, true)).sort(), ['adults', 'check_in_date', 'check_out_date', 'children', 'children_ages']);
  const plain = hotelParameters(validateHotelSearch(input(1)));
  for (const key of ['min_price', 'max_price', 'sort_by', 'amenities', 'free_cancellation', 'special_offers']) assert.equal(key in plain, false);
  for (const patch of [{ q: '' }, { check_in_date: d(-1) }, { check_in_date: '2026-02-30' }, { check_out_date: d(30) }, { adults: 0 }, { rooms: 0 }, { children_ages: [] }, { children_ages: [18] }, { min_price: 20, max_price: 10 }, { sort_by: 1 }, { amenities: [999] }, { rating: 5 }, { free_cancellation: 'invalid' }]) assert.throws(() => validateHotelSearch({ ...input(1), ...patch }));
});

test('hotel search deduplicates provider calls, caches, keeps tokens private and scopes history', async () => {
  const { db, user, trip } = setup();
  await mockProvider([{ properties: [hotel()], search_parameters: { api_key: 'upstream-secret' }, serpapi_pagination: { next_page_token: 'next-private', next: 'https://unsafe.example.com' } }], async (calls) => {
    const [a, b] = await Promise.all([searchHotels(db, user, input(trip.id)), searchHotels(db, user, input(trip.id))]);
    assert.equal(a.search_id, b.search_id); assert.equal(calls.length, 1);
    assert.equal((await searchHotels(db, user, input(trip.id))).search_id, a.search_id);
    assert.equal(calls[0].hostname, 'serpapi.com'); assert.equal(calls[0].searchParams.get('engine'), 'google_hotels'); assert.equal(calls[0].searchParams.get('currency'), 'INR'); assert.equal(calls[0].searchParams.get('children_ages'), '8'); assert.equal(calls[0].searchParams.has('rooms'), false);
    assert.doesNotMatch(JSON.stringify(a), /server-property-token|next-private|upstream-secret|api_key|example.com\/book/);
    assert.equal(a.has_next, true); assert.equal(a.properties[0].rates[0].canRedirect, true);
    assert.equal(hotelHistory(db, user, trip.id).searches.length, 1);
    const other = db.get("SELECT * FROM users WHERE role='employee' AND id!=? LIMIT 1", user.id);
    await assert.rejects(() => nextHotelPage(db, other, { search_id: a.search_id }), (e) => e.status === 404);
  });
});

test('property details and pagination retain criteria and use only server-held tokens', async () => {
  const { db, user, trip } = setup();
  await mockProvider([{ properties: [hotel()], serpapi_pagination: { next_page_token: 'next-page' } }, hotel(), { properties: [{ ...hotel(), name: 'Next property' }] }], async (calls) => {
    const a = await searchHotels(db, user, { ...input(trip.id), amenities: [35], rating: 8, sort_by: 13 });
    const b = await hotelDetails(db, user, { search_id: a.search_id, property_id: a.properties[0].id, property_token: 'tampered' });
    assert.equal(b.properties[0].address, 'Mumbai, India'); assert.equal(calls[1].searchParams.get('property_token'), 'server-property-token'); assert.equal(calls[1].searchParams.has('sort_by'), false);
    const c = await nextHotelPage(db, user, { search_id: a.search_id, next_page_token: 'tampered' });
    assert.equal(c.page, 2); assert.equal(c.properties[0].name, 'Next property'); assert.equal(calls[2].searchParams.get('next_page_token'), 'next-page'); assert.equal(calls[2].searchParams.get('sort_by'), '13'); assert.equal(calls[2].searchParams.get('rating'), '8');
    await assert.rejects(() => nextHotelPage(db, user, { search_id: c.search_id }), (e) => e.status === 409);
  });
});

test('provider redirect is authorized, uses verified URLs and never creates a reservation', async () => {
  const { db, user, trip } = setup();
  await mockProvider([{ properties: [hotel()] }], async () => {
    const a = await searchHotels(db, user, input(trip.id)); const h = a.properties[0]; const ids = { search_id: a.search_id, property_id: h.id, rate_id: h.rates[0].id, url: 'https://tampered.example' };
    const before = db.get('SELECT COUNT(*) c FROM bookings').c;
    const r = redirectHotel(db, user, ids);
    assert.equal(r.status, 302); assert.equal(r.headers.get('location'), 'https://example.com/book?stay=2'); assert.equal(db.get('SELECT COUNT(*) c FROM bookings').c, before);
    assert.throws(() => redirectHotel(db, user, { ...ids, rate_id: 'invalid' }), (e) => e.status === 400);
    db.run("UPDATE trips SET est_budget=1 WHERE id=?", trip.id);
    assert.throws(() => redirectHotel(db, user, ids), (e) => e.status === 409);
    db.run("UPDATE hotel_searches SET expires_at='2000-01-01' WHERE id=?", a.search_id);
    assert.throws(() => redirectHotel(db, user, ids), (e) => e.status === 410);
  });
});

test('hotel preference reuses desk and approval workflows without confirming on approval', async () => {
  const { db, user, trip } = setup();
  await mockProvider([{ properties: [hotel()] }], async () => {
    const a = await searchHotels(db, user, input(trip.id)); const h = a.properties[0];
    const body = { search_id: a.search_id, property_id: h.id, rate_id: h.rates[0].id, comment: 'Please arrange this hotel', price: 1, status: 'Confirmed' };
    const before = db.get('SELECT COUNT(*) c FROM bookings').c;
    const s = requestHotel(db, user, body);
    assert.equal(s.status, 'Submitted'); assert.equal(s.channel, 'agency'); assert.equal(db.get('SELECT COUNT(*) c FROM bookings').c, before);
    const saved = JSON.parse(s.details); assert.equal(saved.quoted_nightly, 10000); assert.equal(saved.quoted_total, 20000);
    assert.equal(requestHotel(db, user, body).duplicate, true);
    db.run("UPDATE policy_rules SET conditions=? WHERE type='Hotel'", { tier: 'Metro', maxPerNight: 1000 });
    assert.throws(() => requestHotel(db, user, { ...body, rate_id: undefined }), (e) => e.status === 400);
    const desk = db.get('SELECT * FROM users WHERE email=?', EMAILS.desk);
    const quote = deskAction(db, desk, s.id, { action: 'add_quote', supplier: 'Actual agency', amount: 40000, valid_till: d(4) }).quotes[0];
    deskAction(db, desk, s.id, { action: 'send_quote', quote_id: quote.id });
    travellerRespond(db, user, s.id, { action: 'accept_quote', quote_id: quote.id });
    const booking = db.get('SELECT * FROM bookings WHERE service_id=?', s.id); assert.equal(booking.status, 'Created'); assert.equal(booking.supplier_ref, null);
    const approval = db.get("SELECT * FROM approvals WHERE entity_type='booking' AND entity_id=? AND status='Pending'", booking.id);
    assert.ok(approval); const manager = db.get('SELECT * FROM users WHERE id=?', approval.approver_id);
    decide(db, manager, approval.id, { decision: 'approve' });
    assert.equal(db.get('SELECT status FROM bookings WHERE id=?', booking.id).status, 'Ticketing Pending');
    assert.equal(db.get('SELECT supplier_ref FROM bookings WHERE id=?', booking.id).supplier_ref, null);
    assert.throws(() => deskAction(db, desk, s.id, { action: 'complete' }), (e) => e.status === 400);
  });
});

test('empty results, missing fields, unsafe URLs, provider failures and quota errors are handled', async () => {
  const { db, user, trip } = setup();
  await mockProvider([{ properties: [] }], async () => { assert.deepEqual((await searchHotels(db, user, input(trip.id))).properties, []); });
  const h = publicHotel(normalizeHotel({ name: 'No optional data', prices: [{ source: 'No safe link', link: 'javascript:alert(1)' }] }, 'id'));
  assert.equal(h.nightly.amount, null); assert.deepEqual(h.images, []); assert.equal(h.rates[0].canRedirect, false);
  await mockProvider([{ error: 'No results found' }, { error: 'secret-url?api_key=do-not-show' }, new DOMException('timeout', 'TimeoutError')], async () => {
    assert.deepEqual(await fetchGoogleHotels({}), { properties: [] });
    await assert.rejects(() => fetchGoogleHotels({}), (e) => e.status === 502 && !/api_key|do-not-show/.test(e.message));
    await assert.rejects(() => fetchGoogleHotels({}), (e) => e.status === 504);
    await assert.rejects(() => fetchGoogleHotels({}, { fetcher: async () => new Response('{}', { status: 429 }) }), (e) => e.status === 429);
    await assert.rejects(() => fetchGoogleHotels({ property_token: 'expired' }, { fetcher: async () => new Response('{}', { status: 400 }) }), (e) => e.status === 410);
  });
});

test('hotel endpoints require authentication and active trip access; the UI contains no secret or confirmation action', async () => {
  const { db, user, trip } = setup();
  assert.equal((await raw('POST', '/hotels/search', { body: input(trip.id) })).status, 401);
  const other = db.get('SELECT id FROM trips WHERE traveller_id!=? AND created_by!=? LIMIT 1', user.id, user.id);
  assert.equal((await api('emp', 'POST', '/hotels/search', input(other.id))).status, 403);
  db.run("UPDATE trips SET status='Draft' WHERE id=?", trip.id);
  assert.equal((await api('emp', 'POST', '/hotels/search', input(trip.id))).status, 409);
  const html = renderToString(React.createElement(HotelPortal, { trip }));
  for (const label of ['Destination / city', 'Check-in date', 'Check-out date', 'Adults', 'Children', 'Rooms requested', 'Search Hotels', 'Lowest price', 'Highest rating', 'Most reviewed', 'Free cancellation', 'Special offers']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /hotel-test-only-key|api_key|Confirm Booking/);
});
