import { json } from '../db';
import { bad, conflict, forbidden, notFound, nowIso, today, addDays, isDate, page as pg, seq, pad, audit, notify, insert, comment } from '../util';
import { teamIds, userName } from './chain';

export const BOOKING_TYPES = ['flight', 'hotel', 'bus', 'train', 'cab', 'other'];
export const BOOKING_STATUSES = ['Created', 'Ticketing Pending', 'Confirmed', 'Changed', 'Partially Cancelled', 'Cancelled', 'No-show', 'Completed'];
const OPEN_STATUSES = ['Created', 'Held', 'Ticketing Pending', 'Confirmed', 'Changed'];
const SERVICE_OF = { flight: 'flight', hotel: 'hotel', bus: 'ground', train: 'ground', cab: 'ground', other: 'other' };
export const typeLabel = { flight: 'Flights', hotel: 'Hotels', bus: 'Buses', train: 'Trains', cab: 'Cabs', other: 'Others' };

function scopeSql(db, user, scope) {
  if (scope === 'all' && ['admin', 'travel_desk', 'finance'].includes(user.role)) return { where: '1=1', params: [] };
  if (scope === 'team') {
    const ids = teamIds(db, user.id).filter((i) => i !== user.id);
    if (!ids.length && !['admin', 'travel_desk', 'finance'].includes(user.role)) return { where: '0=1', params: [] };
    if (['admin', 'travel_desk', 'finance'].includes(user.role)) return { where: '1=1', params: [] };
    return { where: `b.traveller_id IN (${ids.map(() => '?').join(',')})`, params: ids };
  }
  return { where: '(b.traveller_id=? OR b.created_by=?)', params: [user.id, user.id] };
}
export function canViewBooking(db, user, b) {
  if (['admin', 'travel_desk', 'finance'].includes(user.role)) return true;
  if (b.traveller_id === user.id || b.created_by === user.id) return true;
  return user.role === 'manager' && teamIds(db, user.id).includes(b.traveller_id);
}

export function listBookings(db, user, q = {}) {
  const scope = q.scope || 'mine';
  const sc = scopeSql(db, user, scope);
  const w = [sc.where]; const p = [...sc.params];
  if (q.type && q.type !== 'all') { w.push('b.type=?'); p.push(q.type); }
  if (q.status && q.status !== 'All') { w.push('b.status=?'); p.push(q.status); }
  if (q.claim && q.claim !== 'All') { w.push('b.claim_status=?'); p.push(q.claim); }
  if (isDate(q.from)) { w.push('b.travel_date>=?'); p.push(q.from); } if (isDate(q.to)) { w.push('b.travel_date<=?'); p.push(q.to); }
  if (q.q) { w.push('(b.booking_no LIKE ? OR b.supplier_ref LIKE ? OR b.route LIKE ? OR b.supplier LIKE ? OR u.name LIKE ?)'); const s = `%${q.q}%`; p.push(s, s, s, s, s); }
  const base = `FROM bookings b JOIN users u ON u.id=b.traveller_id LEFT JOIN trips t ON t.id=b.trip_id WHERE ${w.join(' AND ')}`;
  const { size, page, offset } = pg(q, 8);
  const total = db.get(`SELECT COUNT(*) c ${base}`, ...p).c;
  const rows = db.all(`SELECT b.*, u.name traveller_name, u.emp_id, u.department, t.trip_no ${base} ORDER BY b.id DESC LIMIT ? OFFSET ?`, ...p, size, offset).map((r) => ({ ...r, details: json(r.details, {}) }));
  const all = db.all(`SELECT b.type,b.status,b.claim_status FROM bookings b JOIN users u ON u.id=b.traveller_id WHERE ${sc.where}`, ...sc.params);
  const kpis = {
    total: all.length, confirmed: all.filter((x) => ['Confirmed', 'Completed'].includes(x.status)).length, pending: all.filter((x) => ['Created', 'Held', 'Ticketing Pending'].includes(x.status)).length,
    cancelled: all.filter((x) => x.status === 'Cancelled').length, claimed: all.filter((x) => ['Claimed', 'Claim In Progress'].includes(x.claim_status)).length, notClaimed: all.filter((x) => x.claim_status === 'Not Claimed').length,
  };
  const tabs = { all: all.length, ...Object.fromEntries(BOOKING_TYPES.map((t) => [t, all.filter((x) => x.type === t).length])) };
  return { rows, total, page, size, kpis, tabs, scope };
}

export function getBooking(db, user, id) {
  const b = db.get('SELECT b.*, u.name traveller_name, u.emp_id, u.department, t.trip_no FROM bookings b JOIN users u ON u.id=b.traveller_id LEFT JOIN trips t ON t.id=b.trip_id WHERE b.id=?', id);
  if (!b) throw notFound('Booking not found');
  if (!canViewBooking(db, user, b)) throw forbidden();
  const refund = db.get('SELECT * FROM refunds WHERE booking_id=?', id);
  const invoice = db.get('SELECT * FROM invoices WHERE booking_id=? ORDER BY id LIMIT 1', id);
  const timeline = [
    { label: 'Booking Created', at: b.booking_date, done: true }, { label: 'Payment Successful', at: b.booking_date, done: b.amount > 0 },
    { label: 'Booking Confirmed', at: b.booking_date, done: ['Confirmed', 'Completed', 'Changed'].includes(b.status) || !!b.cancelled_at },
    ...(b.cancelled_at ? [{ label: 'Booking Cancelled', at: b.cancelled_at.slice(0, 10), done: true }] : [{ label: 'Travel Date', at: b.travel_date, done: b.status === 'Completed' }]),
    { label: 'Expense Claim', at: b.claim_status, done: b.claim_status === 'Claimed' },
  ];
  return { booking: { ...b, details: json(b.details, {}) }, refund, invoice, timeline, comments: db.all("SELECT * FROM comments WHERE entity_type='refund' AND entity_id=? ORDER BY id DESC", id) };
}

// Refund terms: flights follow fare rules, hotels follow the free-cancellation deadline.
export function refundTerms(b) {
  const d = json(b.details, {});
  const agencyFee = b.type === 'flight' ? 500 : 0;
  let penalty = 0; let policyDeadline = d.freeCancelUntil || null;
  if (b.type === 'flight') penalty = d.refundable === false ? b.amount : Math.round(b.amount * 0.1);
  if (b.type === 'hotel') {
    const free = d.freeCancelUntil ? today() <= d.freeCancelUntil : true;
    penalty = free ? 0 : Math.round(b.amount / Math.max(1, d.nights || 1));
  }
  penalty = Math.min(penalty, b.amount);
  const expected = Math.max(0, b.amount - penalty - agencyFee);
  return { penalty, agencyFee, expected, policyDeadline };
}

export function cancelBooking(db, user, id, reason, { silent = false } = {}) {
  return db.tx(() => {
    const b = db.get('SELECT * FROM bookings WHERE id=?', id);
    if (!b) throw notFound('Booking not found');
    if (!silent && !canViewBooking(db, user, b)) throw forbidden();
    if (!OPEN_STATUSES.includes(b.status)) throw conflict(`Booking is already ${b.status}`);
    if (!String(reason || '').trim()) throw bad('A cancellation reason is required');
    const terms = refundTerms(b);
    db.run("UPDATE bookings SET status='Cancelled', cancelled_at=?, cancel_reason=?, claim_status=CASE WHEN claim_status='Not Claimed' THEN 'N/A' ELSE claim_status END WHERE id=?", nowIso(), reason, id);
    db.run("UPDATE services SET status='Cancelled', desk_stage='Cancelled', updated_at=? WHERE booking_id=?", nowIso(), id);
    const desk = db.get("SELECT id FROM users WHERE role='travel_desk' AND active=1 ORDER BY id LIMIT 1");
    const status = terms.expected > 0 ? 'Expected' : 'Not Applicable';
    if (!db.get('SELECT 1 x FROM refunds WHERE booking_id=?', id)) {
      insert(db, 'refunds', { booking_id: id, status, original_amount: b.amount, expected_refund: terms.expected, penalty: terms.penalty, agency_fee: terms.agencyFee, tax_component: 0,
        cancel_date: nowIso(), policy_deadline: terms.policyDeadline, expected_credit_date: terms.expected > 0 ? addDays(today(), 7) : null, owner_id: desk?.id || null, reason, created_at: nowIso(), updated_at: nowIso() });
    }
    audit(db, user, 'booking.cancel', 'booking', id, `${b.booking_no}: ${reason}`);
    notify(db, b.traveller_id, { category: 'other', title: `Booking ${b.booking_no} cancelled`, body: terms.expected > 0 ? `Expected refund ₹${terms.expected.toLocaleString('en-IN')}` : 'No refund applicable', link: '/bookings', refKey: `bk-cancel:${id}` });
    if (desk) notify(db, desk.id, { category: 'other', title: 'New refund case', body: `${b.booking_no} - expected ₹${terms.expected.toLocaleString('en-IN')}`, link: '/refunds', refKey: `refund-new:${id}` });
    return db.get('SELECT * FROM bookings WHERE id=?', id);
  });
}

// Change request: handled by the travel desk through a linked service request.
export function requestChange(db, user, id, input) {
  return db.tx(() => {
    const b = db.get('SELECT * FROM bookings WHERE id=?', id);
    if (!b) throw notFound('Booking not found');
    if (!canViewBooking(db, user, b)) throw forbidden();
    if (!['Confirmed', 'Changed'].includes(b.status)) throw conflict('Only confirmed bookings can be changed');
    if (!String(input.reason || '').trim()) throw bad('A comment is required for a change request');
    if (input.new_date && !isDate(input.new_date)) throw bad('New date is invalid');
    const t = b.trip_id ? db.get('SELECT * FROM trips WHERE id=?', b.trip_id) : null;
    if (!t) throw conflict('Booking is not linked to a trip');
    const sid = insert(db, 'services', {
      srv_no: `SRV-${pad(seq(db, 'service'), 6)}`, trip_id: t.id, type: SERVICE_OF[b.type], channel: 'agency', status: 'Submitted', desk_stage: 'Awaiting Agency Quote',
      details: { kind: 'change', booking_no: b.booking_no, new_date: input.new_date || null, current_date: b.travel_date }, comment: input.reason, priority: 'High', sla_hours: 12, booking_id: b.id, change_of_booking: b.id,
      created_by: user.id, created_at: nowIso(), updated_at: nowIso(),
    });
    comment(db, 'service', sid, user, input.reason, 'Employee');
    audit(db, user, 'booking.change_request', 'booking', id, input.reason);
    return db.get('SELECT * FROM services WHERE id=?', sid);
  });
}

export function afterBookingDecision(db, user, approval, decision, cmt) {
  const b = db.get('SELECT * FROM bookings WHERE id=?', approval.entity_id);
  if (!b) return;
  if (decision === 'approve') {
    const next = db.get("SELECT * FROM approvals WHERE entity_type='booking' AND entity_id=? AND status='Waiting' ORDER BY level LIMIT 1", b.id);
    if (next) { db.run("UPDATE approvals SET status='Pending' WHERE id=?", next.id); return; }
    db.run("UPDATE bookings SET status='Confirmed', ticket_no=COALESCE(ticket_no, ?) WHERE id=?", b.type === 'flight' ? `618-${2345000000 + b.id * 13}` : null, b.id);
    db.run("UPDATE services SET status='Confirmed', desk_stage='Completed', updated_at=? WHERE booking_id=?", nowIso(), b.id);
    notify(db, b.traveller_id, { category: 'other', title: `Booking ${b.booking_no} approved and confirmed`, body: 'Policy exception approved.', link: '/bookings', refKey: `bk-ok:${b.id}` });
  } else {
    db.run("UPDATE bookings SET status='Cancelled', cancelled_at=?, cancel_reason=? WHERE id=?", nowIso(), `Exception rejected: ${cmt}`, b.id);
    db.run("UPDATE services SET status='Cancelled', desk_stage='Cancelled', updated_at=? WHERE booking_id=?", nowIso(), b.id);
    notify(db, b.traveller_id, { category: 'other', severity: 'warn', title: `Booking ${b.booking_no} rejected`, body: cmt, link: '/bookings', refKey: `bk-no:${b.id}` });
  }
}
export { userName };
