import { bad, forbidden, notFound, nowIso, audit, initials, ROLE_LABEL, notify, insert } from '../util';
import { hashPassword, verifyPassword, signToken, verifyToken, sha256, demoOtp } from '../crypto';
import { hasReports } from './chain';

export const SESSION_COOKIE = 'geniq_session';
export const PRE_COOKIE = 'geniq_pre';
const attempts = new Map(); // identifier -> {n, until}
const LOCK_AFTER = 5; const LOCK_MS = 15 * 60 * 1000;

export function publicUser(db, u) {
  if (!u) return null;
  return { id: u.id, empId: u.emp_id, name: u.name, email: u.email, phone: u.phone, role: u.role, roleLabel: ROLE_LABEL[u.role], title: u.title, department: u.department, designation: u.designation, grade: u.grade,
    managerId: u.manager_id, initials: initials(u.name), hasReports: hasReports(db, u.id), homeCity: u.home_city, homeAirport: u.home_airport, location: u.location, companyCode: u.company_code,
    // raw columns used by services
    emp_id: u.emp_id, manager_id: u.manager_id, home_city: u.home_city };
}
const findByIdentifier = (db, id) => {
  const v = String(id || '').trim();
  if (!v) return null;
  return db.get('SELECT * FROM users WHERE active=1 AND (lower(email)=lower(?) OR replace(phone, \' \', \'\')=replace(?, \' \', \'\'))', v, v);
};
export const passwordPolicy = (pw) => {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/\d/.test(pw)) return 'Password needs an uppercase letter, a lowercase letter and a digit';
  return null;
};

export function login(db, { identifier, password }) {
  const key = String(identifier || '').toLowerCase();
  const a = attempts.get(key);
  if (a && a.until > Date.now()) throw Object.assign(bad('Too many failed attempts. Try again in 15 minutes.'), { status: 429 });
  const u = findByIdentifier(db, identifier);
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) {
    const n = (a?.n || 0) + 1; attempts.set(key, { n, until: n >= LOCK_AFTER ? Date.now() + LOCK_MS : 0 });
    audit(db, u ? { id: u.id, name: u.name } : null, 'auth.login_failed', 'user', u?.id, key);
    throw Object.assign(bad('Invalid email / mobile number or password'), { status: 401 });
  }
  attempts.delete(key);
  return { user: u, mfaToken: signToken({ uid: u.id, step: 'mfa' }, 600) };
}
export function verifyMfa(db, { token, code, method, remember }) {
  const p = verifyToken(token);
  if (!p || p.step !== 'mfa') throw Object.assign(bad('Your sign-in session expired. Please sign in again.'), { status: 401 });
  if (String(code || '').trim() !== demoOtp()) { audit(db, { id: p.uid, name: '' }, 'auth.mfa_failed', 'user', p.uid, method || ''); throw Object.assign(bad('Invalid verification code'), { status: 401 }); }
  const u = db.get('SELECT * FROM users WHERE id=? AND active=1', p.uid);
  if (!u) throw forbidden('Account is inactive');
  audit(db, u, 'auth.login', 'user', u.id, method || 'totp');
  const maxAge = remember ? 30 * 86400 : 8 * 3600;
  return { user: u, session: signToken({ uid: u.id, v: 1 }, maxAge), maxAge };
}
export function userFromToken(db, token) {
  const p = verifyToken(token);
  if (!p || p.step || p.purpose) return null;
  const u = db.get('SELECT * FROM users WHERE id=? AND active=1', p.uid);
  return u ? publicUser(db, u) : null;
}

// ----- OTP (demo gateway: a fixed code is accepted; plug an SMS / email sender into sendOtp) -----
function issueOtp(db, identifier, purpose) {
  db.run("UPDATE otps SET used=1 WHERE identifier=? AND purpose=? AND used=0", identifier.toLowerCase(), purpose);
  db.run('INSERT INTO otps(identifier,purpose,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)', identifier.toLowerCase(), purpose, sha256(demoOtp()), new Date(Date.now() + 10 * 60000).toISOString(), nowIso());
}
function checkOtp(db, identifier, purpose, code) {
  const o = db.get('SELECT * FROM otps WHERE identifier=? AND purpose=? AND used=0 ORDER BY id DESC LIMIT 1', identifier.toLowerCase(), purpose);
  if (!o || o.expires_at < nowIso()) throw bad('The verification code has expired. Request a new one.');
  if (o.attempts >= 5) throw bad('Too many incorrect attempts. Request a new code.');
  if (sha256(String(code || '').trim()) !== o.code_hash) { db.run('UPDATE otps SET attempts=attempts+1 WHERE id=?', o.id); throw bad('Invalid verification code'); }
  db.run('UPDATE otps SET used=1 WHERE id=?', o.id);
}
export function forgotPassword(db, { identifier }) {
  if (!String(identifier || '').trim()) throw bad('Enter your registered email ID or mobile number');
  const u = findByIdentifier(db, identifier);
  if (u) issueOtp(db, identifier, 'reset');
  return { sent: true }; // identical response whether or not the account exists
}
export function verifyResetOtp(db, { identifier, code }) {
  checkOtp(db, String(identifier || ''), 'reset', code);
  const u = findByIdentifier(db, identifier); if (!u) throw bad('Invalid verification code');
  return { resetToken: signToken({ uid: u.id, purpose: 'reset' }, 600) };
}
export function resetPassword(db, { token, password }) {
  const p = verifyToken(token); if (!p || p.purpose !== 'reset') throw bad('Reset link expired. Start again.');
  const e = passwordPolicy(password); if (e) throw bad(e);
  db.run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(password), p.uid);
  audit(db, { id: p.uid, name: '' }, 'auth.password_reset', 'user', p.uid, '');
  return { ok: true };
}
export function register(db, input) {
  const name = String(input.name || '').trim(); const email = String(input.email || '').trim().toLowerCase(); const phone = String(input.phone || '').trim();
  if (!name) throw bad('Full name is required');
  if (!/^[^\s@]+@abccorp\.com$/.test(email)) throw bad('Use your corporate email address (@abccorp.com)');
  if (!/^[+\d][\d\s-]{9,16}$/.test(phone)) throw bad('Enter a valid mobile number');
  const e = passwordPolicy(input.password); if (e) throw bad(e);
  if (db.get('SELECT 1 x FROM users WHERE email=? OR phone=?', email, phone)) throw bad('An account with this email or mobile number already exists');
  const n = db.get('SELECT COUNT(*) c FROM users').c + 1000;
  const id = insert(db, 'users', { emp_id: `EMP${n}`, name, email, phone, password_hash: hashPassword(input.password), role: 'employee', department: input.department || 'IT', designation: 'Employee', grade: 'L1', company_code: 'ABC01', nationality: 'Indian', created_at: nowIso() });
  audit(db, { id, name }, 'auth.register', 'user', id, email);
  return { id };
}

// ----- trip on behalf of a colleague: verify the traveller (consent) before reading their profile -----
export function travellerLookup(db, user, { identifier }) {
  const t = findByIdentifier(db, identifier);
  if (!t) throw notFound('No registered traveller found with this corporate email ID or mobile number');
  if (t.id === user.id) throw bad('Choose "Self" to create a trip for yourself');
  issueOtp(db, `trav:${user.id}:${t.id}`, 'traveller');
  notify(db, t.id, { category: 'other', title: 'Trip request on your behalf', body: `${user.name} is creating a business trip for you and needs your verification code.`, refKey: `trav-req:${user.id}:${Date.now()}` });
  return { sent: true, traveller_id: t.id };
}
export function travellerVerify(db, user, { traveller_id, code }) {
  const t = db.get('SELECT * FROM users WHERE id=? AND active=1', traveller_id); if (!t) throw notFound('Traveller not found');
  checkOtp(db, `trav:${user.id}:${t.id}`, 'traveller', code);
  audit(db, user, 'traveller.verified', 'user', t.id, 'Consent given for delegated trip creation');
  return { token: signToken({ purpose: 'traveller', by: user.id, traveller: t.id }, 1800),
    traveller: { id: t.id, name: t.name, emp_id: t.emp_id, department: t.department, designation: t.designation, email: t.email, phone: t.phone, grade: t.grade } };
}
