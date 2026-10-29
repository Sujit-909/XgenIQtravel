import { json } from '../db';
import { profilePhotoUrl } from './profile-photo';
import { bad, conflict, forbidden, notFound, nowIso, today, daysBetween, isDate, audit, notify, insert, validity, getSetting } from '../util';
import { encrypt, decrypt, maskTail } from '../crypto';

export const DOC_TYPES = ['Passport', 'Visa', 'PAN Card', 'Aadhaar Card', 'Driving License', 'Work Permit', 'Other'];
const NO_EXPIRY = ['PAN Card', 'Aadhaar Card'];
const requireStr = (o, k, label) => { if (!String(o[k] ?? '').trim()) throw bad(`${label} is required`); };
export const docStatus = (d, soon = 60) => (NO_EXPIRY.includes(d.doc_type) ? 'Verified' : validity(d.expiry_date, soon));

// ----- per-entity definitions: table, writable columns, validation -----
const ENT = {
  documents: { table: 'documents', cols: ['doc_type', 'title', 'doc_number', 'issue_date', 'expiry_date', 'country'], validate(i, cur) {
    const m = { ...cur, ...i };
    if (!DOC_TYPES.includes(m.doc_type)) throw bad('Select a valid document type');
    requireStr(m, 'doc_number', 'Document number');
    if (!/^[A-Za-z0-9 \-/]{4,24}$/.test(m.doc_number)) throw bad('Document number must be 4-24 letters / digits');
    if (m.issue_date && !isDate(m.issue_date)) throw bad('Issue date is invalid');
    if (!NO_EXPIRY.includes(m.doc_type)) { if (!isDate(m.expiry_date)) throw bad('Expiry date is required for this document'); if (m.issue_date && m.expiry_date <= m.issue_date) throw bad('Expiry date must be after the issue date'); }
    if (m.doc_type === 'Visa') requireStr(m, 'country', 'Visa country');
  } },
  'payment-methods': { table: 'payment_methods', cols: ['kind', 'brand', 'label', 'last4', 'holder', 'valid_thru', 'handle', 'status', 'is_default'], validate(i, cur) {
    if ('cvv' in i || 'cvc' in i || 'security_code' in i) throw bad('Card security codes are never accepted or stored');
    const m = { ...cur, ...i };
    if (!['corporate_card', 'personal_card', 'upi'].includes(m.kind)) throw bad('Invalid payment method type');
    requireStr(m, 'label', 'Name');
    if (m.kind === 'upi') requireStr(m, 'handle', 'UPI ID');
    else {
      if (!/^\d{4}$/.test(String(m.last4 || ''))) throw bad('Enter the last 4 digits of the card');
      if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(String(m.valid_thru || ''))) throw bad('Valid thru must be MM/YY');
      const [mm, yy] = m.valid_thru.split('/').map(Number); const t = new Date();
      if (2000 + yy < t.getFullYear() || (2000 + yy === t.getFullYear() && mm < t.getMonth() + 1)) throw bad('This card has expired');
      requireStr(m, 'holder', 'Cardholder name');
    }
  }, pre(i) { const o = { ...i }; if (o.card_number) { const d = String(o.card_number).replace(/\D/g, ''); if (d.length < 13 || d.length > 19) throw bad('Invalid card number'); o.last4 = d.slice(-4); delete o.card_number; } return o; } },
  'emergency-contacts': { table: 'emergency_contacts', cols: ['name', 'relationship', 'phone', 'email', 'is_primary'], validate(i, cur) {
    const m = { ...cur, ...i }; requireStr(m, 'name', 'Name'); requireStr(m, 'relationship', 'Relationship'); requireStr(m, 'phone', 'Phone number');
    if (!/^[+\d][\d\s-]{7,16}$/.test(m.phone)) throw bad('Phone number is invalid'); if (m.email && !/^\S+@\S+\.\S+$/.test(m.email)) throw bad('Email is invalid');
  } },
  'family-members': { table: 'family_members', cols: ['name', 'relationship', 'dob', 'gender', 'special_assistance'], validate(i, cur) {
    const m = { ...cur, ...i }; requireStr(m, 'name', 'Name'); requireStr(m, 'relationship', 'Relationship'); if (m.dob && (!isDate(m.dob) || m.dob > today())) throw bad('Date of birth is invalid');
  } },
  addresses: { table: 'addresses', cols: ['kind', 'line', 'city', 'state', 'pin', 'country', 'is_default'], validate(i, cur) {
    const m = { ...cur, ...i }; if (!['Current', 'Permanent', 'Office', 'Other'].includes(m.kind)) throw bad('Select an address type');
    requireStr(m, 'line', 'Address'); requireStr(m, 'city', 'City'); requireStr(m, 'state', 'State'); requireStr(m, 'country', 'Country');
    if (m.country === 'India' && !/^\d{6}$/.test(String(m.pin || ''))) throw bad('PIN code must be 6 digits');
  } },
  'loyalty-programs': { table: 'loyalty_programs', cols: ['category', 'provider', 'program', 'membership_no', 'tier', 'expiry_date', 'rank'], validate(i, cur) {
    const m = { ...cur, ...i }; if (!['airline', 'hotel', 'car', 'other'].includes(m.category)) throw bad('Select a program category');
    requireStr(m, 'provider', 'Provider'); requireStr(m, 'program', 'Program name'); requireStr(m, 'membership_no', 'Membership number');
    if (m.expiry_date && !isDate(m.expiry_date)) throw bad('Expiry date is invalid');
  } },
  'bank-accounts': { table: 'bank_accounts', cols: ['bank', 'account_type', 'holder', 'ifsc', 'active', 'is_default'], validate(i, cur) {
    const m = { ...cur, ...i }; requireStr(m, 'bank', 'Bank name'); requireStr(m, 'holder', 'Account holder name');
    if (!['Savings Account', 'Current Account'].includes(m.account_type)) throw bad('Select an account type');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(m.ifsc || '').toUpperCase())) throw bad('IFSC code is invalid');
    if (!cur && !/^\d{9,18}$/.test(String(i.account_number || ''))) throw bad('Account number must be 9-18 digits');
    if (cur && i.account_number !== undefined && !/^\d{9,18}$/.test(String(i.account_number))) throw bad('Account number must be 9-18 digits');
  } },
};
export const PROFILE_ENTITIES = Object.keys(ENT);

const present = (entity, r) => {
  if (entity === 'bank-accounts') { const { account_enc, ...rest } = r; return { ...rest, account_masked: `•••• •••• ${r.last4}` }; }
  if (entity === 'documents') return { ...r, status: docStatus(r), days_left: r.expiry_date ? daysBetween(today(), r.expiry_date) : null };
  if (entity === 'loyalty-programs') return { ...r, status: validity(r.expiry_date, 60) };
  return r;
};
const clearOthers = (db, def, uid, id, extra = '') => { if (def.table === 'bank_accounts' || def.table === 'payment_methods' || def.table === 'emergency_contacts' || def.table === 'addresses') db.run(`UPDATE ${def.table} SET ${def.table === 'emergency_contacts' ? 'is_primary' : 'is_default'}=0 WHERE user_id=? AND id!=? ${extra}`, uid, id); };

export function listEntity(db, user, entity) {
  const def = ENT[entity]; if (!def) throw notFound('Unknown profile section');
  return db.all(`SELECT * FROM ${def.table} WHERE user_id=? ORDER BY id`, user.id).map((r) => present(entity, r));
}
export function createEntity(db, user, entity, input) {
  const def = ENT[entity]; if (!def) throw notFound('Unknown profile section');
  return db.tx(() => {
    const i = def.pre ? def.pre(input) : { ...input };
    def.validate(i, null);
    const row = { user_id: user.id };
    for (const c of def.cols) if (i[c] !== undefined) row[c] = typeof i[c] === 'boolean' ? (i[c] ? 1 : 0) : i[c];
    if (entity === 'bank-accounts') { const n = String(i.account_number); row.account_enc = encrypt(n); row.last4 = n.slice(-4); row.ifsc = String(i.ifsc).toUpperCase(); row.verified = 0; row.active = 1; if (!db.get('SELECT 1 x FROM bank_accounts WHERE user_id=? AND is_default=1', user.id)) row.is_default = 1; }
    if (entity === 'documents') row.created_at = nowIso();
    const id = insert(db, def.table, row);
    if (row.is_default || row.is_primary) clearOthers(db, def, user.id, id);
    audit(db, user, `profile.${entity}.create`, entity, id, '');
    return present(entity, db.get(`SELECT * FROM ${def.table} WHERE id=?`, id));
  });
}
export function updateEntity(db, user, entity, id, input) {
  const def = ENT[entity]; if (!def) throw notFound('Unknown profile section');
  return db.tx(() => {
    const cur = db.get(`SELECT * FROM ${def.table} WHERE id=? AND user_id=?`, id, user.id); if (!cur) throw notFound('Record not found');
    const i = def.pre ? def.pre(input) : { ...input };
    def.validate(i, cur);
    const f = {};
    for (const c of def.cols) if (i[c] !== undefined) f[c] = typeof i[c] === 'boolean' ? (i[c] ? 1 : 0) : i[c];
    if (entity === 'bank-accounts') {
      if (i.account_number !== undefined) { const n = String(i.account_number); f.account_enc = encrypt(n); f.last4 = n.slice(-4); f.verified = 0; }
      if (f.ifsc) { f.ifsc = String(f.ifsc).toUpperCase(); if (f.ifsc !== cur.ifsc) f.verified = 0; }
      if (f.active === 0 && cur.is_default) f.is_default = 0;
      if (f.is_default === 1 && !(f.active ?? cur.active)) throw conflict('An inactive account cannot be the default');
    }
    if (entity === 'documents' && (f.doc_number !== undefined && f.doc_number !== cur.doc_number)) f.verified = 0;
    const keys = Object.keys(f);
    if (keys.length) db.run(`UPDATE ${def.table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => f[k]), id);
    if (f.is_default === 1 || f.is_primary === 1) clearOthers(db, def, user.id, id);
    audit(db, user, `profile.${entity}.update`, entity, id, keys.join(','));
    return present(entity, db.get(`SELECT * FROM ${def.table} WHERE id=?`, id));
  });
}
export function deleteEntity(db, user, entity, id) {
  const def = ENT[entity]; if (!def) throw notFound('Unknown profile section');
  return db.tx(() => {
    const cur = db.get(`SELECT * FROM ${def.table} WHERE id=? AND user_id=?`, id, user.id); if (!cur) throw notFound('Record not found');
    if (entity === 'bank-accounts' && cur.is_default && db.get('SELECT 1 x FROM reimbursements r JOIN expense_reports e ON e.id=r.report_id WHERE e.user_id=? AND r.status IN (\'Payable\',\'Payment Initiated\')', user.id)) throw conflict('This account is the default for a reimbursement that is still being paid. Set another default first.');
    db.run(`DELETE FROM ${def.table} WHERE id=?`, id);
    audit(db, user, `profile.${entity}.delete`, entity, id, '');
    return { deleted: true };
  });
}
export function revealBankAccount(db, user, id) {
  const a = db.get('SELECT * FROM bank_accounts WHERE id=? AND user_id=?', id, user.id); if (!a) throw notFound('Account not found');
  audit(db, user, 'profile.bank.reveal', 'bank-accounts', id, 'Account number revealed by owner');
  return { account_number: decrypt(a.account_enc) };
}
export function verifyBankAccount(db, user, id) {
  if (!['finance', 'admin'].includes(user.role)) throw forbidden('Finance access required');
  const a = db.get('SELECT * FROM bank_accounts WHERE id=?', id); if (!a) throw notFound('Account not found');
  db.run('UPDATE bank_accounts SET verified=1 WHERE id=?', id); audit(db, user, 'bank.verify', 'bank-accounts', id, `user ${a.user_id}`);
  return { verified: true };
}

// ----- personal info, preferences, notification settings -----
const PERSONAL = ['dob', 'gender', 'nationality', 'blood_group', 'marital_status', 'allergies', 'medical_conditions', 'special_notes', 'phone'];
export function updatePersonal(db, user, input) {
  const f = {}; for (const k of PERSONAL) if (input[k] !== undefined) f[k] = input[k];
  if (f.dob && (!isDate(f.dob) || f.dob >= today())) throw bad('Date of birth is invalid');
  if (f.dob && daysBetween(f.dob, today()) < 18 * 365) throw bad('Employee must be at least 18 years old');
  if (f.phone && !/^[+\d][\d\s-]{7,16}$/.test(f.phone)) throw bad('Phone number is invalid');
  if (f.phone && db.get('SELECT 1 x FROM users WHERE phone=? AND id!=?', f.phone, user.id)) throw conflict('This phone number is already registered');
  const keys = Object.keys(f); if (!keys.length) throw bad('Nothing to update');
  db.run(`UPDATE users SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => f[k]), user.id);
  audit(db, user, 'profile.update', 'user', user.id, keys.join(','));
  return db.get('SELECT * FROM users WHERE id=?', user.id);
}
const PREF_DEFAULT = { class: 'Economy', seat: 'Window', meal: 'Vegetarian', airlines: [], hotelCategory: '3 Star / Business', roomType: 'Non-smoking room', groundTransport: 'Company Cab', useLoyalty: true, special: [], otherSpecial: '' };
export const getPreferences = (db, uid) => ({ ...PREF_DEFAULT, ...json(db.get("SELECT data FROM user_json WHERE user_id=? AND kind='travel_preferences'", uid)?.data, {}) });
export function savePreferences(db, user, input) {
  if (input.class && !['Economy', 'Premium Economy', 'Business'].includes(input.class)) throw bad('Invalid travel class');
  const data = { ...getPreferences(db, user.id), ...input };
  db.run("INSERT INTO user_json(user_id,kind,data) VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET data=excluded.data", user.id, 'travel_preferences', JSON.stringify(data));
  audit(db, user, 'profile.preferences', 'user', user.id, '');
  return data;
}
const NOTIF_DEFAULT = { expiry: { Passport: { on: true, days: 60 }, Visa: { on: true, days: 60 }, 'Driving License': { on: true, days: 30 }, 'Work Permit': { on: true, days: 30 }, 'Other Documents': { on: true, days: 30 } }, channels: { inApp: true, email: true, push: true, whatsapp: false, teams: false } };
export const getNotifSettings = (db, uid) => { const s = json(db.get("SELECT data FROM user_json WHERE user_id=? AND kind='notification_settings'", uid)?.data, {}); return { expiry: { ...NOTIF_DEFAULT.expiry, ...(s.expiry || {}) }, channels: { ...NOTIF_DEFAULT.channels, ...(s.channels || {}) } }; };
export function saveNotifSettings(db, user, input) {
  const cur = getNotifSettings(db, user.id);
  for (const [k, v] of Object.entries(input.expiry || {})) {
    if (!cur.expiry[k]) throw bad(`Unknown document type "${k}" - PAN and Aadhaar have no validity period`);
    if (!Number.isInteger(Number(v.days)) || v.days < 1 || v.days > 365) throw bad('Alert days must be between 1 and 365');
    cur.expiry[k] = { on: !!v.on, days: Number(v.days) };
  }
  for (const [k, v] of Object.entries(input.channels || {})) if (k in cur.channels) cur.channels[k] = !!v;
  db.run("INSERT INTO user_json(user_id,kind,data) VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET data=excluded.data", user.id, 'notification_settings', JSON.stringify(cur));
  return cur;
}

export function profileBundle(db, user) {
  const u = db.get('SELECT * FROM users WHERE id=?', user.id);
  const mgr = db.get('SELECT name FROM users WHERE id=?', u.manager_id);
  const data = Object.fromEntries(PROFILE_ENTITIES.map((e) => [e, listEntity(db, user, e)]));
  const docs = data.documents;
  const { password_hash, ...safe } = u;
  return { user: { ...safe, photo_url: profilePhotoUrl(db, user) }, manager: mgr?.name || null, data, preferences: getPreferences(db, user.id), notifSettings: getNotifSettings(db, user.id),
    stats: { documents: docs.length, documentsValid: docs.filter((d) => ['Valid', 'Verified'].includes(d.status)).length, payments: data['payment-methods'].length + data['bank-accounts'].length, flyers: data['loyalty-programs'].filter((l) => l.category === 'airline').length, emergency: data['emergency-contacts'].length } };
}

// ----- expiry alerts & notifications -----
const KEY = { Passport: 'Passport', Visa: 'Visa', 'Driving License': 'Driving License', 'Work Permit': 'Work Permit' };
export function syncAlerts(db, user) {
  const s = getNotifSettings(db, user.id);
  const docs = db.all('SELECT * FROM documents WHERE user_id=?', user.id);
  for (const d of docs) {
    if (NO_EXPIRY.includes(d.doc_type) || !d.expiry_date) continue;
    const cfg = s.expiry[KEY[d.doc_type] || 'Other Documents']; if (!cfg?.on) continue;
    const left = daysBetween(today(), d.expiry_date);
    const label = d.doc_type === 'Visa' ? d.title || 'Visa' : d.doc_type;
    if (left < 0) notify(db, user.id, { category: 'expiry', severity: 'danger', title: `${label} expired`, body: `Your ${label.toLowerCase()} (${d.doc_number}) expired on ${d.expiry_date}. Please update to avoid travel restrictions.`, link: '/documents', refKey: `doc-exp:${d.id}:${d.expiry_date}` });
    else if (left <= cfg.days) notify(db, user.id, { category: 'expiry', severity: 'danger', title: `${label} expiring soon`, body: `Your ${label.toLowerCase()} (${d.doc_number}) will expire in ${left} days on ${d.expiry_date}.`, link: '/documents', refKey: `doc-soon:${d.id}:${d.expiry_date}` });
  }
  const trips = db.all("SELECT * FROM trips WHERE traveller_id=? AND travel_type='International' AND status IN ('Approved','Booking In Progress') AND dep_date>=? AND dep_date<=?", user.id, today(), `${today().slice(0, 4)}-12-31`);
  for (const t of trips) {
    const ok = docs.some((d) => d.doc_type === 'Visa' && d.country === t.dest_country && d.expiry_date && d.expiry_date >= t.ret_date);
    if (!ok) notify(db, user.id, { category: 'other', severity: 'warn', title: `You have an upcoming trip to ${t.dest_country}`, body: 'Please ensure your visa is valid for the travel dates.', link: '/documents', refKey: `visa-chk:${t.id}` });
  }
  if (!db.get('SELECT 1 x FROM emergency_contacts WHERE user_id=?', user.id)) notify(db, user.id, { category: 'other', title: 'Please complete your travel profile', body: 'Add an emergency contact for smoother bookings.', link: '/profile', refKey: 'profile-incomplete' });
}
export function listNotifications(db, user, category) {
  syncAlerts(db, user);
  const all = db.all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100', user.id);
  const rows = category && category !== 'all' ? all.filter((n) => n.category === category) : all;
  return { rows, counts: { all: all.length, expiry: all.filter((n) => n.category === 'expiry').length, approval: all.filter((n) => n.category === 'approval').length, other: all.filter((n) => n.category === 'other').length }, unread: all.filter((n) => !n.is_read).length };
}
export const unreadCount = (db, user) => db.get('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0', user.id).c;
export function markRead(db, user, id) { if (id) db.run('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?', id, user.id); else db.run('UPDATE notifications SET is_read=1 WHERE user_id=?', user.id); return { ok: true }; }
export { getSetting };
