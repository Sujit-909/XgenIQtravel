import { json } from '../db';
import { bad, conflict, forbidden, notFound, nowIso, today, addDays, isDate, num, round2, page as pg, seq, pad, yearOf, audit, notify, insert, comment, getSetting, daysBetween } from '../util';
import { calcReport, itemTotal, validateAllocation, allocate, FX_RATES, FX_SOURCE } from '../calc';
import { extractFromReceipt } from '../ocr';
import { approvalsFor, createChain, teamIds } from './chain';
import { evaluateHotel } from './policy';

export const EXPENSE_TYPES = ['Air Fare', 'Hotel', 'Cab Fare', 'Meals', 'Bus', 'Train Fare', 'Fuel', 'Parking', 'Internet', 'Conference Fee', 'Miscellaneous'];
export const REPORT_STATUSES = ['Draft', 'Submitted', 'Returned for Correction', 'Manager Approved', 'Finance Approved', 'Rejected', 'Posted'];
export const PAYMENT_TYPES = ['Employee Paid', 'Company Paid'];
const EDITABLE = ['Draft', 'Returned for Correction'];
const KIND = { 'Cost Center': 'cost_center', 'WBS Element': 'project', Project: 'project', 'Internal Order': 'internal_order', 'Sales Order': 'sales_order' };
const BOOKING_ITEM = { flight: 'Air Fare', hotel: 'Hotel', cab: 'Cab Fare', bus: 'Bus', train: 'Train Fare', other: 'Miscellaneous' };

export const parseItem = (i) => ({ ...i, allocation: json(i.allocation, []), itemization: json(i.itemization, []), flags: json(i.flags, []), personal: !!i.personal, total: itemTotal(i), total_inr: itemTotal(i) });
export const calcFor = (items, advance) => calcReport(items.map(parseItem), advance);

// ---------- access ----------
function loadReport(db, user, id, { write = false } = {}) {
  const r = db.get('SELECT r.*, u.name employee, u.emp_id, u.department, u.manager_id FROM expense_reports r JOIN users u ON u.id=r.user_id WHERE r.id=?', id);
  if (!r) throw notFound('Expense report not found');
  const privileged = ['admin', 'finance'].includes(user.role);
  const ok = r.user_id === user.id || privileged || (user.role === 'manager' && teamIds(db, user.id).includes(r.user_id))
    || !!db.get("SELECT 1 x FROM approvals WHERE entity_type='expense' AND entity_id=? AND (approver_id=? OR approver_role=?)", id, user.id, user.role);
  if (!ok) throw forbidden();
  if (write && r.user_id !== user.id) throw forbidden('Only the report owner can change this report');
  return r;
}

// ---------- listing ----------
const DISPLAY = { Draft: ['Draft'], Submitted: ['Submitted'], 'In Review': ['Manager Approved'], Approved: ['Finance Approved', 'Posted'], Rejected: ['Rejected'], Returned: ['Returned for Correction'] };
export function listReports(db, user, q = {}) {
  const scope = q.scope || (['finance', 'admin'].includes(user.role) ? 'all' : 'mine');
  const w = []; const p = [];
  if (scope === 'mine') { w.push('r.user_id=?'); p.push(user.id); }
  else if (scope === 'team') { const ids = teamIds(db, user.id); w.push(`r.user_id IN (${ids.map(() => '?').join(',')})`); p.push(...ids); }
  else if (!['finance', 'admin'].includes(user.role)) { w.push('r.user_id=?'); p.push(user.id); }
  const base = [...w]; const baseP = [...p];
  if (q.status && q.status !== 'All') {
    if (q.status === 'Paid') w.push("rb.status='Paid'");
    else if (DISPLAY[q.status]) { w.push(`r.status IN (${DISPLAY[q.status].map(() => '?').join(',')})`); p.push(...DISPLAY[q.status]); } else { w.push('r.status=?'); p.push(q.status); }
  }
  if (q.category && q.category !== 'All') { w.push('r.category=?'); p.push(q.category); }
  if (q.department && q.department !== 'All') { w.push('u.department=?'); p.push(q.department); }
  if (q.cost_object_type && q.cost_object_type !== 'All') { w.push('r.cost_object_type=?'); p.push(q.cost_object_type); }
  if (isDate(q.from)) { w.push('r.start_date>=?'); p.push(q.from); } if (isDate(q.to)) { w.push('r.start_date<=?'); p.push(q.to); }
  if (q.q) { w.push('(r.report_no LIKE ? OR t.trip_no LIKE ? OR u.name LIKE ? OR r.purpose LIKE ? OR u.department LIKE ?)'); const s = `%${q.q}%`; p.push(s, s, s, s, s); }
  const from = 'FROM expense_reports r JOIN users u ON u.id=r.user_id LEFT JOIN trips t ON t.id=r.trip_id LEFT JOIN reimbursements rb ON rb.report_id=r.id';
  const { size, page, offset } = pg(q, 7);
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const total = db.get(`SELECT COUNT(*) c ${from} ${where}`, ...p).c;
  const rows = db.all(`SELECT r.*, u.name employee, u.emp_id, u.department, t.trip_no, rb.status reimb_status, rb.paid_at,
     (SELECT COALESCE(SUM((i.amount+i.tax)*i.fx_rate),0) FROM expense_items i WHERE i.report_id=r.id) total_amount,
     CASE WHEN rb.status='Paid' THEN rb.payable_amount ELSE 0 END reimbursed
     ${from} ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`, ...p, size, offset);
  const bw = base.length ? `WHERE ${base.join(' AND ')}` : '';
  const all = db.all(`SELECT r.status, r.created_at, rb.status rs ${from} ${bw}`, ...baseP);
  const month = today().slice(0, 7); const pm = new Date(); pm.setUTCMonth(pm.getUTCMonth() - 1); const prev = pm.toISOString().slice(0, 7);
  const cnt = (f, m) => all.filter((x) => f(x) && String(x.created_at).startsWith(m)).length;
  const defs = { Draft: (x) => x.status === 'Draft', Submitted: (x) => x.status === 'Submitted', 'In Review': (x) => x.status === 'Manager Approved', Approved: (x) => ['Finance Approved', 'Posted'].includes(x.status), Rejected: (x) => x.status === 'Rejected', Paid: (x) => x.rs === 'Paid', Returned: (x) => x.status === 'Returned for Correction' };
  const kpis = Object.fromEntries(Object.entries(defs).map(([k, f]) => { const c = all.filter(f).length; const a = cnt(f, month); const b = cnt(f, prev); return [k, { count: c, delta: b === 0 ? (a > 0 ? 100 : 0) : Math.round(((a - b) / b) * 100) }]; }));
  const departments = db.all('SELECT DISTINCT u.department d FROM users u ORDER BY 1').map((r) => r.d).filter(Boolean);
  return { rows, total, page, size, kpis, scope, departments };
}

// ---------- create / read / update ----------
function checkCostObjects(db, rows) {
  const err = validateAllocation(rows.map((r) => ({ costObject: r.costObject, percentage: r.percentage })), 'Percentage', 100);
  if (err) throw bad(err);
  for (const r of rows) {
    const code = String(r.costObject).split(' - ')[0].trim();
    if (!db.get('SELECT 1 x FROM master_data WHERE code=? AND active=1 AND kind IN (?,?,?,?)', code, 'cost_center', 'project', 'sales_order', 'internal_order')) throw bad(`Cost object ${r.costObject} is not a valid active cost object`);
  }
}
function writeCostObjects(db, id, rows, type) {
  db.run('DELETE FROM report_cost_objects WHERE report_id=?', id);
  for (const r of rows) insert(db, 'report_cost_objects', { report_id: id, cost_object: r.costObject, type: r.type || type, percentage: Number(r.percentage) });
}

export function createReport(db, user, input) {
  return db.tx(() => {
    const category = input.category || 'Travel';
    if (!['Travel', 'Non Travel', 'Event'].includes(category)) throw bad('Invalid expense category');
    if (!String(input.title || '').trim()) throw bad('Expense report title is required');
    if (!String(input.purpose || '').trim()) throw bad('Report purpose is required');
    if (!String(input.company_code || '').trim()) throw bad('Company code is required');
    if (!String(input.cost_object_type || '').trim()) throw bad('Cost object type is required');
    let trip = null; let advance = 0;
    if (category === 'Travel') {
      if (!input.trip_id) throw bad('A Trip ID is required for travel expense reports');
      trip = db.get('SELECT * FROM trips WHERE id=?', input.trip_id);
      if (!trip || trip.traveller_id !== user.id) throw forbidden('You can only raise expenses against your own trips');
      if (!['Approved', 'Booking In Progress', 'Travel In Progress', 'Expenses Pending', 'Closed'].includes(trip.status)) throw conflict('Expenses can only be added once the trip is approved');
      advance = trip.advance_needed ? trip.advance_amount : 0;
    }
    const cos = Array.isArray(input.cost_objects) && input.cost_objects.length ? input.cost_objects : trip ? [{ costObject: trip.cost_object, percentage: 100, type: trip.cost_object_type }] : [];
    checkCostObjects(db, cos);
    const start = input.start_date || trip?.dep_date || null; const end = input.end_date || trip?.ret_date || null;
    if (start && end && end < start) throw bad('End date cannot be before start date');
    if (String(input.comment || '').length > 2000) throw bad('Comment is limited to 2000 characters');
    const no = `ER-${yearOf()}-${pad(seq(db, `expense-${yearOf()}`), 5)}`;
    const id = insert(db, 'expense_reports', { report_no: no, user_id: user.id, trip_id: trip?.id || null, title: input.title.trim(), purpose: input.purpose.trim(), category, trip_category: trip?.travel_type || input.trip_category || null,
      receipts_mandatory: 1, start_date: start, end_date: end, dest_country: input.dest_country || trip?.dest_country || null, dest_city: input.dest_city || trip?.dest_city || null, company_code: input.company_code,
      cost_object_type: input.cost_object_type, travel_allowance: input.travel_allowance ? 1 : 0, advance, comment: input.comment || null, status: 'Draft', created_at: nowIso(), updated_at: nowIso() });
    writeCostObjects(db, id, cos, input.cost_object_type);
    audit(db, user, 'expense.create', 'expense', id, no);
    return db.get('SELECT * FROM expense_reports WHERE id=?', id);
  });
}

export function updateReport(db, user, id, input) {
  return db.tx(() => {
    const r = loadReport(db, user, id, { write: true });
    if (!EDITABLE.includes(r.status)) throw conflict(`A report in "${r.status}" status cannot be edited`);
    const f = {};
    for (const k of ['title', 'purpose', 'comment', 'dest_city', 'dest_country', 'start_date', 'end_date', 'company_code', 'cost_object_type']) if (input[k] !== undefined) f[k] = input[k];
    if (input.travel_allowance !== undefined) f.travel_allowance = input.travel_allowance ? 1 : 0;
    if (f.title !== undefined && !String(f.title).trim()) throw bad('Expense report title is required');
    const s = f.start_date ?? r.start_date; const e = f.end_date ?? r.end_date; if (s && e && e < s) throw bad('End date cannot be before start date');
    const keys = Object.keys(f);
    if (keys.length) db.run(`UPDATE expense_reports SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`, ...keys.map((k) => f[k]), nowIso(), id);
    if (Array.isArray(input.cost_objects)) { checkCostObjects(db, input.cost_objects); writeCostObjects(db, id, input.cost_objects, f.cost_object_type || r.cost_object_type); }
    audit(db, user, 'expense.update', 'expense', id, keys.join(','));
    return db.get('SELECT * FROM expense_reports WHERE id=?', id);
  });
}

export function getReport(db, user, id) {
  const r = loadReport(db, user, id);
  const items = db.all('SELECT * FROM expense_items WHERE report_id=? ORDER BY id', id).map(parseItem);
  const trip = r.trip_id ? db.get('SELECT id,trip_no,title,travel_type,dep_date,ret_date,dest_city,dest_country,advance_amount,company_code FROM trips WHERE id=?', r.trip_id) : null;
  const costObjects = db.all('SELECT * FROM report_cost_objects WHERE report_id=? ORDER BY id', id);
  const receipts = db.all("SELECT id,name,size,mime FROM files WHERE entity_type='expense' AND entity_id=?", id);
  const calc = calcReport(items, r.advance);
  const approvals = approvalsFor(db, 'expense', id).filter((a) => a.status !== 'Cancelled');
  const reimbursement = db.get('SELECT * FROM reimbursements WHERE report_id=?', id);
  const maxAdvance = getSetting(db, 'max_advance', 50000);
  const owner = db.get('SELECT name,emp_id,department FROM users WHERE id=?', r.user_id);
  const policyChecks = {
    receiptsAttached: items.filter((i) => i.receipt_file_id).length, receiptsTotal: items.length, needsReview: items.filter((i) => i.status === 'Needs Review').length,
    verified: items.filter((i) => i.status === 'Valid').length,
  };
  return { report: r, owner, items, trip, costObjects, receipts, calc, approvals, reimbursement: reimbursement && { ...reimbursement, history: json(reimbursement.history, []) }, maxAdvance, policyChecks,
    can: { edit: r.user_id === user.id && EDITABLE.includes(r.status) }, types: EXPENSE_TYPES, currencies: Object.keys(FX_RATES) };
}

// ---------- line items ----------
function normalizeItem(db, report, i, existing) {
  const type = i.type ?? existing?.type;
  if (!EXPENSE_TYPES.includes(type)) throw bad('Select a valid expense type');
  const vendor = String(i.vendor ?? existing?.vendor ?? '').trim(); if (!vendor) throw bad('Vendor name is required');
  const city = String(i.city ?? existing?.city ?? '').trim(); if (!city) throw bad('City of purchase is required');
  const txn = i.txn_date ?? existing?.txn_date; if (!isDate(txn)) throw bad('Transaction date is required');
  if (txn > today()) throw bad('Transaction date cannot be in the future');
  const amount = num(i.amount ?? existing?.amount, NaN); const tax = num(i.tax ?? existing?.tax, 0);
  if (!(amount > 0)) throw bad('Amount (excluding tax) must be greater than zero'); if (tax < 0) throw bad('Tax amount cannot be negative');
  const currency = i.currency ?? existing?.currency ?? 'INR'; if (!FX_RATES[currency]) throw bad(`Unsupported currency ${currency}`);
  const payment_type = i.payment_type ?? existing?.payment_type ?? 'Employee Paid'; if (!PAYMENT_TYPES.includes(payment_type)) throw bad('Invalid payment type');
  const o = { type, vendor, city, txn_date: txn, amount: round2(amount), tax: round2(tax), currency, fx_rate: FX_RATES[currency], fx_source: FX_SOURCE, payment_type, personal: (i.personal ?? existing?.personal) ? 1 : 0, comment: String(i.comment ?? existing?.comment ?? '').slice(0, 500) };
  if (String(i.comment || '').length > 500) throw bad('Comment is limited to 500 characters');
  if (type === 'Hotel') {
    const from = i.from_date ?? existing?.from_date; const to = i.to_date ?? existing?.to_date;
    if (!isDate(from) || !isDate(to)) throw bad('From and To dates are required for hotel expenses');
    if (to <= from) throw bad('Hotel check-out must be after check-in');
    o.from_date = from; o.to_date = to; o.nights = daysBetween(from, to);
  }
  // itemization (day-wise breakup) must reconcile to the item amounts
  const itemization = i.itemization ?? json(existing?.itemization, []);
  if (itemization.length) {
    const sa = round2(itemization.reduce((s, r) => s + num(r.amount), 0)); const st = round2(itemization.reduce((s, r) => s + num(r.tax), 0));
    if (Math.abs(sa - o.amount) > 1) throw bad(`Itemization amounts (${sa}) must equal the amount excluding tax (${o.amount})`);
    if (Math.abs(st - o.tax) > 1) throw bad(`Itemization tax (${st}) must equal the tax amount (${o.tax})`);
  }
  o.itemization = itemization;
  // cost allocation
  const total = itemTotal(o);
  const basis = i.allocation_basis ?? existing?.allocation_basis ?? 'Percentage';
  let rows = i.allocation ?? json(existing?.allocation, null);
  if (!rows || !rows.length) rows = db.all('SELECT cost_object costObject, type costObjectType, percentage FROM report_cost_objects WHERE report_id=?', report.id);
  const err = validateAllocation(rows, basis, total); if (err) throw bad(err);
  for (const r of rows) {
    const code = String(r.costObject).split(' - ')[0].trim();
    if (!db.get('SELECT 1 x FROM master_data WHERE code=? AND active=1', code)) throw bad(`Cost object ${r.costObject} is not valid`);
  }
  o.allocation_basis = basis; o.allocation = allocate(rows, basis, total);
  return o;
}

function reviewFlags(db, report, o, selfId) {
  const flags = [];
  if (report.start_date && report.end_date && (o.txn_date < addDays(report.start_date, -1) || o.txn_date > addDays(report.end_date, 1))) flags.push('Transaction date is outside the travel dates');
  const dup = db.get('SELECT i.id FROM expense_items i JOIN expense_reports r ON r.id=i.report_id WHERE r.user_id=? AND lower(i.vendor)=lower(?) AND i.txn_date=? AND ROUND((i.amount+i.tax)*i.fx_rate,2)=? AND i.id!=?',
    report.user_id, o.vendor, o.txn_date, itemTotal(o), selfId || 0);
  if (dup) flags.push('Possible duplicate: same vendor, date and amount already claimed');
  if (o.type === 'Hotel' && o.nights) {
    const h = evaluateHotel(db, { hotel: { city: o.city, pricePerNight: itemTotal(o) / o.nights, star: 0 }, travelType: report.trip_category || 'Domestic', destCountry: report.dest_country });
    if (h.status !== 'Compliant') flags.push(h.checks.find((c) => !c.ok)?.detail || 'Hotel rate above policy');
  }
  return flags;
}

function persistItem(db, user, report, i, existingId) {
  if (!EDITABLE.includes(report.status)) throw conflict(`A report in "${report.status}" status cannot be edited`);
  const existing = existingId ? db.get('SELECT * FROM expense_items WHERE id=? AND report_id=?', existingId, report.id) : null;
  if (existingId && !existing) throw notFound('Expense item not found');
  const o = normalizeItem(db, report, i, existing);
  const flags = reviewFlags(db, report, o, existingId);
  const receipt = i.receipt_file_id ?? existing?.receipt_file_id ?? null;
  let hash = existing?.receipt_hash || null;
  if (receipt && receipt !== existing?.receipt_file_id) {
    const f = db.get("SELECT sha256 FROM files WHERE id=? AND entity_type='expense'", receipt);
    if (!f) throw bad('Receipt file not found');
    hash = f.sha256;
    const dupFile = db.get('SELECT i.id FROM expense_items i JOIN expense_reports r ON r.id=i.report_id WHERE r.user_id=? AND i.receipt_hash=? AND i.id!=?', report.user_id, hash, existingId || 0);
    if (dupFile) flags.push('Duplicate receipt: this file was already used in another expense');
  }
  const row = { ...o, status: i.status === 'Needs Review' && !existingId ? 'Needs Review' : flags.length ? 'Needs Review' : 'Valid', flags, receipt_file_id: receipt, receipt_hash: hash, source: existing?.source || i.source || 'manual', confidence: i.confidence ?? existing?.confidence ?? null, booking_id: i.booking_id ?? existing?.booking_id ?? null };
  if (existingId) {
    const keys = Object.keys(row);
    db.run(`UPDATE expense_items SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => row[k]), existingId);
    audit(db, user, 'expense.item.update', 'expense', report.id, `item ${existingId}`);
    return existingId;
  }
  const id = insert(db, 'expense_items', { report_id: report.id, ...row, created_at: nowIso() });
  audit(db, user, 'expense.item.add', 'expense', report.id, `${o.type} ${o.vendor} ${itemTotal(o)}`);
  return id;
}

export function addItem(db, user, reportId, input) { return db.tx(() => { const r = loadReport(db, user, reportId, { write: true }); db.run('UPDATE expense_reports SET updated_at=? WHERE id=?', nowIso(), reportId); return parseItem(db.get('SELECT * FROM expense_items WHERE id=?', persistItem(db, user, r, input, null))); }); }
export function updateItem(db, user, reportId, itemId, input) { return db.tx(() => { const r = loadReport(db, user, reportId, { write: true }); persistItem(db, user, r, input, itemId); return parseItem(db.get('SELECT * FROM expense_items WHERE id=?', itemId)); }); }
export function deleteItems(db, user, reportId, ids) {
  return db.tx(() => {
    const r = loadReport(db, user, reportId, { write: true });
    if (!EDITABLE.includes(r.status)) throw conflict(`A report in "${r.status}" status cannot be edited`);
    let n = 0; for (const id of ids) n += db.run('DELETE FROM expense_items WHERE id=? AND report_id=?', id, reportId).changes;
    audit(db, user, 'expense.item.delete', 'expense', reportId, `${n} item(s)`);
    return { deleted: n };
  });
}

// Upload receipts -> draft line items (AI/OCR extraction through lib/ocr.js)
export function createItemsFromReceipts(db, user, reportId, uploaded) {
  return db.tx(() => {
    const r = loadReport(db, user, reportId, { write: true });
    if (!EDITABLE.includes(r.status)) throw conflict(`A report in "${r.status}" status cannot be edited`);
    const out = [];
    for (const f of uploaded) {
      const x = extractFromReceipt({ name: f.name, buffer: f.buffer, defaultDate: r.start_date && r.start_date <= today() ? r.start_date : today() });
      const dupFile = db.get('SELECT i.id FROM expense_items i JOIN expense_reports er ON er.id=i.report_id WHERE er.user_id=? AND i.receipt_hash=?', user.id, f.sha256);
      const isHotel = x.type === 'Hotel'; // stay dates cannot be read reliably - provisional 1 night, always reviewed
      const needs = x.confidence < 0.75 || !(x.amount > 0) || !!dupFile || isHotel;
      const amount = x.amount > 0 ? x.amount : 1; // placeholder so the draft can be saved; flagged for review
      const id = persistItem(db, user, r, { type: x.type, vendor: x.vendor, city: r.dest_city || 'Unknown', txn_date: x.txn_date, amount, tax: x.tax, currency: x.currency, payment_type: 'Employee Paid', receipt_file_id: f.id,
        ...(isHotel ? { from_date: x.txn_date, to_date: addDays(x.txn_date, 1) } : {}), comment: needs ? 'Extracted automatically - please verify amount and details' : 'Extracted automatically', source: 'ocr', confidence: x.confidence, status: needs ? 'Needs Review' : 'Valid' }, null);
      out.push(parseItem(db.get('SELECT * FROM expense_items WHERE id=?', id)));
    }
    return { items: out, extracted: out.filter((i) => i.status === 'Valid').length, needsReview: out.filter((i) => i.status === 'Needs Review').length };
  });
}

export function createReportFromBooking(db, user, bookingId) {
  return db.tx(() => {
    const b = db.get('SELECT * FROM bookings WHERE id=?', bookingId);
    if (!b || b.traveller_id !== user.id) throw notFound('Booking not found');
    if (!b.trip_id) throw conflict('This booking is not linked to a trip');
    if (['Cancelled'].includes(b.status)) throw conflict('Cancelled bookings cannot be claimed');
    if (['Claimed', 'Claim In Progress'].includes(b.claim_status)) throw conflict('This booking has already been claimed');
    let rep = db.get("SELECT * FROM expense_reports WHERE user_id=? AND trip_id=? AND status='Draft' ORDER BY id DESC LIMIT 1", user.id, b.trip_id);
    if (!rep) {
      const t = db.get('SELECT * FROM trips WHERE id=?', b.trip_id);
      rep = createReport(db, user, { category: 'Travel', trip_id: t.id, title: t.title, purpose: t.purpose_text || t.title, company_code: t.company_code || 'ABC01', cost_object_type: t.cost_object_type, travel_allowance: false });
    }
    const city = db.get('SELECT dest_city FROM trips WHERE id=?', b.trip_id)?.dest_city || 'Unknown';
    const item = persistItem(db, user, rep, { type: BOOKING_ITEM[b.type] || 'Miscellaneous', vendor: b.supplier || 'Supplier', city, txn_date: b.booking_date <= today() ? b.booking_date : today(), amount: b.amount, tax: 0, currency: b.currency, payment_type: 'Employee Paid', booking_id: b.id,
      comment: `Booking ${b.booking_no}`, ...(b.type === 'hotel' ? { from_date: b.travel_date, to_date: b.end_date } : {}) }, null);
    db.run("UPDATE bookings SET claim_status='Claim In Progress' WHERE id=?", b.id);
    return { report: db.get('SELECT * FROM expense_reports WHERE id=?', rep.id), itemId: item };
  });
}

// ---------- submit & approvals ----------
export function submitReport(db, user, id, input = {}) {
  return db.tx(() => {
    const r = loadReport(db, user, id, { write: true });
    if (!EDITABLE.includes(r.status)) throw conflict(`Report is already ${r.status}`);
    const items = db.all('SELECT * FROM expense_items WHERE report_id=?', id);
    if (!items.length) throw bad('Add at least one expense item before submitting');
    if (!input.declaration) throw bad('Please accept the declaration before submitting');
    if (r.receipts_mandatory) {
      const missing = items.filter((i) => !i.receipt_file_id && !i.personal);
      if (missing.length) throw bad(`Physical receipt is mandatory as per policy - ${missing.length} item(s) have no receipt attached`, { items: missing.map((m) => m.id) });
    }
    const calc = calcReport(items.map(parseItem), r.advance);
    const maxAdvance = getSetting(db, 'max_advance', 50000);
    if (r.advance > maxAdvance) throw bad(`Travel advance exceeds the policy maximum of ₹${maxAdvance.toLocaleString('en-IN')}`);
    db.run("UPDATE approvals SET status='Cancelled' WHERE entity_type='expense' AND entity_id=? AND status IN ('Pending','Waiting','Info Requested','Rejected')", id);
    const steps = [];
    if (r.manager_id) steps.push({ label: 'Reporting Manager', approverId: r.manager_id });
    steps.push({ label: 'Finance Validation', approverRole: 'finance', note: 'Validate expenses and cost allocation' });
    createChain(db, 'expense', id, steps);
    db.run("UPDATE expense_reports SET status='Submitted', declaration=1, comment=COALESCE(?,comment), return_reason=NULL, submitted_at=?, updated_at=? WHERE id=?", input.comment || null, nowIso(), nowIso(), id);
    if (steps[0].approverId) notify(db, steps[0].approverId, { category: 'approval', title: 'Expense report awaiting approval', body: `${r.report_no} - ${r.title}`, link: '/approvals', refKey: `exp-sub:${id}:${Date.now()}` });
    audit(db, user, 'expense.submit', 'expense', id, `${r.report_no} gross ${calc.gross}`);
    return db.get('SELECT * FROM expense_reports WHERE id=?', id);
  });
}

export function afterExpenseDecision(db, user, a, decision, cmt) {
  const r = db.get('SELECT * FROM expense_reports WHERE id=?', a.entity_id);
  if (decision === 'approve') {
    const next = db.get("SELECT * FROM approvals WHERE entity_type='expense' AND entity_id=? AND status='Waiting' ORDER BY level LIMIT 1", r.id);
    if (next) {
      db.run("UPDATE approvals SET status='Pending' WHERE id=?", next.id);
      db.run("UPDATE expense_reports SET status='Manager Approved', updated_at=? WHERE id=?", nowIso(), r.id);
    } else {
      db.run("UPDATE expense_reports SET status='Finance Approved', updated_at=? WHERE id=?", nowIso(), r.id);
      const items = db.all('SELECT * FROM expense_items WHERE report_id=?', r.id).map(parseItem);
      const c = calcReport(items, r.advance);
      const payable = c.estimatedReimbursement;
      db.run(`INSERT INTO reimbursements(report_id,status,approved_amount,payable_amount,deductions,currency,history,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(report_id) DO UPDATE SET status=excluded.status, approved_amount=excluded.approved_amount, payable_amount=excluded.payable_amount, updated_at=excluded.updated_at`,
      r.id, payable > 0 ? 'Payable' : 'Not Payable', c.reimbursable, payable, 0, 'INR', JSON.stringify([{ ts: nowIso(), event: 'Finance Approved', by: user.name }]), nowIso(), nowIso());
      db.run("UPDATE bookings SET claim_status='Claimed' WHERE id IN (SELECT booking_id FROM expense_items WHERE report_id=? AND booking_id IS NOT NULL)", r.id);
      notify(db, r.user_id, { category: 'approval', title: `Expense report ${r.report_no} approved`, body: payable > 0 ? `₹${payable.toLocaleString('en-IN')} will be reimbursed` : 'No reimbursement payable', link: `/expenses/${r.id}`, refKey: `exp-ok:${r.id}` });
    }
  } else if (decision === 'reject') {
    db.run("UPDATE expense_reports SET status='Rejected', return_reason=?, updated_at=? WHERE id=?", cmt, nowIso(), r.id);
    notify(db, r.user_id, { category: 'approval', severity: 'danger', title: `Expense report ${r.report_no} rejected`, body: cmt, link: `/expenses/${r.id}`, refKey: `exp-no:${r.id}` });
  } else {
    db.run("UPDATE expense_reports SET status='Returned for Correction', return_reason=?, updated_at=? WHERE id=?", cmt, nowIso(), r.id);
    notify(db, r.user_id, { category: 'approval', severity: 'warn', title: `Expense report ${r.report_no} returned`, body: cmt, link: `/expenses/${r.id}`, refKey: `exp-ret:${r.id}:${Date.now()}` });
  }
}
export { comment };
