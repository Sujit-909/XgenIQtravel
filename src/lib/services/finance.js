import { json } from '../db';
import { bad, conflict, forbidden, notFound, nowIso, today, addDays, daysBetween, isDate, page as pg, seq, pad, audit, notify, comment, getSetting, num, round2 } from '../util';
import { parseItem } from './expenses';
import { calcReport } from '../calc';

const FINANCE = ['finance', 'admin'];
const needFinance = (user) => { if (!FINANCE.includes(user.role)) throw forbidden('Finance access required'); };

// ================= Reimbursements =================
export function listReimbursements(db, user, q = {}) {
  needFinance(user);
  const w = []; const p = [];
  if (q.department && q.department !== 'All') { w.push('u.department=?'); p.push(q.department); }
  if (q.status && q.status !== 'All') { w.push('r.status=?'); p.push(q.status); }
  if (q.payment_status && q.payment_status !== 'All') { w.push('rb.status=?'); p.push(q.payment_status); }
  if (q.q) { w.push('(r.report_no LIKE ? OR u.name LIKE ? OR t.trip_no LIKE ?)'); const s = `%${q.q}%`; p.push(s, s, s); }
  const from = `FROM expense_reports r JOIN users u ON u.id=r.user_id LEFT JOIN trips t ON t.id=r.trip_id LEFT JOIN reimbursements rb ON rb.report_id=r.id WHERE r.status IN ('Submitted','Manager Approved','Finance Approved','Posted') ${w.length ? `AND ${w.join(' AND ')}` : ''}`;
  const { size, page, offset } = pg(q, 5);
  const total = db.get(`SELECT COUNT(*) c ${from}`, ...p).c;
  const rows = db.all(`SELECT r.id, r.report_no, r.status, r.submitted_at, t.trip_no, u.name employee, u.department, rb.status payment_status, rb.approved_amount, rb.payable_amount, rb.deductions, rb.paid_at, rb.attempted_at, rb.payment_ref,
    (SELECT COALESCE(SUM((i.amount+i.tax)*i.fx_rate),0) FROM expense_items i WHERE i.report_id=r.id) total_amount ${from} ORDER BY r.id DESC LIMIT ? OFFSET ?`, ...p, size, offset);
  const all = db.all("SELECT r.status, rb.status ps, rb.payable_amount pa, rb.attempted_at, rb.paid_at, (SELECT COALESCE(SUM((i.amount+i.tax)*i.fx_rate),0) FROM expense_items i WHERE i.report_id=r.id) ta FROM expense_reports r LEFT JOIN reimbursements rb ON rb.report_id=r.id WHERE r.status IN ('Submitted','Manager Approved','Finance Approved','Posted')");
  const sum = (f) => round2(all.filter(f).reduce((s, x) => s + (x.pa || x.ta || 0), 0));
  const kpis = {
    total: { count: all.length, amount: round2(all.reduce((s, x) => s + x.ta, 0)) }, paid: { count: all.filter((x) => x.ps === 'Paid').length, amount: sum((x) => x.ps === 'Paid') },
    initiated: { count: all.filter((x) => x.ps === 'Payment Initiated').length, amount: sum((x) => x.ps === 'Payment Initiated') },
    failed: { count: all.filter((x) => ['Failed', 'Returned'].includes(x.ps)).length, amount: sum((x) => ['Failed', 'Returned'].includes(x.ps)) },
    pendingFinance: { count: all.filter((x) => ['Manager Approved', 'Submitted'].includes(x.status) || x.ps === 'Payable').length, amount: sum((x) => ['Manager Approved', 'Submitted'].includes(x.status) || x.ps === 'Payable') },
    overdue: { count: all.filter((x) => x.ps === 'Payment Initiated' && x.attempted_at && daysBetween(x.attempted_at.slice(0, 10), today()) > 15).length, amount: sum((x) => x.ps === 'Payment Initiated' && x.attempted_at && daysBetween(x.attempted_at.slice(0, 10), today()) > 15) },
  };
  return { rows, total, page, size, kpis, departments: db.all('SELECT DISTINCT department d FROM users ORDER BY 1').map((r) => r.d).filter(Boolean) };
}

export function reimbursementDetail(db, user, reportId) {
  needFinance(user);
  const r = db.get('SELECT r.*, u.name employee, u.department, u.emp_id, t.trip_no, t.title trip_title, t.dest_city FROM expense_reports r JOIN users u ON u.id=r.user_id LEFT JOIN trips t ON t.id=r.trip_id WHERE r.id=?', reportId);
  if (!r) throw notFound('Report not found');
  const rb = db.get('SELECT * FROM reimbursements WHERE report_id=?', reportId);
  const items = db.all('SELECT * FROM expense_items WHERE report_id=?', reportId).map(parseItem);
  const alloc = db.all('SELECT * FROM report_cost_objects WHERE report_id=?', reportId);
  const bank = db.get('SELECT bank,last4,ifsc,verified FROM bank_accounts WHERE user_id=? AND is_default=1 AND active=1', r.user_id);
  const stages = ['Draft', 'Submitted', 'Manager Approved', 'Finance Approved', 'Payment Initiated', rb?.status === 'Failed' ? 'Failed' : 'Paid'];
  const reached = { Draft: true, Submitted: !!r.submitted_at, 'Manager Approved': ['Manager Approved', 'Finance Approved', 'Posted'].includes(r.status), 'Finance Approved': ['Finance Approved', 'Posted'].includes(r.status),
    'Payment Initiated': ['Payment Initiated', 'Paid', 'Failed', 'Returned'].includes(rb?.status), Paid: rb?.status === 'Paid', Failed: rb?.status === 'Failed' };
  return { report: r, reimbursement: rb && { ...rb, history: json(rb.history, []) }, items, calc: calcReport(items, r.advance), alloc, bank, timeline: stages.map((s) => ({ stage: s, done: !!reached[s], failed: s === 'Failed' })) };
}

const pushHistory = (rb, event, by, extra) => [...json(rb.history, []), { ts: nowIso(), event, by, ...extra }];
export function reimbursementAction(db, user, reportId, input) {
  needFinance(user);
  return db.tx(() => {
    const rb = db.get('SELECT * FROM reimbursements WHERE report_id=?', reportId);
    if (!rb) throw notFound('No reimbursement exists for this report yet - it must be finance-approved first');
    const rep = db.get('SELECT * FROM expense_reports WHERE id=?', reportId);
    const act = input.action; const set = (status, extra = {}, evt = status) => {
      const f = { status, updated_at: nowIso(), history: JSON.stringify(pushHistory(rb, evt, user.name, extra.note ? { note: extra.note } : {})), ...extra }; delete f.note;
      const keys = Object.keys(f); db.run(`UPDATE reimbursements SET ${keys.map((k) => `${k}=?`).join(',')} WHERE report_id=?`, ...keys.map((k) => f[k]), reportId);
    };
    const fail = (m) => conflict(`Cannot ${act} while payment status is "${rb.status}". ${m || ''}`.trim());
    if (act === 'initiate') {
      if (!['Payable', 'Failed', 'Returned', 'On Hold'].includes(rb.status)) throw fail();
      const bank = db.get('SELECT * FROM bank_accounts WHERE user_id=? AND is_default=1 AND active=1', rep.user_id);
      if (!bank) throw bad('The employee has no active default reimbursement account');
      if (!bank.verified) throw bad('The employee\'s reimbursement account is not verified');
      if (!(rb.payable_amount > 0)) throw bad('Nothing is payable for this report');
      set('Payment Initiated', { payment_ref: `PAY-${650000 + seq(db, 'payment')}`, channel: `NEFT - ${bank.bank}`, attempted_at: nowIso(), failure_reason: null }, 'Payment initiated');
      notify(db, rep.user_id, { category: 'other', title: 'Reimbursement initiated', body: `${rep.report_no} - ₹${rb.payable_amount.toLocaleString('en-IN')}`, link: '/expenses', refKey: `pay-init:${reportId}:${Date.now()}` });
    } else if (act === 'mark_paid') {
      if (rb.status !== 'Payment Initiated') throw fail('Payment must be initiated first.');
      set('Paid', { paid_at: nowIso() }, 'Paid');
      db.run("UPDATE expense_reports SET status='Posted', updated_at=? WHERE id=? AND status='Finance Approved'", nowIso(), reportId);
      notify(db, rep.user_id, { category: 'other', title: 'Reimbursement paid', body: `${rep.report_no} - ₹${rb.payable_amount.toLocaleString('en-IN')} credited`, link: '/expenses', refKey: `pay-ok:${reportId}` });
    } else if (act === 'mark_failed') {
      if (rb.status !== 'Payment Initiated') throw fail();
      if (!String(input.reason || '').trim()) throw bad('A failure reason is required');
      set('Failed', { failure_reason: input.reason, note: input.reason }, 'Payment failed');
      notify(db, rep.user_id, { category: 'other', severity: 'danger', title: 'Reimbursement failed', body: `${rep.report_no}: ${input.reason}. Please correct your bank details.`, link: '/reimbursement-accounts', refKey: `pay-fail:${reportId}:${Date.now()}` });
    } else if (act === 'return') {
      if (!['Payment Initiated', 'Paid'].includes(rb.status)) throw fail(); set('Returned', { failure_reason: input.reason || 'Returned by bank' }, 'Payment returned');
    } else if (act === 'hold') {
      if (!['Payable'].includes(rb.status)) throw fail(); set('On Hold', { note: input.reason }, 'Put on hold');
    } else if (act === 'release') {
      if (rb.status !== 'On Hold') throw fail(); set('Payable', {}, 'Released from hold');
    } else if (act === 'resubmit') {
      if (!['Failed', 'Returned'].includes(rb.status)) throw fail();
      set('Payable', { failure_reason: null }, 'Resubmitted for payment');
    } else throw bad('Unknown action');
    audit(db, user, `reimbursement.${act}`, 'expense', reportId, rep.report_no);
    return db.get('SELECT * FROM reimbursements WHERE report_id=?', reportId);
  });
}
export function createPaymentBatch(db, user, reportIds) {
  needFinance(user);
  const done = []; const skipped = [];
  for (const id of reportIds) { try { reimbursementAction(db, user, id, { action: 'initiate' }); done.push(id); } catch (e) { skipped.push({ id, reason: e.message }); } }
  return { initiated: done, skipped };
}

// ================= Refund & cancellation centre =================
export const REFUND_FINAL = ['Credited', 'Rejected', 'Not Applicable'];
export function refundDisplay(r) {
  if (!REFUND_FINAL.includes(r.status) && r.status !== 'Partially Credited' && r.expected_credit_date && r.expected_credit_date < today()) return 'Overdue';
  return r.status;
}
const daysOverdue = (r) => (!REFUND_FINAL.includes(r.status) && r.expected_credit_date && r.expected_credit_date < today() ? daysBetween(r.expected_credit_date, today()) : 0);

// Refund recovery rate (per the specification): actual credited / expected refundable x 100.
// Amounts legitimately retained as penalties are excluded (expected_refund is already net of penalties),
// non-refundable cases are excluded, and unresolved refunds are reported separately.
export function refundKpis(db, rows) {
  const refundable = rows.filter((r) => !['Not Applicable', 'Rejected'].includes(r.status) && r.expected_refund > 0);
  const expected = round2(refundable.reduce((s, r) => s + r.expected_refund, 0));
  const actual = round2(refundable.reduce((s, r) => s + r.actual_refund, 0));
  const unresolved = rows.filter((r) => !REFUND_FINAL.includes(r.status));
  return {
    cancelled: rows.length, expected, actual, recoveryRate: expected > 0 ? round2((actual / expected) * 100) : 0,
    penalties: round2(rows.reduce((s, r) => s + r.penalty, 0)), unresolvedCount: unresolved.length, unresolvedAmount: round2(unresolved.reduce((s, r) => s + Math.max(0, r.expected_refund - r.actual_refund), 0)),
    overdue: rows.filter((r) => daysOverdue(r) > getSetting(db, 'refund_overdue_days', 15)).length, rejected: rows.filter((r) => r.status === 'Rejected').length,
  };
}

export function listRefunds(db, user, q = {}) {
  const privileged = ['finance', 'admin', 'travel_desk'].includes(user.role);
  const w = []; const p = [];
  if (!privileged) {
    if (user.role === 'manager') { const ids = db.all('WITH RECURSIVE t(id) AS (SELECT ? UNION SELECT u.id FROM users u JOIN t ON u.manager_id=t.id) SELECT id FROM t', user.id).map((x) => x.id); w.push(`b.traveller_id IN (${ids.map(() => '?').join(',')})`); p.push(...ids); }
    else { w.push('b.traveller_id=?'); p.push(user.id); }
  }
  if (q.type && q.type !== 'All') { w.push('b.type=?'); p.push(q.type); }
  if (q.status && q.status !== 'All') { w.push('r.status=?'); p.push(q.status); }
  if (q.q) { w.push('(b.booking_no LIKE ? OR b.supplier_ref LIKE ? OR u.name LIKE ? OR b.route LIKE ?)'); const s = `%${q.q}%`; p.push(s, s, s, s); }
  const from = `FROM refunds r JOIN bookings b ON b.id=r.booking_id JOIN users u ON u.id=b.traveller_id ${w.length ? `WHERE ${w.join(' AND ')}` : ''}`;
  const { size, page, offset } = pg(q, 8);
  const total = db.get(`SELECT COUNT(*) c ${from}`, ...p).c;
  const rows = db.all(`SELECT r.*, b.booking_no, b.supplier_ref, b.type, b.route, b.detail, b.travel_date, b.supplier, u.name employee, u.emp_id, u.department, (SELECT name FROM users WHERE id=r.owner_id) owner_name ${from} ORDER BY r.id DESC LIMIT ? OFFSET ?`, ...p, size, offset)
    .map((r) => ({ ...r, display_status: refundDisplay(r), days_overdue: daysOverdue(r) }));
  const all = db.all(`SELECT r.* ${from}`, ...p);
  return { rows, total, page, size, kpis: refundKpis(db, all), privileged };
}

export function refundDetail(db, user, bookingId) {
  const r = db.get('SELECT r.*, b.booking_no, b.supplier_ref, b.type, b.route, b.detail, b.supplier, b.traveller_id, u.name employee, u.emp_id, b.cancel_reason, b.cancelled_at, b.travel_date, (SELECT name FROM users WHERE id=r.owner_id) owner_name FROM refunds r JOIN bookings b ON b.id=r.booking_id JOIN users u ON u.id=b.traveller_id WHERE r.booking_id=?', bookingId);
  if (!r) throw notFound('Refund case not found');
  if (!['finance', 'admin', 'travel_desk'].includes(user.role) && r.traveller_id !== user.id && user.role !== 'manager') throw forbidden();
  const timelineStates = ['Not Requested', 'Submitted', 'Supplier Confirmed', 'Processing', 'Partially Credited', 'Credited'];
  const order = { Expected: 0, Requested: 1, 'Supplier Confirmed': 2, Processing: 3, 'Partially Credited': 4, Credited: 5, Rejected: 1, 'Not Applicable': 0 };
  const idx = order[r.status] ?? 0;
  return { refund: { ...r, display_status: refundDisplay(r), days_overdue: daysOverdue(r) }, comments: db.all("SELECT * FROM comments WHERE entity_type='refund' AND entity_id=? ORDER BY id DESC", bookingId),
    timeline: timelineStates.map((s, i) => ({ label: s, done: i <= idx, current: i === idx })), attachments: db.all("SELECT id,name FROM files WHERE entity_type='refund' AND entity_id=?", bookingId) };
}

const NEXT = { Expected: ['Requested'], Requested: ['Supplier Confirmed', 'Rejected'], 'Supplier Confirmed': ['Processing', 'Credited', 'Partially Credited'], Processing: ['Partially Credited', 'Credited', 'Rejected'], 'Partially Credited': ['Credited'] };
export function refundAction(db, user, bookingId, input) {
  if (!['finance', 'admin', 'travel_desk'].includes(user.role)) throw forbidden();
  return db.tx(() => {
    const r = db.get('SELECT * FROM refunds WHERE booking_id=?', bookingId);
    if (!r) throw notFound('Refund case not found');
    const act = input.action;
    if (act === 'assign') { db.run('UPDATE refunds SET owner_id=?, updated_at=? WHERE booking_id=?', input.owner_id, nowIso(), bookingId); }
    else if (act === 'escalate') { db.run('UPDATE refunds SET escalated=1, updated_at=? WHERE booking_id=?', nowIso(), bookingId); const adm = db.get("SELECT id FROM users WHERE role='admin' LIMIT 1"); notify(db, adm?.id, { category: 'other', severity: 'warn', title: 'Refund escalated', body: `Booking ${bookingId} refund is overdue`, link: '/refunds', refKey: `refund-esc:${bookingId}:${Date.now()}` }); }
    else if (act === 'note') { if (!String(input.note || '').trim()) throw bad('Remark is required'); comment(db, 'refund', bookingId, user, input.note, user.role === 'travel_desk' ? 'Travel Desk' : 'Finance'); }
    else if (act === 'supplier_update') { if (!String(input.note || '').trim()) throw bad('Message is required'); comment(db, 'refund', bookingId, user, input.note, input.org || 'Supplier'); }
    else if (act === 'status') {
      const to = input.status;
      if (REFUND_FINAL.includes(r.status)) throw conflict(`Refund is already ${r.status}`);
      if (!(NEXT[r.status] || []).includes(to)) throw conflict(`Cannot move a refund from "${r.status}" to "${to}"`);
      let actual = r.actual_refund; let credit = r.credit_date; let txn = r.txn_id;
      if (['Credited', 'Partially Credited'].includes(to)) {
        const amt = num(input.amount, NaN);
        if (!(amt > 0)) throw bad('Credited amount is required as evidence of actual credit');
        if (!String(input.txn_id || '').trim()) throw bad('Refund transaction ID is required');
        if (amt > r.expected_refund + 0.01) throw bad('Credited amount exceeds the expected refund');
        if (to === 'Credited' && Math.abs(amt - r.expected_refund) > 0.01) throw bad('Use "Partially Credited" when the credited amount is less than the expected refund');
        if (to === 'Partially Credited' && amt >= r.expected_refund) throw bad('Credited amount equals the expected refund - mark it as Credited');
        actual = amt; credit = input.credit_date || today(); txn = input.txn_id;
      }
      db.run('UPDATE refunds SET status=?, actual_refund=?, credit_date=?, txn_id=?, bank_ref=COALESCE(?,bank_ref), payment_ref=COALESCE(?,payment_ref), channel=COALESCE(?,channel), updated_at=? WHERE booking_id=?', to, actual, credit, txn, input.bank_ref || null, input.payment_ref || null, input.channel || null, nowIso(), bookingId);
      if (to === 'Rejected') db.run('UPDATE refunds SET expected_refund=0 WHERE booking_id=?', bookingId);
      const b = db.get('SELECT traveller_id, booking_no FROM bookings WHERE id=?', bookingId);
      notify(db, b.traveller_id, { category: 'other', title: `Refund ${to.toLowerCase()}`, body: `${b.booking_no}${actual ? ` - ₹${actual.toLocaleString('en-IN')}` : ''}`, link: '/refunds', refKey: `refund-${to}:${bookingId}` });
    } else throw bad('Unknown action');
    audit(db, user, `refund.${act}`, 'booking', bookingId, JSON.stringify({ status: input.status, amount: input.amount }));
    return refundDetail(db, user, bookingId).refund;
  });
}

// ================= Supplier & finance reconciliation =================
export function matchStatus(row) {
  if (row.refund_status === 'Overdue' || (row.refund_status && !REFUND_FINAL.includes(row.refund_status) && row.refund_status !== 'Not Applicable' && row.expected_credit_date && row.expected_credit_date < today() && row.refund_status !== 'Partially Credited')) return 'Overdue Refund';
  if (row.duplicate) return 'Duplicate Charge';
  if (row.invoice_no == null) return 'Missing Invoice';
  if (row.refund_status === 'Partially Credited') return 'Partially Matched';
  if (Math.abs(row.invoiced_amount - row.amount) > 0.5) return 'Amount Mismatch';
  return 'Matched';
}
export function reconciliation(db, user, q = {}) {
  needFinance(user);
  const rows = db.all(`SELECT b.id booking_id, b.booking_no, b.supplier_ref ref, b.type, b.supplier, b.amount, b.status booking_status, t.trip_no, u.name employee,
      i.id invoice_id, i.invoice_no, i.invoiced_amount, i.tax_amount, i.paid_amount, i.payment_method, i.payment_ref, i.payment_date, i.erp_status, i.erp_doc_no, i.erp_error, i.erp_system, i.resolved, i.invoice_date,
      rf.status refund_status, rf.expected_refund, rf.actual_refund, rf.expected_credit_date,
      (SELECT COUNT(*) FROM invoices x WHERE x.booking_id=b.id) inv_count
    FROM bookings b JOIN users u ON u.id=b.traveller_id LEFT JOIN trips t ON t.id=b.trip_id
    LEFT JOIN invoices i ON i.id=(SELECT MIN(id) FROM invoices WHERE booking_id=b.id) LEFT JOIN refunds rf ON rf.booking_id=b.id
    WHERE b.status NOT IN ('Created','Held') AND b.amount>0 ORDER BY b.id DESC`)
    .map((r) => ({ ...r, duplicate: r.inv_count > 1 }))
    .map((r) => ({ ...r, match: r.resolved ? 'Matched' : matchStatus(r), netCost: round2(r.amount - (r.actual_refund || 0)) }));
  let filtered = rows;
  if (q.supplier && q.supplier !== 'All') filtered = filtered.filter((r) => r.supplier === q.supplier);
  if (q.match && q.match !== 'All') filtered = filtered.filter((r) => r.match === q.match);
  if (q.erp && q.erp !== 'All') filtered = filtered.filter((r) => r.erp_status === q.erp);
  if (q.type && q.type !== 'All') filtered = filtered.filter((r) => r.type === q.type);
  if (q.q) { const s = String(q.q).toLowerCase(); filtered = filtered.filter((r) => [r.trip_no, r.booking_no, r.ref, r.invoice_no, r.supplier].some((x) => String(x || '').toLowerCase().includes(s))); }
  const tab = q.tab || 'overview';
  if (tab === 'exceptions') filtered = filtered.filter((r) => r.match !== 'Matched' || r.erp_status === 'Error');
  if (tab === 'invoices') filtered = filtered.filter((r) => r.invoice_no);
  if (tab === 'refunds') filtered = filtered.filter((r) => r.refund_status);
  if (tab === 'erp') filtered = filtered.filter((r) => r.erp_status);
  const { size, page, offset } = pg(q, 7);
  const sum = (arr, f) => round2(arr.reduce((s, r) => s + f(r), 0));
  const kpis = {
    bookings: { count: rows.length, amount: sum(rows, (r) => r.amount) }, invoiced: { count: rows.filter((r) => r.invoice_no).length, amount: sum(rows, (r) => r.invoiced_amount || 0) },
    paid: { count: rows.filter((r) => r.paid_amount > 0).length, amount: sum(rows, (r) => r.paid_amount || 0) }, refunded: { count: rows.filter((r) => r.actual_refund > 0).length, amount: sum(rows, (r) => r.actual_refund || 0) },
    exceptions: { count: rows.filter((r) => r.match !== 'Matched').length, amount: sum(rows.filter((r) => r.match !== 'Matched'), (r) => r.amount) },
    overdue: { count: rows.filter((r) => r.match === 'Overdue Refund').length, amount: sum(rows.filter((r) => r.match === 'Overdue Refund'), (r) => r.expected_refund - r.actual_refund) },
  };
  return { rows: filtered.slice(offset, offset + size), total: filtered.length, page, size, kpis, suppliers: [...new Set(rows.map((r) => r.supplier))].sort(), tab };
}
export function reconciliationDetail(db, user, bookingId) {
  needFinance(user);
  const all = reconciliation(db, user, { size: 1000 }).rows.find((r) => r.booking_id === Number(bookingId));
  if (!all) throw notFound('Booking not found');
  return { row: all, notes: db.all("SELECT * FROM comments WHERE entity_type='recon' AND entity_id=? ORDER BY id DESC", bookingId), invoices: db.all('SELECT * FROM invoices WHERE booking_id=?', bookingId) };
}
export function reconciliationAction(db, user, bookingId, input) {
  needFinance(user);
  return db.tx(() => {
    if (input.action === 'note') { if (!String(input.note || '').trim()) throw bad('Note is required'); comment(db, 'recon', bookingId, user, input.note, 'Finance'); }
    else if (input.action === 'resolve') {
      const inv = db.get('SELECT id FROM invoices WHERE booking_id=?', bookingId); if (!inv) throw conflict('Cannot resolve: no invoice has been received for this booking');
      if (!String(input.note || '').trim()) throw bad('A resolution note is required');
      db.run('UPDATE invoices SET resolved=1 WHERE booking_id=?', bookingId); comment(db, 'recon', bookingId, user, `Resolved: ${input.note}`, 'Finance');
    } else if (input.action === 'remove_duplicate') {
      const dup = db.all('SELECT id FROM invoices WHERE booking_id=? ORDER BY id', bookingId); if (dup.length < 2) throw conflict('No duplicate invoice found');
      db.run('DELETE FROM invoices WHERE id=?', dup[dup.length - 1].id); comment(db, 'recon', bookingId, user, 'Duplicate charge removed and supplier credit requested', 'Finance');
    } else if (input.action === 'retry_erp') {
      const inv = db.get('SELECT * FROM invoices WHERE booking_id=?', bookingId); if (!inv) throw notFound('Invoice not found');
      if (inv.erp_status === 'Posted') throw conflict('Already posted to ERP');
      db.run("UPDATE invoices SET erp_status='Posted', erp_error=NULL, erp_posted_at=?, erp_doc_no=COALESCE(erp_doc_no, ?) WHERE booking_id=?", today(), `51000${seq(db, 'erp') + 30000}`, bookingId);
    } else throw bad('Unknown action');
    audit(db, user, `recon.${input.action}`, 'booking', bookingId, input.note || '');
    return { ok: true };
  });
}
export { addDays, isDate, pad };
