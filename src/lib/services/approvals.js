import { json } from '../db';
import { bad, conflict, forbidden, notFound, nowIso, today, daysBetween, page as pg, audit, notify, comment } from '../util';
import { approvalsFor } from './chain';
import { afterBookingDecision } from './bookings';
import { afterExpenseDecision, calcFor } from './expenses';

const mine = (user) => '(a.approver_id=? OR (a.approver_id IS NULL AND a.approver_role=?))';
const priorityOf = (t) => (t.emergency || daysBetween(today(), t.dep_date) <= 7 || t.est_budget >= 50000 ? 'High' : 'Normal');

export function listApprovals(db, user, q = {}) {
  const type = ['trip', 'expense', 'booking'].includes(q.type) ? q.type : 'trip';
  const status = q.status || 'Pending';
  const w = ['a.entity_type=?', mine(user)]; const p = [type, user.id, user.role];
  if (status === 'Pending > 7 days') { w.push("a.status='Pending'", "julianday('now') - julianday(a.created_at) > 7"); }
  else if (status !== 'All') { w.push('a.status=?'); p.push(status); }
  const { size, page, offset } = pg(q);
  let join; let cols;
  if (type === 'trip') { join = 'JOIN trips t ON t.id=a.entity_id JOIN users u ON u.id=t.traveller_id'; cols = 't.trip_no ref, t.title, t.dep_date, t.ret_date, t.dep_city, t.dest_city, t.purpose, t.est_budget amount, t.emergency, u.name employee, u.emp_id, u.department, t.submitted_at submitted'; }
  else if (type === 'expense') { join = 'JOIN expense_reports t ON t.id=a.entity_id JOIN users u ON u.id=t.user_id'; cols = "t.report_no ref, t.title, t.start_date dep_date, t.end_date ret_date, t.dest_city, t.category purpose, (SELECT COALESCE(SUM((i.amount+i.tax)*i.fx_rate),0) FROM expense_items i WHERE i.report_id=t.id) amount, 0 emergency, u.name employee, u.emp_id, u.department, t.submitted_at submitted"; }
  else { join = 'JOIN bookings t ON t.id=a.entity_id JOIN users u ON u.id=t.traveller_id'; cols = "t.booking_no ref, t.detail title, t.travel_date dep_date, t.end_date ret_date, t.route dest_city, t.policy_status purpose, t.amount amount, 0 emergency, u.name employee, u.emp_id, u.department, t.created_at submitted"; }
  if (q.q) { w.push('(ref LIKE ? OR u.name LIKE ? OR title LIKE ?)'); const s = `%${q.q}%`; p.push(s, s, s); }
  if (q.department && q.department !== 'All') { w.push('u.department=?'); p.push(q.department); }
  const sql = `FROM approvals a ${join} WHERE ${w.join(' AND ')}`;
  // alias fix: allow filtering by computed aliases through a subquery
  const inner = `SELECT a.id approval_id, a.status, a.level, a.label, a.created_at, a.entity_id, ${cols} ${sql}`;
  const total = db.get(`SELECT COUNT(*) c FROM (${inner})`, ...p).c;
  let rows = db.all(`SELECT * FROM (${inner}) ORDER BY approval_id DESC LIMIT ? OFFSET ?`, ...p, size, offset);
  rows = rows.map((r) => ({ ...r, priority: type === 'trip' ? priorityOf({ emergency: r.emergency, dep_date: r.dep_date, est_budget: r.amount }) : 'Normal', pendingDays: Math.max(0, Math.floor((Date.now() - Date.parse(r.created_at)) / 86400000)) }));
  const base = db.all(`SELECT a.status, a.created_at FROM approvals a WHERE a.entity_type=? AND ${mine(user)}`, type, user.id, user.role);
  const kpis = { total: base.length, pending: base.filter((x) => x.status === 'Pending').length, approved: base.filter((x) => x.status === 'Approved').length, rejected: base.filter((x) => x.status === 'Rejected').length,
    overdue: base.filter((x) => x.status === 'Pending' && Date.now() - Date.parse(x.created_at) > 7 * 86400000).length };
  const tabs = Object.fromEntries(['trip', 'expense', 'booking'].map((t) => [t, db.get(`SELECT COUNT(*) c FROM approvals a WHERE a.entity_type=? AND a.status='Pending' AND ${mine(user)}`, t, user.id, user.role).c]));
  return { rows, total, page, size, kpis, tabs, type };
}

export function pendingCount(db, user) {
  return db.get(`SELECT COUNT(*) c FROM approvals a WHERE a.status='Pending' AND ${mine(user)}`, user.id, user.role).c;
}

export function approvalDetail(db, user, approvalId) {
  const a = db.get(`SELECT a.* FROM approvals a WHERE a.id=? AND ${mine(user)}`, approvalId, user.id, user.role);
  if (!a) throw notFound('Approval not found');
  const chain = approvalsFor(db, a.entity_type, a.entity_id);
  if (a.entity_type === 'trip') {
    const t = db.get('SELECT t.*, u.name employee, u.emp_id, u.department, u.email, u.phone FROM trips t JOIN users u ON u.id=t.traveller_id WHERE t.id=?', a.entity_id);
    const bookings = db.all("SELECT type,detail,route,travel_date,amount,status FROM bookings WHERE trip_id=? AND status!='Cancelled'", t.id);
    const files = db.all("SELECT id,name,size FROM files WHERE entity_type='trip' AND entity_id=?", t.id);
    return { approval: a, entity: t, chain, bookings, files };
  }
  if (a.entity_type === 'expense') {
    const r = db.get('SELECT r.*, u.name employee, u.emp_id, u.department FROM expense_reports r JOIN users u ON u.id=r.user_id WHERE r.id=?', a.entity_id);
    const items = db.all('SELECT * FROM expense_items WHERE report_id=?', r.id);
    return { approval: a, entity: r, chain, items, calc: calcFor(items, r.advance), files: [] };
  }
  const b = db.get('SELECT b.*, u.name employee FROM bookings b JOIN users u ON u.id=b.traveller_id WHERE b.id=?', a.entity_id);
  return { approval: a, entity: { ...b, details: json(b.details, {}) }, chain, files: [] };
}

export function decide(db, user, approvalId, { decision, comment: cmt }) {
  return db.tx(() => {
    if (!['approve', 'reject', 'info'].includes(decision)) throw bad('Decision must be approve, reject or info');
    const a = db.get(`SELECT a.* FROM approvals a WHERE a.id=? AND ${mine(user)}`, approvalId, user.id, user.role);
    if (!a) throw forbidden('You are not an approver for this item');
    if (a.status !== 'Pending') throw conflict(`This approval is already ${a.status}`);
    if (['reject', 'info'].includes(decision) && !String(cmt || '').trim()) throw bad(decision === 'reject' ? 'A rejection reason is mandatory' : 'Please state what information is required');
    const status = decision === 'approve' ? 'Approved' : decision === 'reject' ? 'Rejected' : 'Info Requested';
    db.run('UPDATE approvals SET status=?, comment=?, approver_id=COALESCE(approver_id,?), acted_at=? WHERE id=?', status, cmt || null, user.id, nowIso(), approvalId);
    if (cmt) comment(db, a.entity_type, a.entity_id, user, cmt, 'Approver');
    audit(db, user, `approval.${decision}`, a.entity_type, a.entity_id, `${a.label}${cmt ? `: ${cmt}` : ''}`);
    if (a.entity_type === 'trip') afterTrip(db, user, a, decision, cmt);
    else if (a.entity_type === 'expense') afterExpenseDecision(db, user, a, decision, cmt);
    else afterBookingDecision(db, user, a, decision, cmt);
    return { ok: true, status };
  });
}

function afterTrip(db, user, a, decision, cmt) {
  const t = db.get('SELECT * FROM trips WHERE id=?', a.entity_id);
  if (decision === 'approve') {
    const next = db.get("SELECT * FROM approvals WHERE entity_type='trip' AND entity_id=? AND status='Waiting' ORDER BY level LIMIT 1", t.id);
    if (next) {
      db.run("UPDATE approvals SET status='Pending' WHERE id=?", next.id);
      db.run("UPDATE trips SET status='Under Approval', updated_at=? WHERE id=?", nowIso(), t.id);
      notify(db, next.approver_id, { category: 'approval', title: 'Trip request awaiting your approval', body: `${t.trip_no} - ${t.title}`, link: '/approvals', refKey: `trip-l${next.level}:${t.id}` });
    } else {
      db.run("UPDATE trips SET status='Approved', approved_at=?, updated_at=? WHERE id=?", nowIso(), nowIso(), t.id);
      notify(db, t.traveller_id, { category: 'approval', title: `Trip ${t.trip_no} approved`, body: 'You can now book services and raise expenses.', link: `/trips/${t.id}`, refKey: `trip-ok:${t.id}` });
    }
  } else if (decision === 'reject') {
    db.run("UPDATE trips SET status='Rejected', updated_at=? WHERE id=?", nowIso(), t.id);
    notify(db, t.traveller_id, { category: 'approval', severity: 'danger', title: `Trip ${t.trip_no} rejected`, body: cmt, link: `/trips/${t.id}`, refKey: `trip-no:${t.id}` });
  } else {
    db.run("UPDATE trips SET status='Pending for Review', updated_at=? WHERE id=?", nowIso(), t.id);
    notify(db, t.traveller_id, { category: 'approval', severity: 'warn', title: `More information needed for ${t.trip_no}`, body: cmt, link: `/trips/${t.id}`, refKey: `trip-info:${t.id}:${Date.now()}` });
  }
}
