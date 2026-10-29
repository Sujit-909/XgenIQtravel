// Travel assistant. Deterministic intent handling (no external LLM needed).
// INTEGRATION POINT: replace `respond` with an LLM call if desired - keep the same {text, card, actions} reply shape and
// keep the explicit-confirmation step before anything is created.
import { json } from '../db';
import { nowIso, today, addDays, daysBetween, getSetting } from '../util';
import { createTrip } from './trips';
import { searchFlights, AIRPORTS, cityToAirport } from '../providers/mock';
import { evaluateFlight } from './policy';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const CITIES = ['Bhubaneswar', 'Mumbai', 'Delhi', 'Bengaluru', 'Kolkata', 'Chennai', 'Hyderabad', 'Pune', 'Goa', 'Singapore', 'Dubai', 'London'];
const ALIAS = { bangalore: 'Bengaluru', bombay: 'Mumbai', madras: 'Chennai', calcutta: 'Kolkata', bbsr: 'Bhubaneswar', blr: 'Bengaluru', bom: 'Mumbai', del: 'Delhi', sin: 'Singapore' };
const CITY_COUNTRY = { Singapore: 'Singapore', Dubai: 'UAE', London: 'United Kingdom' };

function findCity(text) {
  const t = text.toLowerCase(); let best = null;
  for (const c of [...CITIES, ...Object.keys(ALIAS)]) { const i = t.search(new RegExp(`\\b${c.toLowerCase()}\\b`)); if (i >= 0 && (!best || i < best.i)) best = { i, name: ALIAS[c] || c }; }
  return best?.name || null;
}
function citiesIn(text) {
  const out = [];
  const re = new RegExp(`\\b(${[...CITIES, ...Object.keys(ALIAS)].join('|')})\\b`, 'gi'); let m;
  while ((m = re.exec(text))) { const n = ALIAS[m[1].toLowerCase()] || CITIES.find((c) => c.toLowerCase() === m[1].toLowerCase()); if (n && !out.includes(n)) out.push(n); }
  return out;
}
function parseDate(day, mon) {
  const m = MONTHS.indexOf(mon.slice(0, 3).toLowerCase()); if (m < 0) return null;
  const y = new Date().getUTCFullYear(); let d = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (d < today()) d = `${y + 1}${d.slice(4)}`;
  return Number.isNaN(Date.parse(d)) ? null : d;
}
export function parseTripRequest(text, user) {
  const cities = citiesIn(text);
  const lower = text.toLowerCase();
  let to = null; let from = user.homeCity || 'Bhubaneswar';
  const toM = new RegExp(`\\b(?:to|in|at|visit)\\s+(${[...CITIES, ...Object.keys(ALIAS)].join('|')})\\b`, 'i').exec(text);
  if (toM) to = ALIAS[toM[1].toLowerCase()] || CITIES.find((c) => c.toLowerCase() === toM[1].toLowerCase());
  const fromM = new RegExp(`\\bfrom\\s+(${[...CITIES, ...Object.keys(ALIAS)].join('|')})\\b`, 'i').exec(text);
  if (fromM) from = ALIAS[fromM[1].toLowerCase()] || CITIES.find((c) => c.toLowerCase() === fromM[1].toLowerCase());
  if (!to) to = cities.find((c) => c !== from) || cities[0] || null;
  let dep = null; let ret = null;
  const range = /(\d{1,2})(?:st|nd|rd|th)?\s*([a-z]{3,9})?\s*(?:to|-|until|till)\s*(\d{1,2})(?:st|nd|rd|th)?\s*([a-z]{3,9})/i.exec(text);
  if (range) { const m2 = range[4]; const m1 = range[2] && MONTHS.includes(range[2].slice(0, 3).toLowerCase()) ? range[2] : m2; dep = parseDate(range[1], m1); ret = parseDate(range[3], m2); }
  else { const iso = text.match(/\d{4}-\d{2}-\d{2}/g); if (iso) { dep = iso[0]; ret = iso[1] || iso[0]; } else { const one = /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})/i.exec(text); if (one) { dep = parseDate(one[1], one[2]); ret = dep; } } }
  if (!dep && /tomorrow/.test(lower)) { dep = addDays(today(), 1); ret = addDays(dep, 1); }
  if (!dep && /next week/.test(lower)) { const d = new Date(); const add = ((8 - d.getUTCDay()) % 7) || 7; dep = addDays(today(), add); ret = addDays(dep, 2); }
  const purpose = /train|conference|workshop/.test(lower) ? 'Training / conference' : /site|plant|project visit/.test(lower) ? 'Project / site visit' : /internal|team|review/.test(lower) ? 'Internal meeting' : 'Client meeting';
  return { to, from, dep, ret, purpose };
}

function estimate(db, user, d) {
  const a = cityToAirport(d.from); const b = cityToAirport(d.to);
  const dest = CITY_COUNTRY[d.to] || 'India'; const travelType = dest === 'India' ? 'Domestic' : 'International';
  let fare = 0;
  if (a && b) {
    const opts = searchFlights({ from: a, to: b, date: d.dep, cabin: 'Economy' }).filter((o) => o.bookable).map((o) => ({ ...o, p: evaluateFlight(db, { offer: o, travelType, destCountry: dest, grade: user.grade }) }));
    const ok = opts.filter((o) => o.p.status === 'Compliant').sort((x, y) => x.fare - y.fare)[0] || opts.sort((x, y) => x.fare - y.fare)[0];
    fare = (ok?.fare || 0) * 2;
  }
  const nights = Math.max(0, daysBetween(d.dep, d.ret));
  const nightly = travelType === 'International' ? 12500 : ['Mumbai', 'Delhi', 'Bengaluru', 'Kolkata', 'Chennai', 'Hyderabad'].includes(d.to) ? 8000 : 5500;
  return { total: Math.round((fare + nights * nightly + 1500) / 100) * 100, travelType, dest, nights };
}
const defaultCostObject = (user) => (user.department === 'IT' ? 'CC2001 - IT Dept' : 'CC3001 - Operations Dept');

const getState = (db, uid) => json(db.get('SELECT state FROM assistant_state WHERE user_id=?', uid)?.state, {});
const setState = (db, uid, s) => db.run('INSERT INTO assistant_state(user_id,state) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET state=excluded.state', uid, JSON.stringify(s));
const save = (db, uid, role, content) => db.run('INSERT INTO assistant_messages(user_id,role,content,created_at) VALUES(?,?,?,?)', uid, role, JSON.stringify(content), nowIso());
export function history(db, user) {
  return db.all('SELECT * FROM assistant_messages WHERE user_id=? ORDER BY id DESC LIMIT 40', user.id).reverse().map((m) => ({ id: m.id, role: m.role, ...json(m.content, {}), at: m.created_at }));
}

export function respond(db, user, text) {
  const msg = String(text || '').trim().slice(0, 500);
  if (!msg) return { role: 'assistant', text: 'Please type a message, for example "I need to travel to Mumbai from 12 Nov to 14 Nov for a client meeting".' };
  const lower = msg.toLowerCase(); const state = getState(db, user.id);
  if (state.draft) {
    if (/^(yes|y|confirm|create( it)?|go ahead|proceed|ok(ay)?|sure)\b/.test(lower) || /yes,? please/.test(lower)) {
      const d = state.draft;
      try {
        const trip = createTrip(db, user, { purpose: d.purpose, title: `${d.purpose === 'Client meeting' ? 'Client Meeting' : d.purpose} - ${d.to}`, purpose_text: `${d.purpose} in ${d.to}`, travel_type: d.travelType, department: user.department,
          dest_country: d.dest, dep_country: 'India', dep_city: d.from, dest_city: d.to, dep_date: d.dep, ret_date: d.ret, travel_mode: 'Flight', extra_reqs: ['Hotel accommodation', 'Airport / local taxi'], company_code: user.companyCode || 'ABC01',
          cost_object_type: 'Cost Center', cost_object: defaultCostObject(user), est_budget: d.estimate, advance_needed: false, comment: `Created via travel assistant: ${d.purpose} in ${d.to}` }, { submit: true });
        setState(db, user.id, { lastTripId: trip.id });
        return { role: 'assistant', text: 'Trip request created successfully!', card: { type: 'trip_created', trip_no: trip.trip_no, id: trip.id, status: trip.status, from: d.from, to: d.to, dep: d.dep, ret: d.ret, purpose: d.purpose, estimate: d.estimate },
          actions: [{ label: 'View Trip Request', href: `/trips/${trip.id}` }, { label: 'Check Approval Status', href: `/trips/${trip.id}` }] };
      } catch (e) { setState(db, user.id, {}); return { role: 'assistant', text: `I could not create the trip: ${e.message}` }; }
    }
    if (/^(no|cancel|stop|never ?mind)\b/.test(lower)) { setState(db, user.id, {}); return { role: 'assistant', text: 'No problem - I have discarded that draft. Nothing was created.' }; }
  }
  const isTrip = /(travel|trip|fly|flight|go to|visit|going to|need to be)/.test(lower) && findCity(msg);
  if (isTrip && !/(policy|status|upcoming|expense|reimburs)/.test(lower)) {
    const p = parseTripRequest(msg, user);
    if (!p.to) return { role: 'assistant', text: 'Which city are you travelling to?' };
    if (!p.dep) return { role: 'assistant', text: `When do you want to travel to ${p.to}? For example "12 Nov to 14 Nov".` };
    if (p.ret < p.dep) return { role: 'assistant', text: 'The return date is before the departure date. Please give the dates again.' };
    if (p.from === p.to) return { role: 'assistant', text: 'Your departure and destination cities are the same. Where are you travelling from?' };
    const e = estimate(db, user, p);
    const draft = { ...p, estimate: e.total, travelType: e.travelType, dest: e.dest };
    setState(db, user.id, { draft });
    return { role: 'assistant', text: "Sure! I'll create a trip request for you. Here are the details I've captured. Would you like me to create the trip request with these details?",
      card: { type: 'trip_draft', from: p.from, to: p.to, dep: p.dep, ret: p.ret, days: daysBetween(p.dep, p.ret) + 1, nights: e.nights, purpose: p.purpose, estimate: e.total, traveller: `${user.name} (${user.empId} | ${user.department})` } };
  }
  if (/(expense|reimburs|bills|claim)/.test(lower) && !/(status|limit)/.test(lower)) {
    const t = db.get("SELECT * FROM trips WHERE traveller_id=? AND status IN ('Travel In Progress','Expenses Pending','Booking In Progress','Approved','Closed') ORDER BY CASE status WHEN 'Expenses Pending' THEN 0 WHEN 'Travel In Progress' THEN 1 ELSE 2 END, dep_date DESC LIMIT 1", user.id);
    if (!t) return { role: 'assistant', text: 'I could not find an approved trip to raise expenses against. Create and get a trip approved first.' };
    return { role: 'assistant', text: `I can help you raise an expense report. Do you want me to create a new expense report for Trip ${t.trip_no}, or do you want to upload your bills now?`, actions: [{ label: `Create Expense Report for ${t.trip_no}`, href: `/expenses/new?trip=${t.id}`, primary: true }, { label: 'Upload Bills and Create Report', href: `/expenses/new?trip=${t.id}&upload=1` }] };
  }
  if (/(upcoming|my trips|show.*trips)/.test(lower)) {
    const rows = db.all("SELECT id,trip_no,title,dep_date,ret_date,status FROM trips WHERE traveller_id=? AND ret_date>=? AND status NOT IN ('Cancelled','Rejected','Closed','Draft') ORDER BY dep_date LIMIT 5", user.id, today());
    return { role: 'assistant', text: rows.length ? 'Here are your upcoming trips:' : 'You have no upcoming trips.', card: rows.length ? { type: 'list', items: rows.map((r) => ({ title: `${r.trip_no} - ${r.title}`, sub: `${r.dep_date} to ${r.ret_date} · ${r.status}`, href: `/trips/${r.id}` })) } : undefined };
  }
  if (/(claim limit|advance|limit)/.test(lower)) return { role: 'assistant', text: `The maximum travel advance allowed is ₹${getSetting(db, 'max_advance', 50000).toLocaleString('en-IN')}. Trips costing more than ₹${getSetting(db, 'threshold_amount', 100000).toLocaleString('en-IN')} need additional approvals, and physical receipts are mandatory for expense claims.` };
  if (/(policy|guideline|allowed)/.test(lower)) {
    const type = /hotel|stay/.test(lower) ? 'Hotel' : /flight|fly|air/.test(lower) ? 'Flight' : null;
    const rules = db.all(`SELECT rule_no,name,description,conditions FROM policy_rules WHERE status='Active' ${type ? 'AND type=?' : ''} ORDER BY rule_no LIMIT 6`, ...(type ? [type] : []));
    return { role: 'assistant', text: `Here ${type ? `is the ${type.toLowerCase()} policy` : 'are the main travel policies'}:`, card: { type: 'list', items: rules.map((r) => ({ title: `${r.rule_no} - ${r.name}`, sub: r.description || '' })) }, actions: [{ label: 'Open Travel Policy', href: '/policy' }] };
  }
  if (/(claim|reimbursement|payment|paid)/.test(lower) || /status/.test(lower)) {
    const rows = db.all('SELECT r.id,r.report_no,r.status,rb.status ps,rb.payable_amount FROM expense_reports r LEFT JOIN reimbursements rb ON rb.report_id=r.id WHERE r.user_id=? ORDER BY r.id DESC LIMIT 4', user.id);
    return { role: 'assistant', text: rows.length ? 'Here is the status of your latest expense reports:' : 'You have no expense reports yet.', card: rows.length ? { type: 'list', items: rows.map((r) => ({ title: `${r.report_no} - ${r.ps || r.status}`, sub: r.payable_amount ? `Payable ₹${r.payable_amount.toLocaleString('en-IN')}` : r.status, href: `/expenses/${r.id}` })) } : undefined };
  }
  if (/cancel/.test(lower)) {
    const rows = db.all("SELECT id,booking_no,route,detail,travel_date FROM bookings WHERE traveller_id=? AND status IN ('Confirmed','Created') ORDER BY travel_date LIMIT 4", user.id);
    return { role: 'assistant', text: 'For safety I do not cancel bookings from chat. Open the booking below and use "Change / Cancel" - you will see the penalty and refund before confirming.', card: { type: 'list', items: rows.map((r) => ({ title: `${r.booking_no} - ${r.route}`, sub: `${r.detail} · ${r.travel_date}`, href: '/bookings' })) } };
  }
  return { role: 'assistant', text: 'I can help you plan a trip, raise an expense, check policy, track reimbursements or list your upcoming trips. Try: "I need to travel to Mumbai from 12 Nov to 14 Nov for a client meeting".' };
}
export function chat(db, user, text) {
  save(db, user.id, 'user', { text: String(text || '').slice(0, 500) });
  const r = respond(db, user, text);
  const { role, ...content } = r; save(db, user.id, role, content);
  return history(db, user).slice(-2);
}
export { AIRPORTS };
