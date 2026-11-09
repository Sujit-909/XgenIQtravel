import { safeExternalUrl } from './serpapi';
const text = (v) => typeof v === 'string' ? v.slice(0, 12000) : '';
const list = (v) => Array.isArray(v) ? v.filter((item) => item != null) : [];
const strings = (v) => list(v).filter((s) => typeof s === 'string').slice(0, 100);
const number = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
export function hotelPrice(raw) {
  const amount = number(raw?.extracted_lowest) ?? number(raw?.extracted_after_taxes_fees) ?? number(raw?.extracted_display_price);
  return { amount, display: text(raw?.lowest || raw?.after_taxes_fees || raw?.display_price), before_tax: number(raw?.extracted_before_taxes_fees), after_tax: number(raw?.extracted_after_taxes_fees) };
}
function rate(raw, id, room = '') {
  return { id, source: text(raw.source) || 'Booking provider', room, link: safeExternalUrl(raw.link), logo: safeExternalUrl(raw.logo), official: typeof raw.official === 'boolean' ? raw.official : null,
    nightly: hotelPrice(raw.rate_per_night), total: hotelPrice(raw.total_rate), guests: number(raw.num_guests),
    free_cancellation: typeof raw.free_cancellation === 'boolean' ? raw.free_cancellation : null, cancellation_date: text(raw.free_cancellation_until_date), cancellation_time: text(raw.free_cancellation_until_time), inclusions: strings(raw.inclusions), offers: strings(raw.discount_remarks) };
}
export function normalizeHotel(raw, id) {
  const rates = []; const seen = new Set();
  const add = (value, source, room) => {
    if (!value || typeof value !== 'object') return;
    const r = rate({ ...source, ...value }, `${id}-rate-${rates.length}`, room);
    const key = JSON.stringify([r.source, r.room, r.link, r.nightly, r.total, r.free_cancellation]);
    if (!seen.has(key)) { seen.add(key); rates.push(r); }
  };
  for (const provider of [...list(raw.featured_prices), ...list(raw.prices)]) {
    add(provider);
    for (const room of list(provider.rooms)) { add(room, provider, text(room.name)); for (const r of list(room.rates)) add(r, { ...provider, ...room }, text(room.name)); }
  }
  if (!rates.length && safeExternalUrl(raw.link)) add({ source: raw.name, link: raw.link });
  const images = list(raw.images).map((i) => safeExternalUrl(typeof i === 'string' ? i : i.original_image || i.thumbnail)).filter(Boolean).slice(0, 20);
  if (!images.length && safeExternalUrl(raw.thumbnail)) images.push(safeExternalUrl(raw.thumbnail));
  return { id, name: text(raw.name) || 'Unnamed property', type: text(raw.type), description: text(raw.description), address: text(raw.address), phone: text(raw.phone),
    location: strings(raw.essential_info).join(' · '), images, rating: number(raw.overall_rating), reviews: number(raw.reviews), stars: number(raw.extracted_hotel_class), category: text(raw.hotel_class),
    nightly: hotelPrice(raw.rate_per_night), total: hotelPrice(raw.total_rate), amenities: strings(raw.amenities), check_in: text(raw.check_in_time), check_out: text(raw.check_out_time),
    free_cancellation: typeof raw.free_cancellation === 'boolean' ? raw.free_cancellation : null, offers: strings(raw.discount_remarks),
    canDetails: typeof raw.property_token === 'string' && !!raw.property_token, rates };
}
// Tokens and provider URLs remain server-held; the UI uses authorized redirect IDs.
export function publicHotel(hotel) {
  return { ...hotel, rates: hotel.rates.map(({ link, ...r }) => ({ ...r, canRedirect: !!link })) };
}
