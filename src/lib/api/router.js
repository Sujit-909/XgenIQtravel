// Tiny route dispatcher used by the single catch-all Next.js route handler (src/app/api/[...path]/route.js).
// Handlers receive { req, query, params, body, form, user, db } and return plain data (200), created(data) (201) or a Response.
import { getDb } from '../db';
import { HttpError } from '../util';
import { userFromToken, SESSION_COOKIE } from '../services/auth';

const routes = [];
export const created = (data) => ({ __status: 201, data });
export function route(method, pattern, opts, handler) {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  routes.push({ method, re, keys, opts, handler, pattern });
}
export const cookieOf = (req, name) => {
  const h = req.headers.get('cookie') || '';
  for (const part of h.split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return decodeURIComponent(v.join('=')); }
  return null;
};
export function setCookie(name, value, { maxAge, httpOnly = true } = {}) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}${maxAge !== undefined ? `; Max-Age=${maxAge}` : ''}${secure}`;
}
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
export { json as jsonResponse };

export async function dispatch(req) {
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, '') || '/';
    const method = req.method.toUpperCase();
    // CSRF defence in depth (cookies are also SameSite=Lax): state-changing requests must come from our own origin
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const origin = req.headers.get('origin');
      if (origin && new URL(origin).host !== (req.headers.get('x-forwarded-host') || req.headers.get('host'))) return json({ error: 'Cross-origin request blocked' }, 403);
    }
    let matchedPath = false;
    for (const r of routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      matchedPath = true;
      if (r.method !== method) continue;
      const db = getDb();
      let user = null;
      if (r.opts.auth !== false) {
        user = userFromToken(db, cookieOf(req, SESSION_COOKIE));
        if (!user) return json({ error: 'Please sign in to continue' }, 401);
        if (r.opts.roles && !r.opts.roles.includes(user.role)) return json({ error: 'You do not have access to this resource' }, 403);
      }
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      let body = {}; let form = null;
      if (!['GET', 'HEAD'].includes(method)) {
        const ct = req.headers.get('content-type') || '';
        if (ct.includes('multipart/form-data')) form = await req.formData();
        else if (ct.includes('json')) { try { body = await req.json(); } catch { return json({ error: 'Request body is not valid JSON' }, 400); } }
      }
      const out = await r.handler({ req, db, user, params, query: Object.fromEntries(url.searchParams), body, form });
      if (out instanceof Response) return out;
      if (out && out.__status) return json(out.data, out.__status, out.headers);
      return json(out ?? { ok: true });
    }
    return json({ error: matchedPath ? 'Method not allowed' : 'Not found' }, matchedPath ? 405 : 404);
  } catch (e) {
    if (e instanceof HttpError || e?.status) return json({ error: e.message, ...(e.extra || {}) }, e.status || 400);
    if (/FOREIGN KEY|constraint/i.test(String(e?.message))) return json({ error: 'The request conflicts with existing data' }, 409);
    console.error('[api]', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}
