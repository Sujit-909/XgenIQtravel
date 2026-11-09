import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { fresh, EMAILS, api, raw, login } from './helpers';
import { employeeChat } from '@/lib/services/assistant';
import { fetchGemini, parseGeminiResponse } from '@/lib/providers/gemini';
import { cleanAssistantMessage, containsCredentials, assistantLink } from '@/lib/assistant-safety';
import AssistantMarkdown from '@/components/AssistantMarkdown';
import { AssistantView } from '@/views/assistant';
import { POST } from '@/app/api/employee-assistant/chat/route';

const SESSION = 'test-authenticated-session-cookie-value-1';
const question = (message = 'How can I troubleshoot unstable Wi-Fi?') => ({ message, scope: 'general', request_id: randomUUID() });
const response = (token = 'private-provider-token-one') => ({ reconstructed_markdown: '## Troubleshooting\n\n1. Restart the router.\n2. Check the connection.\n\n| Step | Purpose |\n| --- | --- |\n| Restart | Reconnect |\n\n```sh\nping example.com\n```', references: [{ index: 0, title: 'Public source', link: 'https://example.com/help' }, { title: 'Unsafe', link: 'javascript:alert(1)' }, { title: 'Provider link', link: 'https://serpapi.com/search.json?api_key=secret' }], related_questions: [{ question: 'How can I test signal strength?', serpapi_link: 'https://serpapi.com/private-token' }], subsequent_request_token: token });
function setup() { const db = fresh(); const user = db.get('SELECT * FROM users WHERE email=?', EMAILS.emp); return { db, user }; }
async function provider(responses, fn) {
  const oldFetch = global.fetch; const oldKey = process.env.SERPAPI_API_KEY; const calls = [];
  process.env.SERPAPI_API_KEY = 'server-only-gemini-test-key';
  global.fetch = async (url) => { calls.push(new URL(url)); const value = responses.shift(); if (value instanceof Error) throw value; return value instanceof Response ? value : new Response(JSON.stringify(value ?? response())); };
  try { await fn(calls); } finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.SERPAPI_API_KEY; else process.env.SERPAPI_API_KEY = oldKey; }
}

test('Gemini first and follow-up questions keep encrypted tokens bound to employee and session', async () => {
  const { db, user } = setup();
  await provider([response(), response('private-provider-token-two')], async (calls) => {
    const first = await employeeChat(db, user, SESSION, question());
    assert.equal(first.answer_kind, 'general'); assert.equal(first.references.length, 1); assert.equal(first.related_questions.length, 1);
    assert.equal(calls[0].hostname, 'serpapi.com'); assert.equal(calls[0].searchParams.get('engine'), 'google_gemini'); assert.equal(calls[0].searchParams.get('output'), 'json'); assert.equal(calls[0].searchParams.has('subsequent_request_token'), false);
    assert.ok(calls[0].searchParams.get('q').includes('troubleshoot unstable Wi-Fi'));
    assert.equal(calls[0].searchParams.get('no_cache'), 'true', 'Provider conversations cannot be shared through query caching');
    assert.ok(!calls[0].searchParams.get('q').includes(user.email)); assert.ok(!calls[0].searchParams.get('q').includes(user.name));
    assert.doesNotMatch(JSON.stringify(first), /private-provider-token|server-only-gemini-test-key|serpapi_link|api_key/);
    const stored = db.get('SELECT * FROM employee_assistant_conversations WHERE id=?', first.conversation_token);
    assert.notEqual(stored.encrypted_token, 'private-provider-token-one'); assert.notEqual(stored.session_hash, SESSION);
    const second = await employeeChat(db, user, SESSION, { ...question('Turn that into a checklist.'), conversation_token: first.conversation_token });
    assert.equal(calls[1].searchParams.get('subsequent_request_token'), 'private-provider-token-one'); assert.equal(second.conversation_token, first.conversation_token);
    await assert.rejects(() => employeeChat(db, user, SESSION + '-different-browser', { ...question(), conversation_token: first.conversation_token }), (e) => e.status === 404);
    const other = db.get('SELECT * FROM users WHERE id!=? LIMIT 1', user.id);
    await assert.rejects(() => employeeChat(db, other, SESSION, { ...question(), conversation_token: first.conversation_token }), (e) => e.status === 404);
    assert.equal(calls.length, 2); assert.equal(db.get('SELECT COUNT(*) c FROM assistant_messages').c, 0);
  });
});

test('new conversations clear context and expired continuations restart without old tokens', async () => {
  const { db, user } = setup();
  await provider([response(), new Response('{}', { status: 400 }), response('new-after-expiry'), response('new-chat'), response('expired-local')], async (calls) => {
    const first = await employeeChat(db, user, SESSION, question());
    const follow = await employeeChat(db, user, SESSION, { ...question('Explain the first step.'), conversation_token: first.conversation_token });
    assert.equal(follow.conversation_reset, true); assert.equal(calls[1].searchParams.get('subsequent_request_token'), 'private-provider-token-one'); assert.equal(calls[2].searchParams.has('subsequent_request_token'), false);
    const cleared = await employeeChat(db, user, SESSION, { action: 'new_conversation', request_id: randomUUID() });
    assert.notEqual(cleared.conversation_token, first.conversation_token); assert.equal(calls.length, 3);
    await assert.rejects(() => employeeChat(db, user, SESSION, { ...question(), conversation_token: first.conversation_token }), (e) => e.status === 404);
    await employeeChat(db, user, SESSION, { ...question('Draft a generic meeting agenda.'), conversation_token: cleared.conversation_token });
    assert.equal(calls[3].searchParams.has('subsequent_request_token'), false);
    db.run("UPDATE employee_assistant_conversations SET expires_at='2000-01-01' WHERE id=?", cleared.conversation_token);
    const expired = await employeeChat(db, user, SESSION, { ...question(), conversation_token: cleared.conversation_token });
    assert.equal(expired.conversation_reset, true); assert.notEqual(expired.conversation_token, cleared.conversation_token); assert.equal(calls[4].searchParams.has('subsequent_request_token'), false);
  });
});

test('requests are idempotent and provider errors never leak credentials or internal details', async () => {
  const { db, user } = setup();
  await provider([response(), { error: 'Internal URL with api_key=secret-value' }, new DOMException('timeout', 'TimeoutError')], async (calls) => {
    const input = question(); const [a, b] = await Promise.all([employeeChat(db, user, SESSION, input), employeeChat(db, user, SESSION, input)]);
    assert.deepEqual(a, b); assert.deepEqual(await employeeChat(db, user, SESSION, input), a); assert.equal(calls.length, 1);
    await assert.rejects(() => employeeChat(db, user, SESSION, { ...input, message: 'A different question' }), (e) => e.status === 409);
    await assert.rejects(() => fetchGemini('Public question'), (e) => e.status === 502 && !/secret-value|api_key|Internal URL/.test(e.message));
    await assert.rejects(() => fetchGemini('Public question'), (e) => e.status === 504);
    await assert.rejects(() => fetchGemini('Public question', null, { fetcher: async () => new Response('{}', { status: 429 }) }), (e) => e.status === 429);
    await assert.rejects(() => fetchGemini('Public question', null, { fetcher: async () => new Response('bad json') }), (e) => e.status === 502);
    assert.throws(() => parseGeminiResponse({}), (e) => e.status === 502);
  });
});

test('company data is answered locally, scoped to the employee, and never sent upstream', async () => {
  const { db, user } = setup();
  await provider([], async (calls) => {
    const own = await employeeChat(db, user, SESSION, { ...question('Show my travel requests'), scope: 'auto' });
    assert.equal(own.answer_kind, 'internal');
    const records = db.all('SELECT trip_no FROM trips WHERE traveller_id=? ORDER BY dep_date DESC LIMIT 10', user.id);
    for (const record of records) assert.ok(own.answer.includes(record.trip_no));
    const privateTrip = db.get('SELECT trip_no FROM trips WHERE traveller_id!=? LIMIT 1', user.id); assert.ok(!own.answer.includes(privateTrip.trip_no));
    const pay = await employeeChat(db, user, SESSION, { ...question('Show my reimbursement status'), scope: 'auto' }); assert.equal(pay.answer_kind, 'internal');
    const policy = await employeeChat(db, user, SESSION, { ...question('What is our hotel policy?'), scope: 'auto' }); assert.equal(policy.references[0].url, '/policy');
    const leave = await employeeChat(db, user, SESSION, { ...question('How much annual leave does our company provide?'), scope: 'auto' }); assert.match(leave.answer, /No approved HR or leave documents/);
    const other = await employeeChat(db, user, SESSION, { ...question('Show Alice employee records'), scope: 'auto' }); assert.equal(other.answer_kind, 'internal');
    const sensitive = await employeeChat(db, user, SESSION, question('Review this confidential customer list')); assert.equal(sensitive.answer_kind, 'private');
    const pii = await employeeChat(db, user, SESSION, question('Write to person@example.com about the meeting')); assert.equal(pii.answer_kind, 'private');
    assert.equal(calls.length, 0);
  });
});

test('the assistant cannot execute transactions or carry private context into Gemini', async () => {
  const { db, user } = setup();
  const count = () => ['trips', 'bookings', 'expense_reports', 'approvals'].map((name) => db.get(`SELECT COUNT(*) c FROM ${name}`).c);
  const before = count();
  await provider([response()], async (calls) => {
    for (const message of ['Create a trip request for Mumbai', 'Approve my expense report', 'Pay my reimbursement', 'Cancel my booking', 'Submit my leave request']) {
      const result = await employeeChat(db, user, SESSION, question(message)); assert.equal(result.answer_kind, message.startsWith('Create a trip') ? 'travel' : 'workflow');
    }
    assert.deepEqual(count(), before); assert.equal(calls.length, 0);
    const local = await employeeChat(db, user, SESSION, { ...question('Show my reimbursement status'), scope: 'auto' });
    await employeeChat(db, user, SESSION, { ...question('What about its payment?'), scope: 'auto', conversation_token: local.conversation_token });
    assert.equal(calls.length, 0);
    await employeeChat(db, user, SESSION, { ...question('Explain public Wi-Fi troubleshooting.'), conversation_token: local.conversation_token });
    assert.equal(calls.length, 1); assert.equal(calls[0].searchParams.has('subsequent_request_token'), false); assert.ok(!calls[0].searchParams.get('q').includes('Payable'));
  });
});

test('validation, credentials, raw tokens, body size, CSRF and authentication are enforced', async () => {
  const { db, user } = setup();
  for (const message of ['', '   ', {}, 'x'.repeat(2001)]) await assert.rejects(() => employeeChat(db, user, SESSION, question(message)), (e) => e.status === 400);
  for (const message of ['password: do-not-send-this', 'api_key=is-private', 'Bearer super-private-access-token', 'a'.repeat(64)]) await assert.rejects(() => employeeChat(db, user, SESSION, question(message)), (e) => e.status === 422);
  await assert.rejects(() => employeeChat(db, user, SESSION, { ...question(), subsequent_request_token: 'untrusted' }), (e) => e.status === 400);
  assert.equal(cleanAssistantMessage('\u200b Hello\u0000 '), 'Hello'); assert.equal(containsCredentials('How do I reset a password?'), false);
  assert.equal((await POST(new Request('http://localhost:3000/api/employee-assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(question()) }))).status, 401);
  assert.equal((await api('emp', 'POST', '/employee-assistant/chat', { message: 'x'.repeat(20000) })).status, 413);
  const cookie = await login('emp');
  assert.equal((await raw('POST', '/employee-assistant/chat', { cookie, body: question(), headers: { origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await raw('POST', '/employee-assistant/chat', { cookie, form: new FormData() })).status, 415);
});

test('rate limits and missing configuration return safe actionable errors', async () => {
  const { db, user } = setup();
  db.run('INSERT INTO employee_assistant_limits(bucket,window,count,expires_at) VALUES(?,?,6,?)', `gemini:${user.id}`, Math.floor(Date.now() / 60000), Date.now() + 60000);
  await provider([], async (calls) => { await assert.rejects(() => employeeChat(db, user, SESSION, question()), (e) => e.status === 429); assert.equal(calls.length, 0); });
  const oldKey = process.env.SERPAPI_API_KEY; delete process.env.SERPAPI_API_KEY;
  try { await assert.rejects(() => fetchGemini('Public question'), (e) => e.status === 503); } finally { if (oldKey !== undefined) process.env.SERPAPI_API_KEY = oldKey; }
});

test('Markdown supports tables and code without raw HTML, executable links or tracking images', () => {
  const html = renderToString(React.createElement(AssistantMarkdown, { text: '# Heading\n\n- Item\n\n| Name | Value |\n| --- | --- |\n| A | 1 |\n\n```js\nconst x = 1;\n```\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert(1))\n\n![Tracking](https://example.com/pixel)\n\n[Source](https://example.com/help)' }));
  assert.match(html, /<table>/); assert.match(html, /<pre>/); assert.match(html, /<li>Item/); assert.match(html, /href="https:\/\/example.com\/help"/);
  assert.doesNotMatch(html, /<script|<img|href="javascript:/);
  assert.equal(assistantLink('https://serpapi.com/search.json?api_key=value'), null); assert.equal(assistantLink('//untrusted.example'), null);
  const view = renderToString(React.createElement(AssistantView, { user: { name: 'Employee' }, initial: [] }));
  assert.match(view, /GENIQ Employee Assistant/); assert.match(view, /New conversation/); assert.doesNotMatch(view, /Yes, create the trip request/);
});
