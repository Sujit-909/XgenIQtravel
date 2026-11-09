# SerpApi flight integration

## Scope and files

The existing My Trips → Flight Booking portal now uses SerpApi Google Flights. The same portal is reused by `/services/flight?trip=<id>` and `/trips/<id>?service=flight`. No duplicate flight page, travel request or booking is created. Agency flight requests, hotel/ground services, existing dashboards, sidebar, header and login are preserved.

Created:

- `src/lib/flight-search.js`: shared validation, city/IATA mapping, cabin definitions, filtering and sorting.
- `src/lib/providers/serpapi.js`: server-side provider request, timeout/error handling, safe response normalization and booking links.
- `src/lib/services/flights.js`: user/trip authorization, search and selection state, caching, request deduplication, rate limits, history and saved options.
- `src/views/flight-portal.jsx`: compact search/results interface, sequential itinerary selection, provider options, history and saved options.
- `tests/51-flights.test.js`: validation, request mapping, token flows, errors, data ownership, key security, caching, rate limits and saved-option checks.
- `scripts/verify-serpapi.mjs`: explicit live verification of all journey types and booking options without printing keys or tokens.
- `SERPAPI-FLIGHTS-REPORT.md`: this report.

Modified for this integration:

- `.env.example`: documented server-only `SERPAPI_API_KEY`.
- `src/lib/schema.js`: additive SQLite tables `flight_searches`, `flight_options`, `flight_rate_limits` and indexes, created automatically when the database opens.
- `src/lib/api/routes.js`: authenticated flight endpoints.
- `src/lib/services/trips.js`: includes saved flight options in existing trip details.
- `src/views/services.jsx`: replaces the generated-inventory FlightPortal with the SerpApi portal; preserves the agency and other service forms.
- `src/views/trip-detail.jsx`: displays saved options separately from bookings, including on trips whose booking panel is closed.
- `src/app/globals.css`: flight-specific responsive layout using existing colors and surfaces.

Earlier dashboard enhancements remain in the working tree and are documented separately in `DASHBOARD-CARDS-REPORT.md`.

## Configuration

Add the real key to the existing Next.js server environment or to `geniq-travel/.env.local`:

```dotenv
SERPAPI_API_KEY=<your SerpApi key>
```

Restart an already-running application after changing its environment. `.env.local` is ignored by Git. The key is read only in the server provider adapter; it is never a `NEXT_PUBLIC_` variable, request body field or client response field. Missing configuration returns a helpful HTTP 503. No new dependency is required.

## Backend API

All routes use the existing authenticated API dispatcher, cookie sessions, same-origin checks and trip access rules. Responses have `Cache-Control: no-store`; the application caches provider results on the server.

| Endpoint | Input / purpose |
| --- | --- |
| `POST /api/flights/search` | `trip_id`, `type`, passenger counts, `travel_class`, airports/dates or `legs`; starts a search for an approved active trip |
| `POST /api/flights/next` | `search_id`, `offer_id`; resolves the server-held departure token for return or next multi-city leg |
| `POST /api/flights/booking-options` | `search_id`, `offer_id`; resolves the server-held booking token after all legs are selected |
| `POST /api/flights/options` | `search_id`, optional `offer_id`; saves the selected server response as a travel option, never as a booking |
| `GET /api/flights/history?trip_id=<id>` | recent searches for the current user and saved options for the authorized trip |
| `GET /api/flights/search/<search_id>` | resumes an unexpired search belonging to the current user |

Common input fields:

```json
{
  "trip_id": 123,
  "type": 1,
  "departure_id": "DEL",
  "arrival_id": "BOM",
  "outbound_date": "YYYY-MM-DD",
  "return_date": "YYYY-MM-DD",
  "adults": 1,
  "children": 0,
  "infants_in_seat": 0,
  "infants_on_lap": 0,
  "travel_class": 1
}
```

One-way uses `type=2` and omits `return_date`. Round-trip uses `type=1`. Multi-city uses `type=3` and `legs: [{departure_id, arrival_id, date}, ...]`; the backend serializes these as `multi_city_json` and omits top-level dates. Cabin values are 1 Economy, 2 Premium Economy, 3 Business, 4 First Class. Every provider request forces `engine=google_flights`, `currency=INR`, `hl=en`, `gl=in` and the server key.

Airports accept existing city suggestions or three-letter IATA codes. The server validates code syntax and rejects identical airports; the provider validates availability and airport codes outside the local suggestions. Dates must be real calendar dates, not in the past (India timezone), with return/leg dates in order. Searches allow 1–9 adults, nonnegative child/infant counts, at most nine passengers in total, at most one lap infant per adult, and two to six multi-city legs.

## Search and booking-options flows

1. Open Flight Booking on an approved trip. Choose journey type, airports, dates, passengers and cabin.
2. Search via the authenticated backend. Results use actual returned airlines, logos, flight numbers, segments, airport-local dates/times, duration, layovers, cabin, optional fare conditions and provider prices.
3. Apply client-side airline, exact stop count, maximum price/duration and local departure/arrival time filters. Sort by provider recommendation, cheapest, fastest or earliest departure without consuming more API calls.
4. For round-trip, select the outbound option; the backend uses its `departure_token` with the original criteria to retrieve return options. Multi-city repeats that flow for each subsequent leg.
5. Selecting the last leg resolves its `booking_token` and displays providers. Returned combined prices are displayed as supplied; leg prices are not summed. Missing prices, links or optional fields are identified without filling in invented data.
6. Airline-direct/third-party labels appear only when the response explicitly supplies the `airline` flag. Separate-ticket offers and departing/returning booking providers remain distinct. Phone-only options remain visible.
7. Provider URLs use HTTPS. When SerpApi supplies `booking_request.post_data`, the browser submits the supplied fields using a POST form instead of incorrectly treating the URL as a GET link. No payment or ticket issuance takes place in GENIQ through this adapter.
8. Save selected legs or the full itinerary as a travel option on the same trip. Server-held snapshots determine the price and itinerary; client price/status fields are ignored. Saved options are explicitly unconfirmed, are deduplicated, and never appear as confirmed bookings or consume trip booking budget.

Search IDs and offer IDs are opaque. Raw provider selection tokens stay on the server. Search access is scoped to the signed-in user; every operation rechecks trip access. Saving additionally requires the traveller, requester, administrator or travel desk role. The existing policy evaluator displays rule checks for the provider itinerary quote; this is advisory discovery, not booking approval or proof of reservation.

## Performance and failure handling

- 25-second provider timeout; sanitized 502/504 errors, quota/rate-limit 429, expired/unavailable selection 410, missing key 503.
- Five-minute server result cache scoped to user, trip, criteria and selection token.
- Identical simultaneous requests share one provider call within a process.
- SQLite-backed limits of ten uncached provider requests per user/minute and sixty per application database/minute.
- Selection state expires after fifteen minutes; search records older than thirty days are cleaned up during subsequent searches. Saved options persist separately as historical quotes.
- Browser search/action controls prevent duplicate submissions. History retrieval never calls SerpApi.
- Form validation, empty results, missing booking links, provider errors, loading state, history retry and expired-selection messages are included.

## Verification

- Final full suite: **157 tests, 148 passed, zero failed, nine optional browser tests skipped** because Playwright/Chromium/esbuild browser prerequisites are unavailable.
- Tests cover one-way, round-trip, three-leg multi-city, passenger and cabin combinations, bad dates/airport syntax, no results, malformed response, provider errors, timeouts, expired tokens, booking options and POST fields, separate tickets, user ownership, trip authorization/status, missing key, trusted server prices, no fabricated bookings, rate limits, caching and deduplication. Existing page, API, security and dashboard checks remain in the suite.
- `npm run build`: passed on the final source. Next.js emitted the existing multiple-lockfile warning; Node emitted its SQLite experimental warning.
- `git diff --check`: passed.
- Live SerpApi verification passed on 2026-11-04 using the configured server-side key. One-way: 61 initial results and one booking provider/link with POST fields. Round-trip: 64 outbound results, 62 return results selected through departure_token, and 13 booking providers/links with POST fields. Two-leg multi-city: 64 initial results, 62 next-leg results, and 15 booking providers/links with POST fields. All three searches returned prices, and the verification script exited successfully. No checkout was submitted and no reservation was created.
- The real key is stored only in the Git-ignored .env.local file; .env.example remains a placeholder.
- `npm run lint` is unavailable: this repository has no lint script or lint tool configured. Static import, route, client/server and secret checks run in the existing test suite.
- Live verification command: `node --import tsx scripts/verify-serpapi.mjs`. It requires a real configured key and consumes up to eight searches, without printing credentials, tokens or full provider payloads.

## Remaining limitations

- SerpApi is flight discovery and provider referral. It cannot issue tickets, take payment or verify a reservation; no confirmed status is manufactured. A separate provider verification integration would be required to import an externally completed reservation automatically.
- Airport suggestions reuse the application's local airport list; they are not a global remote airport-autocomplete service. Other airports can be entered by IATA code.
- Prices, links and token availability depend on SerpApi and Google Flights. Saved quotes are historical estimates and require a fresh search for current availability.
- Live browser layout, keyboard/form interactions and external provider checkout are not verified by the optional browser suite in this environment.
- The separate, pre-existing policy-aware comparison module and its legacy supplier implementation are outside this Flight Booking integration; they are preserved. This new portal does not use that inventory or its simulated confirmation endpoint.

Official response/parameter references: [Google Flights API](https://serpapi.com/google-flights-api) and [Booking Options](https://serpapi.com/google-flights-booking-options).
