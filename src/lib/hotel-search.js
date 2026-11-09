// Shared form validation and documented Google Hotels filter IDs.
export const HOTEL_AMENITIES = [[35, 'Free Wi-Fi'], [9, 'Free breakfast'], [1, 'Free parking'], [6, 'Pool'], [7, 'Fitness center'], [8, 'Restaurant'], [22, 'Room service'], [40, 'Air-conditioned'], [53, 'Wheelchair accessible'], [19, 'Pet-friendly'], [10, 'Spa']];
export const HOTEL_PROPERTY_TYPES = [[12, 'Beach hotels'], [13, 'Boutique hotels'], [14, 'Hostels'], [15, 'Inns'], [16, 'Motels'], [17, 'Resorts'], [18, 'Spa hotels'], [19, 'Bed and breakfasts'], [20, 'Other'], [21, 'Apartment hotels'], [22, 'Minshuku'], [23, 'Japanese-style business hotels'], [24, 'Ryokan']];
export const HOTEL_SORTS = [['', 'Recommended'], [3, 'Lowest price'], [8, 'Highest rating'], [13, 'Most reviewed']];
export function validateHotelSearch(input, today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter a hotel search');
  const q = String(input.q || '').trim();
  if (q.length < 2 || q.length > 200 || /[\x00-\x1f]/.test(q)) throw new Error('Enter a destination between 2 and 200 characters');
  const date = (s) => {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s || s < today) throw new Error('Stay dates must be valid and cannot be in the past');
    return s;
  };
  const check_in_date = date(input.check_in_date); const check_out_date = date(input.check_out_date);
  if (check_out_date <= check_in_date) throw new Error('Check-out must be after check-in');
  const integer = (key, fallback, min, max) => { const n = Number(input[key] ?? fallback); if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Enter a valid ${key.replace(/_/g, ' ')} (${min}-${max})`); return n; };
  const adults = integer('adults', 1, 1, 20); const children = integer('children', 0, 0, 10); const rooms = integer('rooms', 1, 1, 9);
  const children_ages = input.children_ages ?? [];
  if (!Array.isArray(children_ages) || children_ages.length !== children || children_ages.some((age) => !Number.isInteger(Number(age)) || Number(age) < 1 || Number(age) > 17)) throw new Error('Provide an age from 1 to 17 for every child (use 1 for children under one)');
  const out = { q, check_in_date, check_out_date, adults, children, children_ages: children_ages.map(Number), rooms };
  for (const key of ['min_price', 'max_price']) if (input[key] !== undefined && input[key] !== '') { const n = Number(input[key]); if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new Error('Price limits must be between 0 and 10000000 INR'); out[key] = n; }
  if (out.min_price !== undefined && out.max_price !== undefined && out.min_price > out.max_price) throw new Error('Maximum price must be at least the minimum price');
  for (const [key, allowed] of [['sort_by', [3, 8, 13]], ['rating', [7, 8, 9]], ['hotel_class', [2, 3, 4, 5]], ['property_types', HOTEL_PROPERTY_TYPES.map(([id]) => id)]]) {
    if (input[key] !== undefined && input[key] !== '') { const value = Number(input[key]); if (!allowed.includes(value)) throw new Error(`Select a supported ${key.replace(/_/g, ' ')}`); out[key] = value; }
  }
  if (input.amenities !== undefined) {
    if (!Array.isArray(input.amenities) || input.amenities.length > HOTEL_AMENITIES.length || input.amenities.some((id) => !HOTEL_AMENITIES.some(([value]) => value === Number(id)))) throw new Error('Select supported amenities');
    if (input.amenities.length) out.amenities = [...new Set(input.amenities.map(Number))].sort((a, b) => a - b);
  }
  for (const key of ['free_cancellation', 'special_offers']) {
    if (input[key] === true || input[key] === 'true') out[key] = true;
    else if (![undefined, false, '', 'false'].includes(input[key])) throw new Error('Invalid hotel filter');
  }
  return out;
}
export function hotelParameters(criteria, details = false) {
  const { rooms, children_ages, amenities, ...rest } = criteria;
  const out = details ? { check_in_date: rest.check_in_date, check_out_date: rest.check_out_date, adults: rest.adults, children: rest.children } : rest;
  if (children_ages.length) out.children_ages = children_ages.join(',');
  if (!details && amenities?.length) out.amenities = amenities.join(',');
  // Google Hotels exposes no room-count parameter. Preserve it as a trip preference.
  return out;
}
