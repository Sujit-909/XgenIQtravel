// Mini "Next.js" harness for browser tests: renders the real page functions on the server, serialises the element tree,
// and hydrates it in the browser from an esbuild bundle of the real client components. API calls hit the real route handlers.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { ctx } from 'next/headers';
import '@/lib/api/routes';
import { dispatch } from '@/lib/api/router';
import { getDb } from '@/lib/db';
import { userFromToken, SESSION_COOKIE } from '@/lib/services/auth';
import { navFor } from '@/lib/nav';
import { pendingCount } from '@/lib/services/approvals';
import { unreadCount } from '@/lib/services/profile';

const root = path.resolve(__dirname, '../..');
const appDir = path.join(root, 'src/app');
const viewsDir = path.join(root, 'src/views');

export function tryRequire(...names) { for (const n of names) { try { return require(n); } catch { /* next */ } } return null; }
export const esbuild = () => tryRequire('esbuild', '/home/claude/.npm-global/lib/node_modules/tsx/node_modules/esbuild');
export const playwright = () => tryRequire('playwright', 'playwright-core');
export const chromiumPath = () => ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));

// ---- registry of view components (same names on server and in the browser bundle) ----
const viewFiles = fs.readdirSync(viewsDir).filter((f) => f.endsWith('.jsx')).map((f) => f.replace(/\.jsx$/, ''));
const registry = new Map();
for (const f of viewFiles) { const mod = require(path.join(viewsDir, `${f}.jsx`)); for (const [k, v] of Object.entries(mod)) if (typeof v === 'function') registry.set(v, `${f}:${k}`); }

function ser(node) {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) return node.map(ser);
  if (React.isValidElement(node)) {
    const { children, ...props } = node.props || {};
    const out = { p: JSON.parse(JSON.stringify(props)), c: ser(children) };
    if (typeof node.type === 'string') return { $: 'h', tag: node.type, ...out };
    if (node.type === React.Fragment) return { $: 'f', c: out.c };
    const name = registry.get(node.type);
    if (!name) throw new Error(`Unregistered component in page output: ${node.type?.name}`);
    return { $: 'v', name, ...out };
  }
  throw new Error(`Cannot serialise ${typeof node}`);
}

// ---- routes ----
const pages = [];
(function scan(dir, segs) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (e.name !== 'api') scan(path.join(dir, e.name), [...segs, e.name]); }
    else if (e.name === 'page.jsx') {
      const url = segs.filter((s) => !/^\(.*\)$/.test(s)); const keys = [];
      const re = new RegExp(`^/${url.map((s) => (/^\[.*\]$/.test(s) ? (keys.push(s.slice(1, -1)), '([^/]+)') : s)).join('/')}/?$`);
      pages.push({ re, keys, file: path.join(dir, e.name), shell: segs.includes('(app)') });
    }
  }
}(appDir, []));
// Next.js gives static segments precedence over dynamic ones
pages.sort((a, b) => a.keys.length - b.keys.length);
const PUBLIC = ['/login', '/forgot-password', '/verify-otp', '/mfa'];

async function renderRoute(req, url) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
  ctx.cookies = cookies;
  if (!PUBLIC.some((p) => url.pathname.startsWith(p)) && !cookies[SESSION_COOKIE]) return { redirect: '/login' };
  for (const p of pages) {
    const m = p.re.exec(url.pathname); if (!m) continue;
    const params = Object.fromEntries(p.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const mod = require(p.file);
    try {
      const el = await mod.default({ params: Promise.resolve(params), searchParams: Promise.resolve(Object.fromEntries(url.searchParams)) });
      const payload = { tree: ser(el) };
      if (p.shell) {
        const db = getDb(); const user = userFromToken(db, cookies[SESSION_COOKIE]);
        if (!user) return { redirect: '/login' };
        payload.shell = { user, nav: navFor(user), counts: { pending: pendingCount(db, user), unread: unreadCount(db, user) } };
      }
      return { payload };
    } catch (e) {
      if (e.digest?.startsWith('NEXT_REDIRECT')) return { redirect: e.to };
      if (e.digest === 'NEXT_NOT_FOUND') return { notFound: true };
      throw e;
    }
  }
  return { notFound: true };
}

export async function buildClient() {
  const eb = esbuild(); if (!eb) return null;
  const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import Shell from '@/components/Shell';
import { ToastProvider } from '@/components/ui';
${viewFiles.map((f, i) => `import * as m${i} from '@/views/${f}';`).join('\n')}
const mods = { ${viewFiles.map((f, i) => `'${f}': m${i}`).join(', ')} };
function deser(n) {
  if (n === null || typeof n !== 'object') return n;
  if (Array.isArray(n)) return n.map((x, i) => { const d = deser(x); return React.isValidElement(d) && d.key == null ? React.cloneElement(d, { key: i }) : d; });
  const kids = deser(n.c);
  if (n.$ === 'f') return React.createElement(React.Fragment, null, kids);
  if (n.$ === 'h') return React.createElement(n.tag, n.p, kids);
  const [file, exp] = n.name.split(':');
  return React.createElement(mods[file][exp], n.p, kids);
}
function App({ payload }) { const el = deser(payload.tree); return React.createElement(ToastProvider, null, payload.shell ? React.createElement(Shell, payload.shell, el) : el); }
const rootEl = createRoot(document.getElementById('root'));
const render = (p) => rootEl.render(React.createElement(App, { payload: p }));
window.__refresh = async () => { const r = await fetch(window.location.href, { headers: { 'x-data': '1' } }); if (r.redirected || r.status !== 200) { window.location.reload(); return; } render(await r.json()); };
render(window.__PAGE__);
`;
  const alias = { 'next/link': path.join(__dirname, 'client/link.jsx'), 'next/navigation': path.join(__dirname, 'client/navigation.js') };
  const plugin = { name: 'alias', setup(b) {
    b.onResolve({ filter: /^@\// }, (a) => { const base = path.join(root, 'src', a.path.slice(2)); for (const c of [base, `${base}.js`, `${base}.jsx`]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return { path: c }; return undefined; });
    b.onResolve({ filter: /^next\// }, (a) => (alias[a.path] ? { path: alias[a.path] } : undefined));
  } };
  const res = await eb.build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.js': 'jsx' },
    nodePaths: ['/home/claude/.npm-global/lib/node_modules', path.join(root, 'node_modules')], plugins: [plugin], define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_DEMO_HINTS': '"true"' }, logLevel: 'silent' });
  return res.outputFiles[0].text;
}

export async function startServer() {
  const bundle = await buildClient();
  const css = fs.readFileSync(path.join(appDir, 'globals.css'), 'utf8');
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/client.js') { res.setHeader('content-type', 'text/javascript'); return res.end(bundle); }
      if (url.pathname === '/styles.css') { res.setHeader('content-type', 'text/css'); return res.end(css); }
      if (url.pathname === '/favicon.ico') { res.statusCode = 204; return res.end(); }
      if (url.pathname.startsWith('/api/')) {
        const chunks = []; for await (const c of req) chunks.push(c);
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
        const r = await dispatch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, duplex: 'half' }));
        res.statusCode = r.status; r.headers.forEach((v, k) => { if (k !== 'set-cookie') res.setHeader(k, v); });
        const sc = r.headers.getSetCookie?.() || []; if (sc.length) res.setHeader('set-cookie', sc);
        return res.end(Buffer.from(await r.arrayBuffer()));
      }
      const out = await renderRoute(req, url);
      if (out.redirect) { res.statusCode = 302; res.setHeader('location', out.redirect); return res.end(); }
      if (out.notFound) { res.statusCode = 404; return res.end('Not found'); }
      if (req.headers['x-data']) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(out.payload)); }
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script>window.__PAGE__=${JSON.stringify(out.payload).replace(/</g, '\\u003c')}</script><script src="/client.js"></script></body></html>`);
    } catch (e) { console.error('[e2e-server]', e); res.statusCode = 500; res.end(String(e.stack || e)); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}
