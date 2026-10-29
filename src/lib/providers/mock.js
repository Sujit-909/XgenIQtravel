// Deterministic mock supplier inventory.
// Replace the two exported search/get functions with real supplier / GDS / hotel-API calls;
// the rest of the application only depends on the offer shape returned here.
import { addDays, daysBetween, today } from '../util';

export const AIRPORTS = {
  BBI: { city: 'Bhubaneswar', country: 'India', tz: 330 }, BOM: { city: 'Mumbai', country: 'India', tz: 330 },
  DEL: { city: 'Delhi', country: 'India', tz: 330 }, BLR: { city: 'Bengaluru', country: 'India', tz: 330 },
  CCU: { city: 'Kolkata', country: 'India', tz: 330 }, HYD: { city: 'Hyderabad', country: 'India', tz: 330 },
  MAA: { city: 'Chennai', country: 'India', tz: 330 }, PNQ: { city: 'Pune', country: 'India', tz: 330 },
  GOI: { city: 'Goa', country: 'India', tz: 330 },
  SIN: { city: 'Singapore', country: 'Singapore', tz: 480 }, DXB: { city: 'Dubai', country: 'UAE', tz: 240 },
  LHR: { city: 'London', country: 'United Kingdom', tz: 0 },
};
export const cityToAirport = (city) => Object.keys(AIRPORTS).find((k) => AIRPORTS[k].city.toLowerCase() === String(city || '').toLowerCase()) || null;

// [block minutes, base fare INR] for the direct leg; symmetric.
const PAIRS = {
  'BBI-BOM': [150, 6800], 'BBI-DEL': [140, 6500], 'BBI-BLR': [135, 6200], 'BBI-CCU': [65, 3800], 'BBI-HYD': [110, 5200], 'BBI-MAA': [120, 5600],
  'BOM-DEL': [130, 6900], 'BOM-BLR': [105, 5200], 'BOM-HYD': [95, 4800], 'BOM-GOI': [65, 3900], 'BOM-PNQ': [50, 3200], 'BOM-MAA': [115, 5400], 'BOM-CCU': [165, 7400],
  'DEL-BLR': [175, 7600], 'DEL-HYD': [135, 6100], 'DEL-CCU': [140, 6300], 'DEL-MAA': [175, 7400], 'BLR-HYD': [80, 4200], 'BLR-MAA': [60, 3600], 'BLR-CCU': [160, 6900],
  'BOM-SIN': [330, 38400], 'DEL-SIN': [345, 41000], 'BLR-SIN': [260, 33800], 'BBI-SIN': [300, 39500], 'BOM-DXB': [195, 24500], 'DEL-DXB': [200, 25500], 'BOM-LHR': [585, 61500], 'DEL-LHR': [555, 59500],
};
const pairInfo = (a, b) => {
  const k = [a, b].sort().join('-');
  return PAIRS[k] || [150, 6600];
};
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const hhmm = (min) => `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((min % 60) + 60) % 60).padStart(2, '0')}`;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fmtDuration = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

const DOM = [
  { code: '6E', name: 'IndiGo', dep: '08:00', mult: 1, bag: 15, ref: true, change: 1500, stops: 0, fam: 'Saver' },
  { code: 'AI', name: 'Air India', dep: '09:20', mult: 1.06, bag: 25, ref: true, change: 1000, stops: 0, fam: 'Flex' },
  { code: 'UK', name: 'Vistara', dep: '12:45', mult: 1.25, bag: 25, ref: true, change: 800, stops: 0, fam: 'Economy Flex' },
  { code: 'SG', name: 'SpiceJet', dep: '16:10', mult: 1.02, bag: 15, ref: false, change: 2000, stops: 0, fam: 'Saver' },
  { code: 'AI', name: 'Air India', dep: '06:30', mult: 0.82, bag: 25, ref: true, change: 1000, stops: 1, fam: 'Flex' },
];
const INTL = [
  { code: 'SQ', name: 'Singapore Airlines', dep: '10:20', mult: 1, bag: 25, ref: true, change: 0, stops: 0, fam: 'Economy Flex' },
  { code: 'AI', name: 'Air India', dep: '08:15', mult: 0.85, bag: 25, ref: true, change: 3000, stops: 1, fam: 'Economy Classic', extra: 245 },
  { code: 'EK', name: 'Emirates', dep: '13:10', mult: 1.115, bag: 30, ref: true, change: 0, stops: 1, fam: 'Economy Flex', extra: 260 },
  { code: 'QR', name: 'Qatar Airways', dep: '02:40', mult: 0.97, bag: 30, ref: true, change: 2500, stops: 1, fam: 'Economy Classic', extra: 290 },
];

export function searchFlights({ from, to, date, cabin = 'Economy' }) {
  const A = AIRPORTS[from]; const B = AIRPORTS[to];
  if (!A || !B || from === to) return [];
  const intl = A.country !== B.country;
  const [block, baseFare] = pairInfo(from, to);
  const advance = date ? daysBetween(today(), date) : 14;
  const surge = advance < 3 ? 1.35 : advance < 7 ? 1.18 : 1;
  const cab = cabin === 'Business' ? 2.4 : cabin === 'Premium Economy' ? 1.45 : 1;
  const list = intl ? INTL : DOM;
  return list.map((o, idx) => {
    const duration = o.stops ? Math.round(block * (intl ? 1.8 : 1.6)) + (o.extra || 0) - (intl ? 60 : 0) : block;
    const dep = o.dep;
    const arrMin = toMin(dep) + duration + (B.tz - A.tz);
    const fare = Math.round((baseFare * o.mult * surge * cab) / 50) * 50;
    const seats = (hash(`${from}${to}${date}${idx}`) % 9);
    return {
      id: `FL|${from}|${to}|${date}|${idx}|${cabin}`,
      type: 'flight', airline: o.name, code: o.code, flightNo: `${o.code}${100 + (hash(`${from}${to}${idx}`) % 800)}`,
      from, to, date, depTime: dep, arrTime: hhmm(arrMin), arrNextDay: arrMin >= 1440, duration, durationLabel: fmtDuration(duration),
      stops: o.stops, stopsLabel: o.stops ? `${o.stops} Stop (${intl ? 'DXB/DEL' : 'DEL'})` : 'Non-stop',
      fare, baggageKg: o.bag, refundable: o.ref, changeFee: o.change, fareFamily: o.fam, cabin,
      meal: !(o.code === 'SG' || (o.code === '6E' && !intl)), seatSelection: o.code === 'SQ' || o.code === 'UK',
      seats, bookable: seats > 0, international: intl,
    };
  });
}
export function getFlightOffer(id) {
  const [kind, from, to, date, idx, cabin] = String(id).split('|');
  if (kind !== 'FL') return null;
  return searchFlights({ from, to, date, cabin }).find((o) => o.id === id) || null;
}

const HOTELS = {
  Mumbai: [['Novotel Mumbai', 'BKC', 4, 8500, 4.2], ['Hilton Mumbai', 'BKC', 5, 11500, 4.5], ['Trident BKC', 'BKC', 5, 12800, 4.6], ['Ibis Mumbai', 'Andheri', 3, 6200, 3.9]],
  Delhi: [['The Leela Delhi', 'Chanakyapuri', 5, 12000, 4.7], ['Novotel Delhi', 'Aerocity', 4, 8200, 4.2], ['Lemon Tree Premier', 'Aerocity', 3, 5600, 4.0], ['ITC Maurya', 'Diplomatic Enclave', 5, 14500, 4.7]],
  Bengaluru: [['Taj MG Road', 'MG Road', 5, 11800, 4.6], ['Novotel Bengaluru', 'Whitefield', 4, 7800, 4.3], ['Ibis Bengaluru', 'Outer Ring Road', 3, 5400, 4.0]],
  Bhubaneswar: [['Mayfair Lagoon', 'Jayadev Vihar', 5, 8200, 4.5], ['Trident Bhubaneswar', 'Nayapalli', 5, 7600, 4.4], ['Swosti Premium', 'Jaydev Vihar', 4, 5200, 4.2]],
  Kolkata: [['Taj Bengal', 'Alipore', 5, 11200, 4.5], ['Novotel Kolkata', 'Rajarhat', 4, 7600, 4.2], ['Ibis Kolkata', 'Rajarhat', 3, 4800, 3.9]],
  Hyderabad: [['Novotel HICC', 'HITEC City', 4, 7900, 4.3], ['Taj Krishna', 'Banjara Hills', 5, 11400, 4.6], ['Lemon Tree', 'HITEC City', 3, 4900, 4.0]],
  Chennai: [['Novotel Chennai', 'OMR', 4, 7600, 4.2], ['ITC Grand Chola', 'Guindy', 5, 13200, 4.7], ['Ibis Chennai', 'OMR', 3, 4700, 3.9]],
  Pune: [['Westin Pune', 'Koregaon Park', 5, 10800, 4.5], ['Novotel Pune', 'Nagar Road', 4, 7200, 4.2]],
  Goa: [['Novotel Goa', 'Candolim', 4, 8800, 4.3], ['Taj Holiday Village', 'Candolim', 5, 13800, 4.6]],
  Singapore: [['Marriott Tang Plaza', 'Orchard Road', 5, 12400, 4.5], ['Holiday Inn Singapore', 'Orchard Road', 4, 10800, 4.3], ['Ibis Singapore Novena', 'Novena', 3, 8900, 4.1]],
  Dubai: [['Rove Downtown', 'Downtown', 3, 8800, 4.2], ['Hilton Dubai Creek', 'Deira', 5, 14800, 4.5]],
  London: [['Hilton London Paddington', 'Paddington', 4, 17800, 4.2], ['Premier Inn London City', 'Tower Hill', 3, 12500, 4.1]],
};
export const hotelCities = () => Object.keys(HOTELS);

export function searchHotels({ city, checkIn, checkOut, rooms = 1, guests = 1, maxPrice, minPrice = 0, category, area, breakfast, freeCancel }) {
  const list = HOTELS[city] || [];
  const nights = checkIn && checkOut ? Math.max(1, daysBetween(checkIn, checkOut)) : 1;
  return list.map(([name, loc, star, price, rating], i) => {
    const bf = star >= 4 || i % 2 === 0;
    const fc = star >= 4 || i === 0;
    return {
      id: `HT|${city}|${i}|${checkIn}|${checkOut}`, type: 'hotel', name, city, area: loc, star, pricePerNight: price, rating,
      reviews: 400 + (hash(name) % 1200), breakfast: bf, freeCancelDays: fc ? 3 : 0,
      amenities: ['Wi-Fi', ...(bf ? ['Breakfast'] : []), ...(star >= 4 ? ['Business Center', 'Airport Transfer'] : [])],
      nights, rooms, guests, total: price * nights * rooms, checkIn, checkOut,
    };
  }).filter((h) => (maxPrice ? h.pricePerNight <= Number(maxPrice) : true) && h.pricePerNight >= Number(minPrice || 0)
    && (category && category !== 'All' ? h.star === Number(String(category)[0]) : true)
    && (area ? h.area.toLowerCase().includes(String(area).toLowerCase()) : true)
    && (breakfast ? h.breakfast : true) && (freeCancel ? h.freeCancelDays > 0 : true));
}
export function getHotelOffer(id) {
  const [kind, city, , checkIn, checkOut] = String(id).split('|');
  if (kind !== 'HT') return null;
  return searchHotels({ city, checkIn, checkOut }).find((h) => h.id === id) || null;
}

export const pnr = (seed) => hash(`pnr${seed}`).toString(36).toUpperCase().padEnd(6, 'X').slice(0, 6);
export const _addDays = addDays;

export function searchVehicles({ transport = 'Airport Transfer', passengers = 1, luggage = 1 }) {
  const mult = { 'Airport Transfer': 1, 'Local Taxi': 0.8, 'Rental Cab': 2.2, 'Company Cab': 0 }[transport] ?? 1;
  const list = [['Sedan', 4, 800], ['SUV', 6, 1400], ['Tempo Traveller', 12, 2600]];
  return list.filter(([, cap]) => cap >= Number(passengers || 1)).map(([name, cap, base], i) => ({
    id: `GT|${transport}|${name}`, type: 'ground', vehicle: name, capacity: cap, fare: Math.round(base * mult), provider: 'ComfortDelGro', luggageOk: Number(luggage || 0) <= cap, idx: i,
  }));
}
export function getVehicleOffer(id) {
  const [kind, transport, vehicle] = String(id).split('|');
  if (kind !== 'GT') return null;
  return searchVehicles({ transport, passengers: 1 }).find((v) => v.vehicle === vehicle) || null;
}
