import { json } from '../db';
import { bad, conflict, forbidden, notFound, nowIso, today, isDate, num, page as pg, seq, pad, audit, notify, comment, getSetting, insert } from '../util';
import { createChain } from './chain';

export const STAGES = ['Awaiting Agency Quote', 'Traveller Info', 'Approval Pending', 'Booking in Progress', 'Ticketing Pending', 'Failed / Issues'];
const FINAL = ['Confirmed', 'Cancelled', 'Failed'];
const deskOnly = (user) => { if (!['travel_desk', 'admin'].includes(user.role)) throw forbidden('Travel desk access required'); };
const BK_TYPE = { flight: 'flight', hotel: 'hotel', ground: 'cab', visa: 'other', other: 'other' };

export function slaInfo(s) {
  const elapsed = Math.max(0, (Date.now() - Date.parse(s.created_at)) / 3600000);
  if (FINAL.includes(s.status)) return { elapsed, status: 'Closed', label: fmtAge(elapsed) };
  const ratio = elapsed / s.sla_hours;
  return { elapsed, ratio, status: ratio > 1 ? 'Breached' : ratio > 0.75 ? 'At Risk' : 'On Track', label: fmtAge(elapsed) };
}
const fmtAge = (h) => (h >= 24 ? `${Math.floor(h / 24)}d` : `${Math.max(1, Math.round(h))}h`);
const routeOf = (s, d) => d.from && d.to ? `${d.from} → ${d.to}` : d.city || d.country || d.pickup || (d.services ? [].concat(d.services).join(', ') : '-');

export function listQueue(db, user, q = {}) {
  deskOnly(user);
  const w = ["(s.channel='agency' OR s.status='Failed')", "s.status!='Draft'", "s.status NOT IN ('Confirmed','Cancelled')"]; const p = [];
  if (q.type && q.type !== 'All') { w.push('s.type=?'); p.push(q.type); }
  if (q.priority && q.priority !== 'All') { w.push('s.priority=?'); p.push(q.priority); }
  if (q.owner && q.owner !== 'All') { if (q.owner === 'Unassigned') w.push('s.owner_id IS NULL'); else { w.push('s.owner_id=?'); p.push(q.owner); } }
  if (q.q) { w.push('(s.srv_no LIKE ? OR t.trip_no LIKE ? OR u.name LIKE ?)'); const x = `%${q.q}%`; p.push(x, x, x); }
  const rows = db.all(`SELECT s.*, t.trip_no, t.dep_date, t.dest_city, u.name employee, u.department, o.name owner_name FROM services s JOIN trips t ON t.id=s.trip_id JOIN users u ON u.id=t.traveller_id LEFT JOIN users o ON o.id=s.owner_id WHERE ${w.join(' AND ')} ORDER BY s.id DESC`, ...p)
    .map((s) => { const d = json(s.details, {}); const sla = slaInfo(s); return { ...s, details: d, route: routeOf(s, d), sla, urgent: sla.status === 'Breached' || (s.priority === 'High' && sla.status !== 'On Track') }; });
  const counts = Object.fromEntries(STAGES.map((st) => [st, rows.filter((r) => r.desk_stage === st).length]));
  counts.Urgent = rows.filter((r) => r.urgent).length; counts.All = rows.length;
  const tab = q.tab || 'All';
  const view = tab === 'All' ? rows : tab === 'Urgent' ? rows.filter((r) => r.urgent) : rows.filter((r) => r.desk_stage === tab);
  const { size, page, offset } = pg(q, 8);
  const owners = db.all("SELECT id,name FROM users WHERE role IN ('travel_desk','admin') AND active=1");
  return { rows: view.slice(offset, offset + size), total: view.length, page, size, counts, owners, tab };
}

export function serviceDetail(db, user, id) {
  const s = db.get('SELECT s.*, t.trip_no, t.title trip_title, t.purpose, t.dest_city, t.dep_city, t.dep_date, t.ret_date, t.travel_type, t.traveller_id, t.est_budget, u.name employee, u.emp_id, u.department, u.designation, u.email, u.phone, o.name owner_name FROM services s JOIN trips t ON t.id=s.trip_id JOIN users u ON u.id=t.traveller_id LEFT JOIN users o ON o.id=s.owner_id WHERE s.id=?', id);
  if (!s) throw notFound('Service request not found');
  const isDesk = ['travel_desk', 'admin'].includes(user.role);
  if (!isDesk && s.traveller_id !== user.id && s.created_by !== user.id) throw forbidden();
  const quotes = db.all('SELECT * FROM service_quotes WHERE service_id=? ORDER BY id', id).filter((q) => isDesk || q.sent);
  return { service: { ...s, details: json(s.details, {}) }, sla: slaInfo(s), quotes, comments: db.all("SELECT * FROM comments WHERE entity_type='service' AND entity_id=? ORDER BY id DESC", id), files: db.all("SELECT id,name,size FROM files WHERE entity_type='service' AND entity_id=?", id), isDesk };
}

export function deskAction(db, user, id, input) {
  deskOnly(user);
  return db.tx(() => {
    const s = db.get('SELECT s.*, t.traveller_id, t.trip_no, t.status trip_status FROM services s JOIN trips t ON t.id=s.trip_id WHERE s.id=?', id);
    if (!s) throw notFound('Service request not found');
    const act = input.action;
    if (FINAL.includes(s.status) && act !== 'comment') throw conflict(`Request is already ${s.status}`);
    const touch = (f) => { const k = Object.keys(f); db.run(`UPDATE services SET ${k.map((x) => `${x}=?`).join(',')}, updated_at=? WHERE id=?`, ...k.map((x) => f[x]), nowIso(), id); };
    if (act === 'assign') {
      const o = db.get("SELECT id,name FROM users WHERE id=? AND role IN ('travel_desk','admin')", input.owner_id); if (!o) throw bad('Select a valid owner');
      touch({ owner_id: o.id }); comment(db, 'service', id, user, `Assigned to ${o.name}`, 'Travel Desk');
    } else if (act === 'request_info') {
      if (!String(input.note || '').trim()) throw bad('Please state what information is required');
      touch({ status: 'Awaiting Information', desk_stage: 'Traveller Info' }); comment(db, 'service', id, user, input.note, 'Travel Desk');
      notify(db, s.traveller_id, { category: 'other', severity: 'warn', title: `Information needed for ${s.srv_no}`, body: input.note, link: `/trips/${s.trip_id}`, refKey: `srv-info:${id}:${Date.now()}` });
    } else if (act === 'add_quote') {
      const amount = num(input.amount, NaN);
      if (!String(input.supplier || '').trim()) throw bad('Supplier is required'); if (!(amount > 0)) throw bad('Quote amount must be greater than zero');
      if (input.valid_till && !isDate(input.valid_till)) throw bad('Valid-till date is invalid');
      insert(db, 'service_quotes', { service_id: id, supplier: input.supplier, reference: input.reference || null, amount, details: input.details || null, valid_till: input.valid_till || null, created_at: nowIso() });
      touch({ status: s.status === 'Submitted' ? 'Submitted' : s.status, desk_stage: 'Awaiting Agency Quote' }); comment(db, 'service', id, user, `Quote added: ${input.supplier} ₹${amount.toLocaleString('en-IN')}`, 'Travel Desk');
    } else if (act === 'send_quote') {
      const qt = db.get('SELECT * FROM service_quotes WHERE id=? AND service_id=?', input.quote_id, id); if (!qt) throw notFound('Quote not found');
      if (qt.valid_till && qt.valid_till < today()) throw conflict('This quote has expired - request a fresh quote');
      db.run('UPDATE service_quotes SET sent=1 WHERE id=?', qt.id); touch({ desk_stage: 'Traveller Info' });
      notify(db, s.traveller_id, { category: 'other', title: `Quote received for ${s.srv_no}`, body: `${qt.supplier} - ₹${qt.amount.toLocaleString('en-IN')}. Your approval is needed.`, link: `/dashboard`, refKey: `srv-quote:${qt.id}` });
      comment(db, 'service', id, user, `Quote from ${qt.supplier} sent to traveller`, 'Travel Desk');
    } else if (act === 'ticketing') {
      if (!s.booking_id) throw conflict('Accept a quote first - there is no booking to ticket'); touch({ status: 'In Progress', desk_stage: 'Ticketing Pending' });
    } else if (act === 'issue_ticket' || act === 'complete') {
      if (['flight', 'hotel', 'ground'].includes(s.type) && !s.booking_id) throw conflict('There is no accepted quote / booking for this request yet');
      if (s.booking_id) {
        if (!String(input.supplier_ref || '').trim()) throw bad('Supplier confirmation / PNR is required');
        const b = db.get('SELECT * FROM bookings WHERE id=?', s.booking_id); const d = json(s.details, {});
        if (b.status === 'Created') throw conflict('Booking is waiting for approval and cannot be ticketed yet');
        const change = s.change_of_booking ? { status: 'Changed', travel_date: d.new_date || b.travel_date } : { status: 'Confirmed' };
        db.run('UPDATE bookings SET status=?, travel_date=?, supplier_ref=?, ticket_no=COALESCE(?,ticket_no) WHERE id=?', change.status, change.travel_date ?? b.travel_date, input.supplier_ref, input.ticket_no || null, b.id);
      }
      touch({ status: 'Confirmed', desk_stage: 'Completed' });
      if (s.trip_status === 'Approved') db.run("UPDATE trips SET status='Booking In Progress', updated_at=? WHERE id=?", nowIso(), s.trip_id);
      notify(db, s.traveller_id, { category: 'other', title: `${s.srv_no} confirmed`, body: input.supplier_ref ? `Confirmation: ${input.supplier_ref}` : 'Your request has been completed.', link: `/trips/${s.trip_id}`, refKey: `srv-ok:${id}` });
    } else if (act === 'fail') {
      if (!String(input.note || '').trim()) throw bad('A failure reason is required');
      touch({ status: 'Failed', desk_stage: 'Failed / Issues' }); comment(db, 'service', id, user, `Failed: ${input.note}`, 'Travel Desk');
      notify(db, s.traveller_id, { category: 'other', severity: 'danger', title: `${s.srv_no} could not be completed`, body: input.note, link: `/trips/${s.trip_id}`, refKey: `srv-fail:${id}` });
    } else if (act === 'escalate') {
      touch({ priority: 'High' }); const adm = db.get("SELECT id FROM users WHERE role='admin' LIMIT 1");
      notify(db, adm?.id, { category: 'other', severity: 'warn', title: `Escalation: ${s.srv_no}`, body: 'Delayed request escalated by travel desk', link: '/travel-desk', refKey: `srv-esc:${id}:${Date.now()}` });
    } else if (act === 'comment') {
      if (!String(input.note || '').trim()) throw bad('Comment is required'); comment(db, 'service', id, user, input.note, 'Travel Desk');
    } else throw bad('Unknown action');
    audit(db, user, `desk.${act}`, 'service', id, s.srv_no);
    return serviceDetail(db, user, id);
  });
}

// Traveller replies / accepts a quote
export function travellerRespond(db, user, id, input) {
  return db.tx(() => {
    const s = db.get('SELECT s.*, t.traveller_id, t.est_budget, t.id tid, t.trip_no FROM services s JOIN trips t ON t.id=s.trip_id WHERE s.id=?', id);
    if (!s) throw notFound('Service request not found');
    if (s.traveller_id !== user.id && s.created_by !== user.id) throw forbidden();
    if (FINAL.includes(s.status)) throw conflict(`Request is already ${s.status}`);
    if (input.action === 'reply') {
      if (!String(input.note || '').trim()) throw bad('Reply cannot be empty');
      comment(db, 'service', id, user, input.note, 'Employee');
      db.run("UPDATE services SET status=CASE WHEN status='Awaiting Information' THEN 'Submitted' ELSE status END, desk_stage=CASE WHEN desk_stage='Traveller Info' THEN 'Awaiting Agency Quote' ELSE desk_stage END, updated_at=? WHERE id=?", nowIso(), id);
    } else if (input.action === 'accept_quote' || input.action === 'reject_quote') {
      const q = db.get('SELECT * FROM service_quotes WHERE id=? AND service_id=? AND sent=1', input.quote_id, id); if (!q) throw notFound('Quote not found');
      if (input.action === 'reject_quote') {
        if (!String(input.note || '').trim()) throw bad('Please tell the travel desk why the quote was rejected');
        comment(db, 'service', id, user, `Quote from ${q.supplier} rejected: ${input.note}`, 'Employee'); db.run("UPDATE services SET desk_stage='Awaiting Agency Quote', updated_at=? WHERE id=?", nowIso(), id);
      } else {
        if (q.valid_till && q.valid_till < today()) throw conflict('This quote has expired');
        if (s.booking_id) throw conflict('A quote has already been accepted');
        db.run('UPDATE service_quotes SET accepted=1 WHERE id=?', q.id);
        const used = db.get("SELECT COALESCE(SUM(amount),0) s FROM bookings WHERE trip_id=? AND status NOT IN ('Cancelled')", s.tid).s;
        const over = used + q.amount > s.est_budget * (1 + getSetting(db, 'price_tolerance_pct', 10) / 100);
        const d = json(s.details, {});
        const no = `BK${pad(seq(db, 'booking'), 6)}`;
        const bid = insert(db, 'bookings', { booking_no: no, trip_id: s.tid, service_id: id, traveller_id: s.traveller_id, type: BK_TYPE[s.type], supplier: q.supplier, supplier_ref: null, title: s.type === 'hotel' ? 'Hotel' : s.type === 'flight' ? 'Flight' : 'Service', route: routeOf(s, d), detail: `${q.supplier} ${q.reference || ''}`.trim(),
          details: { ...d, quote: q.id, refundable: true }, booking_date: today(), travel_date: d.departDate || d.checkIn || d.depart_date || d.check_in || null, end_date: d.checkOut || d.check_out || null, amount: q.amount, status: over ? 'Created' : 'Ticketing Pending', policy_status: over ? 'Exception Required' : 'Compliant', policy_note: over ? 'Exceeds approved trip budget' : null, created_by: user.id, created_at: nowIso() });
        db.run("UPDATE services SET booking_id=?, provider=?, status=?, desk_stage=?, updated_at=? WHERE id=?", bid, q.supplier, over ? 'Submitted' : 'In Progress', over ? 'Approval Pending' : 'Ticketing Pending', nowIso(), id);
        if (over) {
          const t = db.get('SELECT u.manager_id FROM users u WHERE u.id=?', s.traveller_id);
          createChain(db, 'booking', bid, [{ label: 'Budget Exception - Reporting Manager', approverId: t.manager_id || getSetting(db, 'emergency_approver_id', null), note: 'Accepted quote exceeds the approved trip budget' }]);
        }
        comment(db, 'service', id, user, `Quote from ${q.supplier} accepted`, 'Employee');
      }
    } else throw bad('Unknown action');
    audit(db, user, `service.${input.action}`, 'service', id, s.srv_no);
    return serviceDetail(db, user, id);
  });
}

export function slaMonitor(db, user) {
  deskOnly(user);
  const rows = db.all("SELECT s.*, t.trip_no, u.name employee FROM services s JOIN trips t ON t.id=s.trip_id JOIN users u ON u.id=t.traveller_id WHERE s.status!='Draft' AND (s.channel='agency' OR s.status='Failed') ORDER BY s.id DESC")
    .map((s) => ({ ...s, details: json(s.details, {}), sla: slaInfo(s), provider: s.provider || 'ABC Travels Pvt. Ltd.' }));
  const by = {};
  for (const r of rows) { const k = r.provider; by[k] = by[k] || { supplier: k, total: 0, breached: 0, atRisk: 0, onTrack: 0, closed: 0 }; by[k].total++; if (r.sla.status === 'Breached') by[k].breached++; else if (r.sla.status === 'At Risk') by[k].atRisk++; else if (r.sla.status === 'On Track') by[k].onTrack++; else by[k].closed++; }
  return { suppliers: Object.values(by), rows: rows.filter((r) => r.sla.status !== 'Closed') };
}
