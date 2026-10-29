import test from 'node:test';
import assert from 'node:assert/strict';
import { api, fresh, d } from './helpers';
import { REPORTS } from '@/lib/services/queries';

test('assistant: draft requires explicit confirmation, then creates a submitted trip', async () => {
  fresh();
  const say = async (m) => (await api('emp', 'POST', '/assistant', { message: m })).data.messages.at(-1);
  let r = await say('I need to travel to Mumbai next week for a client meeting');
  assert.equal(r.card.type, 'trip_draft'); assert.equal(r.card.to, 'Mumbai'); assert.ok(r.card.estimate > 0);
  const before = (await api('emp', 'GET', '/trips')).data.total;
  assert.equal((await api('emp', 'GET', '/trips')).data.total, before, 'nothing created before confirmation');
  r = await say('Yes, please create it'); assert.equal(r.card.type, 'trip_created'); assert.equal(r.card.status, 'Submitted');
  assert.equal((await api('emp', 'GET', '/trips')).data.total, before + 1);
  r = await say('I need to travel to Delhi from 12 Nov to 14 Nov'); assert.equal(r.card.dep.slice(5), '11-12');
  r = await say('no'); assert.match(r.text, /discarded/);
  r = await say('I attended the client meeting and want to raise reimbursement'); assert.ok(r.actions?.[0]?.href.startsWith('/expenses/new'));
  r = await say('show my upcoming trips'); assert.equal(r.card.type, 'list');
  r = await say('what is the hotel policy'); assert.ok(r.card.items.length);
  assert.match((await say('cancel my flight')).text, /do not cancel bookings from chat/);
  assert.ok((await api('emp', 'GET', '/assistant')).data.messages.length > 8);
});

test('reconciliation, policy administration and policy test', async () => {
  fresh();
  const rc = (await api('fin', 'GET', '/reconciliation?size=100')).data; const kinds = new Set(rc.rows.map((r) => r.match));
  for (const k of ['Matched', 'Amount Mismatch', 'Missing Invoice']) assert.ok(kinds.has(k), `${k} present`);
  assert.ok(rc.kpis.bookings.count > 10);
  const miss = rc.rows.find((r) => r.match === 'Missing Invoice');
  assert.equal((await api('fin', 'POST', `/reconciliation/${miss.booking_id}/action`, { action: 'resolve', note: 'x' })).status, 409, 'cannot resolve without invoice');
  const mm = rc.rows.find((r) => r.match === 'Amount Mismatch');
  assert.equal((await api('fin', 'POST', `/reconciliation/${mm.booking_id}/action`, { action: 'resolve' })).status, 400, 'note required');
  assert.equal((await api('fin', 'POST', `/reconciliation/${mm.booking_id}/action`, { action: 'resolve', note: 'Supplier credit note received' })).status, 200);
  assert.equal((await api('fin', 'GET', `/reconciliation/${mm.booking_id}`)).data.row.match, 'Matched');
  // policy
  const pol = (await api('emp', 'GET', '/policy')).data; assert.equal(pol.kpis.total, 12);
  assert.equal((await api('admin', 'POST', '/policy', { name: 'X', type: 'Flight', conditions: '{bad' })).status, 400);
  const r1 = pol.rules.find((r) => r.rule_no === 'PR001');
  const upd = await api('admin', 'PATCH', `/policy/${r1.id}`, { ...r1, conditions: { ...r1.conditions, maxFare: 12000 }, effective_from: '2024-01-01' });
  assert.equal(upd.data.version, r1.version + 1);
  const t = await api('admin', 'POST', '/policy/test', { fromCity: 'Bhubaneswar', toCity: 'Delhi', departDate: d(20), travelType: 'Domestic', fare: 14000, cabin: 'Economy' });
  assert.equal(t.data.status, 'Out of Policy', 'new lower fare limit is enforced immediately');
  const nr = await api('admin', 'POST', '/policy', { name: 'New rule', type: 'Flight', effective_from: '2026-01-01', conditions: { travelType: 'Domestic', maxFare: 9000 } });
  assert.equal(nr.status, 201); assert.match(nr.data.rule_no, /^PR013$/);
});

test('readiness, compliance, team analytics, every report and every role dashboard', async () => {
  fresh();
  const rd = (await api('mgr', 'GET', '/readiness')).data; assert.ok(rd.rows.length > 0); assert.ok(rd.rows[0].checklist.length === 6);
  assert.ok(['Ready', 'At Risk', 'Not Ready'].includes(rd.rows[0].readiness));
  const co = (await api('mgr', 'GET', '/team/compliance?doc=Passport')).data; assert.ok(co.kpis.total >= 8); assert.ok(co.rows.every((r) => r.doc_number === '-' || r.doc_number.includes('*')), 'passport numbers masked');
  assert.ok(co.kpis.expired >= 1 && co.kpis.soon >= 1);
  assert.equal((await api('mgr', 'POST', '/team/remind', { user_id: 1, doc_type: 'Passport' })).status, 403, 'only for own team');
  assert.equal((await api('mgr', 'POST', '/team/remind', { user_id: 4, doc_type: 'Passport' })).status, 200);
  const tb = (await api('mgr', 'GET', '/team/bookings')).data; assert.ok(tb.kpis.total > 0); assert.ok(tb.byService.length);
  for (const k of Object.keys(REPORTS)) { const r = await api('fin', 'GET', `/reports/${k}`); assert.equal(r.status, 200, k); assert.ok(r.data.columns.length, k); }
  assert.equal((await api('fin', 'GET', '/reports/nope')).status, 404);
  for (const who of ['emp', 'mgr', 'desk', 'fin', 'admin']) { const r = await api(who, 'GET', '/dashboard'); assert.equal(r.status, 200, who); assert.ok(r.data.kpis, who); }
  const ed = (await api('emp', 'GET', '/dashboard')).data.kpis; assert.equal(ed.expired, 1); assert.equal(ed.expiringSoon, 1); assert.equal(ed.waiting, 2);
  const sla = (await api('desk', 'GET', '/desk/sla')).data; assert.ok(sla.suppliers.length);
  assert.ok((await api('admin', 'GET', '/integrations')).data.length >= 5);
  assert.equal((await api('admin', 'GET', '/users')).data.length, 16);
  assert.equal((await api('admin', 'POST', '/master', { kind: 'cost_center', code: 'CC1001', name: 'dup' })).status, 409);
  assert.equal((await api('admin', 'POST', '/master', { kind: 'cost_center', code: 'CC9001', name: 'New CC' })).status, 201);
  const aud = (await api('admin', 'GET', '/audit')).data; assert.ok(aud.total > 0);
  assert.equal((await api('emp', 'POST', '/auth/sso')).status, 501);
});
