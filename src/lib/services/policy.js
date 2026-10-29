import { json } from '../db';
import { bad, daysBetween, getSetting, notFound, nowIso, audit } from '../util';
import { fmtDuration, searchFlights, cityToAirport } from '../providers/mock';

const SEV = { Compliant: 0, 'Exception Required': 1, 'Out of Policy': 2 };
const worst = (a, b) => (SEV[b] > SEV[a] ? b : a);

export function cityTier(db, city) {
  const m = db.get("SELECT meta FROM master_data WHERE kind='city' AND lower(name)=lower(?)", city || '');
  return json(m?.meta, {})?.tier || 'Tier 2';
}

function activeRules(db, type) {
  return db.all("SELECT * FROM policy_rules WHERE type=? AND status='Active' ORDER BY rule_no", type)
    .map((r) => ({ ...r, conditions: json(r.conditions, {}) }));
}

// Evaluate a flight offer for a trip. Returns {status, checks[], rules[], preferred}
export function evaluateFlight(db, { offer, travelType, destCountry, grade, bookingDate }) {
  const rules = activeRules(db, 'Flight').filter((r) => {
    const c = r.conditions;
    if (c.travelType && c.travelType !== travelType) return false;
    if (c.countries && !c.countries.includes(destCountry)) return false;
    if (c.grades && grade && !c.grades.includes(grade)) return false;
    return true;
  });
  // Country-specific rules take precedence over generic ones
  const specific = rules.filter((r) => r.conditions.countries);
  const applied = specific.length ? specific : rules;
  const checks = []; let status = 'Compliant';
  for (const r of applied) {
    const c = r.conditions;
    if (c.maxFare != null) {
      const ok = offer.fare <= c.maxFare;
      checks.push({ label: 'Fare limit', ok, rule: r.rule_no, detail: ok ? `≤ ₹${c.maxFare.toLocaleString('en-IN')} (Your fare: ₹${offer.fare.toLocaleString('en-IN')})` : `Fare exceeds policy limit of ₹${c.maxFare.toLocaleString('en-IN')}`, severity: 'Out of Policy' });
      if (!ok) status = worst(status, 'Out of Policy');
    }
    if (c.maxDurationMin != null) {
      const ok = offer.duration <= c.maxDurationMin;
      checks.push({ label: 'Travel duration', ok, rule: r.rule_no, detail: ok ? `≤ ${fmtDuration(c.maxDurationMin)} (Your duration: ${fmtDuration(offer.duration)})` : `Travel time exceeds policy limit of ${Math.round(c.maxDurationMin / 60)} hours`, severity: 'Exception Required' });
      if (!ok) status = worst(status, 'Exception Required');
    }
    if (c.cabin && offer.cabin) {
      const allowed = Array.isArray(c.cabin) ? c.cabin : [c.cabin];
      const ok = allowed.includes(offer.cabin);
      checks.push({ label: 'Travel class', ok, rule: r.rule_no, detail: ok ? `${offer.cabin} allowed` : `${offer.cabin} not allowed (allowed: ${allowed.join(', ')})`, severity: 'Exception Required' });
      if (!ok) status = worst(status, 'Exception Required');
    }
  }
  // Advance booking window
  const adv = activeRules(db, 'General').find((r) => r.conditions.advanceDays != null);
  if (adv && offer.date) {
    const days = daysBetween(bookingDate || new Date().toISOString().slice(0, 10), offer.date);
    const ok = days >= adv.conditions.advanceDays;
    checks.push({ label: 'Advance booking', ok, rule: adv.rule_no, detail: ok ? `Booked ${days} days ahead (min ${adv.conditions.advanceDays})` : `Booked only ${days} days ahead (policy: ${adv.conditions.advanceDays} days)`, severity: 'Exception Required' });
    if (!ok) status = worst(status, 'Exception Required');
  }
  const pref = db.get("SELECT preferred FROM suppliers WHERE kind='airline' AND lower(name)=lower(?)", offer.airline);
  const preferred = !!pref?.preferred;
  checks.push({ label: 'Preferred supplier', ok: preferred, rule: 'PR006', detail: preferred ? 'Preferred' : 'Not a preferred airline', severity: 'info' });
  checks.push({ label: 'Refundable ticket', ok: !!offer.refundable, rule: 'PR001', detail: offer.refundable ? 'Recommended' : 'Non-refundable fare', severity: 'info' });
  return { status, checks, rules: applied.map((r) => r.rule_no), preferred };
}

export function evaluateHotel(db, { hotel, travelType, destCountry }) {
  const tier = travelType === 'International' ? 'International' : cityTier(db, hotel.city);
  const rule = activeRules(db, 'Hotel').find((r) => r.conditions.tier === tier && (!r.conditions.countries || r.conditions.countries.includes(destCountry)))
    || activeRules(db, 'Hotel').find((r) => r.conditions.tier === tier);
  const checks = []; let status = 'Compliant';
  if (rule) {
    const lim = rule.conditions.maxPerNight;
    const ok = hotel.pricePerNight <= lim;
    checks.push({ label: 'Nightly rate', ok, rule: rule.rule_no, detail: ok ? `≤ ₹${lim.toLocaleString('en-IN')} per night` : `Rate exceeds ₹${lim.toLocaleString('en-IN')} per night for ${tier} cities`, severity: 'Exception Required' });
    if (!ok) status = 'Exception Required';
    if (rule.conditions.maxStar && hotel.star > rule.conditions.maxStar) {
      checks.push({ label: 'Hotel category', ok: false, rule: rule.rule_no, detail: `${hotel.star}-star exceeds allowed category`, severity: 'Exception Required' });
      status = 'Exception Required';
    }
  }
  return { status, checks, rules: rule ? [rule.rule_no] : [], tier };
}

// "Lowest logical fare": cheapest compliant option after penalising extra stops and extra travel time.
export function rankFlights(options) {
  const minDur = Math.min(...options.map((o) => o.duration));
  const score = (o) => o.fare + o.stops * 1500 + Math.max(0, o.duration - minDur) / 60 * 800;
  const compliant = options.filter((o) => o.policy.status === 'Compliant' && o.bookable);
  const pool = compliant.length ? compliant : options.filter((o) => o.bookable);
  const best = [...pool].sort((a, b) => score(a) - score(b))[0];
  return { recommendedId: best?.id || null, cheapestId: [...options].filter((o) => o.bookable).sort((a, b) => a.fare - b.fare)[0]?.id || null };
}

// ---------- policy administration ----------
export function listPolicy(db) {
  const rules = db.all('SELECT * FROM policy_rules ORDER BY rule_no').map((r) => ({ ...r, conditions: json(r.conditions, {}) }));
  const versions = db.all('SELECT * FROM policy_versions ORDER BY id DESC LIMIT 20');
  const workflows = db.all('SELECT * FROM approval_workflows ORDER BY id').map((w) => ({ ...w, steps: json(w.steps, []) }));
  const suppliers = db.all('SELECT * FROM suppliers ORDER BY kind, name');
  const tiers = db.all("SELECT code,name,meta FROM master_data WHERE kind='city' ORDER BY name").map((c) => ({ ...c, ...json(c.meta, {}) }));
  return {
    rules, versions, workflows, suppliers, tiers,
    kpis: {
      total: rules.length, active: rules.filter((r) => r.status === 'Active').length, inactive: rules.filter((r) => r.status !== 'Active').length,
      flight: rules.filter((r) => r.type === 'Flight').length, hotel: rules.filter((r) => r.type === 'Hotel').length, workflows: workflows.length,
    },
  };
}

export function savePolicyRule(db, user, id, input) {
  const name = String(input.name || '').trim();
  if (!name) throw bad('Rule name is required');
  if (!input.type) throw bad('Rule type is required');
  if (!input.effective_from) throw bad('Effective from date is required');
  if (input.effective_to && input.effective_to < input.effective_from) throw bad('Effective to must be after effective from');
  const cond = typeof input.conditions === 'string' ? json(input.conditions, null) : input.conditions;
  if (cond === null || typeof cond !== 'object') throw bad('Conditions must be a JSON object');
  return db.tx(() => {
    if (id) {
      const cur = db.get('SELECT * FROM policy_rules WHERE id=?', id);
      if (!cur) throw notFound('Policy rule not found');
      const v = cur.version + 1;
      db.run('UPDATE policy_rules SET name=?,type=?,applicable_to=?,description=?,status=?,effective_from=?,effective_to=?,conditions=?,version=? WHERE id=?',
        name, input.type, input.applicable_to || cur.applicable_to, input.description ?? cur.description, input.status || cur.status, input.effective_from, input.effective_to || null, JSON.stringify(cond), v, id);
      db.run('UPDATE policy_versions SET status=? WHERE rule_id=? AND status=?', 'Expired', id, 'Active');
      db.run('INSERT INTO policy_versions(rule_id,version,effective_from,effective_to,changed_by,description,status,changed_at) VALUES(?,?,?,?,?,?,?,?)',
        id, v, input.effective_from, input.effective_to || null, user.name, input.change_note || 'Policy rule updated', 'Active', nowIso());
      audit(db, user, 'policy.update', 'policy_rule', id, `${cur.rule_no} v${v}`);
      return db.get('SELECT * FROM policy_rules WHERE id=?', id);
    }
    const n = db.get('SELECT COUNT(*) c FROM policy_rules').c + 1;
    const ruleNo = `PR${String(n).padStart(3, '0')}`;
    const r = db.run('INSERT INTO policy_rules(rule_no,name,type,applicable_to,description,status,effective_from,effective_to,conditions) VALUES(?,?,?,?,?,?,?,?,?)',
      ruleNo, name, input.type, input.applicable_to || 'All Employees', input.description || null, input.status || 'Draft', input.effective_from, input.effective_to || null, JSON.stringify(cond));
    db.run('INSERT INTO policy_versions(rule_id,version,effective_from,effective_to,changed_by,description,status,changed_at) VALUES(?,?,?,?,?,?,?,?)',
      r.id, 1, input.effective_from, input.effective_to || null, user.name, 'Initial version', input.status === 'Active' ? 'Active' : 'Draft', nowIso());
    audit(db, user, 'policy.create', 'policy_rule', r.id, ruleNo);
    return db.get('SELECT * FROM policy_rules WHERE id=?', r.id);
  });
}

// "Test Policy Rule": evaluate a sample trip against the active rules
export function testPolicy(db, input) {
  const from = cityToAirport(input.fromCity) || input.from; const to = cityToAirport(input.toCity) || input.to;
  const fare = Number(input.fare || 0);
  const base = searchFlights({ from, to, date: input.departDate, cabin: input.cabin || 'Economy' })[0];
  const offer = base ? { ...base, fare: fare || base.fare } : { fare, duration: 0, date: input.departDate, airline: input.airline || '', cabin: input.cabin || 'Economy', refundable: true };
  const res = evaluateFlight(db, { offer, travelType: input.travelType || 'Domestic', destCountry: input.destCountry || 'India', grade: input.grade, bookingDate: input.bookingDate });
  const threshold = getSetting(db, 'threshold_amount', 100000);
  const approval = input.travelType === 'International' ? 'Reporting Manager → Department Head → Finance / International Approver'
    : Number(input.estimatedFare || fare) > threshold ? 'Reporting Manager → Budget Owner → Department Head' : 'Reporting Manager only';
  return { ...res, approval, applicable: res.status === 'Compliant' };
}
