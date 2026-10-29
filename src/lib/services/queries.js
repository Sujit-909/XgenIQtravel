import { json } from '../db';
import { bad, conflict, forbidden, notFound, nowIso, today, addDays, daysBetween, isDate, page as pg, audit, insert, round2, validity, ROLE_LABEL } from '../util';
import { maskDoc } from '../crypto';
import { teamIds } from './chain';
import { listTrips, syncStatuses, tripScopeSql } from './trips';
import { pendingCount } from './approvals';
import { syncAlerts, unreadCount, docStatus } from './profile';
import { listQueue } from './desk';
import { refundKpis } from './finance';

// ================= dashboards =================
export function dashboard(db, user) {
  syncStatuses(db); syncAlerts(db, user);
  const t = today();
  const base = { role: user.role, pending: pendingCount(db, user), unread: unreadCount(db, user) };
  if (user.role === 'employee') {
    const upcoming = db.all("SELECT t.* FROM trips t WHERE (t.traveller_id=?) AND t.status IN ('Approved','Booking In Progress','Under Approval','Submitted') AND t.dep_date>=? ORDER BY t.dep_date LIMIT 5", user.id, t);
    const upcomingCount = db.get("SELECT COUNT(*) c FROM trips WHERE traveller_id=? AND status IN ('Approved','Booking In Progress','Travel In Progress') AND ret_date>=?", user.id, t).c;
    const replies = [
      ...db.all("SELECT id, trip_no ref, title, dest_city, dep_date, submitted_at created_at, 'trip' kind FROM trips WHERE traveller_id=? AND status='Pending for Review'", user.id).map((r) => ({ ...r, label: 'Trip Approval', sub: 'Action Required', action: 'Review', link: `/trips/${r.id}`, details: `${r.dest_city} · ${r.title}` })),
      ...db.all("SELECT s.id, s.srv_no ref, s.type, s.created_at, t.dep_date, t.ret_date, t.dest_city, t.id trip_id FROM services s JOIN trips t ON t.id=s.trip_id WHERE t.traveller_id=? AND s.status IN ('Submitted','Awaiting Information') AND s.desk_stage='Traveller Info'", user.id)
        .map((r) => ({ ...r, kind: 'service', label: `${r.type[0].toUpperCase()}${r.type.slice(1)} Booking Confirmation`, sub: 'Your Approval Needed', action: 'Approve', link: `/trips/${r.trip_id}?service=${r.type}`, details: `${r.dest_city} · ${r.dep_date} - ${r.ret_date}` })),
    ].map((r) => ({ ...r, daysPending: Math.max(1, Math.floor((Date.now() - Date.parse(r.created_at || nowIso())) / 86400000)) }));
    const docs = db.all("SELECT * FROM documents WHERE user_id=? AND expiry_date IS NOT NULL AND doc_type NOT IN ('PAN Card','Aadhaar Card')", user.id).map((d) => ({ ...d, days_left: daysBetween(t, d.expiry_date) }));
    const draftReports = db.get("SELECT COUNT(*) c FROM expense_reports WHERE user_id=? AND status IN ('Draft','Returned for Correction')", user.id).c;
    const needReport = db.get("SELECT COUNT(*) c FROM trips tr WHERE tr.traveller_id=? AND tr.status='Expenses Pending' AND NOT EXISTS (SELECT 1 FROM expense_reports e WHERE e.trip_id=tr.id)", user.id).c;
    return { ...base, kpis: { upcoming: upcomingCount, waiting: replies.length, expiringSoon: docs.filter((d) => d.days_left >= 0 && d.days_left <= 7).length, expired: docs.filter((d) => d.days_left < 0).length, expensesPending: draftReports + needReport }, upcoming, replies,
      expiring: docs.filter((d) => d.days_left <= 7).sort((a, b) => a.days_left - b.days_left) };
  }
  if (user.role === 'manager') {
    const ids = teamIds(db, user.id);
    const q = `(${ids.map(() => '?').join(',')})`;
    const team = db.get(`SELECT COUNT(*) c FROM trips WHERE traveller_id IN ${q} AND status IN ('Approved','Booking In Progress','Travel In Progress') AND ret_date>=?`, ...ids, t).c;
    const pendingTrips = db.all(`SELECT a.id approval_id, tr.trip_no, tr.title, tr.dep_date, tr.est_budget, u.name employee FROM approvals a JOIN trips tr ON tr.id=a.entity_id JOIN users u ON u.id=tr.traveller_id WHERE a.entity_type='trip' AND a.status='Pending' AND a.approver_id=? ORDER BY a.id DESC LIMIT 6`, user.id);
    const exceptions = db.get("SELECT COUNT(*) c FROM approvals WHERE entity_type='booking' AND status='Pending' AND approver_id=?", user.id).c;
    const rd = readiness(db, user, {});
    const refunds = db.get(`SELECT COUNT(*) c FROM refunds r JOIN bookings b ON b.id=r.booking_id WHERE b.traveller_id IN ${q} AND r.status NOT IN ('Credited','Rejected','Not Applicable')`, ...ids).c;
    return { ...base, kpis: { pendingTrips: db.get("SELECT COUNT(*) c FROM approvals WHERE entity_type='trip' AND status='Pending' AND approver_id=?", user.id).c, pendingExpenses: db.get("SELECT COUNT(*) c FROM approvals WHERE entity_type='expense' AND status='Pending' AND approver_id=?", user.id).c, teamTrips: team, exceptions, highRisk: rd.kpis.high, refunds }, pendingTrips, upcoming: rd.rows.slice(0, 5) };
  }
  if (user.role === 'travel_desk') {
    const qd = listQueue(db, user, { size: 6 });
    return { ...base, kpis: qd.counts, queue: qd.rows, refunds: db.get("SELECT COUNT(*) c FROM refunds WHERE status NOT IN ('Credited','Rejected','Not Applicable')").c };
  }
  if (user.role === 'finance') {
    return { ...base, kpis: { expenseApprovals: db.get("SELECT COUNT(*) c FROM approvals WHERE entity_type='expense' AND status='Pending' AND approver_role='finance'").c, payable: db.get("SELECT COUNT(*) c FROM reimbursements WHERE status='Payable'").c, failed: db.get("SELECT COUNT(*) c FROM reimbursements WHERE status IN ('Failed','Returned')").c,
      exceptions: db.get("SELECT COUNT(*) c FROM bookings b LEFT JOIN invoices i ON i.booking_id=b.id WHERE b.status NOT IN ('Created','Held') AND b.amount>0 AND i.id IS NULL").c, refunds: db.get("SELECT COUNT(*) c FROM refunds WHERE status NOT IN ('Credited','Rejected','Not Applicable')").c },
    recent: db.all("SELECT r.id, r.report_no, r.title, u.name employee, rb.status payment_status, rb.payable_amount FROM expense_reports r JOIN users u ON u.id=r.user_id LEFT JOIN reimbursements rb ON rb.report_id=r.id WHERE r.status IN ('Manager Approved','Finance Approved','Posted') ORDER BY r.id DESC LIMIT 6") };
  }
  const c = (sql) => db.get(sql).c;
  return { ...base, kpis: { users: c('SELECT COUNT(*) c FROM users WHERE active=1'), rules: c("SELECT COUNT(*) c FROM policy_rules WHERE status='Active'"), trips: c('SELECT COUNT(*) c FROM trips'), exceptions: c("SELECT COUNT(*) c FROM bookings WHERE policy_status!='Compliant'"), audit: c('SELECT COUNT(*) c FROM audit_log') }, recentAudit: db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 8') };
}

// ================= trip readiness & disruption centre =================
export function readiness(db, user, q = {}) {
  syncStatuses(db);
  if (!['manager', 'admin', 'travel_desk'].includes(user.role)) throw forbidden();
  const sc = tripScopeSql(db, user, user.role === 'manager' ? 'team' : 'all');
  const days = Number(q.days || 30);
  const trips = db.all(`SELECT t.*, u.name traveller_name, u.emp_id FROM trips t JOIN users u ON u.id=t.traveller_id WHERE ${sc.where} AND t.status IN ('Approved','Booking In Progress') AND t.dep_date>=? AND t.dep_date<=? ORDER BY t.dep_date`, ...sc.params, today(), addDays(today(), days));
  const rows = trips.map((t) => assess(db, t));
  const filtered = rows.filter((r) => (!q.risk || q.risk === 'All' || r.risk === q.risk) && (!q.readiness || q.readiness === 'All' || r.readiness === q.readiness) && (!q.q || `${r.trip_no} ${r.traveller_name} ${r.dest_city}`.toLowerCase().includes(String(q.q).toLowerCase())));
  const expiring = db.get(`SELECT COUNT(*) c FROM documents d JOIN users u ON u.id=d.user_id WHERE d.expiry_date IS NOT NULL AND d.expiry_date<=? AND d.expiry_date>=? AND u.id IN (SELECT t.traveller_id FROM trips t WHERE ${sc.where})`, addDays(today(), 60), today(), ...sc.params).c;
  const disruptions = db.get(`SELECT COUNT(*) c FROM services s JOIN trips t ON t.id=s.trip_id WHERE ${sc.where} AND s.status='Failed'`, ...sc.params).c
    + db.get(`SELECT COUNT(*) c FROM bookings b JOIN trips t ON t.id=b.trip_id WHERE ${sc.where} AND b.status IN ('Changed') AND t.status IN ('Approved','Booking In Progress')`, ...sc.params).c;
  const kpis = { upcoming: rows.length, high: rows.filter((r) => r.risk === 'High').length, medium: rows.filter((r) => r.risk === 'Medium').length, ready: rows.filter((r) => r.readiness === 'Ready').length, expiring, disruptions };
  const { size, page, offset } = pg(q, 5);
  return { rows: filtered.slice(offset, offset + size), total: filtered.length, page, size, kpis, lastUpdated: nowIso() };
}
export function assess(db, t) {
  const trav = db.get('SELECT * FROM users WHERE id=?', t.traveller_id);
  const bks = db.all("SELECT * FROM bookings WHERE trip_id=? AND status!='Cancelled'", t.id);
  const confirmed = (type) => bks.some((b) => b.type === type && ['Confirmed', 'Completed', 'Changed'].includes(b.status));
  const pending = (type) => bks.some((b) => b.type === type && !['Confirmed', 'Completed', 'Changed'].includes(b.status));
  const failed = db.all("SELECT * FROM services WHERE trip_id=? AND status='Failed'", t.id);
  const intl = t.travel_type === 'International';
  const docs = db.all('SELECT * FROM documents WHERE user_id=?', t.traveller_id);
  const visa = docs.find((d) => d.doc_type === 'Visa' && d.country === t.dest_country && d.expiry_date >= t.ret_date);
  const passport = docs.find((d) => d.doc_type === 'Passport');
  const passOk = passport && passport.expiry_date >= addDays(t.ret_date, 183);
  const emergency = !!db.get('SELECT 1 x FROM emergency_contacts WHERE user_id=?', t.traveller_id);
  const lead = daysBetween(today(), t.dep_date);
  const checklist = [
    { key: 'flight', label: 'Flight Ticket', status: confirmed('flight') ? 'Confirmed' : pending('flight') ? 'Pending' : failed.some((f) => f.type === 'flight') ? 'Failed' : 'Not Confirmed', critical: t.travel_mode === 'Flight' },
    { key: 'hotel', label: 'Hotel Booking', status: confirmed('hotel') ? 'Confirmed' : pending('hotel') ? 'Pending' : 'Not Requested', critical: false },
    { key: 'ground', label: 'Ground Transport', status: bks.some((b) => ['cab', 'bus', 'train'].includes(b.type)) ? 'Confirmed' : 'Not Requested', critical: false },
    { key: 'visa', label: 'Visa', status: !intl ? 'Not Required' : visa ? 'Valid' : 'Pending', critical: intl },
    { key: 'passport', label: 'Passport Validity', status: !intl ? 'Not Required' : passOk ? `Valid till ${passport.expiry_date}` : passport ? 'Expiring' : 'Missing', critical: intl },
    { key: 'emergency', label: 'Emergency Contact', status: emergency ? 'Added' : 'Missing', critical: false },
  ];
  const bad_ = checklist.filter((c) => c.critical && !['Confirmed', 'Valid'].includes(c.status) && !String(c.status).startsWith('Valid'));
  const soft = checklist.filter((c) => !c.critical && ['Pending', 'Missing', 'Failed', 'Not Confirmed'].includes(c.status));
  const readinessState = bad_.length ? 'Not Ready' : soft.length ? 'At Risk' : 'Ready';
  const risk = readinessState === 'Not Ready' ? (lead <= 14 ? 'High' : 'Medium') : readinessState === 'At Risk' ? 'Medium' : 'Low';
  const alerts = [
    ...failed.map((f) => ({ severity: 'High', text: `${f.type} booking failed (${f.srv_no})` })),
    ...checklist.filter((c) => c.critical && !['Confirmed', 'Valid'].includes(c.status) && !String(c.status).startsWith('Valid')).map((c) => ({ severity: 'High', text: `${c.label} - ${c.status}` })),
    ...checklist.filter((c) => !c.critical && ['Missing', 'Pending'].includes(c.status)).map((c) => ({ severity: 'Medium', text: `${c.label} - ${c.status}` })),
  ];
  const bookingStatus = confirmed('flight') && (confirmed('hotel') || !pending('hotel')) ? 'Confirmed' : pending('flight') || pending('hotel') ? 'Pending' : 'Unconfirmed';
  const docStatusLabel = !intl ? (emergency ? 'Valid' : 'Missing Info') : visa && passOk ? 'Valid' : !visa ? 'Visa Pending' : 'Passport Expiring';
  return { id: t.id, trip_no: t.trip_no, traveller_name: trav.name, dest_city: t.dest_city, dest_country: t.dest_country, dep_date: t.dep_date, ret_date: t.ret_date, purpose: t.purpose, est_budget: t.est_budget, booking_status: bookingStatus, doc_status: docStatusLabel, readiness: readinessState, risk, checklist, alerts, last_checked: nowIso(), department: trav.department, travel_type: t.travel_type };
}

// ================= team travel compliance =================
const DOC_TABS = ['Passport', 'Visa', 'PAN Card', 'Aadhaar Card', 'Driving License', 'Other'];
export function teamCompliance(db, user, q = {}) {
  if (!['manager', 'admin', 'travel_desk'].includes(user.role)) throw forbidden();
  const ids = user.role === 'manager' ? teamIds(db, user.id).filter((i) => i !== user.id) : db.all('SELECT id FROM users WHERE active=1').map((r) => r.id);
  const members = ids.length ? db.all(`SELECT * FROM users WHERE id IN (${ids.map(() => '?').join(',')}) AND active=1 ORDER BY name`, ...ids) : [];
  const tab = DOC_TABS.includes(q.doc) ? q.doc : 'Passport'; const within = Number(q.within || 60);
  const allDocs = ids.length ? db.all(`SELECT * FROM documents WHERE user_id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  const typeMatch = (d) => (tab === 'Other' ? !['Passport', 'Visa', 'PAN Card', 'Aadhaar Card', 'Driving License'].includes(d.doc_type) : d.doc_type === tab);
  const rows = members.map((m) => {
    const d = allDocs.filter((x) => x.user_id === m.id && typeMatch(x)).sort((a, b) => String(b.expiry_date).localeCompare(String(a.expiry_date)))[0];
    const left = d?.expiry_date ? daysBetween(today(), d.expiry_date) : null;
    const status = !d ? 'Not Available' : left === null ? 'Valid' : left < 0 ? 'Expired' : left <= within ? 'Expiring Soon' : 'Valid';
    return { user_id: m.id, name: m.name, emp_id: m.emp_id, department: m.department, nationality: m.nationality, doc_number: d ? maskDoc(d.doc_number) : '-', expiry_date: d?.expiry_date || null, days_left: left, status };
  });
  let view = rows;
  if (q.department && q.department !== 'All') view = view.filter((r) => r.department === q.department);
  if (q.status && q.status !== 'All') view = view.filter((r) => r.status === q.status);
  if (q.employee && q.employee !== 'All') view = view.filter((r) => String(r.user_id) === String(q.employee));
  if (q.q) view = view.filter((r) => `${r.name} ${r.emp_id}`.toLowerCase().includes(String(q.q).toLowerCase()));
  const tabs = Object.fromEntries(DOC_TABS.map((t) => { const f = (d) => (t === 'Other' ? !['Passport', 'Visa', 'PAN Card', 'Aadhaar Card', 'Driving License'].includes(d.doc_type) : d.doc_type === t); return [t, allDocs.filter((d) => f(d) && d.expiry_date && daysBetween(today(), d.expiry_date) <= 60).length]; }));
  return { tab, tabs, kpis: { total: rows.length, valid: rows.filter((r) => r.status === 'Valid').length, soon: rows.filter((r) => r.status === 'Expiring Soon').length, expired: rows.filter((r) => r.status === 'Expired').length, na: rows.filter((r) => r.status === 'Not Available').length },
    rows: view, departments: [...new Set(members.map((m) => m.department))].filter(Boolean), employees: members.map((m) => ({ id: m.id, name: m.name })) };
}
export function remindEmployee(db, user, userId, docType) {
  if (!['manager', 'admin', 'travel_desk'].includes(user.role)) throw forbidden();
  const ok = user.role !== 'manager' || teamIds(db, user.id).includes(Number(userId)); if (!ok) throw forbidden();
  db.run('INSERT OR IGNORE INTO notifications(user_id,category,severity,title,body,link,ref_key,created_at) VALUES(?,?,?,?,?,?,?,?)', userId, 'expiry', 'warn', `Reminder: update your ${docType}`, `${user.name} asked you to review your ${docType} details.`, '/documents', `remind:${docType}:${user.id}:${today()}`, nowIso());
  return { ok: true };
}

// ================= team booking analytics =================
export function teamBookingAnalytics(db, user, q = {}) {
  if (!['manager', 'admin', 'travel_desk', 'finance'].includes(user.role)) throw forbidden();
  const ids = user.role === 'manager' ? teamIds(db, user.id).filter((i) => i !== user.id) : null;
  const where = ids ? `b.traveller_id IN (${ids.map(() => '?').join(',')})` : '1=1'; const p = ids || [];
  if (ids && !ids.length) return { empty: true, kpis: {}, byService: [], refundStatus: [], trend: [], rows: [], total: 0, page: 1, size: 8 };
  const all = db.all(`SELECT b.*, r.status rstatus, r.expected_refund, r.actual_refund, u.name employee, u.emp_id, u.department FROM bookings b JOIN users u ON u.id=b.traveller_id LEFT JOIN refunds r ON r.booking_id=b.id WHERE ${where}`, ...p);
  const from = isDate(q.from) ? q.from : addDays(today(), -120); const to = isDate(q.to) ? q.to : addDays(today(), 120);
  const inRange = all.filter((b) => (b.travel_date || '') >= from && (b.travel_date || '') <= to);
  const kpis = { total: inRange.length, confirmed: inRange.filter((b) => ['Confirmed', 'Completed'].includes(b.status)).length, pending: inRange.filter((b) => ['Created', 'Ticketing Pending'].includes(b.status)).length, cancelled: inRange.filter((b) => b.status === 'Cancelled').length,
    refundPending: { count: inRange.filter((b) => b.rstatus && !['Credited', 'Rejected', 'Not Applicable'].includes(b.rstatus)).length, amount: round2(inRange.filter((b) => b.rstatus && !['Credited', 'Rejected', 'Not Applicable'].includes(b.rstatus)).reduce((s, b) => s + b.expected_refund - b.actual_refund, 0)) },
    refundCredited: { count: inRange.filter((b) => b.rstatus === 'Credited').length, amount: round2(inRange.reduce((s, b) => s + (b.actual_refund || 0), 0)) } };
  const byService = ['flight', 'hotel', 'bus', 'train', 'cab', 'other'].map((t) => ({ label: t[0].toUpperCase() + t.slice(1) + 's', value: inRange.filter((b) => b.type === t).length })).filter((x) => x.value);
  const canc = inRange.filter((b) => b.status === 'Cancelled');
  const refundStatus = ['Credited', 'Processing', 'Requested', 'Supplier Confirmed', 'Partially Credited', 'Rejected', 'Not Applicable'].map((s) => ({ label: s, value: canc.filter((b) => b.rstatus === s).length })).filter((x) => x.value);
  const trend = []; for (let i = 2; i >= 0; i--) { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - i); const m = d.toISOString().slice(0, 7); const rows = all.filter((b) => b.rstatus && String(b.cancelled_at || '').startsWith(m)); trend.push({ label: m, credited: round2(rows.reduce((s, b) => s + (b.actual_refund || 0), 0)), pending: round2(rows.reduce((s, b) => s + Math.max(0, b.expected_refund - b.actual_refund), 0)) }); }
  let list = inRange;
  const tab = q.tab || 'All'; if (tab === 'Cancelled') list = list.filter((b) => b.status === 'Cancelled'); else if (tab === 'Confirmed') list = list.filter((b) => b.status === 'Confirmed'); else if (tab === 'Pending') list = list.filter((b) => ['Created', 'Ticketing Pending'].includes(b.status));
  else if (tab === 'Refund Pending') list = list.filter((b) => b.rstatus && !['Credited', 'Rejected', 'Not Applicable'].includes(b.rstatus)); else if (tab === 'Refund Credited') list = list.filter((b) => b.rstatus === 'Credited'); else if (tab === 'Refund Rejected') list = list.filter((b) => b.rstatus === 'Rejected');
  if (q.department && q.department !== 'All') list = list.filter((b) => b.department === q.department);
  if (q.service && q.service !== 'All') list = list.filter((b) => b.type === q.service);
  if (q.q) list = list.filter((b) => `${b.booking_no} ${b.employee} ${b.route} ${b.supplier_ref}`.toLowerCase().includes(String(q.q).toLowerCase()));
  const tabs = { All: inRange.length, Confirmed: kpis.confirmed, Pending: kpis.pending, Cancelled: kpis.cancelled, 'Refund Pending': kpis.refundPending.count, 'Refund Credited': kpis.refundCredited.count, 'Refund Rejected': inRange.filter((b) => b.rstatus === 'Rejected').length };
  const { size, page, offset } = pg(q, 8);
  return { kpis, byService, refundStatus, trend, tabs, tab, rows: list.sort((a, b) => b.id - a.id).slice(offset, offset + size).map((b) => ({ ...b, details: json(b.details, {}) })), total: list.length, page, size, departments: [...new Set(all.map((b) => b.department))].filter(Boolean), refundKpis: refundKpis(db, db.all('SELECT * FROM refunds')) };
}

// ================= reports =================
export const REPORTS = {
  actual_vs_budget: 'Actual vs approved budget', department_spend: 'Spend by department', supplier_spend: 'Spend by supplier', policy_exceptions: 'Policy exceptions',
  cancellation_losses: 'Cancellation penalties and losses', overdue_refunds: 'Overdue refunds', refund_recovery: 'Refund recovery', unclaimed_bookings: 'Bookings not yet claimed',
};
export function report(db, user, type) {
  if (!REPORTS[type]) throw notFound('Unknown report');
  if (user.role === 'employee') throw forbidden('Reports are available to managers, finance, travel desk and administrators');
  const sc = tripScopeSql(db, user, user.role === 'manager' ? 'team' : 'all');
  const money = (x) => round2(x);
  let columns; let rows;
  if (type === 'actual_vs_budget') {
    columns = ['Trip', 'Traveller', 'Destination', 'Status', 'Approved budget', 'Booked', 'Expenses claimed', 'Variance'];
    rows = db.all(`SELECT t.id, t.trip_no, u.name tn, t.dest_city, t.status, t.est_budget, (SELECT COALESCE(SUM(amount),0) FROM bookings b WHERE b.trip_id=t.id AND b.status!='Cancelled') booked, (SELECT COALESCE(SUM((i.amount+i.tax)*i.fx_rate),0) FROM expense_items i JOIN expense_reports e ON e.id=i.report_id WHERE e.trip_id=t.id) exp FROM trips t JOIN users u ON u.id=t.traveller_id WHERE ${sc.where} AND t.status NOT IN ('Draft','Cancelled','Rejected') ORDER BY t.id DESC LIMIT 200`, ...sc.params)
      .map((r) => [r.trip_no, r.tn, r.dest_city, r.status, money(r.est_budget), money(r.booked), money(r.exp), money(r.est_budget - Math.max(r.booked, r.exp))]);
  } else if (type === 'department_spend') {
    columns = ['Department', 'Trips', 'Booked amount', 'Expenses claimed'];
    rows = db.all(`SELECT u.department d, COUNT(DISTINCT t.id) n, COALESCE(SUM(b.amount),0) booked FROM trips t JOIN users u ON u.id=t.traveller_id LEFT JOIN bookings b ON b.trip_id=t.id AND b.status!='Cancelled' WHERE ${sc.where} GROUP BY u.department ORDER BY booked DESC`, ...sc.params)
      .map((r) => [r.d, r.n, money(r.booked), money(db.get("SELECT COALESCE(SUM((i.amount+i.tax)*i.fx_rate),0) s FROM expense_items i JOIN expense_reports e ON e.id=i.report_id JOIN users u ON u.id=e.user_id WHERE u.department=?", r.d).s)]);
  } else if (type === 'supplier_spend') {
    columns = ['Supplier', 'Type', 'Bookings', 'Amount']; rows = db.all("SELECT supplier, type, COUNT(*) n, SUM(amount) a FROM bookings WHERE status!='Cancelled' GROUP BY supplier, type ORDER BY a DESC").map((r) => [r.supplier, r.type, r.n, money(r.a)]);
  } else if (type === 'policy_exceptions') {
    columns = ['Booking', 'Traveller', 'Supplier', 'Amount', 'Policy status', 'Issue', 'Justification']; rows = db.all("SELECT b.booking_no, u.name, b.supplier, b.amount, b.policy_status, b.policy_note, b.justification FROM bookings b JOIN users u ON u.id=b.traveller_id WHERE b.policy_status IS NOT NULL AND b.policy_status!='Compliant' ORDER BY b.id DESC").map((r) => [r.booking_no, r.name, r.supplier, money(r.amount), r.policy_status, r.policy_note || '', r.justification || '']);
  } else if (type === 'cancellation_losses') {
    columns = ['Booking', 'Supplier', 'Original amount', 'Penalty', 'Agency fee', 'Expected refund']; rows = db.all('SELECT b.booking_no, b.supplier, r.original_amount, r.penalty, r.agency_fee, r.expected_refund FROM refunds r JOIN bookings b ON b.id=r.booking_id ORDER BY r.penalty DESC').map((r) => [r.booking_no, r.supplier, money(r.original_amount), money(r.penalty), money(r.agency_fee), money(r.expected_refund)]);
  } else if (type === 'overdue_refunds') {
    columns = ['Booking', 'Supplier', 'Expected refund', 'Credited', 'Expected by', 'Days overdue', 'Status']; rows = db.all("SELECT b.booking_no, b.supplier, r.expected_refund, r.actual_refund, r.expected_credit_date, r.status FROM refunds r JOIN bookings b ON b.id=r.booking_id WHERE r.status NOT IN ('Credited','Rejected','Not Applicable') AND r.expected_credit_date<?", today()).map((r) => [r.booking_no, r.supplier, money(r.expected_refund), money(r.actual_refund), r.expected_credit_date, daysBetween(r.expected_credit_date, today()), r.status]);
  } else if (type === 'refund_recovery') {
    const k = refundKpis(db, db.all('SELECT * FROM refunds')); columns = ['Metric', 'Value'];
    rows = [['Cancelled bookings', k.cancelled], ['Expected refundable amount (excludes penalties)', money(k.expected)], ['Actual refund credited', money(k.actual)], ['Recovery rate %', k.recoveryRate], ['Penalties retained by suppliers', money(k.penalties)], ['Unresolved refunds', k.unresolvedCount], ['Unresolved amount', money(k.unresolvedAmount)], ['Rejected refund cases', k.rejected]];
  } else {
    columns = ['Booking', 'Traveller', 'Type', 'Travel date', 'Amount']; rows = db.all("SELECT b.booking_no, u.name, b.type, b.travel_date, b.amount FROM bookings b JOIN users u ON u.id=b.traveller_id WHERE b.claim_status='Not Claimed' AND b.status IN ('Confirmed','Completed') AND b.travel_date<? ORDER BY b.travel_date", today()).map((r) => [r.booking_no, r.name, r.type, r.travel_date, money(r.amount)]);
  }
  return { type, title: REPORTS[type], columns, rows };
}
export function reportCsv(r) {
  const esc = (v) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [r.columns, ...r.rows].map((row) => row.map(esc).join(',')).join('\n');
}

// ================= admin: audit, master data, users, integrations =================
const adminOnly = (user) => { if (user.role !== 'admin') throw forbidden('Administrator access required'); };
export function auditLog(db, user, q = {}) {
  adminOnly(user);
  const w = []; const p = [];
  if (q.entity && q.entity !== 'All') { w.push('entity_type=?'); p.push(q.entity); }
  if (q.q) { w.push('(action LIKE ? OR actor_name LIKE ? OR detail LIKE ?)'); const s = `%${q.q}%`; p.push(s, s, s); }
  const wh = w.length ? `WHERE ${w.join(' AND ')}` : ''; const { size, page, offset } = pg(q, 15);
  return { rows: db.all(`SELECT * FROM audit_log ${wh} ORDER BY id DESC LIMIT ? OFFSET ?`, ...p, size, offset), total: db.get(`SELECT COUNT(*) c FROM audit_log ${wh}`, ...p).c, page, size, entities: db.all('SELECT DISTINCT entity_type e FROM audit_log WHERE entity_type IS NOT NULL ORDER BY 1').map((r) => r.e) };
}
export function masterList(db, user, kind) {
  if (!['admin', 'finance', 'manager', 'travel_desk', 'employee'].includes(user.role)) throw forbidden();
  const kinds = kind ? [kind] : ['company', 'department', 'cost_center', 'project', 'sales_order', 'internal_order', 'city'];
  return db.all(`SELECT m.*, u.name owner_name FROM master_data m LEFT JOIN users u ON u.id=m.owner_id WHERE m.kind IN (${kinds.map(() => '?').join(',')}) ORDER BY m.kind, m.code`, ...kinds).map((r) => ({ ...r, meta: json(r.meta, {}) }));
}
export function masterSave(db, user, input, id) {
  adminOnly(user);
  const kinds = ['department', 'cost_center', 'project', 'sales_order', 'internal_order', 'city'];
  if (!kinds.includes(input.kind)) throw bad('Invalid master data type');
  if (!String(input.code || '').trim() || !String(input.name || '').trim()) throw bad('Code and name are required');
  if (id) { db.run('UPDATE master_data SET name=?, owner_id=?, meta=?, active=? WHERE id=?', input.name, input.owner_id || null, input.meta || {}, input.active === false ? 0 : 1, id); audit(db, user, 'master.update', 'master', id, input.code); return db.get('SELECT * FROM master_data WHERE id=?', id); }
  if (db.get('SELECT 1 x FROM master_data WHERE kind=? AND code=?', input.kind, input.code)) throw conflict('This code already exists');
  const nid = insert(db, 'master_data', { kind: input.kind, code: input.code.trim(), name: input.name.trim(), owner_id: input.owner_id || null, meta: input.meta || {} });
  audit(db, user, 'master.create', 'master', nid, input.code); return db.get('SELECT * FROM master_data WHERE id=?', nid);
}
export function usersList(db, user) {
  adminOnly(user);
  return db.all('SELECT u.id,u.emp_id,u.name,u.email,u.role,u.department,u.designation,u.grade,u.active,m.name manager_name FROM users u LEFT JOIN users m ON m.id=u.manager_id ORDER BY u.emp_id').map((u) => ({ ...u, role_label: ROLE_LABEL[u.role] }));
}
export function userUpdate(db, user, id, input) {
  adminOnly(user);
  const u = db.get('SELECT * FROM users WHERE id=?', id); if (!u) throw notFound('User not found');
  if (input.role !== undefined) {
    if (!ROLE_LABEL[input.role]) throw bad('Invalid role');
    if (u.id === user.id) throw conflict('You cannot change your own role');
    if (u.role === 'admin' && input.role !== 'admin' && db.get("SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1").c <= 1) throw conflict('At least one administrator must remain');
  }
  if (input.active === false && u.id === user.id) throw conflict('You cannot deactivate your own account');
  if (input.manager_id !== undefined && input.manager_id) { if (Number(input.manager_id) === id) throw bad('A user cannot report to themselves'); if (teamIds(db, id).includes(Number(input.manager_id))) throw bad('This would create a circular reporting line'); }
  const f = {}; for (const k of ['role', 'department', 'designation', 'grade', 'manager_id']) if (input[k] !== undefined) f[k] = input[k]; if (input.active !== undefined) f.active = input.active ? 1 : 0;
  const keys = Object.keys(f); if (!keys.length) throw bad('Nothing to update');
  db.run(`UPDATE users SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => f[k]), id);
  audit(db, user, 'user.update', 'user', id, JSON.stringify(f)); return { ok: true };
}
export function integrations(db, user) {
  adminOnly(user);
  const erp = db.get("SELECT COUNT(*) c, SUM(CASE WHEN erp_status='Error' THEN 1 ELSE 0 END) err, MAX(erp_posted_at) last FROM invoices");
  return [
    { name: 'ERP / Finance posting (SAP S/4HANA)', status: erp.err ? 'Attention' : 'Healthy', detail: `${erp.c} invoices tracked, ${erp.err || 0} posting error(s)`, last: erp.last || '-' },
    { name: 'Supplier inventory (flights, hotels, cabs)', status: 'Demo provider', detail: 'Deterministic mock inventory - connect real supplier APIs in lib/providers', last: '-' },
    { name: 'Identity / SSO (company account)', status: 'Not configured', detail: 'Password sign-in with MFA is active', last: '-' },
    { name: 'SMS / Email / WhatsApp / Teams gateway', status: 'Demo OTP mode', detail: 'Notifications are stored in-app; external channels need a gateway', last: '-' },
    { name: 'Receipt OCR / AI extraction', status: 'Offline extractor', detail: 'Filename and text based extraction; replace lib/ocr.js with a document-AI service', last: '-' },
  ];
}
export { docStatus, validity };
