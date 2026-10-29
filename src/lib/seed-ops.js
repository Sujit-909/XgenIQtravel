import { addDays, today, nowIso, insert, pad } from './util';
import { calcReport, itemTotal, FX_SOURCE } from './calc';
import { pnr } from './providers/mock';

const CITY = { Mumbai: ['India', 'BOM'], Delhi: ['India', 'DEL'], Bengaluru: ['India', 'BLR'], Kolkata: ['India', 'CCU'], Chennai: ['India', 'MAA'], Hyderabad: ['India', 'HYD'], Bhubaneswar: ['India', 'BBI'], Pune: ['India', 'PNQ'], Goa: ['India', 'GOI'],
  Singapore: ['Singapore', 'SIN'], Dubai: ['UAE', 'DXB'], London: ['United Kingdom', 'LHR'] };
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function seedOperations(db, ids) {
  const T = today(); const d = (n) => addDays(T, n); const year = T.slice(0, 4);
  const rnd = mulberry(20261024); const pick = (a) => a[Math.floor(rnd() * a.length)];
  const user = (emp) => db.get('SELECT * FROM users WHERE id=?', ids[emp]);
  const empOf = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  const bookingNo = () => { db.run("INSERT INTO counters(name,value) VALUES('booking',300) ON CONFLICT(name) DO UPDATE SET value=value+1"); return `BK${pad(db.get("SELECT value FROM counters WHERE name='booking'").value, 6)}`; };

  // ---------- trips ----------
  const mkTrip = (o) => {
    const u = user(o.who); const dest = CITY[o.to]; const dep = CITY[o.from] || ['India', 'BBI'];
    const dd = d(o.depOff); const rr = d(o.depOff + (o.days ?? 2) - 1);
    const intl = dest[0] !== dep[0];
    const co = o.co || ['Cost Center', 'CC2001 - IT Dept'];
    const id = insert(db, 'trips', {
      trip_no: o.no ? `BT-${year}-${pad(o.no, 5)}` : (() => { db.run("INSERT INTO counters(name,value) VALUES('trip-seed',140) ON CONFLICT(name) DO UPDATE SET value=value+1"); return `BT-${year}-${pad(db.get("SELECT value FROM counters WHERE name='trip-seed'").value, 5)}`; })(),
      created_by: ids[o.by || o.who], traveller_id: ids[o.who], created_for_type: o.by ? 'Colleague' : 'Self',
      purpose: o.purpose, title: o.title, purpose_text: o.text || o.title, travel_type: intl ? 'International' : 'Domestic',
      department: u.department, dest_country: dest[0], dep_country: dep[0], dep_city: o.from, dest_city: o.to, dep_date: dd, ret_date: rr,
      travel_mode: o.mode || 'Flight', extra_reqs: JSON.stringify(['Hotel accommodation', 'Airport / local taxi']), company_code: 'ABC01',
      cost_object_type: co[0], cost_object: co[1], est_budget: o.budget, advance_needed: o.adv ? 1 : 0, advance_amount: o.adv || 0, comment: o.text || o.title,
      status: o.status, submitted_at: o.status === 'Draft' ? null : d(o.depOff - 12) + 'T09:00:00.000Z',
      approved_at: ['Approved', 'Booking In Progress', 'Travel In Progress', 'Expenses Pending', 'Closed'].includes(o.status) ? d(o.depOff - 9) + 'T11:00:00.000Z' : null,
      closed_at: o.status === 'Closed' ? d(o.depOff + 10) + 'T10:00:00.000Z' : null,
      created_at: d(o.depOff - 13) + 'T09:00:00.000Z', updated_at: nowIso(),
    });
    // approval chain
    const mgr = u.manager_id || ids.EMP003;
    const chain = intl ? [[mgr, 'Reporting Manager'], [ids.EMP003, 'Department Head'], [ids.EMP021, 'Finance / International Approver']]
      : co[0] === 'Project' ? [[mgr, 'Reporting Manager'], [ids.EMP004, 'Project / Budget Owner']] : [[mgr, 'Reporting Manager']];
    const ded = chain.filter((c, i) => i === 0 || (c[0] !== chain[i - 1][0] && c[0] !== ids[o.who]));
    if (o.status !== 'Draft') {
      ded.forEach(([aid, label], i) => {
        let st = 'Approved';
        if (['Submitted'].includes(o.status)) st = i === 0 ? 'Pending' : 'Waiting';
        if (o.status === 'Under Approval') st = i === 0 ? 'Approved' : i === 1 ? 'Pending' : 'Waiting';
        if (o.status === 'Pending for Review') st = i === 0 ? 'Info Requested' : 'Waiting';
        if (o.status === 'Rejected') st = i === 0 ? 'Rejected' : 'Waiting';
        insert(db, 'approvals', { entity_type: 'trip', entity_id: id, level: i + 1, label, approver_id: aid, status: st,
          comment: st === 'Rejected' ? 'Budget not available for this quarter' : st === 'Info Requested' ? 'Please confirm the client meeting date and attach the invitation.' : null,
          acted_at: ['Approved', 'Rejected', 'Info Requested'].includes(st) ? d(o.depOff - 10) + 'T10:00:00.000Z' : null, created_at: d(o.depOff - 12) + 'T09:00:00.000Z' });
      });
    }
    return id;
  };
  const booking = (o) => {
    const t = db.get('SELECT * FROM trips WHERE id=?', o.trip);
    const id = insert(db, 'bookings', {
      booking_no: o.no || bookingNo(), trip_id: o.trip, traveller_id: t.traveller_id, type: o.type, supplier: o.supplier, supplier_ref: o.ref || pnr(`${o.trip}${o.type}${o.supplier}`),
      ticket_no: o.type === 'flight' ? `618-${2345678000 + o.trip * 7}` : null, title: o.title, route: o.route, detail: o.detail,
      details: o.details || {}, booking_date: o.bdate || d(-8), travel_date: o.travel, end_date: o.end || o.travel, amount: o.amount, status: o.status || 'Confirmed',
      claim_status: o.claim || 'Not Claimed', policy_status: 'Compliant', cancelled_at: o.status === 'Cancelled' ? o.cancelledAt || d(-10) : null,
      cancel_reason: o.status === 'Cancelled' ? o.reason || 'Changed Plan' : null, created_by: t.created_by, created_at: nowIso(),
    });
    return id;
  };
  const flight = (trip, from, to, dt, amount, airline, o = {}) => booking({ trip, type: 'flight', supplier: airline, title: 'Flight', route: `${from} → ${to}`, detail: airline, travel: dt, amount, details: { from, to, airline, depTime: '08:00', arrTime: '10:30', duration: '2h 30m', baggageKg: 15 }, ...o });
  const hotel = (trip, name, city, dt, nights, amount, o = {}) => booking({ trip, type: 'hotel', supplier: name, title: 'Hotel', route: name, detail: `${name}, ${city} · ${nights} Night${nights > 1 ? 's' : ''}`, travel: dt, end: addDays(dt, nights), amount, details: { hotel: name, city, nights, rooms: 1 }, ...o });
  const refund = (bk, o) => {
    const b = db.get('SELECT * FROM bookings WHERE id=?', bk);
    insert(db, 'refunds', { booking_id: bk, status: o.status, original_amount: b.amount, expected_refund: o.expected, penalty: o.penalty || 0, agency_fee: o.fee || 0, tax_component: 0,
      actual_refund: o.actual || 0, cancel_date: b.cancelled_at, policy_deadline: addDays((b.cancelled_at || T).slice(0, 10), -3), expected_credit_date: o.expectedDate, credit_date: o.creditDate || null,
      txn_id: o.actual ? `REF${123456000 + bk}` : null, bank_ref: o.actual ? `SBIN${1023456 + bk}` : null, channel: o.actual ? 'NEFT' : null, owner_id: ids.EMP020, reason: b.cancel_reason,
      created_at: nowIso(), updated_at: nowIso() });
  };

  // Rabindra
  const t125 = mkTrip({ no: 125, who: 'EMP001', title: 'Client Meeting - Mumbai', purpose: 'Client meeting', from: 'Bhubaneswar', to: 'Mumbai', depOff: 10, days: 3, status: 'Booking In Progress', budget: 50000, adv: 10000, co: ['Cost Center', 'CC1001 - Marketing Dept'], text: 'Need to meet key client for project discussion and finalization.' });
  const t118 = mkTrip({ no: 118, who: 'EMP001', title: 'Project Visit - Bengaluru', purpose: 'Project / site visit', from: 'Delhi', to: 'Bengaluru', depOff: 25, days: 2, status: 'Under Approval', budget: 28000, co: ['Project', 'PRJ1001 - Digital Transformation'] });
  const t115 = mkTrip({ no: 115, who: 'EMP001', title: 'Internal Meeting - Delhi', purpose: 'Internal meeting', from: 'Bhubaneswar', to: 'Delhi', depOff: 32, days: 4, status: 'Approved', budget: 35000 });
  const t124 = mkTrip({ no: 124, who: 'EMP001', title: 'Client Meeting - Chennai', purpose: 'Client meeting', from: 'Bhubaneswar', to: 'Chennai', depOff: 18, days: 2, status: 'Pending for Review', budget: 22000 });
  const t110 = mkTrip({ no: 110, who: 'EMP001', title: 'Training - Hyderabad', purpose: 'Training / conference', from: 'Bhubaneswar', to: 'Hyderabad', depOff: -45, days: 3, status: 'Closed', budget: 30000 });
  const t127 = mkTrip({ no: 127, who: 'EMP001', title: 'Client Visit - Dubai', purpose: 'Client meeting', from: 'Bhubaneswar', to: 'Dubai', depOff: 50, days: 4, status: 'Approved', budget: 90000, mode: 'Flight' });
  insert(db, 'trips', { trip_no: `BT-${year}-00126`, created_by: ids.EMP001, traveller_id: ids.EMP001, created_for_type: 'Self', purpose: 'Training / conference', title: 'Training - Pune', purpose_text: 'Advanced cloud workshop', travel_type: 'Domestic', department: 'IT', dest_country: 'India', dep_country: 'India', dep_city: 'Bhubaneswar', dest_city: 'Pune', dep_date: d(40), ret_date: d(41), travel_mode: 'Flight', extra_reqs: '[]', company_code: 'ABC01', cost_object_type: 'Cost Center', cost_object: 'CC2001 - IT Dept', est_budget: 18000, status: 'Draft', created_at: nowIso(), updated_at: nowIso() });
  // others
  const t128 = mkTrip({ no: 128, who: 'EMP012', title: 'Client Meeting - Singapore', purpose: 'Project / site visit', from: 'Mumbai', to: 'Singapore', depOff: 12, days: 6, status: 'Booking In Progress', budget: 100000, co: ['Project', 'PRJ1023 - Projects - Singapore'], adv: 20000 });
  const t131 = mkTrip({ no: 131, who: 'EMP002', title: 'UK Team Meeting', purpose: 'Client meeting', from: 'Mumbai', to: 'London', depOff: 35, days: 6, status: 'Approved', budget: 180000, co: ['Cost Center', 'CC2001 - IT Dept'] });
  const t123 = mkTrip({ no: 123, who: 'EMP005', title: 'Client Meeting - ABC Corp', purpose: 'Client meeting', from: 'Mumbai', to: 'Delhi', depOff: 14, days: 3, status: 'Submitted', budget: 18500, co: ['Cost Center', 'CC2001 - IT Dept'] });
  mkTrip({ no: 122, who: 'EMP006', title: 'HR Training - Bengaluru', purpose: 'Training / conference', from: 'Delhi', to: 'Bengaluru', depOff: 20, days: 2, status: 'Submitted', budget: 12000 });
  mkTrip({ no: 121, who: 'EMP008', title: 'Site Visit - Hyderabad', purpose: 'Project / site visit', from: 'Bhubaneswar', to: 'Hyderabad', depOff: 12, days: 3, status: 'Submitted', budget: 9800 });
  mkTrip({ no: 119, who: 'EMP007', title: 'Finance Conference - Singapore', purpose: 'Training / conference', from: 'Mumbai', to: 'Singapore', depOff: 22, days: 4, status: 'Under Approval', budget: 65000, co: ['Cost Center', 'CC4001 - HR Dept'] });
  mkTrip({ no: 117, who: 'EMP009', title: 'Audit - Delhi', purpose: 'Internal meeting', from: 'Bengaluru', to: 'Delhi', depOff: 16, days: 2, status: 'Approved', budget: 14500 });
  mkTrip({ no: 116, who: 'EMP010', title: 'Maintenance Review - Kolkata', purpose: 'Project / site visit', from: 'Kolkata', to: 'Bhubaneswar', depOff: 28, days: 2, status: 'Rejected', budget: 11200 });
  mkTrip({ no: 114, who: 'EMP011', title: 'Internal Meeting - Goa', purpose: 'Internal meeting', from: 'Hyderabad', to: 'Goa', depOff: 9, days: 2, status: 'Submitted', budget: 7500 });

  // bulk trips
  const team = ['EMP001', 'EMP005', 'EMP006', 'EMP007', 'EMP008', 'EMP009', 'EMP010', 'EMP011', 'EMP012', 'EMP013', 'EMP002'];
  const purposes = ['Client meeting', 'Project / site visit', 'Training / conference', 'Internal meeting'];
  const route = [['Mumbai', 'Delhi'], ['Delhi', 'Bengaluru'], ['Bhubaneswar', 'Mumbai'], ['Hyderabad', 'Chennai'], ['Kolkata', 'Mumbai'], ['Bengaluru', 'Pune'], ['Mumbai', 'Singapore'], ['Delhi', 'Dubai']];
  const plan = [['Draft', 4, [20, 60]], ['Submitted', 4, [10, 40]], ['Pending for Review', 3, [10, 40]], ['Under Approval', 5, [10, 40]], ['Approved', 8, [5, 45]], ['Booking In Progress', 7, [3, 30]],
    ['Travel In Progress', 5, [-2, 0]], ['Expenses Pending', 6, [-25, -8]], ['Closed', 22, [-140, -30]], ['Rejected', 2, [10, 30]], ['Cancelled', 4, [5, 40]]];
  const bulk = [];
  for (const [status, count, [lo, hi]] of plan) {
    for (let i = 0; i < count; i++) {
      const who = pick(team); const [from, to] = pick(route); const intl = CITY[to][0] !== 'India';
      const depOff = Math.round(lo + rnd() * (hi - lo)); const days = 2 + Math.floor(rnd() * 3);
      const needsMulti = status === 'Under Approval';
      const co = needsMulti ? ['Project', 'PRJ1002 - Client Project'] : pick([['Cost Center', 'CC2001 - IT Dept'], ['Cost Center', 'CC3001 - Operations Dept'], ['Project', 'PRJ1002 - Client Project']]);
      const id = mkTrip({ who, title: `${pick(['Client Meeting', 'Site Visit', 'Workshop', 'Review', 'Training'])} - ${to}`, purpose: pick(purposes), from, to, depOff, days, status, budget: intl ? 90000 + Math.round(rnd() * 60000) : 12000 + Math.round(rnd() * 30000), co });
      bulk.push({ id, who, from, to, depOff, days, status, intl });
    }
  }

  // ---------- bookings ----------
  const BK = (n, fn) => fn(`BK${pad(n, 6)}`);
  BK(123, (no) => flight(t110, 'BBI', 'HYD', d(-45), 7450, 'IndiGo', { no, status: 'Completed', claim: 'Claimed', ref: '6E7K9L' }));
  BK(122, (no) => hotel(t110, 'Novotel HICC', 'Hyderabad', d(-45), 2, 12000, { no, status: 'Completed', claim: 'Claimed', ref: 'HN93KD' }));
  BK(121, (no) => booking({ no, trip: t110, type: 'bus', supplier: 'Volvo AC', title: 'Bus', route: 'Hyderabad → Warangal', detail: 'Volvo AC', travel: d(-44), amount: 1200, status: 'Completed', claim: 'Claimed', ref: 'BS45PL' }));
  BK(120, (no) => booking({ no, trip: t115, type: 'train', supplier: 'Rajdhani Express', title: 'Train', route: 'Bhubaneswar → Delhi', detail: 'Rajdhani Express', travel: d(32), amount: 2350, ref: 'TR9JK2' }));
  BK(119, (no) => booking({ no, trip: t110, type: 'cab', supplier: 'Ola', title: 'Cab', route: 'Airport → Hotel', detail: 'Ola', travel: d(-45), amount: 650, status: 'Completed', claim: 'Claimed', ref: 'CB77NM' }));
  BK(118, (no) => hotel(t125, 'ITC Mumbai', 'Mumbai', d(10), 1, 0, { no, status: 'Cancelled', claim: 'N/A', reason: 'Hotel Not Required', ref: 'HT66PQ' }));
  BK(117, (no) => flight(t127, 'DEL', 'DXB', d(50), 32500, 'Emirates', { no, status: 'Created', ref: '6E532A' }));
  BK(116, (no) => flight(t125, 'BBI', 'BOM', d(10), 6800, 'Air India', { no, ref: 'BY1H2P' }));
  BK(115, (no) => flight(t115, 'BBI', 'DEL', d(32), 6500, 'IndiGo', { no, ref: '6E4D1X' }));
  BK(114, (no) => flight(t110, 'HYD', 'BBI', d(-43), 6900, 'IndiGo', { no, status: 'Completed', claim: 'Claimed', ref: '6E2M9Q' }));
  BK(113, (no) => flight(t125, 'BOM', 'BBI', d(12), 7100, 'IndiGo', { no, ref: '6E8R3T' }));
  BK(112, (no) => hotel(t125, 'Novotel Mumbai', 'Mumbai', d(10), 2, 17000, { no, ref: 'HN55ZT' }));
  refund(db.get("SELECT id FROM bookings WHERE booking_no='BK000118'").id, { status: 'Not Applicable', expected: 0, expectedDate: null });

  // Singapore trip BT-2026-00128 (full itinerary example)
  const sg = flight(t128, 'BOM', 'SIN', d(12), 38400, 'Singapore Airlines', { ref: 'SQ221345', details: { from: 'BOM', to: 'SIN', airline: 'Singapore Airlines', flightNo: 'SQ323', depTime: '10:20', arrTime: '18:20', duration: '5h 30m', baggageKg: 25, cabin: 'Economy', stops: 0 } });
  void sg;
  hotel(t128, 'Marriott Tang Plaza', 'Singapore', d(12), 5, 50000, { ref: 'MB12345', details: { hotel: 'Marriott Tang Plaza', city: 'Singapore', nights: 5, room: 'Deluxe Room', breakfast: true } });
  flight(t128, 'SIN', 'BOM', d(17), 38400, 'Singapore Airlines', { ref: 'SQ221345R', details: { from: 'SIN', to: 'BOM', airline: 'Singapore Airlines', flightNo: 'SQ324', depTime: '08:15', arrTime: '10:35', duration: '5h 25m', baggageKg: 25 } });
  booking({ trip: t128, type: 'cab', supplier: 'ComfortDelGro', title: 'Airport Transfer', route: 'Changi Airport → Marriott Tang Plaza', detail: 'Private Car', travel: d(12), amount: 5000, ref: 'GT556677' });

  // bulk bookings, cancellations and refunds
  let nCancel = 0;
  const reasons = ['Changed Plan', 'Trip Cancelled', 'Hotel Not Required', 'User Cancelled', 'Weather Issue', 'Schedule Change', 'Not Required', 'Personal Reason'];
  for (const b of bulk) {
    if (['Draft', 'Submitted', 'Pending for Review', 'Under Approval', 'Rejected'].includes(b.status)) continue;
    const dep = d(b.depOff); const past = b.depOff + b.days < 0;
    const fare = b.intl ? 36000 + Math.round(rnd() * 12000) : 5500 + Math.round(rnd() * 4000);
    const st = b.status === 'Cancelled' ? 'Cancelled' : past || b.depOff < 0 ? 'Completed' : 'Confirmed';
    const claim = b.status === 'Closed' ? 'Claimed' : b.status === 'Expenses Pending' ? 'Not Claimed' : 'Not Claimed';
    const fid = flight(b.id, CITY[b.from][1], CITY[b.to][1], dep, fare, pick(['IndiGo', 'Air India', 'Vistara']), { status: st, claim, reason: pick(reasons), cancelledAt: d(Math.min(-1, b.depOff - 6 - Math.floor(rnd() * 8))) });
    const nights = b.days - 1;
    if (nights > 0 && b.status !== 'Cancelled') hotel(b.id, pick(['Novotel', 'Ibis', 'Lemon Tree']), b.to, dep, nights, nights * (b.intl ? 11000 : 6500), { status: st, claim });
    if (b.status === 'Cancelled') {
      nCancel++;
      const bk = db.get('SELECT * FROM bookings WHERE id=?', fid);
      const penalty = rnd() < 0.3 ? Math.round(bk.amount * 0.15) : 0; const fee = 500; const expected = bk.amount - penalty - fee;
      const kind = nCancel % 5;
      const cancelledDay = bk.cancelled_at.slice(0, 10);
      if (kind === 0) refund(fid, { status: 'Credited', expected, penalty, fee, actual: expected, expectedDate: addDays(cancelledDay, 7), creditDate: addDays(cancelledDay, 6) });
      else if (kind === 1) refund(fid, { status: 'Processing', expected, penalty, fee, expectedDate: addDays(cancelledDay, 7) });
      else if (kind === 2) refund(fid, { status: 'Requested', expected, penalty, fee, expectedDate: addDays(cancelledDay, 5) });
      else if (kind === 3) refund(fid, { status: 'Supplier Confirmed', expected, penalty, fee, expectedDate: d(6) });
      else refund(fid, { status: 'Rejected', expected: 0, penalty: bk.amount, fee: 0, expectedDate: null });
    }
  }
  // Worked example: partially credited refund that is overdue (SQ221345)
  const t129 = mkTrip({ no: 129, who: 'EMP012', title: 'Client Meeting - Singapore (cancelled)', purpose: 'Client meeting', from: 'Delhi', to: 'Singapore', depOff: -8, days: 2, status: 'Cancelled', budget: 85000, co: ['Cost Center', 'CC2001 - IT Dept'] });
  const sqb = flight(t129, 'DEL', 'SIN', d(-8), 72450, 'Singapore Airlines', { status: 'Cancelled', ref: 'SQ221345', cancelledAt: d(-16), reason: 'Change in client schedule' });
  refund(sqb, { status: 'Partially Credited', expected: 62450, penalty: 8000, fee: 2000, actual: 31225, expectedDate: d(-5), creditDate: d(-10) });
  db.run('UPDATE refunds SET txn_id=?, bank_ref=?, channel=? WHERE booking_id=?', 'REF123456789', 'SBIN1023456', 'NEFT', sqb);
  insert(db, 'comments', { entity_type: 'refund', entity_id: sqb, author: 'Singapore Airlines', org: 'Supplier', body: 'Refund of ₹31,225 processed for PNR SQ221345. Remaining amount under review.', created_at: d(-10) + 'T10:20:00.000Z' });
  insert(db, 'comments', { entity_type: 'refund', entity_id: sqb, author: 'Neha (Travel Desk)', org: 'Travel Desk', body: 'Followed up with airline. Awaiting final refund confirmation.', created_at: d(-9) + 'T16:45:00.000Z' });
  insert(db, 'comments', { entity_type: 'refund', entity_id: sqb, author: 'Vikash Kumar', org: 'Employee', body: 'Requested cancellation due to client schedule change.', created_at: d(-16) + 'T10:15:00.000Z' });

  // ---------- invoices / reconciliation ----------
  const allBk = db.all("SELECT * FROM bookings WHERE status NOT IN ('Created','Held') ORDER BY id");
  allBk.forEach((b, i) => {
    if (b.amount <= 0) return;
    if (i % 11 === 0) return; // missing invoice
    const supplier = b.supplier; const base = { booking_id: b.id, supplier, invoice_no: `INV-${supplier.slice(0, 3).toUpperCase()}-${4400 + b.id}`, invoice_date: b.booking_date, tax_amount: Math.round(b.amount * 0.05), payment_method: i % 3 === 0 ? 'Corporate Card' : 'Bank Transfer', card_last4: '1234', payment_ref: `CC-${20261000 + b.id}`, payment_date: b.booking_date, created_at: nowIso() };
    const mismatch = i % 8 === 0;
    const posted = i % 17 !== 0;
    insert(db, 'invoices', { ...base, invoiced_amount: mismatch ? Math.round(b.amount * 1.08) : b.amount, paid_amount: b.amount, erp_system: 'SAP S/4HANA', erp_doc_no: posted ? `51000${23000 + b.id}` : null,
      erp_status: posted ? 'Posted' : (i % 2 ? 'Error' : 'Not Posted'), erp_error: posted ? null : 'Cost centre is locked for posting', erp_posted_at: posted ? b.booking_date : null });
    if (i % 13 === 0) insert(db, 'invoices', { ...base, invoiced_amount: b.amount, paid_amount: b.amount, erp_system: 'SAP S/4HANA', erp_status: 'Posted', erp_doc_no: `51000${24000 + b.id}` });
  });

  // ---------- agency service requests (travel desk queue) ----------
  let autoSrv = 0;
  const svc = (o) => {
    const t = db.get('SELECT * FROM trips WHERE id=?', o.trip);
    autoSrv += 1; const n = 250 + autoSrv;
    return insert(db, 'services', { srv_no: `SRV-${pad(o.no || n, 6)}`, trip_id: o.trip, type: o.type, channel: 'agency', status: o.status, desk_stage: o.stage, details: o.details, comment: o.comment,
      owner_id: o.owner === null ? null : ids[o.owner || 'EMP020'], priority: o.priority || 'Medium', sla_hours: o.sla || 24, created_by: t.traveller_id, created_at: o.created || new Date(Date.now() - (o.hoursAgo ?? 12) * 3600000).toISOString(), updated_at: nowIso(), provider: o.provider || null });
  };
  const s245 = svc({ no: 245, trip: t131, type: 'flight', status: 'Submitted', stage: 'Awaiting Agency Quote', priority: 'High', hoursAgo: 12, comment: 'Client meeting with UK team',
    details: { from: 'Mumbai (BOM)', to: 'London (LHR)', departDate: d(35), returnDate: d(40), cabin: 'Economy', preferredAirlines: 'Any (British Airways preferred)', special: 'Aisle seat', remarks: 'Client meeting with UK team' } });
  const q = (sid, supplier, ref, amount, det) => insert(db, 'service_quotes', { service_id: sid, supplier, reference: ref, amount, details: det, valid_till: d(-1), sent: 0, created_at: nowIso() });
  q(s245, 'British Airways', 'BA123', 62500, 'BOM → LHR | 28 Nov | Economy | 1 Stop | 14h 30m | Baggage 23 kg'); q(s245, 'Emirates', 'EK503', 58700, 'BOM → LHR | 28 Nov | Economy | 1 Stop | 15h 10m | Baggage 25 kg');
  [['Awaiting Quote', 'Awaiting Agency Quote', 'EMP005', 'hotel', 'High', 4], ['Awaiting Information', 'Traveller Info', 'EMP006', 'hotel', 'Medium', 24], ['Submitted', 'Approval Pending', 'EMP012', 'visa', 'Medium', 48],
    ['In Progress', 'Booking in Progress', 'EMP008', 'ground', 'Medium', 4], ['In Progress', 'Ticketing Pending', 'EMP005', 'flight', 'Medium', 8], ['Failed', 'Failed / Issues', 'EMP009', 'hotel', 'High', 26], ['Submitted', 'Awaiting Agency Quote', 'EMP011', 'flight', 'High', 30]].forEach(([status, stage, who, type, priority, hrs], i) => {
    const tr = db.get("SELECT id FROM trips WHERE traveller_id=? AND status IN ('Approved','Booking In Progress') ORDER BY id LIMIT 1", ids[who]) || { id: t115 };
    svc({ trip: tr.id, type, status: status === 'Awaiting Quote' ? 'Submitted' : status, stage, priority, hoursAgo: hrs, owner: i === 6 ? null : 'EMP020', comment: 'Please arrange as per policy.', details: { note: 'Auto-seeded request', from: 'Mumbai', to: 'Delhi' } });
  });
  // Rabindra: hotel quote awaiting his decision
  const sh = svc({ no: 345, trip: t125, type: 'hotel', status: 'Submitted', stage: 'Traveller Info', hoursAgo: 26, comment: 'Need 3/4 star hotel near BKC with breakfast.',
    details: { city: 'Mumbai', checkIn: d(10), checkOut: d(12), rooms: 1, category: '3 Star / Business', area: 'Near Client Office (BKC)', breakfast: true } });
  insert(db, 'service_quotes', { service_id: sh, supplier: 'Novotel Mumbai', reference: 'NV-9921', amount: 17000, details: 'Novotel Mumbai BKC | 2 nights | Breakfast | Free cancellation till 8 Nov', valid_till: d(3), sent: 1, created_at: nowIso() });
  svc({ no: 301, trip: t125, type: 'flight', status: 'Confirmed', stage: 'Completed', hoursAgo: 120, comment: 'Morning flight preferred.', details: { from: 'Bhubaneswar (BBI)', to: 'Mumbai (BOM)', departDate: d(10), cabin: 'Economy' } });
  db.run("UPDATE services SET booking_id=(SELECT id FROM bookings WHERE booking_no='BK000116') WHERE srv_no='SRV-000301'");
  insert(db, 'comments', { entity_type: 'service', entity_id: s245, author: 'Neha (Travel Desk)', org: 'Travel Desk', body: 'Sent request to British Airways for quote.', created_at: new Date(Date.now() - 6 * 3600000).toISOString() });
  insert(db, 'comments', { entity_type: 'service', entity_id: s245, author: 'Agency (British Airways)', org: 'Agency', body: 'Quote requested. Awaiting availability.', created_at: new Date(Date.now() - 5 * 3600000).toISOString() });
  insert(db, 'comments', { entity_type: 'service', entity_id: s245, author: 'Amit Singh', org: 'Employee', body: 'Need preferred flight options. Please check BA / AI.', created_at: new Date(Date.now() - 4 * 3600000).toISOString() });
  void t123; void t124; void t118;

  seedExpenses(db, ids, { t125, t110, d, empOf });
}

function seedExpenses(db, ids, { t125, t110, d, empOf }) {
  const year = today().slice(0, 4);
  const T = today();
  const cos = { 'CC1001 - Marketing Dept': 'Cost Center', 'CC2001 - IT Dept': 'Cost Center', 'PRJ1002 - Client Project': 'WBS Element', 'CC3001 - Operations Dept': 'Cost Center' };
  const mkReport = (o) => {
    const id = insert(db, 'expense_reports', {
      report_no: `ER-${year}-${pad(o.no, 5)}`, user_id: ids[o.who], trip_id: o.trip || null, title: o.title, purpose: o.purpose || o.title, category: o.category || 'Travel', trip_category: 'Domestic',
      receipts_mandatory: 1, start_date: d(o.off), end_date: d(o.off + 2), dest_country: 'India', dest_city: o.city || 'Mumbai', company_code: 'ABC01', cost_object_type: 'Cost Center', travel_allowance: 1,
      advance: o.advance || 0, comment: o.title, declaration: o.status === 'Draft' ? 0 : 1, status: o.status, return_reason: o.status === 'Returned for Correction' ? 'Hotel invoice is not legible. Please re-upload.' : null,
      submitted_at: o.status === 'Draft' ? null : d(o.off + 3) + 'T10:00:00.000Z', created_at: d(o.off + 2) + 'T09:00:00.000Z', updated_at: nowIso() });
    const split = o.split || [['CC1001 - Marketing Dept', 70], ['CC2001 - IT Dept', 30]];
    for (const [c, p] of split) insert(db, 'report_cost_objects', { report_id: id, cost_object: c, type: cos[c] || 'Cost Center', percentage: p });
    const rows = [];
    for (const it of o.items) {
      const total = itemTotal({ amount: it[3], tax: it[4], fx_rate: 1 });
      const alloc = split.map(([c, p]) => ({ costObjectType: cos[c] || 'Cost Center', costObject: c, percentage: p, amount: Math.round(total * p) / 100 }));
      const row = { report_id: id, type: it[0], vendor: it[1], city: o.city || 'Mumbai', txn_date: d(o.off + it[2]), payment_type: it[5] || 'Employee Paid', amount: it[3], tax: it[4], currency: 'INR', fx_rate: 1, fx_source: FX_SOURCE,
        personal: it[6] ? 1 : 0, comment: it[7] || '', status: it[8] || 'Valid', source: 'manual', allocation: alloc, created_at: nowIso() };
      if (it[0] === 'Hotel') Object.assign(row, { from_date: d(o.off), to_date: d(o.off + 2), nights: 2 });
      insert(db, 'expense_items', row); rows.push(row);
    }
    const calc = calcReport(rows, o.advance || 0);
    return { id, calc };
  };
  const reimb = (rep, o) => {
    insert(db, 'reimbursements', { report_id: rep.id, status: o.status, approved_amount: rep.calc.reimbursable, payable_amount: Math.max(0, rep.calc.reimbursable - (o.advance || 0) - (o.ded || 0)), deductions: o.ded || 0, payment_ref: o.ref || null,
      channel: o.status === 'Not Payable' ? null : 'NEFT - HDFC Bank', attempted_at: o.attempted || null, paid_at: o.paid || null, failure_reason: o.fail || null,
      history: o.history || [], created_at: nowIso(), updated_at: nowIso() });
  };
  const mgrApproval = (rep, uemp, st, level = 1) => insert(db, 'approvals', { entity_type: 'expense', entity_id: rep.id, level, label: level === 1 ? 'Reporting Manager' : 'Finance Validation', approver_id: level === 1 ? ids[uemp === 'EMP001' ? 'EMP002' : 'EMP002'] : null, approver_role: level === 1 ? null : 'finance', status: st, acted_at: st === 'Approved' ? d(-3) + 'T10:00:00.000Z' : null, created_at: nowIso() });

  // Rabindra's draft report for the Mumbai trip (matches the Create / Review screens)
  mkReport({ no: 126, who: 'EMP001', trip: t125, title: 'Client Meeting - Mumbai', purpose: 'Client meeting for project discussion', off: 10, advance: 10000, status: 'Draft', items: [
    ['Air Fare', 'IndiGo', 0, 12500, 625, 'Employee Paid', 0, 'Bhubaneswar to Mumbai flight ticket'], ['Hotel', 'Marriott Hotels', 0, 15254, 2746, 'Employee Paid', 0, 'Hotel stay for client meeting.'],
    ['Cab Fare', 'Uber', 0, 750, 0, 'Employee Paid', 0, 'Airport to hotel'], ['Meals', 'Barbeque Nation', 1, 1250, 62, 'Employee Paid', 0, 'Client dinner'], ['Bus', 'Volvo Bus', 2, 800, 0, 'Employee Paid', 0, 'Travel to client site', 'Needs Review']] });
  const r125 = mkReport({ no: 125, who: 'EMP001', trip: t110, title: 'Training - Hyderabad', off: -45, city: 'Hyderabad', status: 'Submitted', split: [['CC2001 - IT Dept', 100]], items: [
    ['Air Fare', 'IndiGo', 0, 14350, 0, 'Employee Paid', 0, 'Flights BBI-HYD-BBI'], ['Hotel', 'Novotel HICC', 0, 12000, 0, 'Employee Paid', 0, 'Hotel for training'], ['Cab Fare', 'Ola', 0, 650, 0, 'Employee Paid', 0, 'Airport transfer']] });
  mgrApproval(r125, 'EMP001', 'Pending');
  // Team reports covering every status (manager, finance and reimbursement screens)
  const team = [
    [124, 'EMP005', 'Plant Visit', 'Approved', 'Finance Approved', { status: 'Payment Initiated', ref: 'PAY-658900', attempted: d(-2) + 'T10:22:00.000Z' }],
    [123, 'EMP012', 'Singapore Client Visit', 'Finance Approved', null, { status: 'Failed', ref: 'PAY-658923', fail: 'Account number invalid', attempted: d(-1) + 'T10:22:00.000Z', advance: 3000, ded: 3000 }],
    [122, 'EMP006', 'Office Supplies', 'Manager Approved', null, null], [121, 'EMP007', 'Annual Conference', 'Draft', null, null],
    [120, 'EMP008', 'Training - Delhi', 'Posted', null, { status: 'Paid', ref: 'PAY-658811', paid: d(-6) + 'T12:00:00.000Z', attempted: d(-7) + 'T10:00:00.000Z' }],
    [119, 'EMP009', 'Software Subscription', 'Rejected', null, null], [118, 'EMP010', 'Client Visit - Bangalore', 'Returned for Correction', null, null],
    [117, 'EMP011', 'Vendor Meeting - Delhi', 'Finance Approved', null, { status: 'Payable' }], [116, 'EMP013', 'Site Visit - Chennai', 'Finance Approved', null, { status: 'On Hold' }],
    [115, 'EMP005', 'Audit Review', 'Posted', null, { status: 'Paid', ref: 'PAY-658790', paid: d(-12) + 'T12:00:00.000Z' }], [114, 'EMP006', 'Workshop - Pune', 'Submitted', null, null], [113, 'EMP012', 'Client Dinner', 'Submitted', null, null],
  ];
  team.forEach(([no, who, title, status, , r], i) => {
    const rep = mkReport({ no, who, title, status, off: -20 - i * 3, city: 'Delhi', advance: r?.advance || 0, items: [['Air Fare', 'IndiGo', 0, 9000 + i * 400, 450], ['Hotel', 'Novotel', 0, 7000 + i * 200, 840], ['Meals', 'Local', 1, 1500, 75], ['Cab Fare', 'Ola', 1, 900, 0]] });
    const lvl1 = ['Submitted'].includes(status) ? 'Pending' : status === 'Rejected' ? 'Rejected' : status === 'Returned for Correction' ? 'Info Requested' : 'Approved';
    if (status !== 'Draft') mgrApproval(rep, who, lvl1, 1);
    if (['Manager Approved'].includes(status)) insert(db, 'approvals', { entity_type: 'expense', entity_id: rep.id, level: 2, label: 'Finance Validation', approver_role: 'finance', status: 'Pending', created_at: nowIso() });
    if (['Finance Approved', 'Posted'].includes(status)) insert(db, 'approvals', { entity_type: 'expense', entity_id: rep.id, level: 2, label: 'Finance Validation', approver_role: 'finance', status: 'Approved', acted_at: d(-3) + 'T10:00:00.000Z', created_at: nowIso() });
    if (r) reimb(rep, { ...r, history: [{ ts: d(-9) + 'T10:00:00.000Z', event: 'Submitted', by: 'Employee' }, { ts: d(-6) + 'T10:00:00.000Z', event: 'Manager Approved', by: 'Amit Singh' }, { ts: d(-4) + 'T10:00:00.000Z', event: 'Finance Approved', by: 'Karan Mehta' }] });
    if (status === 'Draft') db.run("UPDATE expense_reports SET declaration=0 WHERE id=?", rep.id);
  });
  void T; void empOf;
  db.run("INSERT INTO counters(name,value) VALUES('trip-' || ?, 400) ON CONFLICT(name) DO UPDATE SET value=excluded.value", year);
  db.run("INSERT INTO counters(name,value) VALUES('expense-' || ?, 200) ON CONFLICT(name) DO UPDATE SET value=excluded.value", year);
  db.run("INSERT INTO counters(name,value) VALUES('service',400) ON CONFLICT(name) DO UPDATE SET value=excluded.value");
  db.run("INSERT INTO counters(name,value) VALUES('booking',500) ON CONFLICT(name) DO UPDATE SET value=excluded.value");
}
