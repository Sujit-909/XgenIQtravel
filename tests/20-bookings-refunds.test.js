import test from 'node:test';
import assert from 'node:assert/strict';
import { api, fresh, tripBody, d, formWith } from './helpers';
import { getDb } from '@/lib/db';

async function approvedTrip(over = {}) {
  const t = (await api('emp', 'POST', '/trips', tripBody({ dep_date: d(15), ret_date: d(17), ...over }))).data;
  await api('emp', 'POST', `/trips/${t.id}/submit`);
  let guard = 0;
  while (guard++ < 4) {
    const cur = (await api('emp', 'GET', `/trips/${t.id}`)).data;
    if (cur.trip.status === 'Approved') break;
    const p = cur.approvals.find((a) => a.status === 'Pending'); if (!p) break;
    const who = { 'Amit Singh': 'mgr', 'Arvind Kapoor': 'head', 'Meera Iyer': 'owner', 'Karan Mehta': 'fin' }[p.approver_name];
    await api(who, 'POST', `/approvals/${p.id}/decision`, { decision: 'approve' });
  }
  return t;
}

test('services: validation, agency request, visa rules', async () => {
  fresh();
  const t = await approvedTrip();
  const base = { type: 'flight', channel: 'agency', details: { from: 'Bhubaneswar (BBI)', to: 'Mumbai (BOM)', depart_date: d(15) }, comment: 'Morning flight please' };
  assert.equal((await api('emp', 'POST', `/trips/${t.id}/services`, { ...base, comment: '' })).status, 400, 'comment mandatory');
  assert.equal((await api('emp', 'POST', `/trips/${t.id}/services`, { ...base, details: { from: 'x' } })).status, 400, 'required fields');
  const ok = await api('emp', 'POST', `/trips/${t.id}/services`, base); assert.equal(ok.status, 201); assert.equal(ok.data.desk_stage, 'Awaiting Agency Quote');
  assert.equal((await api('emp', 'GET', `/trips/${t.id}`)).data.trip.status, 'Booking In Progress');
  const draft = await api('emp', 'POST', `/trips/${t.id}/services`, { type: 'hotel', channel: 'agency', draft: true, details: {} }); assert.equal(draft.data.status, 'Draft');
  const visa = { type: 'visa', details: { country: 'Singapore', visa_type: 'Business', purpose: 'Meeting', passport_number: 'Z1234567', passport_expiry: d(900) }, comment: 'Please help' };
  assert.equal((await api('emp', 'POST', `/trips/${t.id}/services`, visa)).status, 409, 'visa not for domestic trips');
  // international trip: passport validity rule
  const it = await approvedTrip({ travel_type: 'International', dest_country: 'Singapore', dest_city: 'Singapore' });
  assert.equal((await api('emp', 'POST', `/trips/${it.id}/services`, { ...visa, details: { ...visa.details, passport_expiry: d(60) } })).status, 400, 'passport must be valid 6 months past travel');
  assert.equal((await api('emp', 'POST', `/trips/${it.id}/services`, visa)).status, 201);
  // draft trip cannot book
  const dr = (await api('emp', 'POST', '/trips', tripBody())).data;
  assert.equal((await api('emp', 'POST', `/trips/${dr.id}/services`, base)).status, 409);
});

test('desk flow: quote -> traveller accepts -> ticket issued; info request; rbac', async () => {
  fresh();
  const t = await approvedTrip();
  const s = (await api('emp', 'POST', `/trips/${t.id}/services`, { type: 'flight', channel: 'agency', details: { from: 'BBI', to: 'BOM', depart_date: d(15) }, comment: 'Need morning flight' })).data;
  assert.equal((await api('emp', 'POST', `/desk/${s.id}/action`, { action: 'add_quote' })).status, 403, 'employee blocked from desk actions');
  assert.equal((await api('desk', 'POST', `/desk/${s.id}/action`, { action: 'add_quote', supplier: 'IndiGo', amount: 0 })).status, 400);
  const dtl = (await api('desk', 'POST', `/desk/${s.id}/action`, { action: 'add_quote', supplier: 'IndiGo', reference: '6E1', amount: 7200, valid_till: d(3) })).data;
  const qid = dtl.quotes[0].id;
  assert.equal((await api('emp', 'GET', `/services/${s.id}`)).data.quotes.length, 0, 'unsent quotes hidden from traveller');
  await api('desk', 'POST', `/desk/${s.id}/action`, { action: 'send_quote', quote_id: qid });
  assert.equal((await api('emp', 'GET', `/services/${s.id}`)).data.quotes.length, 1);
  assert.equal((await api('desk', 'POST', `/desk/${s.id}/action`, { action: 'issue_ticket', supplier_ref: 'ABC123' })).status, 409, 'cannot ticket before acceptance');
  assert.equal((await api('emp', 'POST', `/services/${s.id}/respond`, { action: 'accept_quote', quote_id: qid })).status, 200);
  assert.equal((await api('emp', 'POST', `/services/${s.id}/respond`, { action: 'accept_quote', quote_id: qid })).status, 409, 'only one quote can be accepted');
  assert.equal((await api('desk', 'POST', `/desk/${s.id}/action`, { action: 'issue_ticket' })).status, 400, 'confirmation reference required');
  const done = await api('desk', 'POST', `/desk/${s.id}/action`, { action: 'issue_ticket', supplier_ref: 'PNR789', ticket_no: '098-1234567890' });
  assert.equal(done.data.service.status, 'Confirmed');
  const bk = (await api('emp', 'GET', '/bookings')).data.rows.find((b) => b.supplier_ref === 'PNR789'); assert.equal(bk.status, 'Confirmed');
  // request-info loop
  const s2 = (await api('emp', 'POST', `/trips/${t.id}/services`, { type: 'hotel', channel: 'agency', details: { city: 'Mumbai', check_in: d(15), check_out: d(17), rooms: 1 }, comment: 'hotel' })).data;
  await api('desk', 'POST', `/desk/${s2.id}/action`, { action: 'request_info', note: 'Which area?' });
  assert.equal((await api('emp', 'GET', `/services/${s2.id}`)).data.service.status, 'Awaiting Information');
  await api('emp', 'POST', `/services/${s2.id}/respond`, { action: 'reply', note: 'BKC' });
  assert.equal((await api('emp', 'GET', `/services/${s2.id}`)).data.service.status, 'Submitted');
  const q = await api('desk', 'GET', '/desk/queue'); assert.ok(q.data.counts.All >= 1);
});

test('policy-aware search and portal booking with exception approval', async () => {
  fresh();
  const t = await approvedTrip();
  const s = await api('emp', 'GET', `/search?kind=both&from=BBI&to=BOM&date=${d(15)}&return_date=${d(17)}&city=Mumbai&trip_id=${t.id}`);
  assert.equal(s.status, 200); assert.ok(s.data.flights.options.length >= 4); assert.ok(s.data.flights.recommendedId);
  assert.equal(s.data.flights.options.find((o) => o.id === s.data.flights.recommendedId).policy.status, 'Compliant');
  assert.ok(s.data.hotels.length && s.data.comparison.length);
  assert.equal((await api('emp', 'GET', `/search?kind=flight&from=BBI&to=BBI&date=${d(15)}`)).status, 400);
  const pick = s.data.flights.options.find((o) => o.id === s.data.flights.recommendedId);
  assert.equal((await api('emp', 'POST', `/trips/${t.id}/book`, { type: 'flight', offer_id: pick.id })).status, 400, 'comment mandatory');
  const bk = await api('emp', 'POST', `/trips/${t.id}/book`, { type: 'flight', offer_id: pick.id, comment: 'Booking recommended flight' });
  assert.equal(bk.status, 201); assert.equal(bk.data.booking.status, 'Confirmed'); assert.equal(bk.data.exception, false);
  assert.equal((await api('emp', 'POST', `/trips/${t.id}/book`, { type: 'flight', offer_id: pick.id, comment: 'again' })).status, 409, 'duplicate booking blocked');
  // expensive option => exception requiring justification and approval
  const costly = s.data.flights.options.filter((o) => o.id !== pick.id && o.policy.status !== 'Compliant' && o.bookable)[0] || s.data.flights.options.find((o) => o.fare > 15000);
  if (costly) {
    const r1 = await api('emp', 'POST', `/trips/${t.id}/book`, { type: 'flight', offer_id: costly.id, comment: 'x' });
    assert.ok([400, 409].includes(r1.status));
  }
  // international: Emirates 1-stop > 8h is an exception for Singapore
  const it = await approvedTrip({ travel_type: 'International', dest_country: 'Singapore', dest_city: 'Singapore', est_budget: 200000 });
  const si = (await api('emp', 'GET', `/search?kind=flight&from=BOM&to=SIN&date=${d(15)}&trip_id=${it.id}`)).data;
  const sq = si.options?.find?.(() => true) || si.flights.options[0];
  const exc = si.flights.options.find((o) => o.policy.status !== 'Compliant' && o.bookable);
  assert.ok(exc, 'international search yields at least one non-compliant option');
  const nj = await api('emp', 'POST', `/trips/${it.id}/book`, { type: 'flight', offer_id: exc.id, comment: 'Booking' });
  assert.equal(nj.status, 400); assert.equal(nj.data.requiresJustification, true);
  const ex = await api('emp', 'POST', `/trips/${it.id}/book`, { type: 'flight', offer_id: exc.id, comment: 'Booking', justification: 'Only option that reaches the client on time' });
  assert.equal(ex.status, 201); assert.equal(ex.data.exception, true); assert.equal(ex.data.booking.status, 'Created');
  void sq;
  const appr = (await api('mgr', 'GET', '/approvals?type=booking')).data.rows; assert.ok(appr.length >= 1);
  await api('mgr', 'POST', `/approvals/${appr[0].approval_id}/decision`, { decision: 'approve' });
  let b = (await api('emp', 'GET', `/bookings/${ex.data.booking.id}`)).data.booking;
  if (b.status !== 'Confirmed') { const a2 = (await api('fin', 'GET', '/approvals?type=booking')).data.rows; for (const a of a2) await api('fin', 'POST', `/approvals/${a.approval_id}/decision`, { decision: 'approve' }); b = (await api('emp', 'GET', `/bookings/${ex.data.booking.id}`)).data.booking; }
  assert.equal(b.status, 'Confirmed'); assert.ok(b.ticket_no);
  // hotel + ground
  const h = s.data.hotels[0];
  assert.equal((await api('emp', 'POST', `/trips/${t.id}/book`, { type: 'hotel', offer_id: h.id, comment: 'Hotel near client' })).status, 201);
  const gt = (await api('emp', 'GET', '/search?kind=ground&transport=Airport%20Transfer&passengers=1')).data.vehicles[0];
  assert.equal((await api('emp', 'POST', `/trips/${t.id}/book`, { type: 'ground', offer_id: gt.id, comment: 'Airport pickup', pickup: 'BOM', dropoff: 'Hotel', pickup_date: d(15), pickup_time: '11:00', transport_type: 'Airport Transfer' })).status, 201);
});

test('sold-out booking fails, is recorded, and alerts the traveller', async () => {
  fresh(); const t = await approvedTrip(); const db = getDb();
  // availability is deterministic per route/date: scan forward until an offer is sold out
  let sold = null;
  for (let i = 15; i < 60 && !sold; i++) {
    const s = (await api('emp', 'GET', `/search?kind=flight&from=BBI&to=BOM&date=${d(i)}&trip_id=${t.id}`)).data;
    sold = s.flights.options.find((o) => !o.bookable);
  }
  assert.ok(sold, 'a sold-out offer exists in the mock inventory');
  const r = await api('emp', 'POST', `/trips/${t.id}/book`, { type: 'flight', offer_id: sold.id, comment: 'try' });
  assert.equal(r.status, 409); assert.equal(r.data.failed, true);
  assert.ok(db.get("SELECT 1 x FROM services WHERE status='Failed' AND trip_id=?", t.id));
  assert.ok(db.get("SELECT 1 x FROM notifications WHERE title='Booking failed'"));
  assert.equal(db.get('SELECT COUNT(*) c FROM bookings WHERE trip_id=?', t.id).c, 0, 'no booking row is created for a failed attempt');
});

test('cancellation creates refund case; refund workflow and recovery KPI', async () => {
  fresh(); const t = await approvedTrip(); const db = getDb();
  const s = (await api('emp', 'GET', `/search?kind=flight&from=BBI&to=BOM&date=${d(15)}&trip_id=${t.id}`)).data;
  const pick = s.flights.options.find((o) => o.id === s.flights.recommendedId);
  const bk = (await api('emp', 'POST', `/trips/${t.id}/book`, { type: 'flight', offer_id: pick.id, comment: 'book' })).data.booking;
  assert.equal((await api('emp', 'POST', `/bookings/${bk.id}/cancel`, {})).status, 400, 'reason required');
  assert.equal((await api('emp', 'POST', `/bookings/${bk.id}/cancel`, { reason: 'Changed Plan' })).status, 200);
  assert.equal((await api('emp', 'POST', `/bookings/${bk.id}/cancel`, { reason: 'Changed Plan' })).status, 409, 'already cancelled');
  const rf = (await api('emp', 'GET', `/refunds/${bk.id}`)).data.refund;
  assert.equal(rf.status, 'Expected'); assert.equal(rf.expected_refund, pick.fare - Math.round(pick.fare * 0.1) - 500);
  assert.equal((await api('emp', 'POST', `/refunds/${bk.id}/action`, { action: 'status', status: 'Requested' })).status, 403, 'traveller cannot change refund status');
  assert.equal((await api('desk', 'POST', `/refunds/${bk.id}/action`, { action: 'status', status: 'Credited', amount: rf.expected_refund, txn_id: 'T1' })).status, 409, 'must follow the status path');
  await api('desk', 'POST', `/refunds/${bk.id}/action`, { action: 'status', status: 'Requested' });
  await api('desk', 'POST', `/refunds/${bk.id}/action`, { action: 'status', status: 'Supplier Confirmed' });
  assert.equal((await api('fin', 'POST', `/refunds/${bk.id}/action`, { action: 'status', status: 'Credited', amount: rf.expected_refund })).status, 400, 'txn id required');
  assert.equal((await api('fin', 'POST', `/refunds/${bk.id}/action`, { action: 'status', status: 'Credited', amount: rf.expected_refund + 50, txn_id: 'T9' })).status, 400, 'cannot exceed expected');
  assert.equal((await api('fin', 'POST', `/refunds/${bk.id}/action`, { action: 'status', status: 'Credited', amount: rf.expected_refund - 100, txn_id: 'T9' })).status, 400, 'partial must use Partially Credited');
  const done = await api('fin', 'POST', `/refunds/${bk.id}/action`, { action: 'status', status: 'Credited', amount: rf.expected_refund, txn_id: 'T9', credit_date: d(0) });
  assert.equal(done.status, 200); assert.equal(done.data.status, 'Credited');
  const all = (await api('fin', 'GET', '/refunds')).data;
  const rows = db.all('SELECT * FROM refunds');
  const exp = rows.filter((r) => !['Not Applicable', 'Rejected'].includes(r.status) && r.expected_refund > 0).reduce((s, r) => s + r.expected_refund, 0);
  const act = rows.filter((r) => !['Not Applicable', 'Rejected'].includes(r.status) && r.expected_refund > 0).reduce((s, r) => s + r.actual_refund, 0);
  assert.equal(all.kpis.recoveryRate, Math.round((act / exp) * 10000) / 100, 'recovery rate = credited / expected refundable');
  assert.ok(all.rows.some((r) => r.days_overdue > 0 && r.display_status), 'overdue refunds are flagged');
  // trip cancellation cancels bookings and opens refund cases
  const t2 = await approvedTrip(); const s2 = (await api('emp', 'GET', `/search?kind=flight&from=BBI&to=DEL&date=${d(15)}&trip_id=${t2.id}`)).data;
  const p2 = s2.flights.options.find((o) => o.id === s2.flights.recommendedId);
  await api('emp', 'POST', `/trips/${t2.id}/book`, { type: 'flight', offer_id: p2.id, comment: 'book' });
  await api('emp', 'POST', `/trips/${t2.id}/cancel`, { reason: 'Client cancelled' });
  assert.equal(db.get("SELECT status FROM bookings WHERE trip_id=?", t2.id).status, 'Cancelled');
  assert.ok(db.get('SELECT 1 x FROM refunds r JOIN bookings b ON b.id=r.booking_id WHERE b.trip_id=?', t2.id));
});

test('booking change request creates desk work; access control on bookings', async () => {
  fresh(); const db = getDb();
  const mine = (await api('emp', 'GET', '/bookings')).data.rows.find((b) => b.status === 'Confirmed' && b.trip_id);
  assert.equal((await api('emp', 'POST', `/bookings/${mine.id}/change`, { new_date: d(40) })).status, 400, 'reason mandatory');
  const ch = await api('emp', 'POST', `/bookings/${mine.id}/change`, { new_date: d(40), reason: 'Client moved the meeting' }); assert.equal(ch.status, 201);
  assert.equal(ch.data.change_of_booking, mine.id);
  const other = db.get("SELECT id FROM bookings WHERE traveller_id!=(SELECT id FROM users WHERE email='sujit@xgeniq.com') LIMIT 1");
  assert.equal((await api('emp', 'GET', `/bookings/${other.id}`)).status, 403);
  assert.equal((await api('emp', 'GET', '/bookings?scope=team')).data.rows.length, 0, 'employee has no team');
  assert.ok((await api('mgr', 'GET', '/bookings?scope=team')).data.rows.length > 5);
});
void formWith;
