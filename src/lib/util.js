export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const pad = (n, w) => String(n).padStart(w, '0');
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const num = (v, d = 0) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? d : Number(v));

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const forbidden = (msg = 'You do not have access to this resource') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg, extra) => new HttpError(409, msg, extra);

// Sequential identifiers: seq(db,'trip-2026') -> 1,2,3...
export function seq(db, name) {
  db.run('INSERT INTO counters(name,value) VALUES(?,1) ON CONFLICT(name) DO UPDATE SET value = value + 1', name);
  return db.get('SELECT value FROM counters WHERE name=?', name).value;
}
export const yearOf = (d = today()) => d.slice(0, 4);

export function getSetting(db, key, fallback) {
  const r = db.get('SELECT value FROM settings WHERE key=?', key);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return r.value; }
}
export function setSetting(db, key, value) {
  db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
}

export function audit(db, user, action, entityType, entityId, detail) {
  db.run(
    'INSERT INTO audit_log(ts,actor_id,actor_name,action,entity_type,entity_id,detail) VALUES(?,?,?,?,?,?,?)',
    nowIso(), user?.id ?? null, user?.name ?? 'System', action, entityType ?? null, entityId ?? null, detail ?? null,
  );
}

export function notify(db, userId, { category = 'other', severity = 'info', title, body, link, refKey }) {
  if (!userId) return;
  db.run(
    'INSERT OR IGNORE INTO notifications(user_id,category,severity,title,body,link,ref_key,created_at) VALUES(?,?,?,?,?,?,?,?)',
    userId, category, severity, title, body ?? null, link ?? null, refKey ?? null, nowIso(),
  );
}

export function comment(db, entityType, entityId, user, body, org) {
  db.run(
    'INSERT INTO comments(entity_type,entity_id,user_id,author,org,body,created_at) VALUES(?,?,?,?,?,?,?)',
    entityType, entityId, user?.id ?? null, user?.name ?? 'System', org ?? null, body, nowIso(),
  );
}

export function page(query, defSize = 10) {
  const size = Math.min(100, Math.max(1, parseInt(query.size ?? defSize, 10) || defSize));
  const p = Math.max(1, parseInt(query.page ?? 1, 10) || 1);
  return { size, page: p, offset: (p - 1) * size };
}

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');

export const ROLE_LABEL = {
  employee: 'Employee', manager: 'Manager', travel_desk: 'Travel Desk Operator', finance: 'Finance Administrator', admin: 'Administrator',
};

// Validity status of a dated document / membership.
export function validity(expiry, soonDays = 60, ref = today()) {
  if (!expiry) return 'Valid';
  const d = daysBetween(ref, expiry);
  if (d < 0) return 'Expired';
  if (d <= soonDays) return 'Expiring Soon';
  return 'Valid';
}

// Generic insert helper used by seed data and services: insert(db,'table',{col:value})
export function insert(db, table, obj) {
  const keys = Object.keys(obj);
  return db.run(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map((k) => obj[k])).id;
}
