import '@/lib/api/routes';
import { dispatch } from '@/lib/api/router';
import { getDb, resetDbForTests } from '@/lib/db';
import { addDays, today } from '@/lib/util';

export const PASSWORD = 'Sujit@909';
export const EMAILS = { emp: 'sujit@xgeniq.com', mgr: 'manager@xgeniq.com', head: 'arvind.kapoor@abccorp.com', owner: 'meera.iyer@abccorp.com', desk: 'travel@xgeniq.com', fin: 'karan.mehta@abccorp.com', admin: 'admin@xgeniq.com' };
const sessions = {};

export async function raw(method, path, { cookie, body, form, headers = {} } = {}) {
  const h = new Headers({ host: 'localhost:3000', ...headers });
  if (cookie) h.set('cookie', cookie);
  let b;
  if (form) b = form; else if (body !== undefined) { h.set('content-type', 'application/json'); b = JSON.stringify(body); }
  return dispatch(new Request(`http://localhost:3000/api${path}`, { method, headers: h, body: b }));
}
export async function login(who) {
  if (sessions[who]) return sessions[who];
  const r1 = await (await raw('POST', '/auth/login', { body: { identifier: EMAILS[who] || who, password: PASSWORD } })).json();
  const r2 = await raw('POST', '/auth/mfa', { body: { token: r1.token, code: '246810', remember: false } });
  sessions[who] = r2.headers.get('set-cookie').split(';')[0];
  return sessions[who];
}
export async function api(who, method, path, body, form) {
  const cookie = who ? await login(who) : undefined;
  const res = await raw(method, path, { cookie, body, form });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : ct.includes('pdf') ? Buffer.from(await res.arrayBuffer()) : await res.text();
  return { status: res.status, data, res };
}
export const fresh = () => { resetDbForTests(); for (const k of Object.keys(sessions)) delete sessions[k]; return getDb(); };
export const d = (n) => addDays(today(), n);
export const tripBody = (o = {}) => ({
  purpose: 'Client meeting', title: 'Client Meeting - Mumbai', purpose_text: 'Meeting with client', travel_type: 'Domestic', department: 'IT', dest_country: 'India', dep_country: 'India', dep_city: 'Bhubaneswar', dest_city: 'Mumbai',
  dep_date: d(20), ret_date: d(22), travel_mode: 'Flight', extra_reqs: ['Hotel accommodation'], company_code: 'ABC01', cost_object_type: 'Cost Center', cost_object: 'CC2001 - IT Dept', est_budget: 25000, advance_needed: false, comment: 'Need to meet client', ...o,
});
export function formWith(files, extra = {}) {
  const f = new FormData();
  for (const [name, content, type] of files) f.append('files', new File([content], name, { type: type || 'application/pdf' }));
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
}
