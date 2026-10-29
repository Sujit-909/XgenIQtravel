import test from 'node:test';
import assert from 'node:assert/strict';
import { api, raw, fresh, tripBody, d, login, EMAILS, PASSWORD, formWith } from './helpers';

test('setup', () => { fresh(); });

test('authentication: password, MFA, session, lockout, reset', async () => {
  assert.equal((await api(null, 'GET', '/trips')).status, 401, 'unauthenticated blocked');
  const bad = await raw('POST', '/auth/login', { body: { identifier: EMAILS.emp, password: 'nope' } });
  assert.equal(bad.status, 401);
  const ok = await (await raw('POST', '/auth/login', { body: { identifier: '+91 9876543210', password: PASSWORD } })).json();
  assert.ok(ok.mfaRequired && ok.token, 'mobile number sign-in works');
  assert.equal((await raw('POST', '/auth/mfa', { body: { token: ok.token, code: '000000' } })).status, 401);
  const good = await raw('POST', '/auth/mfa', { body: { token: ok.token, code: '246810' } });
  assert.equal(good.status, 200);
  assert.match(good.headers.get('set-cookie'), /HttpOnly/);
  const me = await api('emp', 'GET', '/auth/me');
  assert.equal(me.data.user.name, 'Rabindra Shau');
  // forgot password gives the same answer for unknown accounts
  const f1 = await (await raw('POST', '/auth/forgot', { body: { identifier: 'nobody@abccorp.com' } })).json();
  const f2 = await (await raw('POST', '/auth/forgot', { body: { identifier: EMAILS.emp } })).json();
  assert.deepEqual(f1, f2);
  const v = await (await raw('POST', '/auth/verify-otp', { body: { identifier: EMAILS.emp, code: '246810' } })).json();
  assert.ok(v.resetToken);
  assert.equal((await raw('POST', '/auth/reset', { body: { token: v.resetToken, password: 'weak' } })).status, 400);
  assert.equal((await raw('POST', '/auth/reset', { body: { token: v.resetToken, password: 'NewPass@123' } })).status, 200);
  const re = await (await raw('POST', '/auth/login', { body: { identifier: EMAILS.emp, password: 'NewPass@123' } })).json();
  assert.ok(re.mfaRequired);
  await raw('POST', '/auth/reset', { body: { token: v.resetToken, password: PASSWORD } }); // restore for other tests
  // cross-origin mutation is blocked
  const x = await raw('POST', '/auth/logout', { headers: { origin: 'https://evil.example' } });
  assert.equal(x.status, 403);
});

test('trip validation and draft / submit lifecycle', async () => {
  fresh();
  const bad1 = await api('emp', 'POST', '/trips', tripBody({ ret_date: d(10) }));
  assert.equal(bad1.status, 400); assert.match(bad1.data.error, /Return date/);
  assert.equal((await api('emp', 'POST', '/trips', tripBody({ cost_object: 'CC9999 - Nope' }))).status, 400);
  assert.equal((await api('emp', 'POST', '/trips', tripBody({ advance_needed: true, advance_amount: 90000, est_budget: 120000 }))).status, 400, 'advance above policy max');
  assert.equal((await api('emp', 'POST', '/trips', tripBody({ travel_type: 'Domestic', dest_country: 'Singapore' }))).status, 400, 'domestic with foreign destination');
  assert.equal((await api('emp', 'POST', '/trips', tripBody({ dep_date: d(-3), ret_date: d(-1) }))).status, 400, 'past departure');
  const draft = await api('emp', 'POST', '/trips', tripBody());
  assert.equal(draft.status, 201); assert.equal(draft.data.status, 'Draft'); assert.match(draft.data.trip_no, /^BT-\d{4}-\d{5}$/);
  const id = draft.data.id;
  // only the owner sees it
  assert.equal((await api('mgr', 'GET', `/trips/${id}`)).status, 200, 'manager of the traveller can view');
  assert.equal((await api('head', 'GET', `/trips/${id}`)).status, 200, 'dept head above manager can view team trips');
  const other = await api('owner', 'GET', `/trips/${id}`);
  assert.equal(other.status, 403, 'unrelated manager cannot view');
  const sub = await api('emp', 'POST', `/trips/${id}/submit`);
  assert.equal(sub.status, 200); assert.equal(sub.data.status, 'Submitted');
  assert.equal((await api('emp', 'POST', `/trips/${id}/submit`)).status, 409, 'cannot submit twice');
  assert.equal((await api('emp', 'PATCH', `/trips/${id}`, { title: 'x' })).status, 409, 'cannot edit submitted trip');
  const g = await api('emp', 'GET', `/trips/${id}`);
  assert.equal(g.data.approvals.length, 1); assert.equal(g.data.approvals[0].approver_name, 'Amit Singh');
  // approvals
  const ap = await api('mgr', 'GET', '/approvals?type=trip&status=Pending');
  const mine = ap.data.rows.find((r) => r.entity_id === id); assert.ok(mine, 'manager sees pending approval');
  assert.equal((await api('emp', 'POST', `/approvals/${mine.approval_id}/decision`, { decision: 'approve' })).status, 403, 'requester cannot approve own trip');
  assert.equal((await api('owner', 'POST', `/approvals/${mine.approval_id}/decision`, { decision: 'approve' })).status, 403, 'wrong approver blocked');
  assert.equal((await api('mgr', 'POST', `/approvals/${mine.approval_id}/decision`, { decision: 'reject' })).status, 400, 'rejection needs a reason');
  assert.equal((await api('mgr', 'POST', `/approvals/${mine.approval_id}/decision`, { decision: 'approve' })).status, 200);
  assert.equal((await api('emp', 'GET', `/trips/${id}`)).data.trip.status, 'Approved');
  assert.equal((await api('mgr', 'POST', `/approvals/${mine.approval_id}/decision`, { decision: 'approve' })).status, 409, 'cannot decide twice');
});

test('workflow routing: international, threshold, project, emergency, info request, reject', async () => {
  fresh();
  const wf = async (o) => (await api('emp', 'POST', '/trips/workflow', tripBody(o))).data;
  assert.equal((await wf({})).kind, 'standard');
  const intl = await wf({ travel_type: 'International', dest_country: 'Singapore', dest_city: 'Singapore' });
  assert.equal(intl.kind, 'international'); assert.deepEqual(intl.steps.map((s) => s.approverName), ['Amit Singh', 'Arvind Kapoor', 'Karan Mehta']);
  const thr = await wf({ est_budget: 150000 }); assert.equal(thr.kind, 'threshold');
  const proj = await wf({ cost_object_type: 'Project', cost_object: 'PRJ1001 - Digital Transformation' }); assert.equal(proj.kind, 'project');
  assert.deepEqual(proj.steps.map((s) => s.approverName), ['Amit Singh', 'Meera Iyer']);
  const em = await wf({ emergency: true, emergency_justification: 'Outage' }); assert.equal(em.kind, 'emergency');
  assert.equal((await api('emp', 'POST', '/trips', tripBody({ emergency: true }), undefined)).status, 400, 'emergency needs justification');
  // multi-level project trip end to end with info request
  const t = (await api('emp', 'POST', '/trips', tripBody({ cost_object_type: 'Project', cost_object: 'PRJ1001 - Digital Transformation' }))).data;
  await api('emp', 'POST', `/trips/${t.id}/submit`);
  const first = (await api('mgr', 'GET', '/approvals?type=trip')).data.rows.find((r) => r.entity_id === t.id);
  assert.equal((await api('mgr', 'POST', `/approvals/${first.approval_id}/decision`, { decision: 'info', comment: 'Attach the invite' })).status, 200);
  assert.equal((await api('emp', 'GET', `/trips/${t.id}`)).data.trip.status, 'Pending for Review');
  assert.equal((await api('emp', 'POST', `/trips/${t.id}/submit`)).data.status, 'Submitted');
  await api('mgr', 'POST', `/approvals/${first.approval_id}/decision`, { decision: 'approve' });
  assert.equal((await api('emp', 'GET', `/trips/${t.id}`)).data.trip.status, 'Under Approval');
  const second = (await api('owner', 'GET', '/approvals?type=trip')).data.rows.find((r) => r.entity_id === t.id);
  assert.ok(second, 'level 2 approver now sees it');
  await api('owner', 'POST', `/approvals/${second.approval_id}/decision`, { decision: 'reject', comment: 'No budget' });
  assert.equal((await api('emp', 'GET', `/trips/${t.id}`)).data.trip.status, 'Rejected');
});

test('trip on behalf of a colleague requires verified consent', async () => {
  fresh();
  assert.equal((await api('emp', 'POST', '/trips', tripBody({ created_for_type: 'Colleague', traveller_id: 8 }))).status, 403, 'no consent token');
  const lk = await api('emp', 'POST', '/traveller/lookup', { identifier: 'rahul.mehta@abccorp.com' });
  assert.equal(lk.status, 200);
  assert.equal((await api('emp', 'POST', '/traveller/verify', { traveller_id: lk.data.traveller_id, code: '111111' })).status, 400);
  const v = await api('emp', 'POST', '/traveller/verify', { traveller_id: lk.data.traveller_id, code: '246810' });
  assert.equal(v.data.traveller.name, 'Rahul Mehta');
  const t = await api('emp', 'POST', '/trips', tripBody({ created_for_type: 'Colleague', traveller_token: v.data.token, traveller_id: lk.data.traveller_id, department: 'IT' }));
  assert.equal(t.status, 201); assert.equal(t.data.traveller_name, 'Rahul Mehta'); assert.equal(t.data.creator_name, 'Rabindra Shau');
  assert.equal((await api('emp', 'POST', '/trips', tripBody({ created_for_type: 'Agency' }))).status, 403, 'employee cannot create agency trips');
  // another user cannot reuse the token
  assert.equal((await api('mgr', 'POST', '/trips', tripBody({ created_for_type: 'Colleague', traveller_token: v.data.token }))).status, 403);
});

test('trip cancel, copy, close rules and attachments', async () => {
  fresh();
  const t = (await api('emp', 'POST', '/trips', tripBody(), undefined)).data;
  const up = await api('emp', 'POST', `/trips/${t.id}/attachments`, undefined, formWith([['agenda.pdf', 'hello']]));
  assert.equal(up.status, 201);
  assert.equal((await api('emp', 'POST', `/trips/${t.id}/attachments`, undefined, formWith([['malware.exe', 'x']]))).status, 400, 'bad file type');
  const copy = await api('emp', 'POST', `/trips/${t.id}/copy`); assert.equal(copy.status, 201); assert.match(copy.data.title, /copy/);
  assert.equal((await api('emp', 'POST', `/trips/${t.id}/cancel`, {})).status, 400, 'reason required');
  assert.equal((await api('emp', 'POST', `/trips/${t.id}/cancel`, { reason: 'Meeting postponed' })).data.status, 'Cancelled');
  assert.equal((await api('emp', 'POST', `/trips/${t.id}/cancel`, { reason: 'again' })).status, 409);
  // closing an approved, unfinished trip is blocked with reasons
  const seeded = (await api('emp', 'GET', '/trips?q=Client%20Meeting%20-%20Mumbai')).data.rows.find((r) => r.status === 'Booking In Progress');
  const close = await api('emp', 'POST', `/trips/${seeded.id}/close`); assert.equal(close.status, 409); assert.ok(close.data.blockers.length);
});
