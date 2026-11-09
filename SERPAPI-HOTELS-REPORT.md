# Google Hotels integration

The existing My Trip → Hotel Booking portal now searches live SerpApi Google Hotels inventory. It is reused on trip details and `/services/hotel?trip=<id>`. Agency requests, existing navigation, flight integration, dashboards, typography, theme, and trip access rules are preserved. No additional travel request or duplicate hotel page is created.

## Created and modified files

Created:

- `src/lib/hotel-search.js`: shared validation, documented filter IDs and provider parameter mapping.
- `src/lib/providers/hotels.js`: property, image, price, provider and cancellation normalization.
- `src/lib/services/hotels.js`: authenticated trip-scoped search, pagination, details, history, referral and Travel Desk requests.
- `src/views/hotel-portal.jsx`: search form, filters, property cards, details dialog, provider rates, children’s ages and history.
- `tests/54-hotels.test.js`: seven integration/regression tests covering inputs, responses, caching, access, pagination, redirects and approval behavior.
- `scripts/verify-hotels.mjs`: live provider verification without printing credentials or tokens.
- `SERPAPI-HOTELS-REPORT.md`: this report.

Modified:

- `src/lib/providers/serpapi.js`: shared server-side transport for `google_flights` and `google_hotels`, using the existing key, sanitized errors, timeout and shared rate limiter.
- `src/lib/services/flights.js`: reuses the shared limiter; existing flight behavior remains covered by its tests.
- `src/lib/schema.js`: additive `hotel_searches` table and indexes, applied when the database opens.
- `src/lib/api/routes.js`: hotel endpoints in the existing authenticated dispatcher.
- `src/views/services.jsx`: replaces the generated-inventory hotel portal with the live portal; agency forms remain available.
- `src/lib/services/desk.js`: checks the actual agency quote against existing hotel policy and budget rules for the new SerpApi hotel requests.
- `src/lib/services/bookings.js`: approving a SerpApi hotel exception leaves it awaiting supplier confirmation rather than manufacturing a confirmed reservation.
- `src/app/globals.css`: scoped hotel layouts and responsive cards using existing style variables.

`.env.example` already contained an empty `SERPAPI_API_KEY=` entry and was preserved. No new key or dependency was added. Earlier unrelated work remains in the working tree.

## Environment

The existing server-side `SERPAPI_API_KEY` in Git-ignored `.env.local` is reused. It is never a `NEXT_PUBLIC_` variable and is never returned to the browser. Provider request metadata, API-key query strings, raw pagination URLs and selection tokens are excluded from client responses. Missing configuration produces HTTP 503. Restart the server after changing its environment.

## Endpoints

All endpoints use existing session authentication and trip authorization. Search, pagination, details and referral require an approved active trip. Client-supplied prices, tokens, provider URLs and reservation statuses are ignored.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/hotels/search` | Validates `trip_id`, destination, dates, adults, children/ages, rooms and optional filters; starts a live search |
| `POST /api/hotels/page` | Accepts `search_id`; uses the server-held `next_page_token` with original criteria |
| `POST /api/hotels/details` | Accepts `search_id` and `property_id`; uses that result’s server-held `property_token` |
| `GET /api/hotels/search/<search_id>` | Retrieves an unexpired search owned by the current user |
| `GET /api/hotels/history?trip_id=<id>` | Returns the current user’s recent searches associated with the authorized trip |
| `GET /api/hotels/redirect?search_id=...&property_id=...&rate_id=...` | Rechecks access, expiry and policy, then returns HTTP 302 to the selected server-held HTTPS provider URL |
| `POST /api/hotels/request` | Sends a verified hotel/rate preference into the existing Travel Desk service-request workflow |

Search fields: `q`, `check_in_date`, `check_out_date`, `adults`, `children`, `children_ages` (array), `rooms`. Optional fields: `sort_by`, `min_price`, `max_price`, `rating`, `hotel_class`, `property_types`, `amenities` (array), `free_cancellation`, `special_offers`. Only supported, supplied optional values are sent upstream. All provider calls force `engine=google_hotels`, `currency=INR`, `gl=in`, `hl=en` and the server key.

Sort IDs: 3 lowest price, 8 highest rating, 13 most reviewed. Guest-rating IDs: 7 for 3.5+, 8 for 4.0+, 9 for 4.5+. Property types and amenities use documented SerpApi IDs, not inferred fields.

## Search, details and referral flows

1. Choose an existing approved trip and open Hotel Booking.
2. Enter destination, check-in/out, adults, children and each child’s age, and requested room count. Dates are validated both client-side and server-side, including real calendar dates and check-out after check-in. Children’s ages must match the count; age 1 represents children under one as required by the provider.
3. Choose price range, hotel class, guest rating, property type, amenities, cancellation, special offers and sorting. Filtering/sorting runs through supported provider parameters across the search, including later pages.
4. Compare actual hotel cards. Missing images, ratings, addresses or prices are identified rather than filled with dummy values. Prices retain provider-supplied display values and numeric quotes; a total is shown only when returned. Taxes and room allocation must be verified with the selected provider.
5. Open View Details to retrieve the property using its token. The dialog shows available photos, description, address/contact, amenities, room/rate variations, cancellation terms and providers. Official/partner labels are used only when supplied in the response.
6. A compliant priced rate offers an authorized provider referral. The application opens the server-validated external URL; it never processes payment or marks the reservation confirmed. Rates requiring policy/budget review are routed to Travel Desk assistance.
7. Hotel preferences sent to the Travel Desk include the server-held hotel/rate quote, guest/stay details, comment and required justification. Identical submissions are deduplicated. The existing agency quote, traveller acceptance and manager approval workflow handles fulfillment. Approvals alone do not confirm the new hotel reservation; the existing Travel Desk supplier-confirmation step remains required.

Hotel search history remains attached to the same trip. Search discovery creates no booking records. Travel Desk requests are existing `services` records, so the existing trip tracking, notifications, manager approvals, booking listings and finance processes continue to apply at their normal workflow stages.

## Caching, limits and security

- Five-minute server result cache scoped to user, trip, criteria and token; identical concurrent requests share one provider call.
- Search state expires after fifteen minutes; records older than thirty days are removed during subsequent searches.
- Flights and hotels share the existing SQLite-backed provider limit: ten uncached calls per user/minute and sixty per database/minute.
- Fixed provider host, HTTPS links, no server-side following of provider result URLs, 25-second timeout, sanitized errors, empty-result handling, and explicit expired-selection messages.
- Saving a preference additionally requires the traveller, requester, admin or Travel Desk role. Other trip viewers do not gain write access.
- Provider redirects re-evaluate current policy and budget, so cached quotes cannot bypass a changed budget.
- Browser loading states and submission locks avoid duplicate search/actions; prior pages are reused locally when navigating backward.

## Verification

- `npm test`: **168 tests, 159 passed, zero failed, nine optional Playwright browser tests skipped** because that harness’s dependencies are unavailable.
- Existing flight tests passed after sharing transport/limiting.
- Hotel tests cover destination/date/guest validation, child ages, optional parameter mapping, amenities/rating/sorting, result normalization, no results, missing data, safe links, caching/deduplication, user/trip authorization, token privacy/expiry, pagination, details, provider referral, trusted prices, duplicate service prevention, policy approval and absence of fabricated reservations.
- `npm run build`: **passed** using the isolated production output directory; the existing Next.js multiple-lockfile and Node SQLite experimental warnings remain.
- `npm run lint`: unavailable because the repository has no lint script or configured lint tool. Existing static import, server/client, route and secret checks passed in the test suite.
- Live provider verification passed using the existing key: Mumbai search returned **20 properties**; property details returned **9 images, 59 amenities, 18 provider/rate entries and 18 booking links**, including **13 cancellation rates**; pagination returned another **20 properties**. A lowest-price, minimum-rating, Free Wi-Fi and free-cancellation search returned **18 properties**.
- Independent Chrome checks against the running app verified actual search, next/previous pagination, property details and no page/panel overflow at **1366px, 1920px and 390px**. The selected Dubai property returned **9 photos and 109 provider/room-rate entries**, with **25 rates eligible for provider referral** under the current trip’s policy/budget. No checkout was submitted or reservation made.
- Chrome verified that selecting two children creates two age controls and accepts separate ages. A live authenticated provider referral returned HTTP 302 to an external HTTPS URL; checkout was deliberately not followed.
- Secret checks confirmed that the real key is absent from .env.example and production client assets; .env.local is Git-ignored.
- `git diff --check`: passed.
- Chrome screenshots and diagnostic artifacts are local and ignored under `.next-dev/hotel-qa/`.

## Limitations

- Google Hotels does not document a room-count search parameter. Requested rooms are retained with the trip and agency request but are not falsely sent as a supported API filter, used to multiply quotes, or claimed to be available. Multiple-room selections require Travel Desk verification of room allocation and the combined price.
- SerpApi provides discovery and provider referral, not reservation transactions or automated booking verification. No in-app payment or automatic confirmed status is added. The Travel Desk must obtain actual supplier confirmation through its existing workflow.
- Provider prices, links, room availability and cancellation deadlines can change; historical search quotes are not guaranteed reservation prices.
- No remote autocomplete was added: the existing free-text destination search is sufficient for this flow.
- Existing legacy policy-aware comparison and other non-hotel supplier flows are preserved. This new Hotel Booking portal does not use generated hotel inventory or the simulated portal-confirmation endpoint.

References: [Google Hotels parameters](https://serpapi.com/google-hotels-api), [property details and rates](https://serpapi.com/google-hotels-property-details), [property types](https://serpapi.com/google-hotels-property-types), [amenities](https://serpapi.com/google-hotels-amenities).
