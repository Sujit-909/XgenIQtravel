import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, d } from './helpers';
import { renderPage, expectRedirect } from './render';
import { getDb } from '@/lib/db';
import { state } from 'next/navigation';

const PAGES = [
  // [role, file, params, searchParams, text that must appear]
  ['emp', '(app)/dashboard/page.jsx', {}, {}, 'Upcoming Trips'],
  ['mgr', '(app)/dashboard/page.jsx', {}, {}, 'Manager Dashboard'], ['desk', '(app)/dashboard/page.jsx', {}, {}, 'Travel Desk Dashboard'], ['fin', '(app)/dashboard/page.jsx', {}, {}, 'Finance Dashboard'], ['admin', '(app)/dashboard/page.jsx', {}, {}, 'Administration'],
  ['emp', '(app)/trips/page.jsx', {}, {}, 'My Trips'], ['mgr', '(app)/trips/page.jsx', {}, { status: 'Approved', page: '1' }, 'Manage Business Trips'], ['admin', '(app)/trips/page.jsx', {}, { q: 'Mumbai' }, 'Recent Business Trips'],
  ['emp', '(app)/trips/new/page.jsx', {}, {}, 'Business Trip Request'],
  ['emp', '(app)/bookings/page.jsx', {}, {}, 'My Bookings'], ['emp', '(app)/bookings/page.jsx', {}, { type: 'hotel', selected: '3' }, 'Booking Details'], ['emp', '(app)/search/page.jsx', {}, {}, 'Fare Comparison'],
  ['emp', '(app)/assistant/page.jsx', {}, {}, 'Travel Assistant'], ['mgr', '(app)/approvals/page.jsx', {}, {}, 'My Approvals'], ['mgr', '(app)/approvals/page.jsx', {}, { type: 'expense', status: 'All' }, 'Expense Approvals'], ['fin', '(app)/approvals/page.jsx', {}, {}, 'Expense Reports'],
  ['mgr', '(app)/bookings/page.jsx', {}, {}, 'My Bookings'],
  ['emp', '(app)/expenses/page.jsx', {}, {}, 'Manage Expenses'], ['mgr', '(app)/expenses/page.jsx', {}, { scope: 'team', status: 'Submitted' }, 'Manage Expenses'], ['fin', '(app)/expenses/page.jsx', {}, {}, 'Manage Expenses'], ['emp', '(app)/expenses/new/page.jsx', {}, {}, 'Create Expense Report'],
  ['emp', '(app)/profile/page.jsx', {}, {}, 'My Profile'], ...['prefs', 'docs', 'pay', 'family', 'addr', 'loyalty', 'notif'].map((t) => ['emp', '(app)/profile/page.jsx', {}, { tab: t }, 'My Profile']), ['mgr', '(app)/profile/page.jsx', {}, {}, 'My Profile'],
  ['emp', '(app)/documents/page.jsx', {}, {}, 'Travel Documents'], ['emp', '(app)/reimbursement-accounts/page.jsx', {}, {}, 'Reimbursement Accounts'], ['fin', '(app)/reimbursement-accounts/page.jsx', {}, {}, 'Reimbursement Accounts'], ['emp', '(app)/loyalty/page.jsx', {}, {}, 'Loyalty Programs'], ['emp', '(app)/notifications/page.jsx', {}, {}, 'Recent Notifications'], ['emp', '(app)/notifications/page.jsx', {}, { category: 'expiry' }, 'Alert Settings'],
  ['emp', '(app)/refunds/page.jsx', {}, {}, 'Refund Centre'], ['fin', '(app)/refunds/page.jsx', {}, {}, 'Refund Progress Timeline'], ['desk', '(app)/refunds/page.jsx', {}, { status: 'Partially Credited' }, 'Actions &amp; Owner'], ['mgr', '(app)/refunds/page.jsx', {}, {}, 'Refund Centre'],
  ['mgr', '(app)/team/bookings/page.jsx', {}, {}, 'Team Travel Bookings'], ['mgr', '(app)/team/bookings/page.jsx', {}, { tab: 'Cancelled', service: 'flight' }, 'Team Travel Bookings'], ['fin', '(app)/team/bookings/page.jsx', {}, {}, 'Team Travel Bookings'],
  ...['Passport', 'Visa', 'PAN Card', 'Aadhaar Card', 'Driving License', 'Other'].map((t) => ['mgr', '(app)/team/compliance/page.jsx', {}, { doc: t }, 'Team Travel Compliance']), ['admin', '(app)/team/compliance/page.jsx', {}, { status: 'Expired' }, 'Compliance'],
  ['mgr', '(app)/readiness/page.jsx', {}, {}, 'Disruption Centre'], ['desk', '(app)/readiness/page.jsx', {}, { risk: 'High', days: '60' }, 'Disruption Centre'],
  ['desk', '(app)/travel-desk/page.jsx', {}, {}, 'Operations Queue'], ['desk', '(app)/travel-desk/page.jsx', {}, { tab: 'Awaiting Agency Quote' }, 'Service Request'], ['desk', '(app)/travel-desk/page.jsx', {}, { tab: 'Urgent' }, 'Operations Queue'], ['desk', '(app)/travel-desk/sla/page.jsx', {}, {}, 'SLA Monitoring'],
  ['fin', '(app)/finance/reimbursements/page.jsx', {}, {}, 'Reimbursement Tracker'], ['fin', '(app)/finance/reimbursements/page.jsx', {}, { payment_status: 'Failed' }, 'Payment Actions'], ['admin', '(app)/finance/reimbursements/page.jsx', {}, { status: 'Posted' }, 'Reimbursement Tracker'],
  ...['overview', 'invoices', 'payments', 'refunds', 'erp', 'exceptions'].map((t) => ['fin', '(app)/finance/reconciliation/page.jsx', {}, { tab: t }, 'Reconciliation']), ['fin', '(app)/finance/reconciliation/page.jsx', {}, { match: 'Amount Mismatch' }, 'Exception Details'],
  ['emp', '(app)/policy/page.jsx', {}, {}, 'Travel Policy'], ['admin', '(app)/policy/page.jsx', {}, {}, 'Test Policy Rule'], ...['workflows', 'tiers', 'suppliers', 'versions'].map((t) => ['admin', '(app)/policy/page.jsx', {}, { tab: t }, 'Travel Policy']),
  ...['actual_vs_budget', 'department_spend', 'supplier_spend', 'policy_exceptions', 'cancellation_losses', 'overdue_refunds', 'refund_recovery', 'unclaimed_bookings'].map((t) => ['fin', '(app)/reports/page.jsx', {}, { type: t }, 'Reports']), ['mgr', '(app)/reports/page.jsx', {}, {}, 'Reports'],
  ...['cost_center', 'project', 'sales_order', 'internal_order', 'department', 'city'].map((t) => ['admin', '(app)/master-data/page.jsx', {}, { kind: t }, 'Master Data']), ['admin', '(app)/users/page.jsx', {}, {}, 'User Management'], ['admin', '(app)/integrations/page.jsx', {}, {}, 'Integration Monitoring'], ['admin', '(app)/audit/page.jsx', {}, { entity: 'trip', q: 'trip' }, 'Audit Logs'],
  ['emp', '(app)/help/page.jsx', {}, {}, 'Help &amp; Support'],
  ['emp', '(app)/services/[type]/page.jsx', { type: 'flight' }, {}, 'Flight Booking'], ['emp', '(app)/services/[type]/page.jsx', { type: 'visa' }, {}, 'Visa Processing'],
];
test('setup', () => { fresh(); });
for (const [who, file, params, sp, text] of PAGES) {
  test(`page ${file} as ${who} ${JSON.stringify(sp)}`, async () => {
    state.params = params;
    const html = await renderPage(file, { who, params, sp });
    assert.ok(html.length > 200, 'rendered something');
    assert.ok(html.includes(text), `contains "${text}"`);
    assert.ok(!/undefined|NaN|\[object Object\]/.test(html.replace(/<[^>]+>/g, ' ')), 'no undefined / NaN / [object Object] leaks into the UI');
  });
}
test('unauthenticated users are redirected to the login page', async () => {
  assert.equal(await expectRedirect('(app)/dashboard/page.jsx', { who: null }), '/login');
});
test('trip detail, edit and itinerary pages render for real trips', async () => {
  fresh(); const db = getDb();
  const own = db.get("SELECT id FROM trips WHERE trip_no LIKE '%00125'").id;
  for (const [file, who] of [['(app)/trips/[id]/page.jsx', 'emp'], ['(app)/trips/[id]/details/page.jsx', 'emp'], ['(app)/trips/[id]/page.jsx', 'mgr']]) {
    const html = await renderPage(file, { who, params: { id: String(own) } });
    assert.ok(html.includes('00125'), file);
  }
  const draft = db.get("SELECT id FROM trips WHERE status='Draft' AND traveller_id=(SELECT id FROM users WHERE email='sujit@xgeniq.com')").id;
  assert.ok((await renderPage('(app)/trips/[id]/edit/page.jsx', { who: 'emp', params: { id: String(draft) } })).includes('Edit Business Trip Request'));
  assert.equal(await expectRedirect('(app)/trips/[id]/edit/page.jsx', { who: 'emp', params: { id: String(own) } }), 'NOT_FOUND', 'approved trips cannot be edited');
  assert.equal(await expectRedirect('(app)/trips/[id]/page.jsx', { who: 'owner', params: { id: String(own) } }), 'NOT_FOUND', 'unrelated users get a 404');
  const hub = await renderPage('(app)/services/[type]/page.jsx', { who: 'emp', params: { type: 'hotel' }, sp: { trip: String(own) } });
  assert.ok(hub.includes('Hotel Booking'));
  assert.equal(await expectRedirect('(app)/services/[type]/page.jsx', { who: 'emp', params: { type: 'nope' } }), 'NOT_FOUND');
});

test('expense report pages render in every state', async () => {
  fresh(); const db = getDb();
  const reps = db.all('SELECT r.id, r.status, u.email FROM expense_reports r JOIN users u ON u.id=r.user_id');
  const draft = reps.find((r) => r.status === 'Draft' && r.email === 'sujit@xgeniq.com');
  for (const step of ['items', 'review']) assert.ok((await renderPage('(app)/expenses/[id]/page.jsx', { who: 'emp', params: { id: String(draft.id) }, sp: { step } })).includes(step === 'items' ? 'Add Expense Items' : 'Review &amp; Submit'));
  assert.ok((await renderPage('(app)/expenses/[id]/page.jsx', { who: 'emp', params: { id: String(draft.id) }, sp: { upload: '1' } })).includes('Upload Documents'));
  for (const r of reps.filter((x) => x.status !== 'Draft')) { const html = await renderPage('(app)/expenses/[id]/page.jsx', { who: 'fin', params: { id: String(r.id) } }); assert.ok(html.includes('Approval Status'), `${r.status} report renders for finance`); }
  assert.equal(await expectRedirect('(app)/expenses/[id]/page.jsx', { who: 'owner', params: { id: String(draft.id) } }), 'NOT_FOUND');
});

test('role guards redirect users away from restricted pages', async () => {
  fresh();
  assert.equal(await expectRedirect('(app)/travel-desk/page.jsx', { who: 'emp' }), '/dashboard');
  assert.equal(await expectRedirect('(app)/readiness/page.jsx', { who: 'emp' }), '/dashboard');
  assert.equal(await expectRedirect('(app)/team/compliance/page.jsx', { who: 'fin' }), '/dashboard');
});

test('admin-only and finance-only pages are guarded', async () => {
  fresh();
  for (const [file, who] of [['(app)/users/page.jsx', 'mgr'], ['(app)/audit/page.jsx', 'fin'], ['(app)/integrations/page.jsx', 'emp'], ['(app)/finance/reimbursements/page.jsx', 'mgr'], ['(app)/reports/page.jsx', 'emp']])
    assert.equal(await expectRedirect(file, { who }), '/dashboard', `${who} on ${file}`);
});
