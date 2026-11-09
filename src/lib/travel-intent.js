import { AIRPORTS } from './constants';

export const travelToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const plus = (date, days) => { const d = new Date(`${date}T12:00:00Z`); if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== date || !Number.isFinite(days)) return date; d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
export function travelDates(text, base = travelToday()) {
  const hits = [];
  for (const m of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) hits.push([m.index, m[1]]);
  for (const m of text.toLowerCase().matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(20\d{2}))?\b/g)) {
    let year = Number(m[3] || base.slice(0,4)); const month = MONTHS.indexOf(m[2]) + 1;
    let value = `${year}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    if (!m[3] && value < base) value = `${++year}${value.slice(4)}`;
    hits.push([m.index,value]);
  }
  for (const m of text.toLowerCase().matchAll(/\b(today|tomorrow|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/g)) {
    const name = m[1].replace('next ',''); let days = name === 'today' ? 0 : name === 'tomorrow' ? 1 : (['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(name) - new Date(`${base}T12:00:00Z`).getUTCDay() + 7) % 7 || 7;
    hits.push([m.index,plus(base,days)]);
  }
  return hits.sort((a,b)=>a[0]-b[0]).map((h)=>h[1]);
}
export function travelIntent(message) {
  return /\b(?:find|search|book|reserve|plan|create|arrange|need|want|visit|visiting|travel to)\b/i.test(message) && /\b(?:flights?|hotels?|trip|travel|visit|visiting)\b/i.test(message) && !/\b(?:policy|guidance|checklist|how (?:can|do|to)|explain)\b/i.test(message);
}
export function extractTravel(message, previous = {}, base = travelToday()) {
  const t = message.toLowerCase().replace(/bangalore/g,'bengaluru'); const patch = {};
  const cities = AIRPORTS.map(([code,label])=>({ code, city:label.split(' (')[0] }));
  const find = (part) => cities.find((c)=>new RegExp(`\\b(?:${c.city}|${c.code})\\b`,'i').test(part));
  const from = t.match(/\bfrom\s+(.+?)(?=\bto\b|\bon\b|\bfor\b|$)/)?.[1]; const to = t.match(/\b(?:to|visit|visiting|in|near)\s+(.+)/)?.[1];
  if (from && find(from)) patch.origin = find(from).city;
  if (to && find(to)) patch.destination = find(to).city;
  if (!to && !from && !previous.destination && find(t)) patch.destination = find(t).city;
  if (/\bflight|trip|visit|travel\b/.test(t)) patch.needs_flight = true;
  if (/\bhotel|stay|accommodation\b/.test(t)) patch.needs_hotel = true;
  if (/\bhotel\b/.test(t) && !/\b(?:flight|trip|visit|travel)\b/.test(t) && previous.needs_flight === undefined) patch.needs_flight = false;
  if (/hotel only|no flights?/.test(t)) patch.needs_flight = false;
  if (/flight only|no hotels?/.test(t)) patch.needs_hotel = false;
  if (/one[ -]way/.test(t)) patch.type = 2;
  if (/round[ -]trip|return flight/.test(t)) patch.type = 1;
  const dates = travelDates(message,base);
  if (dates.length) {
    if (dates.length === 1 && (/\breturn|back|check[ -]?out\b/.test(t) || (previous.departure && !previous.return_date && !/depart|leave|check[ -]?in|change/.test(t)))) patch.return_date = dates[0];
    else patch.departure = dates[0];
    if (dates[1]) patch.return_date = dates[1];
    if (/\bchange\b.*\bhotel\b|\bhotel\b.*\bdates\b/.test(t)) { if (patch.departure) {patch.check_in=patch.departure;delete patch.departure;} if(patch.return_date){patch.check_out=patch.return_date;delete patch.return_date;} }
  }
  const departure = patch.departure || previous.departure;
  const duration = t.match(/\b(?:for\s+)?(\d{1,2}|three|two|four|five)\s+(days?|nights?)\b/);
  if (duration) { const n = /^\d+$/.test(duration[1]) ? Number(duration[1]) : ({two:2,three:3,four:4,five:5})[duration[1]]; patch.return_offset_days = n - (duration[2].startsWith('day') ? 1 : 0); }
  if (departure && !patch.return_date && (patch.return_offset_days ?? previous.return_offset_days) !== undefined) patch.return_date = plus(departure, patch.return_offset_days ?? previous.return_offset_days);
  for (const [pattern,key] of [[/(\d+)\s+(?:passengers?|adults?)/,'adults'],[/(\d+)\s+guests?/,'guests'],[/(\d+)\s+rooms?/,'rooms']]) { const m = t.match(pattern); if(m) patch[key]=Number(m[1]); }
  if (/morning/.test(t)) patch.departure_time = 'morning'; else if (/evening/.test(t)) patch.departure_time = 'evening'; else if (/afternoon/.test(t)) patch.departure_time = 'afternoon';
  if (/premium economy/.test(t)) patch.travel_class = 2; else if (/business class/.test(t)) patch.travel_class = 3; else if (/first class/.test(t)) patch.travel_class = 4; else if (/economy/.test(t)) patch.travel_class = 1;
  if (/refundable|free cancellation/.test(t)) patch.free_cancellation = !/non[ -]?refundable/.test(t);
  const budget = t.match(/(?:under|budget(?: of)?|below|up to)\s*(?:₹|rs\.?|inr)?\s*([\d,]+)/);
  if (budget) patch[/hotel|night/.test(t) ? 'hotel_budget' : 'flight_budget'] = Number(budget[1].replaceAll(',',''));
  if (/client meeting/.test(t)) { patch.purpose = 'Client meeting'; patch.purpose_text = 'Client meeting'; }
  else if (/training|conference/.test(t)) { patch.purpose = 'Training / conference'; patch.purpose_text = 'Training / conference'; }
  else if (/internal meeting/.test(t)) { patch.purpose = 'Internal meeting'; patch.purpose_text = 'Internal meeting'; }
  else if (/site visit|project/.test(t)) { patch.purpose = 'Project / site visit'; patch.purpose_text = 'Project / site visit'; }
  return patch;
}
