import test from 'node:test';
import assert from 'node:assert/strict';
import { api, fresh, tripBody, d, formWith } from './helpers';
import { getDb } from '@/lib/db';

const item = (o = {}) => ({ type: 'Air Fare', vendor: 'IndiGo', city: 'Mumbai', txn_date: d(-1), amount: 12500, tax: 625, currency: 'INR', payment_type: 'Employee Paid', comment: 'Flight', ...o });
async function setup() {
  const t = (await api('emp', 'POST', '/trips', tripBody({ dep_date: d(5), ret_date: d(7), advance_needed: true, advance_amount: 10000 }))).data;
  await api('emp', 'POST', `/trips/${t.id}/submit`);
  const p = (await api('emp', 'GET', `/trips/${t.id}`)).data.approvals[0];
  await api('mgr', 'POST', `/approvals/${p.id}/decision`, { decision: 'approve' });
  return t;
}
const reportBody = (t, o = {}) => ({ category: 'Travel', trip_id: t.id, title: 'Client Meeting - Mumbai', purpose: 'Client meeting', company_code: 'ABC01', cost_object_type: 'Cost Center', travel_allowance: true,
  cost_objects: [{ costObject: 'CC1001 - Marketing Dept', percentage: 70, type: 'Cost Center' }, { costObject: 'CC2001 - IT Dept', percentage: 30, type: 'Cost Center' }], ...o });

test('expense report creation rules', async () => {
  fresh();
  const draftTrip = (await api('emp', 'POST', '/trips', tripBody())).data;
  assert.equal((await api('emp', 'POST', '/expenses', reportBody(draftTrip))).status, 409, 'trip must be approved');
  const t = await setup();
  assert.equal((await api('emp', 'POST', '/expenses', reportBody(t, { title: '' }))).status, 400);
  assert.equal((await api('emp', 'POST', '/expenses', reportBody(t, { cost_objects: [{ costObject: 'CC1001 - Marketing Dept', percentage: 60 }, { costObject: 'CC2001 - IT Dept', percentage: 30 }] }))).status, 400, 'allocation must total 100');
  assert.equal((await api('emp', 'POST', '/expenses', reportBody(t, { cost_objects: [{ costObject: 'CC1001 - Marketing Dept', percentage: 50 }, { costObject: 'CC1001 - Marketing Dept', percentage: 50 }] }))).status, 400, 'duplicate cost object');
  assert.equal((await api('mgr', 'POST', '/expenses', reportBody(t))).status, 403, "cannot raise expenses on someone else's trip");
  const r = await api('emp', 'POST', '/expenses', reportBody(t)); assert.equal(r.status, 201); assert.match(r.data.report_no, /^ER-\d{4}-\d{5}$/); assert.equal(r.data.advance, 10000);
});

test('line items: validation, allocation, itemization, duplicates, receipts, calculation', async () => {
  fresh(); const t = await setup();
  const rep = (await api('emp', 'POST', '/expenses', reportBody(t))).data; const P = `/expenses/${rep.id}`;
  for (const [bad, why] of [[{ amount: 0 }, 'zero amount'], [{ vendor: '' }, 'vendor'], [{ txn_date: d(5) }, 'future date'], [{ currency: 'XYZ' }, 'currency'], [{ type: 'Spaceship' }, 'type'], [{ tax: -5 }, 'negative tax'], [{ payment_type: 'Cash' }, 'payment type']])
    assert.equal((await api('emp', 'POST', `${P}/items`, item(bad))).status, 400, why);
  assert.equal((await api('emp', 'POST', `${P}/items`, item({ type: 'Hotel', amount: 15254, tax: 2746 }))).status, 400, 'hotel needs dates');
  assert.equal((await api('emp', 'POST', `${P}/items`, item({ allocation: [{ costObject: 'CC1001 - Marketing Dept', percentage: 90 }] }))).status, 400, 'item allocation must be 100%');
  const hotel = await api('emp', 'POST', `${P}/items`, item({ type: 'Hotel', vendor: 'Marriott Hotels', amount: 15254, tax: 2746, from_date: d(-3), to_date: d(-1), itemization: [{ date: d(-3), description: 'Room', amount: 7627, tax: 1373 }, { date: d(-2), description: 'Room', amount: 7627, tax: 1373 }] }));
  assert.equal(hotel.status, 201); assert.equal(hotel.data.nights, 2);
  assert.equal(hotel.data.allocation.reduce((s, a) => s + a.amount, 0), 18000, 'allocation amounts add up to the item total');
  assert.equal((await api('emp', 'POST', `${P}/items`, item({ type: 'Hotel', vendor: 'X', amount: 1000, tax: 0, from_date: d(-3), to_date: d(-1), itemization: [{ date: d(-3), description: 'Room', amount: 100, tax: 0 }] }))).status, 400, 'itemization must reconcile');
  const a = await api('emp', 'POST', `${P}/items`, item()); assert.equal(a.status, 201);
  const dup = await api('emp', 'POST', `${P}/items`, item()); assert.equal(dup.data.status, 'Needs Review'); assert.ok(dup.data.flags.some((f) => /duplicate/i.test(f)));
  const usd = await api('emp', 'POST', `${P}/items`, item({ vendor: 'Delta', amount: 100, tax: 0, currency: 'USD', txn_date: d(-2) })); assert.equal(usd.data.total_inr, 8350, 'foreign currency converted at the rate table');
  const personal = await api('emp', 'POST', `${P}/items`, item({ vendor: 'Spa', type: 'Miscellaneous', amount: 1000, tax: 0, personal: true, txn_date: d(-2) }));
  const company = await api('emp', 'POST', `${P}/items`, item({ vendor: 'Uber', type: 'Cab Fare', amount: 500, tax: 0, payment_type: 'Company Paid', txn_date: d(-2) }));
  const rd = (await api('emp', 'GET', P)).data;
  // gross = 18000 + 13125 + 13125 + 8350 + 1000 + 500 ; personal and company-paid are excluded from reimbursement
  assert.equal(rd.calc.gross, 54100); assert.equal(rd.calc.personal, 1000); assert.equal(rd.calc.company, 500); assert.equal(rd.calc.reimbursable, 52600); assert.equal(rd.calc.estimatedReimbursement, 42600);
  // delete a dup item and edit another
  assert.equal((await api('emp', 'POST', `${P}/items/delete`, { ids: [dup.data.id] })).data.deleted, 1);
  assert.equal((await api('emp', 'PATCH', `${P}/items/${a.data.id}`, { amount: 13000 })).data.amount, 13000);
  void personal; void company;
  // others cannot touch it
  assert.equal((await api('mgr', 'POST', `${P}/items`, item())).status, 403);
  assert.equal((await api('owner', 'GET', P)).status, 403);
});

test('receipts: extraction, duplicate detection, mandatory-receipt rule, submit and full approval to payment', async () => {
  fresh(); const t = await setup(); const db = getDb();
  const rep = (await api('emp', 'POST', '/expenses', reportBody(t))).data; const P = `/expenses/${rep.id}`;
  await api('emp', 'POST', `${P}/items`, item());
  assert.equal((await api('emp', 'POST', `${P}/submit`, { declaration: true })).status, 400, 'receipt mandatory');
  assert.equal((await api('emp', 'POST', `${P}/receipts`, undefined, formWith([['virus.exe', 'x']], { mode: 'extract' }))).status, 400);
  const ex = await api('emp', 'POST', `${P}/receipts`, undefined, formWith([['Flight_Ticket_12500.pdf', '%PDF-1'], ['Hotel_Invoice_18000.pdf', '%PDF-2'], ['scan001.jpg', 'jpeg', 'image/jpeg']], { mode: 'extract' }));
  assert.equal(ex.status, 201); assert.equal(ex.data.items.length, 3);
  assert.equal(ex.data.items.find((i) => i.type === 'Air Fare').amount, 12500);
  assert.equal(ex.data.items.find((i) => i.vendor.toLowerCase().includes('scan')).status, 'Needs Review');
  const again = await api('emp', 'POST', `${P}/receipts`, undefined, formWith([['Flight_Ticket_12500.pdf', '%PDF-1']], { mode: 'extract' }));
  assert.ok(again.data.items[0].flags.some((f) => /duplicate receipt/i.test(f)), 'same file twice is flagged');
  // attach receipt to the manual item
  const att = await api('emp', 'POST', `${P}/receipts`, undefined, formWith([['bill.pdf', 'data-unique']], { mode: 'attach' }));
  const manual = (await api('emp', 'GET', P)).data.items.find((i) => i.source === 'manual');
  await api('emp', 'PATCH', `${P}/items/${manual.id}`, { receipt_file_id: att.data.files[0].id });
  assert.equal((await api('emp', 'POST', `${P}/submit`, {})).status, 400, 'declaration required');
  const sub = await api('emp', 'POST', `${P}/submit`, { declaration: true });
  assert.equal(sub.status, 200); assert.equal(sub.data.status, 'Submitted');
  assert.equal((await api('emp', 'POST', `${P}/items`, item({ vendor: 'Late' }))).status, 409, 'submitted reports are locked');
  assert.equal((await api('emp', 'POST', `${P}/submit`, { declaration: true })).status, 409);
  // PDF export
  const pdf = await api('emp', 'GET', `${P}/pdf`); assert.equal(pdf.status, 200); assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  assert.equal((await api('owner', 'GET', `${P}/pdf`)).status, 403);
  // manager approves -> finance validates -> reimbursement
  const m = (await api('mgr', 'GET', '/approvals?type=expense')).data.rows.find((r) => r.entity_id === rep.id); assert.ok(m);
  assert.equal((await api('fin', 'POST', `/approvals/${m.approval_id}/decision`, { decision: 'approve' })).status, 403, 'finance cannot act on the manager level');
  await api('mgr', 'POST', `/approvals/${m.approval_id}/decision`, { decision: 'approve' });
  assert.equal(db.get('SELECT status FROM expense_reports WHERE id=?', rep.id).status, 'Manager Approved');
  const f = (await api('fin', 'GET', '/approvals?type=expense')).data.rows.find((r) => r.entity_id === rep.id); assert.ok(f, 'finance level is now pending');
  assert.equal((await api('emp', 'GET', '/reimbursements')).status, 403);
  await api('fin', 'POST', `/approvals/${f.approval_id}/decision`, { decision: 'approve' });
  const rb = db.get('SELECT * FROM reimbursements WHERE report_id=?', rep.id);
  assert.equal(rb.status, 'Payable');
  const calc = (await api('emp', 'GET', P)).data.calc;
  assert.equal(rb.payable_amount, calc.estimatedReimbursement); assert.equal(calc.advance, 10000);
  // payment lifecycle
  const act = (a, extra) => api('fin', 'POST', `/reimbursements/${rep.id}/action`, { action: a, ...extra });
  assert.equal((await act('mark_paid')).status, 409, 'must initiate first');
  assert.equal((await act('initiate')).status, 200);
  assert.equal((await act('initiate')).status, 409, 'cannot initiate twice');
  assert.equal((await act('mark_failed')).status, 400, 'reason required');
  assert.equal((await act('mark_failed', { reason: 'Account number invalid' })).status, 200);
  assert.ok(db.get("SELECT 1 x FROM notifications WHERE title='Reimbursement failed'"));
  assert.equal((await act('resubmit')).status, 200); assert.equal((await act('initiate')).status, 200);
  assert.equal((await act('mark_paid')).status, 200);
  assert.equal(db.get('SELECT status FROM expense_reports WHERE id=?', rep.id).status, 'Posted');
  const det = (await api('fin', 'GET', `/reimbursements/${rep.id}`)).data; assert.ok(det.reimbursement.history.length >= 5);
  const list = (await api('fin', 'GET', '/reimbursements')).data; assert.ok(list.kpis.paid.count >= 1);
});

test('returned / rejected expense reports, unverified bank account and batch payments', async () => {
  fresh(); const t = await setup(); const db = getDb();
  const rep = (await api('emp', 'POST', '/expenses', reportBody(t))).data; const P = `/expenses/${rep.id}`;
  const f = await api('emp', 'POST', `${P}/receipts`, undefined, formWith([['bill.pdf', 'z']], { mode: 'attach' }));
  await api('emp', 'POST', `${P}/items`, item({ receipt_file_id: f.data.files[0].id }));
  await api('emp', 'POST', `${P}/submit`, { declaration: true });
  const m = (await api('mgr', 'GET', '/approvals?type=expense')).data.rows.find((r) => r.entity_id === rep.id);
  assert.equal((await api('mgr', 'POST', `/approvals/${m.approval_id}/decision`, { decision: 'info' })).status, 400, 'reason needed');
  await api('mgr', 'POST', `/approvals/${m.approval_id}/decision`, { decision: 'info', comment: 'Receipt unreadable' });
  const r1 = (await api('emp', 'GET', P)).data.report; assert.equal(r1.status, 'Returned for Correction'); assert.equal(r1.return_reason, 'Receipt unreadable');
  assert.equal((await api('emp', 'POST', `${P}/items`, item({ vendor: 'Extra', txn_date: d(-2) }))).status, 201, 'returned reports are editable again');
  const ex = db.get('SELECT id FROM expense_items WHERE report_id=? AND vendor=?', rep.id, 'Extra');
  await api('emp', 'POST', `${P}/items/delete`, { ids: [ex.id] });
  assert.equal((await api('emp', 'POST', `${P}/submit`, { declaration: true })).status, 200, 'resubmission creates a fresh chain');
  const m2 = (await api('mgr', 'GET', '/approvals?type=expense')).data.rows.filter((r) => r.entity_id === rep.id && r.status === 'Pending'); assert.equal(m2.length, 1);
  await api('mgr', 'POST', `/approvals/${m2[0].approval_id}/decision`, { decision: 'approve' });
  const f2 = (await api('fin', 'GET', '/approvals?type=expense')).data.rows.find((r) => r.entity_id === rep.id);
  await api('fin', 'POST', `/approvals/${f2.approval_id}/decision`, { decision: 'approve' });
  // unverified account blocks payment
  db.run("UPDATE bank_accounts SET verified=0 WHERE user_id=(SELECT id FROM users WHERE email='sujit@xgeniq.com') AND is_default=1");
  const batch = (await api('fin', 'POST', '/reimbursements/batch', { report_ids: [rep.id] })).data;
  assert.equal(batch.initiated.length, 0); assert.match(batch.skipped[0].reason, /not verified/);
  const acct = db.get("SELECT id FROM bank_accounts WHERE is_default=1 AND user_id=(SELECT id FROM users WHERE email='sujit@xgeniq.com')");
  assert.equal((await api('emp', 'POST', `/profile/bank-accounts/${acct.id}/verify`)).status, 403);
  assert.equal((await api('fin', 'POST', `/profile/bank-accounts/${acct.id}/verify`)).status, 200);
  assert.equal((await api('fin', 'POST', '/reimbursements/batch', { report_ids: [rep.id] })).data.initiated.length, 1);
});

test('claiming a booking creates a draft expense item', async () => {
  fresh(); const db = getDb();
  const bk = (await api('emp', 'GET', '/bookings')).data.rows.find((b) => b.claim_status === 'Not Claimed' && b.status === 'Confirmed' && b.trip_id && b.type === 'flight');
  const r = await api('emp', 'POST', `/bookings/${bk.id}/claim`); assert.equal(r.status, 201);
  assert.equal(db.get('SELECT claim_status FROM bookings WHERE id=?', bk.id).claim_status, 'Claim In Progress');
  assert.equal((await api('emp', 'POST', `/bookings/${bk.id}/claim`)).status, 409, 'cannot claim twice');
});

test('profile security: masking, encryption, card rules, defaults', async () => {
  fresh(); const db = getDb();
  const list = (await api('emp', 'GET', '/profile/bank-accounts')).data;
  assert.ok(list.every((a) => !('account_enc' in a) && a.account_masked.endsWith(a.last4)));
  const raw = db.get('SELECT account_enc FROM bank_accounts LIMIT 1').account_enc; assert.ok(!/\d{9}/.test(raw), 'account numbers are encrypted at rest');
  assert.equal((await api('emp', 'POST', `/profile/bank-accounts/${list[0].id}/reveal`)).data.account_number, '50100123451234');
  assert.equal((await api('mgr', 'POST', `/profile/bank-accounts/${list[0].id}/reveal`)).status, 404, "cannot reveal someone else's account");
  assert.equal((await api('emp', 'POST', '/profile/bank-accounts', { bank: 'Axis', account_type: 'Savings Account', holder: 'R', account_number: '123', ifsc: 'UTIB0000001' })).status, 400);
  assert.equal((await api('emp', 'POST', '/profile/bank-accounts', { bank: 'Axis', account_type: 'Savings Account', holder: 'Rabindra Shau', account_number: '9182736451230', ifsc: 'bad' })).status, 400);
  const nb = await api('emp', 'POST', '/profile/bank-accounts', { bank: 'Axis', account_type: 'Savings Account', holder: 'Rabindra Shau', account_number: '9182736451230', ifsc: 'UTIB0000001' });
  assert.equal(nb.status, 201); assert.equal(nb.data.verified, 0);
  assert.equal((await api('emp', 'POST', '/profile/payment-methods', { kind: 'personal_card', label: 'X', last4: '1234', valid_thru: '01/30', holder: 'R', cvv: '123' })).status, 400, 'CVV rejected');
  const card = await api('emp', 'POST', '/profile/payment-methods', { kind: 'personal_card', brand: 'Visa', label: 'My card', card_number: '4111 1111 1111 1111', valid_thru: '01/35', holder: 'Rabindra Shau' });
  assert.equal(card.data.last4, '1111'); assert.ok(!JSON.stringify(card.data).includes('4111'));
  assert.equal((await api('emp', 'POST', '/profile/payment-methods', { kind: 'personal_card', label: 'Old', last4: '1111', valid_thru: '01/20', holder: 'R' })).status, 400, 'expired card');
  const docs = (await api('emp', 'GET', '/profile/documents')).data;
  assert.deepEqual(['Valid', 'Expiring Soon', 'Expired'].every((s) => docs.some((x) => x.status === s)), true);
  assert.equal((await api('emp', 'POST', '/profile/documents', { doc_type: 'Passport', doc_number: 'P1234567', issue_date: '2020-01-01', expiry_date: '2019-01-01' })).status, 400, 'expiry before issue');
  assert.equal((await api('emp', 'POST', '/profile/nonsense', {})).status, 404);
  assert.equal((await api('emp', 'PUT', '/profile/notification-settings', { expiry: { 'PAN Card': { on: true, days: 30 } } })).status, 400, 'PAN has no validity');
  assert.equal((await api('emp', 'PUT', '/profile/notification-settings', { expiry: { Passport: { on: true, days: 900 } } })).status, 400);
  const n = (await api('emp', 'GET', '/notifications')).data; assert.ok(n.rows.some((x) => x.category === 'expiry'), 'expiry alerts generated from documents');
  assert.equal((await api('emp', 'GET', '/notifications')).data.rows.filter((x) => /expir/i.test(x.title)).length, n.rows.filter((x) => /expir/i.test(x.title)).length, 'alerts are not duplicated');
  assert.equal((await api('emp', 'POST', '/notifications/read', {})).data.ok, true);
  assert.equal((await api('emp', 'GET', '/notifications')).data.unread, 0);
});

test('role-based access control', async () => {
  fresh();
  for (const [who, path, code] of [['emp', '/reimbursements', 403], ['emp', '/reconciliation', 403], ['emp', '/audit', 403], ['emp', '/users', 403], ['emp', '/desk/queue', 403], ['emp', '/readiness', 403], ['emp', '/team/compliance', 403], ['emp', '/reports/department_spend', 403],
    ['mgr', '/audit', 403], ['mgr', '/reimbursements', 403], ['fin', '/desk/queue', 403], ['desk', '/reimbursements', 403], ['admin', '/audit', 200], ['fin', '/reimbursements', 200], ['desk', '/desk/queue', 200], ['mgr', '/readiness', 200], ['mgr', '/team/compliance', 200], ['mgr', '/reports/department_spend', 200]])
    assert.equal((await api(who, 'GET', path)).status, code, `${who} ${path}`);
  assert.equal((await api('emp', 'POST', '/policy', { name: 'x' })).status, 403);
  assert.equal((await api('emp', 'PATCH', '/users/1', { role: 'admin' })).status, 403);
  const r = await api('mgr', 'GET', '/reports/policy_exceptions?format=csv'); assert.equal(r.status, 200); assert.match(r.data, /Booking/);
  // admin safeguards
  const me = (await api('admin', 'GET', '/auth/me')).data.user;
  assert.equal((await api('admin', 'PATCH', `/users/${me.id}`, { role: 'employee' })).status, 409, 'cannot demote self / last admin');
  assert.equal((await api('admin', 'PATCH', '/users/4', { manager_id: 4 })).status, 400, 'self-reporting');
  assert.equal((await api('admin', 'PATCH', '/users/3', { manager_id: 4 })).status, 200);
  assert.equal((await api('admin', 'PATCH', '/users/2', { manager_id: 4 })).status, 400, 'circular reporting line');
});
