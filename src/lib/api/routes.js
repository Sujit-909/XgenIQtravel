import { route, created, setCookie, cookieOf, jsonResponse } from './router';
import { SESSION_COOKIE, PRE_COOKIE, login, verifyMfa, forgotPassword, verifyResetOtp, resetPassword, register, travellerLookup, travellerVerify } from '../services/auth';
import * as trips from '../services/trips';
import * as svc from '../services/services';
import * as bookings from '../services/bookings';
import * as approvals from '../services/approvals';
import * as expenses from '../services/expenses';
import { buildReportPdf } from '../services/expense-pdf';
import * as fin from '../services/finance';
import * as desk from '../services/desk';
import * as profile from '../services/profile';
import { uploadProfilePhoto, getProfilePhoto, removeProfilePhoto } from '../services/profile-photo';
import * as q from '../services/queries';
import * as policy from '../services/policy';
import * as assistant from '../services/assistant';
import { saveUpload, readFile } from '../services/files';
import { bad, forbidden, notFound, audit } from '../util';
import { canViewTrip } from '../services/trips';

const num = (v) => Number(v);

// ---------- auth ----------
route('POST', '/auth/login', { auth: false }, ({ db, body }) => {
  const { mfaToken, user } = login(db, body);
  return { mfaRequired: true, token: mfaToken, name: user.name, methods: ['totp', 'sms', 'email'], phoneHint: `•••• ${String(user.phone || '').slice(-4)}`, emailHint: user.email.replace(/^(.).*(@.*)$/, '$1•••$2') };
});
route('POST', '/auth/mfa', { auth: false }, ({ db, body }) => {
  const { session, maxAge, user } = verifyMfa(db, body);
  return new Response(JSON.stringify({ ok: true, role: user.role }), { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': setCookie(SESSION_COOKIE, session, { maxAge }) } });
});
route('POST', '/auth/logout', { auth: false }, () => new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'set-cookie': setCookie(SESSION_COOKIE, '', { maxAge: 0 }) } }));
route('GET', '/auth/me', ({ user, db }) => ({ user, unread: profile.unreadCount(db, user), pending: approvals.pendingCount(db, user) }));
route('POST', '/auth/forgot', { auth: false }, ({ db, body }) => forgotPassword(db, body));
route('POST', '/auth/verify-otp', { auth: false }, ({ db, body }) => verifyResetOtp(db, body));
route('POST', '/auth/reset', { auth: false }, ({ db, body }) => resetPassword(db, body));
route('POST', '/auth/register', { auth: false }, ({ db, body }) => created(register(db, body)));
route('POST', '/auth/sso', { auth: false }, () => jsonResponse({ error: 'Company SSO is not configured for this deployment. Sign in with your email and password.' }, 501));
route('POST', '/traveller/lookup', ({ db, user, body }) => travellerLookup(db, user, body));
route('POST', '/traveller/verify', ({ db, user, body }) => travellerVerify(db, user, body));

// ---------- trips ----------
route('GET', '/trips', ({ db, user, query }) => trips.listTrips(db, user, query));
route('POST', '/trips', ({ db, user, body }) => created(trips.createTrip(db, user, body, { submit: !!body.submit })));
route('POST', '/trips/workflow', ({ db, user, body }) => trips.workflowPreview(db, user, body));
route('GET', '/trips/:id', ({ db, user, params }) => trips.getTrip(db, user, num(params.id)));
route('PATCH', '/trips/:id', ({ db, user, params, body }) => trips.updateTrip(db, user, num(params.id), body));
route('POST', '/trips/:id/submit', ({ db, user, params }) => trips.submitTrip(db, user, num(params.id)));
route('POST', '/trips/:id/cancel', ({ db, user, params, body }) => trips.cancelTrip(db, user, num(params.id), body.reason));
route('POST', '/trips/:id/copy', ({ db, user, params }) => created(trips.copyTrip(db, user, num(params.id))));
route('POST', '/trips/:id/close', ({ db, user, params }) => trips.closeTrip(db, user, num(params.id)));
route('GET', '/trips/:id/close-check', ({ db, user, params }) => { trips.loadTrip(db, user, num(params.id)); return { blockers: trips.closeBlockers(db, num(params.id)) }; });
route('POST', '/trips/:id/attachments', async ({ db, user, params, form }) => {
  const t = trips.loadTrip(db, user, num(params.id));
  if (t.created_by !== user.id && t.traveller_id !== user.id) throw forbidden();
  const files = (form?.getAll('files') || []).filter((f) => typeof f === 'object');
  if (!files.length) throw bad('Choose at least one file to upload');
  const out = [];
  for (const f of files) { const r = await saveUpload(db, user, 'trip', t.id, f); out.push({ id: r.id, name: r.name, size: r.size }); }
  return created({ files: out });
});
route('GET', '/trips/:id/services', ({ db, user, params }) => svc.listTripServices(db, user, num(params.id)));
route('POST', '/trips/:id/services', ({ db, user, params, body }) => created(svc.saveService(db, user, num(params.id), body)));
route('POST', '/trips/:id/book', ({ db, user, params, body }) => created(svc.bookPortal(db, user, num(params.id), body)));
route('GET', '/search', ({ db, user, query }) => svc.searchWithPolicy(db, user, query));

// ---------- services / travel desk ----------
route('GET', '/services/:id', ({ db, user, params }) => desk.serviceDetail(db, user, num(params.id)));
route('POST', '/services/:id/respond', ({ db, user, params, body }) => desk.travellerRespond(db, user, num(params.id), body));
route('POST', '/services/:id/attachments', async ({ db, user, params, form }) => {
  const s = db.get('SELECT s.*, t.traveller_id FROM services s JOIN trips t ON t.id=s.trip_id WHERE s.id=?', num(params.id)); if (!s) throw notFound('Service request not found');
  if (s.traveller_id !== user.id && s.created_by !== user.id && !['travel_desk', 'admin'].includes(user.role)) throw forbidden();
  const files = (form?.getAll('files') || []).filter((f) => typeof f === 'object'); if (!files.length) throw bad('Choose at least one file to upload');
  const out = []; for (const f of files) { const r = await saveUpload(db, user, 'service', s.id, f); out.push({ id: r.id, name: r.name }); }
  return created({ files: out });
});
route('GET', '/desk/queue', { roles: ['travel_desk', 'admin'] }, ({ db, user, query }) => desk.listQueue(db, user, query));
route('GET', '/desk/sla', { roles: ['travel_desk', 'admin'] }, ({ db, user }) => desk.slaMonitor(db, user));
route('POST', '/desk/:id/action', { roles: ['travel_desk', 'admin'] }, ({ db, user, params, body }) => desk.deskAction(db, user, num(params.id), body));

// ---------- bookings ----------
route('GET', '/bookings', ({ db, user, query }) => bookings.listBookings(db, user, query));
route('GET', '/bookings/:id', ({ db, user, params }) => bookings.getBooking(db, user, num(params.id)));
route('POST', '/bookings/:id/cancel', ({ db, user, params, body }) => bookings.cancelBooking(db, user, num(params.id), body.reason));
route('POST', '/bookings/:id/change', ({ db, user, params, body }) => created(bookings.requestChange(db, user, num(params.id), body)));
route('POST', '/bookings/:id/claim', ({ db, user, params }) => created(expenses.createReportFromBooking(db, user, num(params.id))));

// ---------- approvals ----------
route('GET', '/approvals', ({ db, user, query }) => approvals.listApprovals(db, user, query));
route('GET', '/approvals/:id', ({ db, user, params }) => approvals.approvalDetail(db, user, num(params.id)));
route('POST', '/approvals/:id/decision', ({ db, user, params, body }) => approvals.decide(db, user, num(params.id), body));

// ---------- expenses ----------
route('GET', '/expenses', ({ db, user, query }) => expenses.listReports(db, user, query));
route('POST', '/expenses', ({ db, user, body }) => created(expenses.createReport(db, user, body)));
route('GET', '/expenses/:id', ({ db, user, params }) => expenses.getReport(db, user, num(params.id)));
route('PATCH', '/expenses/:id', ({ db, user, params, body }) => expenses.updateReport(db, user, num(params.id), body));
route('POST', '/expenses/:id/items', ({ db, user, params, body }) => created(expenses.addItem(db, user, num(params.id), body)));
route('PATCH', '/expenses/:id/items/:itemId', ({ db, user, params, body }) => expenses.updateItem(db, user, num(params.id), num(params.itemId), body));
route('POST', '/expenses/:id/items/delete', ({ db, user, params, body }) => expenses.deleteItems(db, user, num(params.id), (body.ids || []).map(Number)));
route('POST', '/expenses/:id/receipts', async ({ db, user, params, form }) => {
  const rep = expenses.getReport(db, user, num(params.id)); if (!rep.can.edit) throw forbidden('This report cannot be changed');
  const files = (form?.getAll('files') || []).filter((f) => typeof f === 'object'); if (!files.length) throw bad('Choose at least one receipt to upload');
  if (files.length > 20) throw bad('Upload at most 20 receipts at a time');
  const uploaded = []; for (const f of files) uploaded.push(await saveUpload(db, user, 'expense', num(params.id), f, ['pdf', 'jpg', 'jpeg', 'png']));
  if (form.get('mode') === 'extract') return created(expenses.createItemsFromReceipts(db, user, num(params.id), uploaded));
  return created({ files: uploaded.map(({ buffer, ...f }) => f) });
});
route('POST', '/expenses/:id/submit', ({ db, user, params, body }) => expenses.submitReport(db, user, num(params.id), body));
route('GET', '/expenses/:id/pdf', async ({ db, user, params }) => {
  const bytes = await buildReportPdf(db, user, num(params.id));
  return new Response(bytes, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="expense-report-${params.id}.pdf"`, 'cache-control': 'no-store' } });
});
route('GET', '/files/:id', ({ db, user, params }) => {
  const { file, data } = readFile(db, user, num(params.id), (f) => {
    if (f.uploaded_by === user.id || ['admin', 'finance', 'travel_desk'].includes(user.role)) return true;
    if (f.entity_type === 'trip') { const t = db.get('SELECT * FROM trips WHERE id=?', f.entity_id); return !!t && canViewTrip(db, user, t); }
    if (f.entity_type === 'expense') { try { expenses.getReport(db, user, f.entity_id); return true; } catch { return false; } }
    return false;
  });
  audit(db, user, 'file.download', file.entity_type, file.entity_id, file.name);
  return new Response(data, { headers: { 'content-type': file.mime || 'application/octet-stream', 'content-disposition': `attachment; filename="${file.name.replace(/"/g, '')}"`, 'x-content-type-options': 'nosniff' } });
});

// ---------- finance ----------
route('GET', '/reimbursements', { roles: ['finance', 'admin'] }, ({ db, user, query }) => fin.listReimbursements(db, user, query));
route('POST', '/reimbursements/batch', { roles: ['finance', 'admin'] }, ({ db, user, body }) => fin.createPaymentBatch(db, user, (body.report_ids || []).map(Number)));
route('GET', '/reimbursements/:id', { roles: ['finance', 'admin'] }, ({ db, user, params }) => fin.reimbursementDetail(db, user, num(params.id)));
route('POST', '/reimbursements/:id/action', { roles: ['finance', 'admin'] }, ({ db, user, params, body }) => fin.reimbursementAction(db, user, num(params.id), body));
route('GET', '/refunds', ({ db, user, query }) => fin.listRefunds(db, user, query));
route('GET', '/refunds/:id', ({ db, user, params }) => fin.refundDetail(db, user, num(params.id)));
route('POST', '/refunds/:id/action', { roles: ['finance', 'admin', 'travel_desk'] }, ({ db, user, params, body }) => fin.refundAction(db, user, num(params.id), body));
route('GET', '/reconciliation', { roles: ['finance', 'admin'] }, ({ db, user, query }) => fin.reconciliation(db, user, query));
route('GET', '/reconciliation/:id', { roles: ['finance', 'admin'] }, ({ db, user, params }) => fin.reconciliationDetail(db, user, num(params.id)));
route('POST', '/reconciliation/:id/action', { roles: ['finance', 'admin'] }, ({ db, user, params, body }) => fin.reconciliationAction(db, user, num(params.id), body));

// ---------- profile ----------
route('POST', '/profile/photo', async ({ db, user, form }) => uploadProfilePhoto(db, user, form?.get('photo')));
route('DELETE', '/profile/photo', ({ db, user }) => removeProfilePhoto(db, user));
route('GET', '/profile/photo', ({ db, user }) => {
  const { file, data } = getProfilePhoto(db, user);
  return new Response(data, { headers: { 'content-type': file.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
});
route('GET', '/profile', ({ db, user }) => profile.profileBundle(db, user));
route('PATCH', '/profile/personal', ({ db, user, body }) => { profile.updatePersonal(db, user, body); return profile.profileBundle(db, user).user; });
route('GET', '/profile/preferences', ({ db, user }) => profile.getPreferences(db, user.id));
route('PUT', '/profile/preferences', ({ db, user, body }) => profile.savePreferences(db, user, body));
route('GET', '/profile/notification-settings', ({ db, user }) => profile.getNotifSettings(db, user.id));
route('PUT', '/profile/notification-settings', ({ db, user, body }) => profile.saveNotifSettings(db, user, body));
route('POST', '/profile/bank-accounts/:id/reveal', ({ db, user, params }) => profile.revealBankAccount(db, user, num(params.id)));
route('POST', '/profile/bank-accounts/:id/verify', { roles: ['finance', 'admin'] }, ({ db, user, params }) => profile.verifyBankAccount(db, user, num(params.id)));
const entityOk = (e) => { if (!profile.PROFILE_ENTITIES.includes(e)) throw notFound('Unknown profile section'); return e; };
route('GET', '/profile/:entity', ({ db, user, params }) => profile.listEntity(db, user, entityOk(params.entity)));
route('POST', '/profile/:entity', ({ db, user, params, body }) => created(profile.createEntity(db, user, entityOk(params.entity), body)));
route('PATCH', '/profile/:entity/:id', ({ db, user, params, body }) => profile.updateEntity(db, user, entityOk(params.entity), num(params.id), body));
route('DELETE', '/profile/:entity/:id', ({ db, user, params }) => profile.deleteEntity(db, user, entityOk(params.entity), num(params.id)));
route('GET', '/notifications', ({ db, user, query }) => profile.listNotifications(db, user, query.category));
route('POST', '/notifications/read', ({ db, user, body }) => profile.markRead(db, user, body.id));

// ---------- dashboards, analytics, admin ----------
route('GET', '/dashboard', ({ db, user }) => q.dashboard(db, user));
route('GET', '/readiness', { roles: ['manager', 'admin', 'travel_desk'] }, ({ db, user, query }) => q.readiness(db, user, query));
route('GET', '/team/compliance', { roles: ['manager', 'admin', 'travel_desk'] }, ({ db, user, query }) => q.teamCompliance(db, user, query));
route('POST', '/team/remind', { roles: ['manager', 'admin', 'travel_desk'] }, ({ db, user, body }) => q.remindEmployee(db, user, num(body.user_id), body.doc_type || 'travel document'));
route('GET', '/team/bookings', { roles: ['manager', 'admin', 'travel_desk', 'finance'] }, ({ db, user, query }) => q.teamBookingAnalytics(db, user, query));
route('GET', '/reports/:type', { roles: ['manager', 'admin', 'travel_desk', 'finance'] }, ({ db, user, params, query }) => {
  const r = q.report(db, user, params.type);
  if (query.format === 'csv') return new Response(q.reportCsv(r), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${params.type}.csv"` } });
  return r;
});
route('GET', '/audit', { roles: ['admin'] }, ({ db, user, query }) => q.auditLog(db, user, query));
route('GET', '/master', ({ db, user, query }) => q.masterList(db, user, query.kind));
route('POST', '/master', { roles: ['admin'] }, ({ db, user, body }) => created(q.masterSave(db, user, body)));
route('PATCH', '/master/:id', { roles: ['admin'] }, ({ db, user, params, body }) => q.masterSave(db, user, body, num(params.id)));
route('GET', '/users', { roles: ['admin'] }, ({ db, user }) => q.usersList(db, user));
route('PATCH', '/users/:id', { roles: ['admin'] }, ({ db, user, params, body }) => q.userUpdate(db, user, num(params.id), body));
route('GET', '/integrations', { roles: ['admin'] }, ({ db, user }) => q.integrations(db, user));
route('GET', '/policy', ({ db }) => policy.listPolicy(db));
route('POST', '/policy', { roles: ['admin'] }, ({ db, user, body }) => created(policy.savePolicyRule(db, user, null, body)));
route('PATCH', '/policy/:id', { roles: ['admin'] }, ({ db, user, params, body }) => policy.savePolicyRule(db, user, num(params.id), body));
route('POST', '/policy/test', { roles: ['admin'] }, ({ db, body }) => policy.testPolicy(db, body));

// ---------- assistant ----------
route('GET', '/assistant', ({ db, user }) => ({ messages: assistant.history(db, user) }));
route('POST', '/assistant', ({ db, user, body }) => ({ messages: assistant.chat(db, user, body.message) }));
export const cookieHelpers = { cookieOf, PRE_COOKIE };
