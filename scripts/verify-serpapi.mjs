// Explicit live check: consumes up to eight SerpApi searches; prints no keys or tokens.
// Run: node --import tsx scripts/verify-serpapi.mjs
import nextEnv from '@next/env';
import { fetchGoogleFlights, normalizeBookingOptions, normalizeItinerary } from '../src/lib/providers/serpapi.js';
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
if (!process.env.SERPAPI_API_KEY?.trim()) {
  console.log('Live verification unavailable: configure SERPAPI_API_KEY in .env.local or the server environment.');
  process.exitCode = 2;
} else {
  const date = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const base = { departure_id: 'DEL', arrival_id: 'BOM', outbound_date: date(30), adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0, travel_class: 1 };
  let failed = false;
  for (const type of [2, 1, 3]) {
    try {
      const params = type === 3 ? { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0, travel_class: 1, type, multi_city_json: JSON.stringify([{ departure_id: 'DEL', arrival_id: 'BOM', date: date(30) }, { departure_id: 'BOM', arrival_id: 'DEL', date: date(35) }]) } : { ...base, type, ...(type === 1 ? { return_date: date(35) } : {}) };
      let response = await fetchGoogleFlights(params);
      let choices = [...(response.best_flights || []), ...(response.other_flights || [])];
      console.log(JSON.stringify({ journey: type === 2 ? 'one-way' : type === 1 ? 'round-trip' : 'multi-city', stage: 'initial', result_count: choices.length, provider_status: response.search_metadata?.status || 'unspecified' }));
      if (!choices.length) { failed = true; continue; }
      let chosen = choices.find((f) => type === 2 ? f.booking_token : f.departure_token);
      if (type !== 2 && chosen?.departure_token) {
        response = await fetchGoogleFlights({ ...params, departure_token: chosen.departure_token });
        choices = [...(response.best_flights || []), ...(response.other_flights || [])];
        console.log(JSON.stringify({ journey: type, stage: 'next-leg', result_count: choices.length }));
        chosen = choices.find((f) => f.booking_token);
      }
      if (!chosen?.booking_token) { console.log('No booking token returned for this selection.'); failed = true; continue; }
      const view = normalizeItinerary(chosen, 'verification');
      response = await fetchGoogleFlights({ ...params, booking_token: chosen.booking_token });
      const options = normalizeBookingOptions(response);
      console.log(JSON.stringify({ journey: type, stage: 'booking-options', segment_count: view.segments.length, price_returned: view.price !== null, provider_count: options.length, link_count: options.filter((o) => o.request).length, post_form_count: options.filter((o) => o.request?.fields).length }));
    } catch (error) {
      console.log(JSON.stringify({ journey: type, status: error.status || 500, error: 'Live verification failed; check the provider configuration, quota and availability.' }));
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
}
