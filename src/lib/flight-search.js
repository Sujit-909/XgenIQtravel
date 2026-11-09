// Shared validation and display helpers; no credentials or server dependencies.
import { AIRPORTS } from './constants';

export const CABINS = ['Economy', 'Premium Economy', 'Business', 'First Class'];
export function airportCode(value) {
  const input = String(value || '').trim();
  const known = AIRPORTS.find(([code, label]) => code === input.toUpperCase() || label.toLowerCase() === input.toLowerCase() || label.split(' (')[0].toLowerCase() === input.toLowerCase());
  if (known) return known[0];
  const code = input.match(/\(([A-Za-z]{3})\)$/)?.[1] || input;
  return /^[A-Za-z]{3}$/.test(code) ? code.toUpperCase() : '';
}
export function validateFlightSearch(input, today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Flight search is required');
  const type = Number(input.type);
  if (![1, 2, 3].includes(type)) throw new Error('Select one-way, round-trip or multi-city');
  const result = { type };
  for (const [key, fallback, min] of [['adults', 1, 1], ['children', 0, 0], ['infants_in_seat', 0, 0], ['infants_on_lap', 0, 0]]) {
    const n = Number(input[key] ?? fallback);
    if (!Number.isInteger(n) || n < min || n > 9) throw new Error('Passenger counts must be whole numbers between 0 and 9, with at least one adult');
    result[key] = n;
  }
  if (result.adults + result.children + result.infants_in_seat + result.infants_on_lap > 9) throw new Error('Search for at most nine passengers');
  if (result.infants_on_lap > result.adults) throw new Error('Each infant on lap needs an adult');
  result.travel_class = Number(input.travel_class ?? 1);
  if (![1, 2, 3, 4].includes(result.travel_class)) throw new Error('Select a valid cabin class');
  const date = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value || value < today) throw new Error('Travel dates must be valid and cannot be in the past');
    return value;
  };
  const leg = (v) => {
    if (!v || typeof v !== 'object') throw new Error('Enter each flight leg');
    const departure_id = airportCode(v.departure_id); const arrival_id = airportCode(v.arrival_id);
    if (!departure_id || !arrival_id) throw new Error('Enter a city from the suggestions or a three-letter IATA airport code');
    if (departure_id === arrival_id) throw new Error('Origin and destination must be different');
    return { departure_id, arrival_id, date: date(v.date) };
  };
  if (type === 3) {
    if (!Array.isArray(input.legs) || input.legs.length < 2 || input.legs.length > 6) throw new Error('Multi-city requires two to six flight legs');
    result.legs = input.legs.map(leg);
    if (result.legs.some((v, i) => i > 0 && v.date < result.legs[i - 1].date)) throw new Error('Multi-city dates must be in travel order');
  } else {
    const l = leg({ departure_id: input.departure_id, arrival_id: input.arrival_id, date: input.outbound_date });
    Object.assign(result, { departure_id: l.departure_id, arrival_id: l.arrival_id, outbound_date: l.date });
    if (type === 1) {
      result.return_date = date(input.return_date);
      if (result.return_date < result.outbound_date) throw new Error('Return date cannot be before departure');
    }
  }
  return result;
}
export const flightDuration = (minutes) => Number.isFinite(minutes) ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : 'Duration unavailable';

export function filterFlights(rows, filters) {
  const time = (v) => v?.slice(11, 16) || '';
  const shown = rows.filter((r) => (!filters.airline || r.segments.some((s) => s.airline === filters.airline)) &&
    (filters.stops === '' || r.stops === Number(filters.stops)) &&
    (!filters.max_price || (r.price !== null && r.price <= Number(filters.max_price))) &&
    (!filters.max_duration || (r.duration !== null && r.duration <= Number(filters.max_duration))) &&
    (!filters.departure || time(r.segments[0]?.departure.time) >= filters.departure) &&
    (!filters.arrival || time(r.segments.at(-1)?.arrival.time) <= filters.arrival));
  const num = (v) => v ?? Infinity;
  return shown.sort((a, b) => filters.sort === 'cheapest' ? num(a.price) - num(b.price) : filters.sort === 'fastest' ? num(a.duration) - num(b.duration) : filters.sort === 'earliest' ? (a.segments[0]?.departure.time || 'Z').localeCompare(b.segments[0]?.departure.time || 'Z') : Number(b.recommended) - Number(a.recommended));
}
