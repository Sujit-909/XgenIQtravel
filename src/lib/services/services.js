import { json } from '../db';
import { bad, conflict, forbidden, notFound, nowIso, today, addDays, isDate, daysBetween, seq, pad, audit, notify, insert, comment, getSetting, num } from '../util';
import { loadTrip } from './trips';
import { createChain } from './chain';
import { evaluateFlight, evaluateHotel, rankFlights } from './policy';
import { searchFlights, getFlightOffer, searchHotels, getHotelOffer, searchVehicles, getVehicleOffer, cityToAirport, AIRPORTS, pnr } from '../providers/mock';

export const SERVICE_TYPES = ['flight', 'hotel', 'ground', 'visa', 'other'];
export const OTHER_SERVICES = ['Travel Insurance', 'International SIM', 'Lounge Access', 'Foreign Exchange', 'Conference Registration', 'Other (Specify)'];
const REQUIRED = {
  flight: [['from', 'From'], ['to', 'To'], ['depart_date', 'Departure date']],
  hotel: [['city', 'Destination city'], ['check_in', 'Check-in date'], ['check_out', 'Check-out date'], ['rooms', 'Rooms']],
  ground: [['transport_type', 'Transport type'], ['pickup', 'Pickup location'], ['dropoff', 'Drop-off location'], ['pickup_date', 'Pickup date'], ['pickup_time', 'Pickup time'], ['passengers', 'Passengers']],
  visa: [['country', 'Destination country'], ['visa_type', 'Visa type'], ['purpose', 'Purpose of visit'], ['passport_number', 'Passport number'], ['passport_expiry', 'Passport expiry date']],
  other: [['services', 'At least one service']],
};
const bookableStatuses = ['Approved', 'Booking In Progress', 'Travel In Progress'];

function validateDetails(db, trip, type, d, channel) {
  const miss = REQUIRED[type].filter(([k]) => d[k] === undefined || d[k] === null || String(d[k]).trim() === '' || (Array.isArray(d[k]) && d[k].length === 0)).map(([, l]) => `${l} is required`);
  if (miss.length) throw bad(miss[0], { errors: miss });
  if (type === 'flight' && !isDate(d.depart_date)) throw bad('Departure date is invalid');
  if (type === 'flight' && d.return_date && (!isDate(d.return_date) || d.return_date < d.depart_date)) throw bad('Return date cannot be before departure date');
  if (type === 'hotel') {
    if (!isDate(d.check_in) || !isDate(d.check_out)) throw bad('Check-in / check-out dates are invalid');
    if (d.check_out <= d.check_in) throw bad('Check-out must be after check-in');
    if (num(d.rooms) < 1) throw bad('At least one room is required');
  }
  if (type === 'ground') {
    if (!isDate(d.pickup_date)) throw bad('Pickup date is invalid');
    if (num(d.passengers) < 1) throw bad('At least one passenger is required');
  }
  if (type === 'visa') {
    if (trip.travel_type !== 'International') throw conflict('Visa processing is only required for international trips');
    // Passport must be valid for 6 months beyond the end of travel
    const min = addDays(trip.ret_date, 183);
    if (!isDate(d.passport_expiry) || d.passport_expiry < min) throw bad(`Passport must be valid for at least 6 months after travel (expiry on or after ${min})`);
  }
  void channel;
}

// Create / update / submit a service request (agency channel, visa, other, and drafts).
export function saveService(db, user, tripId, input) {
  return db.tx(() => {
    const trip = loadTrip(db, user, tripId);
    if (!SERVICE_TYPES.includes(input.type)) throw bad('Unknown service type');
    if (!bookableStatuses.includes(trip.status)) throw conflict('Services can only be requested for an approved trip');
    const channel = input.channel === 'agency' ? 'agency' : 'portal';
    const details = { ...(input.details || {}) };
    if (input.type === 'visa') { details.travel_start = trip.dep_date; details.travel_end = trip.ret_date; }
    const draft = !!input.draft;
    if (!draft) {
      validateDetails(db, trip, input.type, details, channel);
      if (!String(input.comment || '').trim()) throw bad('A comment is required before submitting the request');
    }
    if (String(input.comment || '').length > 1000) throw bad('Comment is limited to 1000 characters');
    const slaByType = { flight: 24, hotel: 24, ground: 12, visa: 72, other: 48 };
    let id = input.id ? Number(input.id) : null;
    if (id) {
      const cur = db.get('SELECT * FROM services WHERE id=? AND trip_id=?', id, tripId);
      if (!cur) throw notFound('Service request not found');
      if (cur.status !== 'Draft') throw conflict('Only draft requests can be edited');
      db.run('UPDATE services SET details=?, comment=?, status=?, desk_stage=?, channel=?, updated_at=? WHERE id=?', details, input.comment || null, draft ? 'Draft' : 'Submitted', draft ? null : 'Awaiting Agency Quote', channel, nowIso(), id);
    } else {
      id = insert(db, 'services', { srv_no: `SRV-${pad(seq(db, 'service'), 6)}`, trip_id: tripId, type: input.type, channel, status: draft ? 'Draft' : 'Submitted', desk_stage: draft ? null : 'Awaiting Agency Quote',
        details, comment: input.comment || null, priority: daysBetween(today(), trip.dep_date) <= 3 ? 'High' : 'Medium', sla_hours: slaByType[input.type], created_by: user.id, created_at: nowIso(), updated_at: nowIso() });
    }
    if (!draft) {
      if (trip.status === 'Approved') db.run("UPDATE trips SET status='Booking In Progress', updated_at=? WHERE id=?", nowIso(), tripId);
      comment(db, 'service', id, user, input.comment, 'Employee');
      const desks = db.all("SELECT id FROM users WHERE role='travel_desk' AND active=1");
      const s = db.get('SELECT srv_no FROM services WHERE id=?', id);
      desks.forEach((u) => notify(db, u.id, { category: 'other', title: `New ${input.type} request ${s.srv_no}`, body: `${trip.trip_no} - ${trip.title}`, link: '/travel-desk', refKey: `srv-new:${id}` }));
      audit(db, user, 'service.submit', 'service', id, `${input.type} (${channel}) for ${trip.trip_no}`);
    }
    return db.get('SELECT * FROM services WHERE id=?', id);
  });
}

export { serviceTiles } from '../service-tiles';

// ---------- policy-aware search ----------
export function searchWithPolicy(db, user, q) {
  const trip = q.trip_id ? loadTrip(db, user, q.trip_id) : null;
  const out = {};
  const grade = user.grade;
  if (['flight', 'both'].includes(q.kind || 'both')) {
    const from = q.from && AIRPORTS[q.from] ? q.from : cityToAirport(q.from_city); const to = q.to && AIRPORTS[q.to] ? q.to : cityToAirport(q.to_city);
    if (!from || !to) throw bad('Select valid origin and destination airports');
    if (from === to) throw bad('Origin and destination must be different');
    if (!isDate(q.date)) throw bad('Departure date is required');
    if (q.date < today()) throw bad('Departure date cannot be in the past');
    const intl = AIRPORTS[from].country !== AIRPORTS[to].country;
    const travelType = trip?.travel_type || (intl ? 'International' : 'Domestic');
    const destCountry = AIRPORTS[to].country;
    const options = searchFlights({ from, to, date: q.date, cabin: q.cabin || 'Economy' }).map((o) => ({ ...o, policy: evaluateFlight(db, { offer: o, travelType, destCountry, grade }) }));
    const rank = rankFlights(options);
    out.flights = { options, ...rank, from, to, travelType };
  }
  if (['hotel', 'both'].includes(q.kind || 'both') && (q.city || q.to_city)) {
    const city = q.city || q.to_city;
    const checkIn = q.check_in || q.date; const checkOut = q.check_out || q.return_date || addDays(checkIn, 1);
    if (isDate(checkIn) && isDate(checkOut) && checkOut > checkIn) {
      const travelType = trip?.travel_type || (out.flights?.travelType ?? 'Domestic');
      const country = trip?.dest_country || (AIRPORTS[out.flights?.to]?.country ?? 'India');
      out.hotels = searchHotels({ city, checkIn, checkOut, rooms: num(q.rooms, 1), guests: num(q.guests, 1), maxPrice: q.max_price, minPrice: q.min_price, category: q.category, area: q.area, breakfast: q.breakfast === 'true' || q.breakfast === true, freeCancel: q.free_cancel === 'true' || q.free_cancel === true })
        .map((h) => ({ ...h, policy: evaluateHotel(db, { hotel: h, travelType, destCountry: country }) }));
    }
  }
  if (q.kind === 'ground') out.vehicles = searchVehicles({ transport: q.transport, passengers: q.passengers, luggage: q.luggage });
  // total trip cost comparison for the top three flight options
  if (out.flights && out.hotels?.length) {
    const hotel = out.hotels.find((h) => h.policy.status === 'Compliant') || out.hotels[0];
    const top = [out.flights.options.find((o) => o.id === out.flights.recommendedId), ...out.flights.options.filter((o) => o.id !== out.flights.recommendedId && o.bookable)].filter(Boolean).slice(0, 3);
    out.comparison = top.map((o, i) => {
      const base = Math.round(o.fare * 0.84); const taxes = o.fare - base; const transfer = 2000;
      return { option: i + 1, id: o.id, status: o.policy.status, flightFare: base, taxes, baggage: 0, transfer, hotel: hotel.total, total: o.fare + transfer + hotel.total };
    });
    out.cancellationExposure = out.flights.options.find((o) => o.id === out.flights.recommendedId) ? Math.round(out.flights.options.find((o) => o.id === out.flights.recommendedId).fare * 0.1) + 500 : 0;
  }
  return out;
}

// ---------- portal booking ----------
export function bookPortal(db, user, tripId, input) {
  let failed = null;
  const result = db.tx(() => {
    const trip = loadTrip(db, user, tripId);
    if (!bookableStatuses.includes(trip.status)) throw conflict('Bookings can only be made for an approved trip');
    if (!String(input.comment || '').trim()) throw bad('A comment is required before submitting the booking');
    const type = input.type;
    let offer; let amount; let bkType; let route; let detail; let travelDate; let endDate; let supplier; let policy = { status: 'Compliant', checks: [], rules: [] }; let details = {};
    const traveller = db.get('SELECT * FROM users WHERE id=?', trip.traveller_id);
    if (type === 'flight') {
      offer = getFlightOffer(input.offer_id);
      if (!offer) throw notFound('Selected flight is no longer available');
      policy = evaluateFlight(db, { offer, travelType: trip.travel_type, destCountry: trip.dest_country, grade: traveller.grade });
      amount = offer.fare * Math.max(1, num(input.passengers, 1)); bkType = 'flight'; route = `${offer.from} → ${offer.to}`; supplier = offer.airline; detail = `${offer.airline} ${offer.flightNo}`;
      travelDate = offer.date; endDate = offer.date;
      details = { from: offer.from, to: offer.to, airline: offer.airline, flightNo: offer.flightNo, depTime: offer.depTime, arrTime: offer.arrTime, duration: offer.durationLabel, baggageKg: offer.baggageKg, cabin: offer.cabin, stops: offer.stops, refundable: offer.refundable, fareFamily: offer.fareFamily, seat: input.seat || null, meal: input.meal || null };
    } else if (type === 'hotel') {
      offer = getHotelOffer(input.offer_id);
      if (!offer) throw notFound('Selected hotel is no longer available');
      const o2 = { ...offer, rooms: num(input.rooms, offer.rooms), guests: num(input.guests, offer.guests) };
      policy = evaluateHotel(db, { hotel: o2, travelType: trip.travel_type, destCountry: trip.dest_country });
      amount = o2.pricePerNight * o2.nights * o2.rooms; bkType = 'hotel'; route = offer.name; supplier = offer.name; detail = `${offer.name}, ${offer.city} · ${offer.nights} Night${offer.nights > 1 ? 's' : ''}`;
      travelDate = offer.checkIn; endDate = offer.checkOut;
      details = { hotel: offer.name, city: offer.city, area: offer.area, nights: offer.nights, rooms: o2.rooms, guests: o2.guests, breakfast: offer.breakfast, freeCancelUntil: offer.freeCancelDays ? addDays(offer.checkIn, -offer.freeCancelDays) : null, refundable: offer.freeCancelDays > 0 };
    } else if (type === 'ground') {
      offer = getVehicleOffer(input.offer_id);
      if (!offer) throw notFound('Selected vehicle is no longer available');
      amount = offer.fare; bkType = 'cab'; route = `${input.pickup || 'Pickup'} → ${input.dropoff || 'Drop'}`; supplier = offer.provider; detail = `${offer.vehicle} (${input.transport_type || 'Airport Transfer'})`;
      travelDate = input.pickup_date || trip.dep_date; endDate = travelDate;
      details = { vehicle: offer.vehicle, pickup: input.pickup, dropoff: input.dropoff, time: input.pickup_time, passengers: num(input.passengers, 1), luggage: num(input.luggage, 0), transport: input.transport_type };
    } else throw bad('Portal booking supports flight, hotel and ground transport');

    // Duplicate booking guard
    const dup = db.get("SELECT booking_no FROM bookings WHERE trip_id=? AND type=? AND route=? AND travel_date=? AND status NOT IN ('Cancelled')", tripId, bkType, route, travelDate);
    if (dup) throw conflict(`Duplicate booking: ${dup.booking_no} already exists for this trip, route and date`);
    const srvId = insert(db, 'services', { srv_no: `SRV-${pad(seq(db, 'service'), 6)}`, trip_id: tripId, type, channel: 'portal', status: 'In Progress', details: { offer_id: input.offer_id, ...details }, comment: input.comment, provider: supplier, priority: 'Medium', sla_hours: 1, created_by: user.id, created_at: nowIso(), updated_at: nowIso() });
    // Supplier failure (sold out / timeout) is recorded so travel desk and traveller are alerted
    if (offer.bookable === false) {
      db.run("UPDATE services SET status='Failed', desk_stage='Failed / Issues', updated_at=? WHERE id=?", nowIso(), srvId);
      notify(db, trip.traveller_id, { category: 'other', severity: 'danger', title: 'Booking failed', body: `${detail} is sold out. Please choose another option.`, link: `/trips/${tripId}`, refKey: `bk-fail:${srvId}` });
      audit(db, user, 'booking.failed', 'service', srvId, 'Supplier returned no availability');
      failed = srvId;
      return null;
    }
    // Budget re-check against the approved estimate (with tolerance)
    const used = db.get("SELECT COALESCE(SUM(amount),0) s FROM bookings WHERE trip_id=? AND status NOT IN ('Cancelled')", tripId).s;
    const tol = getSetting(db, 'price_tolerance_pct', 10);
    const overBudget = used + amount > trip.est_budget * (1 + tol / 100);
    const issues = [...policy.checks.filter((c) => !c.ok && c.severity !== 'info').map((c) => c.detail), ...(overBudget ? [`Exceeds approved trip budget of ₹${trip.est_budget.toLocaleString('en-IN')}`] : [])];
    const exception = policy.status !== 'Compliant' || overBudget;
    const justification = String(input.justification || '').trim();
    if (exception && justification.length < 10) throw bad('This option is outside policy or budget. A justification (min 10 characters) is mandatory.', { requiresJustification: true, policy: policy.status, issues });
    const no = `BK${pad(seq(db, 'booking'), 6)}`;
    const bid = insert(db, 'bookings', { booking_no: no, trip_id: tripId, service_id: srvId, traveller_id: trip.traveller_id, type: bkType, supplier, supplier_ref: pnr(`${no}${supplier}`), ticket_no: bkType === 'flight' && !exception ? `618-${2345000000 + Number(no.slice(2)) * 13}` : null,
      title: bkType === 'cab' ? 'Cab' : bkType === 'hotel' ? 'Hotel' : 'Flight', route, detail, details, booking_date: today(), travel_date: travelDate, end_date: endDate, amount, status: exception ? 'Created' : 'Confirmed',
      policy_status: overBudget && policy.status === 'Compliant' ? 'Exception Required' : policy.status, policy_note: issues.join('; ') || null, justification: justification || null, created_by: user.id, created_at: nowIso() });
    db.run('UPDATE services SET booking_id=?, status=?, desk_stage=? WHERE id=?', bid, exception ? 'Approved' : 'Confirmed', exception ? 'Approval Pending' : 'Completed', srvId);
    if (trip.status === 'Approved') db.run("UPDATE trips SET status='Booking In Progress', updated_at=? WHERE id=?", nowIso(), tripId);
    if (exception) {
      const mgr = db.get('SELECT id,name FROM users WHERE id=?', traveller.manager_id);
      const steps = [{ label: 'Policy Exception - Reporting Manager', approverId: mgr?.id || getSetting(db, 'emergency_approver_id', null), note: issues.join('; ') }];
      if (policy.status === 'Out of Policy') steps.push({ label: 'Policy Exception - Finance', approverId: getSetting(db, 'intl_approver_id', null), note: 'Out-of-policy fare' });
      createChain(db, 'booking', bid, steps);
      notify(db, steps[0].approverId, { category: 'approval', title: 'Policy exception needs approval', body: `${no} - ${detail}`, link: '/approvals', refKey: `bk-exc:${bid}` });
    }
    audit(db, user, exception ? 'booking.exception' : 'booking.confirm', 'booking', bid, `${no} ${detail} ₹${amount} ${policy.status}`);
    return { booking: db.get('SELECT * FROM bookings WHERE id=?', bid), service: db.get('SELECT * FROM services WHERE id=?', srvId), policy, exception, issues };
  });
  if (failed) throw conflict('Booking failed: the selected option is sold out. The travel desk has been alerted.', { failed: true, serviceId: failed });
  return result;
}

export function listTripServices(db, user, tripId) {
  loadTrip(db, user, tripId);
  return db.all('SELECT * FROM services WHERE trip_id=? ORDER BY id DESC', tripId).map((s) => ({ ...s, details: json(s.details, {}) }));
}
export { forbidden };
