import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, playwright, chromiumPath, esbuild } from './e2e/harness';
import { fresh, PASSWORD, EMAILS } from './helpers';

const pw = playwright(); const can = pw && chromiumPath() && esbuild();
const opts = { skip: can ? false : 'Playwright / Chromium / esbuild not available (optional browser tests)', timeout: 120000 };
let S; let browser; let errors = [];

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage(); errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => d.dismiss());
  return page;
}
async function signIn(page, email) {
  await page.goto(`${S.url}/login`);
  await page.getByLabel(/Email ID/).fill(email); await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.locator('form').getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL('**/mfa');
  const boxes = page.getByLabel(/Digit/); for (let i = 0; i < 6; i++) await boxes.nth(i).fill('246810'[i]);
  await page.getByRole('button', { name: 'Verify & Continue' }).click();
  await page.waitForURL('**/dashboard');
}

test('start browser harness', opts, async () => {
  fresh(); S = await startServer(); browser = await pw.chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
});

test('login with MFA, wrong password and sign-out', opts, async () => {
  const page = await newPage();
  await page.goto(`${S.url}/login`);
  await page.getByLabel(/Email ID/).fill(EMAILS.emp); await page.getByLabel(/^Password/).fill('wrong');
  await page.locator('form').getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByRole('alert').waitFor(); assert.match(await page.getByRole('alert').innerText(), /Invalid/);
  await signIn(page, EMAILS.emp);
  await page.getByText('Upcoming Trips').first().waitFor();
  assert.match(await page.locator('body').innerText(), /(Good (Morning|Afternoon|Evening)|Welcome), Rabindra/);
  await page.getByRole('button', { name: /Rabindra Shau/ }).click(); await page.getByRole('button', { name: 'Sign out' }).click(); await page.waitForURL('**/login');
  await page.goto(`${S.url}/dashboard`); await page.waitForURL('**/login');
  assert.deepEqual(errors, []);
});

test('create and submit a trip, manager approves it, trip becomes Approved', opts, async () => {
  const emp = await newPage(); await signIn(emp, EMAILS.emp);
  await emp.goto(`${S.url}/trips/new`);
  await emp.getByLabel('Request Purpose').selectOption('Client meeting');
  await emp.getByLabel('Trip Title').fill('E2E Client Meeting - Mumbai'); await emp.getByLabel('Purpose of travel').fill('Quarterly review');
  await emp.getByLabel('Destination City').selectOption('Mumbai');
  const dep = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10); const ret = new Date(Date.now() + 22 * 86400000).toISOString().slice(0, 10);
  await emp.getByLabel('Departure Date').fill(dep); await emp.getByLabel('Return Date').fill(ret);
  await emp.locator('label.f').filter({ hasText: /^Cost Object \*/ }).locator('select').selectOption({ label: 'CC2001 - IT Dept' });
  await emp.getByLabel('Estimated total budget').fill('25000'); await emp.getByLabel('Comment').fill('Need to meet key client');
  await emp.getByText('Reporting Manager').first().waitFor();
  await emp.getByRole('button', { name: 'Submit for Approval' }).click();
  await emp.waitForURL(/\/trips\/\d+$/); await emp.getByText('Submitted').first().waitFor();
  const tripUrl = emp.url();
  // validation error is shown to the user
  await emp.goto(`${S.url}/trips/new`); await emp.getByRole('button', { name: 'Submit for Approval' }).click(); await emp.getByRole('alert').waitFor();
  // manager approves
  const mgr = await newPage(); await signIn(mgr, EMAILS.mgr);
  await mgr.goto(`${S.url}/approvals`); await mgr.getByText('E2E Client Meeting').first().waitFor();
  await mgr.getByRole('row', { name: /E2E Client Meeting/ }).click();
  await mgr.getByRole('button', { name: 'Approve', exact: true }).click(); await mgr.getByText('Approved').first().waitFor();
  await emp.goto(tripUrl); await emp.getByText('Approved').first().waitFor();
  assert.deepEqual(errors, []);
});

test('flight search with policy, booking, then cancellation opens a refund case', opts, async () => {
  const page = await newPage(); await signIn(page, EMAILS.emp);
  await page.goto(`${S.url}/trips?q=00125`); await page.getByRole('link', { name: /BT-\d{4}-00125/ }).first().click(); await page.waitForURL(/\/trips\/\d+$/);
  await page.getByRole('button', { name: 'Search Flights' }).click(); await page.getByText('Available Flights').waitFor();
  await page.getByText('Recommended').first().waitFor();
  await page.getByLabel('Comment').fill('Booking the recommended option'); await page.getByRole('button', { name: /Book Now|Submit for Exception/ }).click();
  await page.locator('.ok, .warn').filter({ hasText: /Flight booked|Submitted for approval|Duplicate/ }).first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.goto(`${S.url}/bookings`); await page.getByText('My Bookings').first().waitFor();
  const row = page.getByRole('row').filter({ hasText: 'Confirmed' }).first(); await row.getByRole('button', { name: 'More actions' }).click(); await page.getByRole('button', { name: 'Cancel booking' }).click();
  await page.getByLabel('Cancellation reason').fill('Plans changed'); await page.getByRole('button', { name: 'Cancel Booking' }).click();
  await page.getByText('Cancelled').first().waitFor();
  await page.goto(`${S.url}/refunds`); await page.getByText('Refund Details').waitFor();
  assert.deepEqual(errors, []);
});

test('expense report: create, add item with allocation, upload receipt, review and submit', opts, async () => {
  const page = await newPage(); await signIn(page, EMAILS.emp);
  await page.goto(`${S.url}/expenses/new`);
  await page.getByLabel('Trip ID').selectOption({ index: 1 });
  await page.getByRole('button', { name: /Next: Add Expense Items/ }).click(); await page.waitForURL(/\/expenses\/\d+\?step=items/);
  await page.getByRole('button', { name: 'Add Expense Manually' }).first().click();
  const dlg = page.getByRole('dialog'); await dlg.getByLabel('Vendor Name').fill('IndiGo'); await dlg.getByLabel('City of Purchase').fill('Mumbai');
  await dlg.getByLabel('Transaction Date').fill(new Date(Date.now() - 86400000).toISOString().slice(0, 10)); await dlg.getByLabel('Amount (Excl. Tax)').fill('12500'); await dlg.getByLabel('Tax Amount').fill('625');
  await dlg.locator('input[type=file]').setInputFiles({ name: 'ticket.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await dlg.getByText('ticket.pdf').waitFor();
  await dlg.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('row', { name: /IndiGo/ }).waitFor();
  await page.getByRole('button', { name: /Next: Review & Submit/ }).click();
  await page.getByText('Gross Claim Amount').waitFor();
  await page.getByRole('button', { name: 'Submit for Approval' }).isDisabled();
  await page.getByLabel(/I certify/).check(); await page.getByRole('button', { name: 'Submit for Approval' }).click();
  await page.getByText('Approval Status').waitFor(); await page.getByText('Submitted').first().waitFor();
  assert.deepEqual(errors, []);
});

test('travel assistant creates a trip only after confirmation', opts, async () => {
  const page = await newPage(); await signIn(page, EMAILS.emp); await page.goto(`${S.url}/assistant`);
  await page.getByLabel('Message').fill('I need to travel to Mumbai next week for a client meeting'); await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('Estimated Cost').waitFor();
  await page.getByRole('button', { name: 'Yes, create the trip request' }).click(); await page.getByText(/Trip ID: BT-/).waitFor();
  assert.deepEqual(errors, []);
});

test('profile: add an address and a payment method; sensitive data is masked', opts, async () => {
  const page = await newPage(); await signIn(page, EMAILS.emp);
  await page.goto(`${S.url}/profile?tab=addr`); await page.getByRole('button', { name: 'Add Address' }).click();
  const d = page.getByRole('dialog'); await d.getByLabel(/^Address \*$/).fill('Plot 9, Test Lane'); await d.getByLabel('City').fill('Pune'); await d.getByLabel('State').fill('Maharashtra'); await d.getByLabel('PIN Code').fill('12'); 
  await d.getByRole('button', { name: 'Save' }).click(); await d.getByRole('alert').waitFor();
  await d.getByLabel('PIN Code').fill('411001'); await d.getByRole('button', { name: 'Save' }).click(); await page.getByText('Plot 9, Test Lane').waitFor();
  await page.goto(`${S.url}/reimbursement-accounts`); assert.match(await page.locator('body').innerText(), /••••/); assert.doesNotMatch(await page.locator('body').innerText(), /50100123451234/);
  await page.getByRole('button', { name: 'Show account number' }).first().click(); await page.getByText('50100123451234').waitFor();
  assert.deepEqual(errors, []);
});

test('manager, travel desk and finance consoles load and act', opts, async () => {
  const desk = await newPage(); await signIn(desk, EMAILS.desk); await desk.goto(`${S.url}/travel-desk`); await desk.getByText('Operations Queue').first().waitFor(); await desk.getByText(/Service Request: SRV/).waitFor();
  await desk.getByRole('button', { name: 'Add Comment' }).click(); await desk.getByRole('dialog').getByLabel('Comment').fill('Checking with supplier'); await desk.getByRole('dialog').getByRole('button', { name: 'Save' }).click(); await desk.getByText('Checking with supplier').waitFor();
  const fin = await newPage(); await signIn(fin, 'karan.mehta@abccorp.com'); await fin.goto(`${S.url}/finance/reimbursements`); await fin.getByText('Reimbursement Tracker').first().waitFor(); await fin.getByText('Payment Actions').waitFor();
  await fin.goto(`${S.url}/finance/reconciliation?tab=exceptions`); await fin.getByText('Exception Details').waitFor();
  const mgr = await newPage(); await signIn(mgr, EMAILS.mgr); await mgr.goto(`${S.url}/team/bookings`); await mgr.getByText('Bookings by Service').waitFor(); await mgr.goto(`${S.url}/readiness`); await mgr.getByText('Readiness Checklist').waitFor();
  assert.deepEqual(errors, []);
});

test('stop browser harness', opts, async () => { await browser.close(); await S.close(); });
