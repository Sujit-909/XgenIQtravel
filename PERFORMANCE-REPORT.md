# Page-loading diagnosis and improvements — 29 October 2026

## Outcome

Implemented four targeted server-side improvements after collecting a baseline. The UI, login panel styling, authentication flow, permissions, API contracts, database schema, dependencies, and framework versions are preserved. Existing unrelated working-tree changes were retained.

The strongest measured improvement is approval-history processing at scale: median service time fell from **37.53ms to 23.87ms**, and materialized history rows fell from **20,041 to 11**. These are isolated service measurements, not deployed page-load measurements. The small seeded browser fixture did **not** demonstrate a consistent overall navigation or initial-load improvement; no such improvement is claimed.

## Problems identified and changes

1. **Development compilation dominates first visits.** The development log records `/login` compilation at 1,227ms and its first response at 1,684ms. The employee's first module transitions took 918–1,167ms for bookings, trips, and expenses, versus 164–185ms in the original production run (including the benchmark's 100ms settling delay). Development dashboard first-load JavaScript transferred about 2.17MB versus 120KB compressed in production. Use the existing `npm run build` followed by `npm start` when assessing normal production responsiveness. Compilation overhead is not an application query problem.

2. **Approvals loaded the entire visible history to calculate five KPIs.** `listApprovals` now calculates counts in SQLite and groups the three pending-tab counts in one query. The paginated rows, filters, status labels, personal/role ownership predicate, overdue cutoff, and unfiltered KPI semantics remain intact. No results are cached. Tests compare the aggregates to the original counting semantics across roles, types, and filters, check bounded materialization, and verify immediate freshness after a decision changes.

3. **Department spending reports issued one extra expense query per department.** A single grouped expense query now supplies the existing report rows. Existing expense scope, trip scope, null-department behavior, and rounding are preserved; no financial access policy was expanded. Tests compare amounts to the previous per-department query for manager, finance, and admin and verify employee denial.

4. **Profile loading queried and formatted documents twice.** Profile statistics now reuse the documents already fetched for display. This removes one read per profile bundle and avoids duplicate status formatting. Tests verify both query count and statistic correctness.

5. **Layout and page repeated session validation during the same server render.** `currentUser` now uses React's request-local server-render `cache`. Layout and page share a validated lookup within that render. Later requests still validate the signed token and current active-user row; role restrictions remain outside the memoized helper. There is no process-wide user, financial, or permission-result cache. This follows [Next.js 15 request memoization guidance](https://nextjs.org/docs/15/app/guides/caching#react-cache-function).

## Measurements

Service benchmark: application-seeded isolated in-memory SQLite, 25 warm calls per endpoint, authorization and JSON serialization included. SQL counters include both reads and writes. Approval scaling adds 20,000 approval-history records only to this disposable database and measures the service directly. Timing varies with host load; row and query reductions are more reliable than sub-millisecond timing changes.

| Operation | Before | After |
| --- | ---: | ---: |
| Approval history, 20,000 additional records: median | 37.53ms | 23.87ms |
| Same fixture: p95 | 58.06ms | 31.84ms |
| Same fixture: materialized rows | 20,041 | 11 |
| Same fixture: SQL calls | 6 | 4 |
| Admin department report: SQL calls, including auth | 9 | 4 |
| Employee profile bundle endpoint: SQL calls, including auth | 15 | 14 |
| Admin department report: median | 0.228ms | 0.237ms |
| Employee profile endpoint: median | 0.650ms | 0.866ms |

The last two timing results do not show a latency improvement for this small fixture despite reduced query work.

Production browser benchmark: local headless Chrome at 1440×900, no CPU/network throttling, isolated app-seeded database, four roles in sequence, fresh browser profile per run. `/login` is requested once to wait for server startup before browser measurement. Route changes use actual links when present; otherwise the report explicitly records a document navigation. Link timings include 20ms polling and 100ms settling and are not directly comparable to document load-event timings. Production runs were collected before and after, with a separate development baseline.

| Browser metric | Before production | Final production |
| --- | ---: | ---: |
| Login document TTFB | 277.4ms | 460.0ms |
| Login load event | 379.5ms | 643.1ms |
| Employee dashboard load event | 85.6ms | 375.5ms |
| Employee → trips link measurement | 165ms | 250ms |
| Employee → bookings link measurement | 185ms | 188ms |
| Employee → expenses link measurement | 164ms | 203ms |
| Employee → profile link measurement | 150ms | 203ms |
| Employee approvals HTTP API median, five requests | 7.4ms | 6.6ms |
| Shared first-load JS, Next production build | 103KB | 103KB |

The browser run is a smoke benchmark with too few repetitions to attribute general latency changes to the patch. It contains regressions as well as one small API improvement. Even the untouched login page was slower in the final run. This does not prove a host-related cause or establish a page-load win. A route loading boundary was trialed and removed after slower measured transitions; it is not part of the final implementation. No bundle-size reduction is claimed. DOM readiness and load events are not hydration or time-to-interactive metrics; a precise before/after usable-time metric was not collected.

Full per-role route/API records and server logs are in `performance-results/before.json`, `after.json`, `development-before.json`, their corresponding `*-server.log` files, and `services-before.json` / `services-after.json`. Final build output is in `performance-results/build.log`.

## Other areas inspected

- App Router pages already fetch primary data on the server; client views supply forms and interaction. No client/server conversion or blanket dynamic imports were justified by the measured bundle sizes.
- Shared API callbacks are stable; primary pages do not first wait for a client-side API effect. No broad duplicate-fetch or polling bottleneck was established.
- Existing pagination and batched readiness reads were preserved. No virtualization was added to small rendered tables.
- Dashboard greeting updates once after mounting; header search state is already isolated. No measured React rendering bottleneck justified additional component memoization.
- Login background is a 124,260-byte JPEG using `background-size: cover`; fonts use a local/system fallback stack, with no external font request in the styles. No image, font, icon, palette, or animation change was justified by this baseline.
- Synchronous SQLite and request-time status/alert synchronization remain. No speculative index, schema migration, global sensitive-data cache, or new dependency was introduced.

## Validation

- `npm test`: **139 passed, 0 failed, 9 skipped**. Covers login, MFA, sessions, lockout, password reset, role guards, four dashboards plus travel desk, trips, bookings, approvals, expense/payment workflows, notifications, profiles, reports, and client/server boundaries. The nine skipped tests require the optional Playwright harness; they are not counted as passing browser workflows.
- Production `npm run build`: passed, including Next's configured lint/type-validation stage. There is no standalone lint or type-check script in `package.json`; this JavaScript project does not have a separate configured TypeScript check.
- Independent Chrome DevTools browser harness: passed navigation across trips, bookings, expenses, approvals, notifications, and profile for the four roles; actual login form → MFA controls → dashboard → account-menu logout; API login/MFA/logout for each role; unauthenticated `/auth/me` returns 401; `/api/users` returns 403 for non-admin roles and 200 for admin. SSO correctly reports the existing unconfigured 501 response; a live identity-provider SSO integration is unavailable to test.
- Browser reports contain no JavaScript exceptions or `console.error` calls. Server logs contain the existing multiple-lockfile workspace-root and experimental SQLite warnings, without application exceptions during these checks. Expected unauthenticated and forbidden responses were explicitly tested.
- `git diff --check`: passed (Git printed line-ending conversion notices).
- Full trip/booking/expense mutation workflows passed in isolated service tests. They were not repeated end-to-end through browser forms.

## Files changed for this task

- `src/lib/session.js` — request-local session lookup memoization.
- `src/lib/services/approvals.js` — bounded KPI and tab aggregation.
- `src/lib/services/queries.js` — department expense batching.
- `src/lib/services/profile.js` — reuse fetched documents.
- `tests/48-loading-performance.test.js` — equivalence, scope, freshness, and query-bound regression tests.
- `tests/perf-services.mjs` — isolated query/timing and scaling benchmark.
- `tests/perf-pages.mjs` — production/development browser benchmark and authentication smoke checks.
- `PERFORMANCE-REPORT.md` and `performance-results/` — findings and measured artifacts.

## Reproduction

Run from the `geniq-travel` directory in PowerShell:

```powershell
npm test
npm run build
node tests/perf-pages.mjs --label=current
$env:TSX_TSCONFIG_PATH='tests/tsconfig.json'
node --no-warnings --require ./tests/setup.cjs --import tsx tests/perf-services.mjs --label=current
```

The browser script requires local Google Chrome at its standard Windows installation path and launches a server on port 3106. It explicitly selects an in-memory database and its own test secret/OTP. The service script uses the test bootstrap's in-memory default; unset an externally supplied `DATABASE_PATH` before running it. Neither benchmark should be pointed at live financial data. To compare development, run `node tests/perf-pages.mjs --dev --label=development-current` separately; rebuild before subsequently starting a production server.

## Remaining limits

Development compilation is still expected to be slower than a production build. The isolated seed does not reproduce an unknown deployed network, disk contention, concurrent traffic, or production dataset. Precise hydration/usable time, React profiler traces, and deployed multi-user p50/p95 navigation measurements remain uncollected. Large-history approvals still scan matching records in SQLite for accurate totals, and readiness/team analytics still calculate summaries across eligible records. Further indexing, pagination changes, or infrastructure work needs representative production measurements; this patch does not establish that those are currently the bottleneck.
