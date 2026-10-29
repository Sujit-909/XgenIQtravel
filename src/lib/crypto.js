import crypto from 'node:crypto';

const isProd = () => process.env.NODE_ENV === 'production';
export function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) {
    if (isProd()) throw new Error('AUTH_SECRET must be set in production');
    return 'dev-only-secret-change-me';
  }
  return s;
}
const dataKey = () => crypto.scryptSync(process.env.DATA_KEY || secret(), 'geniq-data-key', 32);

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${h.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  const b = Buffer.from(hash, 'hex');
  return b.length === h.length && crypto.timingSafeEqual(h, b);
}
export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// Signed, expiring tokens (used for session cookies, MFA step, traveller-consent and password reset).
export function signToken(payload, ttlSec) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch { return null; }
}

// AES-256-GCM for bank account numbers (never stored in clear text).
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', dataKey(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export function decrypt(blob) {
  const [iv, tag, enc] = String(blob).split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', dataKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

export const maskTail = (s, keep = 4) => {
  const t = String(s ?? '');
  return t.length <= keep ? t : `${'•'.repeat(Math.max(4, t.length - keep))}${t.slice(-keep)}`;
};
export const maskDoc = (s) => {
  const t = String(s ?? '');
  return t.length <= 4 ? t : `${t.slice(0, 3)}${'*'.repeat(t.length - 5)}${t.slice(-2)}`;
};

export const demoOtp = () => process.env.DEMO_OTP || '246810';
