// Live verification: up to four provider calls; never prints credentials or tokens.
import nextEnv from '@next/env';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fetchGoogleHotels } from '../src/lib/providers/serpapi.js';
import { normalizeHotel, publicHotel } from '../src/lib/providers/hotels.js';
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
try {
  const params = { q: 'Mumbai', check_in_date: day(30), check_out_date: day(32), adults: 2, children: 1, children_ages: '8' };
  const raw = await fetchGoogleHotels(params);
  const rows = raw.properties || [];
  console.log(JSON.stringify({ stage: 'search', status: raw.search_metadata?.status, properties: rows.length, nextPageAvailable: !!raw.serpapi_pagination?.next_page_token }));
  if (!rows.length) throw new Error('No live search results');
  const chosen = rows.find((p) => p.property_token);
  if (!chosen) throw new Error('No property token returned');
  const detail = await fetchGoogleHotels({ ...params, property_token: chosen.property_token });
  const normalized = normalizeHotel(detail, 'live-property');
  console.log(JSON.stringify({ stage: 'details', hasName: !!detail.name, hasAddress: !!detail.address, images: normalized.images.length, amenities: normalized.amenities.length, providersAndRates: normalized.rates.length, bookingLinks: normalized.rates.filter((r) => r.link).length, cancellationRates: normalized.rates.filter((r) => r.free_cancellation === true).length, nightlyPriceReturned: normalized.nightly.amount !== null, stayPriceReturned: normalized.total.amount !== null }));
  if (raw.serpapi_pagination?.next_page_token) {
    const next = await fetchGoogleHotels({ ...params, next_page_token: raw.serpapi_pagination.next_page_token });
    console.log(JSON.stringify({ stage: 'pagination', properties: next.properties?.length || 0 }));
  }
  const filtered = await fetchGoogleHotels({ ...params, sort_by: 3, rating: 7, amenities: '35', free_cancellation: true });
  console.log(JSON.stringify({ stage: 'filters', properties: filtered.properties?.length || 0, lowestPriceSort: true, guestRating: '3.5+', amenity: 'Free Wi-Fi', freeCancellation: true }));
  mkdirSync('.next-dev/hotel-qa', { recursive: true });
  writeFileSync('.next-dev/hotel-qa/live-summary.json', JSON.stringify({ searchCount: rows.length, details: publicHotel(normalized), filteredCount: filtered.properties?.length || 0 }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ error: 'Live hotel verification did not complete. Check server configuration, quota and provider availability.', status: error.status || 500 }));
  process.exitCode = 1;
}
