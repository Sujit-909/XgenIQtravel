import { json } from '../db';
import { bad, conflict, forbidden, notFound, nowIso, today, isDate, num, page as pg, seq, yearOf, pad, audit, notify, getSetting, insert, daysBetween } from '../util';
import { verifyToken } from '../crypto';
import { createChain, approvalsFor, teamIds, userName } from './chain';
import { cancelBooking } from './bookings';

export const TRIP_STATUSES = ['Draft', 'Submitted', 'Pending for Review', 'Under Approval', 'Approved', 'Booking In Progress', 'Travel In Progress', 'Expenses Pending', 'Closed', 'Rejected', 'Cancelled'];
export const PURPOSES = ['Client meeting', 'Project / site visit', 'Training / conference', 'Internal meeting'];
export const TRAVEL_MODES = ['Flight', 'Train', 'Company cab', 'Rental cab', 'Personal cab', 'Bus', 'Other'];
const COST_KIND = { 'Cost Center': 'cost_center', Project: 'project', 'Sales Order': 'sales_order' };
const ACTIVE = ['Submitted', 'Pending for Review', 'Under Approval', 'Approved', 'Booking In Progress', 'Travel In Progress', 'Expenses Pending'];

export function syncStatuses(db) {
  const t = today();
  db.run("UPDATE trips SET status='Travel In Progress', updated_at=? WHERE status IN ('Approved','Booking In Progress') AND dep_date<=? AND ret_date>=?", nowIso(), t, t);
  db.run("UPDATE trips SET status='Expenses Pending', updated_at=? WHERE status IN ('Approved','Booking In Progress','Travel In Progress') AND ret_date<?", nowIso(), t);
}

// ---------- access control ----------
export function tripScopeSql(db, user, scope) {
  if (['admin', 'travel_desk', 'finance'].includes(user.role) && scope !== 'mine') return { where: '1=1', params: [] };
  if (scope === 'team' || (user.role === 'manager' && scope !== 'mine')) {
    const ids = teamIds(db, user.id);
    return { where: `(t.traveller_id IN (${ids.map(() => '?').join(',')}) OR t.created_by=?)`, params: [...ids, user.id] };
  }
  return { where: '(t.traveller_id=? OR t.created_by=?)', params: [user.id, user.id] };
}
export function canViewTrip(db, user, t) {
  if (['admin', 'travel_desk', 'finance'].includes(user.role)) return true;
  if (t.traveller_id === user.id || t.created_by === user.id) return true;
  if (db.get("SELECT 1 x FROM approvals WHERE entity_type='trip' AND entity_id=? AND approver_id=?", t.id, user.id)) return true;
  return teamIds(db, user.id).includes(t.traveller_id) && user.role === 'manager';
}
export function loadTrip(db, user, id) {
  const t = db.get('SELECT * FROM trips WHERE id=?', id);
  if (!t) throw notFound('Trip not found');
  if (!canViewTrip(db, user, t)) throw forbidden();
  return t;
}
const canEditTrip = (user, t) => t.created_by === user.id || t.traveller_id === user.id || user.role === 'admin';

// ---------- approval workflow ----------
export function computeWorkflow(db, t, traveller) {
  const threshold = getSetting(db, 'threshold_amount', 100000);
  const person = (id) => (id ? db.get('SELECT id,name FROM users WHERE id=?', id) : null);
  const mgr = person(traveller.manager_id);
  const dept = db.get("SELECT owner_id FROM master_data WHERE kind='department' AND lower(name)=lower(?)", traveller.department || '');
  const depHead = person(dept?.owner_id);
  const code = String(t.cost_object || '').split(' - ')[0];
  const coRow = db.get('SELECT owner_id FROM master_data WHERE code=? AND kind IN (?,?,?,?)', code, 'cost_center', 'project', 'sales_order', 'internal_order');
  const owner = person(coRow?.owner_id);
  const intlApprover = person(getSetting(db, 'intl_approver_id', null));
  const raw = [];
  let kind = 'standard';
  if (t.emergency) {
    kind = 'emergency';
    raw.push({ label: 'Emergency Approver', who: person(getSetting(db, 'emergency_approver_id', null)), note: 'Emergency workflow - justification recorded, reviewed after travel' });
  } else if (t.travel_type === 'International') {
    kind = 'international';
    raw.push({ label: 'Reporting Manager', who: mgr, note: 'Based on policy and trip type' }, { label: 'Department Head', who: depHead, note: 'If estimated cost above threshold or international' }, { label: 'Finance / International Approver', who: intlApprover, note: 'For international travel' });
  } else if (Number(t.est_budget) > threshold) {
    kind = 'threshold';
    raw.push({ label: 'Reporting Manager', who: mgr, note: 'Based on policy and trip type' }, { label: 'Budget Owner', who: owner, note: `Estimated cost above ₹${threshold.toLocaleString('en-IN')}` }, { label: 'Department Head', who: depHead, note: 'Above configured threshold' });
  } else if (t.cost_object_type === 'Project') {
    kind = 'project';
    raw.push({ label: 'Reporting Manager', who: mgr, note: 'Based on policy and trip type' }, { label: 'Project / Budget Owner', who: owner, note: 'Trip charged to a project' });
  } else raw.push({ label: 'Reporting Manager', who: mgr, note: 'Standard domestic trip within budget' });
  // No self-approval and no duplicate approver in the chain
  const seen = new Set([traveller.id]);
  const steps = [];
  for (const r of raw) {
    if (!r.who || seen.has(r.who.id)) continue;
    seen.add(r.who.id);
    steps.push({ label: r.label, approverId: r.who.id, approverName: r.who.name, note: r.note });
  }
  if (!steps.length) {
    const fb = person(getSetting(db, 'emergency_approver_id', null));
    if (fb && fb.id !== traveller.id) steps.push({ label: 'Department Head', approverId: fb.id, approverName: fb.name, note: 'Escalated - no other approver available' });
  }
  return { kind, steps };
}

// ---------- validation ----------
function costObjectOk(db, type, value) {
  const kind = COST_KIND[type];
  if (!kind) return false;
  const code = String(value).split(' - ')[0].trim();
  return !!db.get('SELECT 1 x FROM master_data WHERE kind=? AND code=? AND active=1', kind, code);
}
export function validateTrip(db, user, i, { submit }) {
  const e = [];
  const need = (k, label) => { if (!String(i[k] ?? '').trim()) e.push(`${label} is required`); };
  need('title', 'Trip title');
  if (!submit && e.length) throw bad(e[0], { errors: e });
  need('purpose', 'Request purpose'); need('purpose_text', 'Purpose of travel'); need('department', 'Department'); need('dest_country', 'Destination country'); need('dep_country', 'Departure country');
  need('dep_city', 'Departure city'); need('dest_city', 'Destination city'); need('travel_mode', 'Preferred travel mode'); need('company_code', 'Company code');
  need('cost_object_type', 'Cost object type'); need('cost_object', 'Cost object');
  if (submit) need('comment', 'Comment');
  if (!PURPOSES.includes(i.purpose) && i.purpose) e.push('Invalid request purpose');
  if (!TRAVEL_MODES.includes(i.travel_mode) && i.travel_mode) e.push('Invalid travel mode');
  if (!isDate(i.dep_date)) e.push('Departure date is required'); if (!isDate(i.ret_date)) e.push('Return date is required');
  if (isDate(i.dep_date) && isDate(i.ret_date) && i.ret_date < i.dep_date) e.push('Return date cannot be before departure date');
  if (isDate(i.dep_date) && i.dep_date < today() && !i.emergency) e.push('Departure date cannot be in the past');
  const intl = i.dest_country && i.dep_country && i.dest_country !== i.dep_country;
  if (i.travel_type === 'Domestic' && intl) e.push('Destination country differs from departure country - choose International travel');
  if (i.travel_type === 'International' && i.dest_country && i.dest_country === i.dep_country) e.push('International travel needs a different destination country');
  if (i.cost_object_type && i.cost_object && !costObjectOk(db, i.cost_object_type, i.cost_object)) e.push('Selected cost object is not valid for the chosen cost object type');
  if (!(num(i.est_budget) > 0)) e.push('Estimated total budget must be greater than zero');
  if (i.advance_needed) {
    const max = getSetting(db, 'max_advance', 50000);
    if (!(num(i.advance_amount) > 0)) e.push('Advance amount is required when a travel advance is needed');
    else if (num(i.advance_amount) > max) e.push(`Advance cannot exceed the policy maximum of ₹${max.toLocaleString('en-IN')}`);
    else if (num(i.advance_amount) > num(i.est_budget)) e.push('Advance cannot exceed the estimated budget');
  }
  if (i.emergency && !String(i.emergency_justification || '').trim()) e.push('Emergency travel requires a justification');
  if (String(i.comment || '').length > 2000) e.push('Comment is limited to 2000 characters');
  if (e.length) throw bad(e[0], { errors: e });
}

function resolveTraveller(db, user, i) {
  const type = i.created_for_type || 'Self';
  if (type === 'Self') return { traveller: user, type };
  if (type === 'Agency' && !['travel_desk', 'admin'].includes(user.role)) throw forbidden('Only travel desk / agency users can create trips for an agency booking');
  const tok = verifyToken(i.traveller_token);
  if (!tok || tok.purpose !== 'traveller' || tok.by !== user.id || (i.traveller_id && Number(i.traveller_id) !== tok.traveller)) throw forbidden('Traveller verification is required before creating a trip on their behalf');
  const traveller = db.get('SELECT * FROM users WHERE id=? AND active=1', tok.traveller);
  if (!traveller) throw notFound('Traveller not found');
  return { traveller, type };
}

const FIELDS = ['purpose', 'title', 'purpose_text', 'travel_type', 'emergency', 'emergency_justification', 'department', 'dest_country', 'dep_country', 'dep_city', 'dest_city', 'dep_date', 'ret_date', 'travel_mode', 'extra_other', 'company_code', 'cost_object_type', 'cost_object', 'currency', 'est_budget', 'advance_needed', 'advance_amount', 'comment'];
const pickFields = (i) => {
  const o = {};
  for (const f of FIELDS) if (i[f] !== undefined) o[f] = i[f];
  if (i.extra_reqs !== undefined) o.extra_reqs = JSON.stringify(Array.isArray(i.extra_reqs) ? i.extra_reqs : []);
  if ('emergency' in o) o.emergency = o.emergency ? 1 : 0;
  if ('advance_needed' in o) { o.advance_needed = o.advance_needed ? 1 : 0; if (!o.advance_needed) o.advance_amount = 0; }
  if ('est_budget' in o) o.est_budget = num(o.est_budget); if ('advance_amount' in o) o.advance_amount = num(o.advance_amount);
  if (o.travel_type === undefined && o.dest_country && o.dep_country) o.travel_type = o.dest_country === o.dep_country ? 'Domestic' : 'International';
  return o;
};

export function createTrip(db, user, input, { submit = false } = {}) {
  return db.tx(() => {
    const { traveller, type } = resolveTraveller(db, user, input);
    const data = { ...input, department: input.department || traveller.department };
    validateTrip(db, user, data, { submit });
    const no = `BT-${yearOf()}-${pad(seq(db, `trip-${yearOf()}`), 5)}`;
    const id = insert(db, 'trips', { trip_no: no, created_by: user.id, traveller_id: traveller.id, created_for_type: type, ...pickFields(data), status: 'Draft', created_at: nowIso(), updated_at: nowIso() });
    audit(db, user, 'trip.create', 'trip', id, `${no} for ${traveller.name} (${type})`);
    if (submit) submitTrip(db, user, id);
    return getTripRow(db, id);
  });
}
const getTripRow = (db, id) => db.get('SELECT t.*, u.name traveller_name, c.name creator_name FROM trips t JOIN users u ON u.id=t.traveller_id JOIN users c ON c.id=t.created_by WHERE t.id=?', id);

export function updateTrip(db, user, id, input) {
  return db.tx(() => {
    const t = loadTrip(db, user, id);
    if (!canEditTrip(user, t)) throw forbidden('Only the requester can edit this trip');
    if (!['Draft', 'Pending for Review'].includes(t.status)) throw conflict(`A trip in "${t.status}" status cannot be edited. Use Request Change instead.`);
    const merged = { ...t, ...input, extra_reqs: input.extra_reqs ?? json(t.extra_reqs, []) };
    validateTrip(db, user, merged, { submit: false });
    const f = pickFields(input);
    const keys = Object.keys(f);
    if (keys.length) db.run(`UPDATE trips SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`, ...keys.map((k) => f[k]), nowIso(), id);
    audit(db, user, 'trip.update', 'trip', id, keys.join(','));
    return getTripRow(db, id);
  });
}

export function submitTrip(db, user, id) {
  return db.tx(() => {
    const t = loadTrip(db, user, id);
    if (!canEditTrip(user, t)) throw forbidden('Only the requester can submit this trip');
    if (!['Draft', 'Pending for Review'].includes(t.status)) throw conflict(`Trip is already ${t.status}`);
    validateTrip(db, user, { ...t, extra_reqs: json(t.extra_reqs, []) }, { submit: true });
    const traveller = db.get('SELECT * FROM users WHERE id=?', t.traveller_id);
    if (t.status === 'Pending for Review') {
      db.run("UPDATE approvals SET status='Pending', comment=comment, acted_at=NULL WHERE entity_type='trip' AND entity_id=? AND status='Info Requested'", id);
      const anyApproved = db.get("SELECT 1 x FROM approvals WHERE entity_type='trip' AND entity_id=? AND status='Approved'", id);
      db.run('UPDATE trips SET status=?, updated_at=? WHERE id=?', anyApproved ? 'Under Approval' : 'Submitted', nowIso(), id);
      const p = db.get("SELECT approver_id FROM approvals WHERE entity_type='trip' AND entity_id=? AND status='Pending' ORDER BY level LIMIT 1", id);
      notify(db, p?.approver_id, { category: 'approval', title: 'Trip re-submitted for approval', body: `${t.trip_no} - ${t.title}`, link: '/approvals', refKey: `trip-resub:${id}:${Date.now()}` });
    } else {
      const wf = computeWorkflow(db, t, traveller);
      if (!wf.steps.length) throw conflict('No approver could be determined for this trip. Contact the travel administrator.');
      createChain(db, 'trip', id, wf.steps);
      db.run("UPDATE trips SET status='Submitted', submitted_at=?, updated_at=? WHERE id=?", nowIso(), nowIso(), id);
      notify(db, wf.steps[0].approverId, { category: 'approval', title: 'Trip request awaiting your approval', body: `${t.trip_no} - ${t.title} (${traveller.name})`, link: '/approvals', refKey: `trip-sub:${id}` });
      if (t.emergency) audit(db, user, 'trip.emergency', 'trip', id, t.emergency_justification);
    }
    audit(db, user, 'trip.submit', 'trip', id, t.trip_no);
    return getTripRow(db, id);
  });
}

export function workflowPreview(db, user, input) {
  let traveller = user;
  if (input.traveller_id && Number(input.traveller_id) !== user.id) {
    const u = db.get('SELECT * FROM users WHERE id=?', input.traveller_id);
    if (u && (user.role !== 'employee' || verifyToken(input.traveller_token))) traveller = u;
  }
  const dest = input.dest_country; const dep = input.dep_country;
  const travel_type = input.travel_type || (dest && dep && dest !== dep ? 'International' : 'Domestic');
  return computeWorkflow(db, { ...input, travel_type, emergency: input.emergency ? 1 : 0 }, traveller);
}

export function cancelTrip(db, user, id, reason) {
  return db.tx(() => {
    const t = loadTrip(db, user, id);
    if (!canEditTrip(user, t) && !['admin', 'travel_desk'].includes(user.role)) throw forbidden();
    if (['Closed', 'Cancelled', 'Rejected'].includes(t.status)) throw conflict(`Trip is already ${t.status}`);
    if (!String(reason || '').trim()) throw bad('A cancellation reason is required');
    db.all("SELECT id FROM bookings WHERE trip_id=? AND status IN ('Created','Held','Ticketing Pending','Confirmed','Changed')", id).forEach((b) => cancelBooking(db, user, b.id, reason, { silent: true }));
    db.run("UPDATE services SET status='Cancelled', desk_stage='Cancelled', updated_at=? WHERE trip_id=? AND status NOT IN ('Confirmed','Cancelled','Failed')", nowIso(), id);
    db.run("UPDATE approvals SET status='Cancelled', acted_at=? WHERE entity_type='trip' AND entity_id=? AND status IN ('Pending','Waiting')", nowIso(), id);
    db.run("UPDATE trips SET status='Cancelled', updated_at=? WHERE id=?", nowIso(), id);
    audit(db, user, 'trip.cancel', 'trip', id, reason);
    notify(db, t.traveller_id, { category: 'other', title: 'Trip cancelled', body: `${t.trip_no} - ${reason}`, link: `/trips/${id}`, refKey: `trip-cancel:${id}` });
    return getTripRow(db, id);
  });
}

export function copyTrip(db, user, id) {
  const t = loadTrip(db, user, id);
  const no = `BT-${yearOf()}-${pad(seq(db, `trip-${yearOf()}`), 5)}`;
  const newId = insert(db, 'trips', {
    trip_no: no, created_by: user.id, traveller_id: user.id, created_for_type: 'Self', purpose: t.purpose, title: `${t.title} (copy)`, purpose_text: t.purpose_text, travel_type: t.travel_type,
    department: t.department, dest_country: t.dest_country, dep_country: t.dep_country, dep_city: t.dep_city, dest_city: t.dest_city, travel_mode: t.travel_mode, extra_reqs: t.extra_reqs,
    company_code: t.company_code, cost_object_type: t.cost_object_type, cost_object: t.cost_object, est_budget: t.est_budget, advance_needed: t.advance_needed, advance_amount: t.advance_amount,
    comment: t.comment, status: 'Draft', created_at: nowIso(), updated_at: nowIso(),
  });
  audit(db, user, 'trip.copy', 'trip', newId, `from ${t.trip_no}`);
  return getTripRow(db, newId);
}

// Rules for closing a trip: nothing outstanding (bookings, refunds, services, expenses, reimbursements).
export function closeBlockers(db, id) {
  const b = [];
  const t = db.get('SELECT * FROM trips WHERE id=?', id);
  if (!['Expenses Pending', 'Travel In Progress', 'Booking In Progress', 'Approved'].includes(t.status)) b.push(`Trip is ${t.status}`);
  if (t.ret_date && t.ret_date >= today()) b.push('Travel has not been completed yet');
  const open = db.all("SELECT booking_no FROM bookings WHERE trip_id=? AND status IN ('Created','Held','Ticketing Pending')", id);
  if (open.length) b.push(`Outstanding bookings: ${open.map((x) => x.booking_no).join(', ')}`);
  const refunds = db.all("SELECT b.booking_no FROM refunds r JOIN bookings b ON b.id=r.booking_id WHERE b.trip_id=? AND r.status IN ('Expected','Requested','Supplier Confirmed','Processing','Partially Credited')", id);
  if (refunds.length) b.push(`Refunds not yet credited: ${refunds.map((x) => x.booking_no).join(', ')}`);
  const svc = db.all("SELECT srv_no FROM services WHERE trip_id=? AND status IN ('Submitted','Awaiting Information','Approved','In Progress')", id);
  if (svc.length) b.push(`Open service requests: ${svc.map((x) => x.srv_no).join(', ')}`);
  const exp = db.all("SELECT report_no FROM expense_reports WHERE trip_id=? AND status NOT IN ('Finance Approved','Posted','Rejected')", id);
  if (exp.length) b.push(`Expense reports not finance-approved: ${exp.map((x) => x.report_no).join(', ')}`);
  const unpaid = db.all("SELECT e.report_no FROM expense_reports e JOIN reimbursements r ON r.report_id=e.id WHERE e.trip_id=? AND r.status NOT IN ('Paid','Not Payable')", id);
  if (unpaid.length) b.push(`Reimbursement pending: ${unpaid.map((x) => x.report_no).join(', ')}`);
  return b;
}
export function closeTrip(db, user, id) {
  return db.tx(() => {
    const t = loadTrip(db, user, id);
    if (!canEditTrip(user, t) && !['admin', 'finance'].includes(user.role)) throw forbidden();
    const blockers = closeBlockers(db, id);
    if (blockers.length) throw conflict('Trip cannot be closed yet', { blockers });
    db.run("UPDATE trips SET status='Closed', closed_at=?, updated_at=? WHERE id=?", nowIso(), nowIso(), id);
    audit(db, user, 'trip.close', 'trip', id, t.trip_no);
    return getTripRow(db, id);
  });
}

// ---------- queries ----------
const pct = (cur, prev) => (prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100));
export function listTrips(db, user, q = {}) {
  syncStatuses(db);
  const scope = q.scope || (user.role === 'employee' ? 'mine' : user.role === 'manager' ? 'team' : 'all');
  const sc = tripScopeSql(db, user, scope);
  const where = [sc.where]; const params = [...sc.params];
  if (q.status && q.status !== 'All') { where.push('t.status=?'); params.push(q.status); }
  if (q.purpose && q.purpose !== 'All') { where.push('t.purpose=?'); params.push(q.purpose); }
  if (q.travel_type && q.travel_type !== 'All') { where.push('t.travel_type=?'); params.push(q.travel_type); }
  if (q.department && q.department !== 'All') { where.push('t.department=?'); params.push(q.department); }
  if (isDate(q.from)) { where.push('t.dep_date>=?'); params.push(q.from); }
  if (isDate(q.to)) { where.push('t.dep_date<=?'); params.push(q.to); }
  if (q.q) { where.push('(t.trip_no LIKE ? OR t.title LIKE ? OR t.dest_city LIKE ? OR u.name LIKE ?)'); const s = `%${q.q}%`; params.push(s, s, s, s); }
  const { size, page, offset } = pg(q);
  const base = `FROM trips t JOIN users u ON u.id=t.traveller_id WHERE ${where.join(' AND ')}`;
  const total = db.get(`SELECT COUNT(*) c ${base}`, ...params).c;
  const rows = db.all(`SELECT t.*, u.name traveller_name, u.emp_id traveller_emp ${base} ORDER BY t.dep_date DESC, t.id DESC LIMIT ? OFFSET ?`, ...params, size, offset);
  // aggregates over the whole scope (ignoring filters)
  const all = db.all(`SELECT t.id,t.status,t.created_at,t.submitted_at FROM trips t WHERE ${sc.where}`, ...sc.params);
  const month = today().slice(0, 7); const prevM = new Date(); prevM.setUTCMonth(prevM.getUTCMonth() - 1); const prev = prevM.toISOString().slice(0, 7);
  const inM = (a, m) => all.filter((x) => String(x.created_at).startsWith(m) && a(x)).length;
  const counts = Object.fromEntries(TRIP_STATUSES.map((s) => [s, all.filter((x) => x.status === s).length]));
  const approvalHours = db.all(`SELECT t.status, AVG((julianday(a.acted_at)-julianday(t.submitted_at))*24) h FROM trips t JOIN approvals a ON a.entity_type='trip' AND a.entity_id=t.id AND a.acted_at IS NOT NULL
    WHERE ${sc.where} AND t.submitted_at IS NOT NULL GROUP BY t.status`, ...sc.params);
  const hrs = Object.fromEntries(approvalHours.map((r) => [r.status, r.h]));
  const fmtH = (h) => (h == null ? '-' : h < 24 ? `${Math.max(1, Math.round(h))} hours` : `${(h / 24).toFixed(1)} days`);
  const sel = (st) => (x) => st.includes(x.status);
  const kpis = {
    total: all.length, totalDelta: pct(inM(() => true, month), inM(() => true, prev)),
    pending: counts.Submitted + counts['Under Approval'] + counts['Pending for Review'], pendingDelta: pct(inM(sel(['Submitted', 'Under Approval', 'Pending for Review']), month), inM(sel(['Submitted', 'Under Approval', 'Pending for Review']), prev)),
    booking: counts['Booking In Progress'], bookingDelta: pct(inM(sel(['Booking In Progress']), month), inM(sel(['Booking In Progress']), prev)),
    completed: counts.Closed, completedDelta: pct(inM(sel(['Closed']), month), inM(sel(['Closed']), prev)),
  };
  const byStatus = TRIP_STATUSES.map((s) => ({ status: s, count: counts[s], thisMonth: inM(sel([s]), month), avgApproval: fmtH(hrs[s]), pct: all.length ? Math.round((counts[s] / all.length) * 1000) / 10 : 0 }));
  const departments = db.all(`SELECT DISTINCT t.department d FROM trips t WHERE ${sc.where} AND t.department IS NOT NULL ORDER BY 1`, ...sc.params).map((r) => r.d);
  return { rows, total, page, size, kpis, counts, byStatus, departments, scope };
}

export function trackerFor(t, hasBookingConfirmed = false) {
  const steps = ['Request', 'Approval', 'Booking', 'Travel', 'Expenses', 'Closure'];
  const idxByStatus = { Draft: 0, Submitted: 1, 'Pending for Review': 1, 'Under Approval': 1, Approved: 2, 'Booking In Progress': 2, 'Travel In Progress': 3, 'Expenses Pending': 4, Closed: 6, Rejected: 1, Cancelled: 1 };
  const cur = idxByStatus[t.status] ?? 0;
  const dates = [t.created_at?.slice(0, 10), t.approved_at?.slice(0, 10), t.dep_date && t.status !== 'Draft' ? 'In Progress' : '-', `${t.dep_date || ''} - ${t.ret_date || ''}`, ['Expenses Pending', 'Closed'].includes(t.status) ? 'Pending' : '-', t.closed_at?.slice(0, 10) || '-'];
  return steps.map((label, i) => ({ label, date: dates[i], state: ['Rejected', 'Cancelled'].includes(t.status) ? (i === 0 ? 'done' : i === 1 ? 'failed' : 'todo') : i < cur ? 'done' : i === cur ? 'current' : 'todo' }));
}

export function getTrip(db, user, id) {
  syncStatuses(db);
  const t = loadTrip(db, user, id);
  const traveller = db.get('SELECT id,name,emp_id,email,phone,department,designation,grade,manager_id,home_city,nationality FROM users WHERE id=?', t.traveller_id);
  const creator = db.get('SELECT id,name,emp_id FROM users WHERE id=?', t.created_by);
  const approvals = approvalsFor(db, 'trip', id);
  const services = db.all('SELECT * FROM services WHERE trip_id=? ORDER BY id DESC', id).map((s) => ({ ...s, details: json(s.details, {}), quotes: db.all('SELECT * FROM service_quotes WHERE service_id=?', s.id) }));
  const bookings = db.all('SELECT * FROM bookings WHERE trip_id=? ORDER BY travel_date, id', id).map((b) => ({ ...b, details: json(b.details, {}) }));
  const files = db.all("SELECT id,name,mime,size,created_at FROM files WHERE entity_type='trip' AND entity_id=?", id);
  const utilized = bookings.filter((b) => !['Cancelled'].includes(b.status)).reduce((s, b) => s + b.amount, 0);
  const wf = approvals.length ? null : computeWorkflow(db, t, traveller);
  const history = db.all("SELECT ts,actor_name,action,detail FROM audit_log WHERE entity_type='trip' AND entity_id=? ORDER BY id DESC LIMIT 50", id);
  const reports = db.all('SELECT id,report_no,status FROM expense_reports WHERE trip_id=?', id);
  return {
    trip: { ...t, extra_reqs: json(t.extra_reqs, []) }, traveller, creator, approvals, workflow: wf, services, bookings, files, history, reports,
    tracker: trackerFor(t), summary: { utilized, balance: t.est_budget - utilized },
    can: { edit: canEditTrip(user, t) && ['Draft', 'Pending for Review'].includes(t.status), cancel: canEditTrip(user, t) && !['Closed', 'Cancelled', 'Rejected'].includes(t.status),
      book: ['Approved', 'Booking In Progress', 'Travel In Progress'].includes(t.status), expense: ['Approved', 'Booking In Progress', 'Travel In Progress', 'Expenses Pending', 'Closed'].includes(t.status),
      close: canEditTrip(user, t) && !['Closed', 'Cancelled', 'Rejected', 'Draft'].includes(t.status) },
  };
}
export const daysUntil = (d) => daysBetween(today(), d);
export { userName, ACTIVE };
