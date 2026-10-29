import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh, raw, PASSWORD } from './helpers';
import { renderPage } from './render';

test('login renders branded panels and preserves accessible authentication controls', async () => {
  fresh();
  const html = await renderPage('(auth)/login/page.jsx', { who: null });
  for (const text of ['XgenIQ', 'Corporate Travel Platform', 'Your Business Travel', 'Sign In to XGENIQ Travel Portal', 'Create Account', 'Remember me', 'Show password', 'Company Account']) assert.ok(html.includes(text), text);
  assert.match(html, /type="password"/);
  assert.match(html, /href="\/forgot-password"/);
  assert.match(html, /class="login-airport" aria-hidden="true"/);
});
test('registration validation, sign-in and unconfigured SSO responses remain intact', async () => {
  fresh();
  assert.equal((await raw('POST', '/auth/register', { body: { name: 'Test', email: 'invalid@example.com' } })).status, 400);
  const body = { name: 'Login Design Test', email: 'login.design@abccorp.com', phone: '+91 9000012345', password: PASSWORD };
  assert.equal((await raw('POST', '/auth/register', { body })).status, 201);
  const login = await raw('POST', '/auth/login', { body: { identifier: body.email, password: PASSWORD } });
  assert.equal(login.status, 200); assert.equal((await login.json()).mfaRequired, true);
  const sso = await raw('POST', '/auth/sso');
  assert.equal(sso.status, 501); assert.match((await sso.json()).error, /not configured/);
});
