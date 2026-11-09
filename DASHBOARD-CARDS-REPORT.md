# Dashboard summary card enhancement

All 28 existing dashboard summary cards (including the Travel Desk refund summary) use a shared, compact `SummaryCard`. It renders one native Next.js link with keyboard focus, hover elevation, a small icon, readable count, and reduced padding. Styling is scoped to this component; the header, sidebar, login, global typography, and existing palette are unchanged. The existing responsive grids remain in use. Browser measurement of the requested approximate height reduction has not been performed.

## Navigation mappings

| Role | Card | Existing destination and filter |
| --- | --- | --- |
| Employee | Upcoming Trips | `/trips?view=upcoming` — own Approved, Booking In Progress, Travel In Progress trips whose return date is today or later |
| Employee | Waiting for Your Reply | `/trips?view=waiting` — own trips pending review or with a service awaiting traveller information |
| Employee | Expiring Soon | `/documents?filter=soon&within=7` — documents expiring in the next seven days |
| Employee | Expired | `/documents?filter=expired` |
| Employee | Expense Reports / Pending to Submit | `/expenses?view=to-submit&scope=mine` — Draft and Returned for Correction reports, plus trips awaiting a report |
| Manager | Trip Approvals | `/approvals?type=trip&status=Pending` |
| Manager | Expense Approvals | `/approvals?type=expense&status=Pending` |
| Manager | Team Trips Upcoming | `/trips?scope=team&view=upcoming` |
| Manager | Policy Exceptions | `/approvals?type=booking&status=Pending` |
| Manager | High-Risk Trips | `/readiness?risk=High` — existing default 30-day readiness window |
| Manager | Refunds Pending | `/refunds?status=Unresolved` |
| Travel Desk | Awaiting Agency Quote | `/travel-desk?tab=Awaiting%20Agency%20Quote` |
| Travel Desk | Traveller Info | `/travel-desk?tab=Traveller%20Info` |
| Travel Desk | Approval Pending | `/travel-desk?tab=Approval%20Pending` |
| Travel Desk | Booking in Progress | `/travel-desk?tab=Booking%20in%20Progress` |
| Travel Desk | Ticketing Pending | `/travel-desk?tab=Ticketing%20Pending` |
| Travel Desk | Failed / Issues | `/travel-desk?tab=Failed%20%2F%20Issues` |
| Travel Desk | Open Refund Cases | `/refunds?status=Unresolved` |
| Finance | Expense Approvals | `/approvals?type=expense&status=Pending` |
| Finance | Ready to Pay | `/finance/reimbursements?payment_status=Payable` |
| Finance | Failed Payments | `/finance/reimbursements?payment_status=Failed%20%2F%20Returned` |
| Finance | Missing Invoices | `/finance/reconciliation?match=Missing%20Invoice` — bookings without an invoice, including manually resolved exceptions |
| Finance | Refunds Pending | `/refunds?status=Unresolved` |
| Admin | Active Users | `/users?active=1` |
| Admin | Active Policy Rules | `/policy?status=Active` |
| Admin | Trips | `/trips` |
| Admin | Policy Exceptions | `/reports?type=policy_exceptions` |
| Admin | Audit Records | `/audit` |

Unresolved refunds exclude Credited, Rejected, and Not Applicable. Filters run before existing pagination. Listings retain their existing ordering and search/filter controls. Selected filters appear in tabs, pills, selects, or a removable badge. URL navigation supports back/forward, and shared filter controls now synchronize with URL changes. Document filtering also uses URL state.

The waiting-reply count now counts distinct trips, matching the destination's trip rows; individual actions remain in the dashboard's reply table. Approval counts now use the same assigned-user or unassigned-role predicate as the approval listing. No routes, backend fields, dummy data, duplicate listing pages, or client API requests were added. Existing service and page access guards remain in place. Dashboard loading and retry error boundaries were added.

## Modified files

- `src/components/ui.jsx`: shared SummaryCard and URL synchronization for Filters.
- `src/app/globals.css`: scoped compact card styles and interaction states.
- `src/app/(app)/dashboard/loading.jsx`: loading state.
- `src/app/(app)/dashboard/error.jsx`: retry error state.
- `src/views/dashboard.jsx`: all five role dashboards and 28 destinations.
- `src/lib/services/queries.js`: matching approval and waiting-trip counts.
- `src/lib/services/trips.js`: upcoming and waiting filters with traveller scope.
- `src/lib/services/expenses.js`: pending-submission filter and unreported trips.
- `src/lib/services/finance.js`: combined failed/returned payments, unresolved refunds, missing-invoice matching.
- `src/views/trips.jsx`: visible dashboard filter.
- `src/views/expenses.jsx`: visible filter and trips awaiting expense reports.
- `src/views/profile.jsx`: URL-backed document filter and seven-day window.
- `src/views/admin.jsx`: active users and active policy rules filters.
- `src/views/finance.jsx`: failed/returned filter option.
- `src/views/ops.jsx`: unresolved refund filter option.
- `tests/49-dashboard-navigation.test.js`: navigation markup, count consistency, pagination and access checks.
- `DASHBOARD-CARDS-REPORT.md`: this report.

## Validation

- `npm test`: 150 tests, 141 passed, zero failed, nine optional browser tests skipped because Playwright/Chromium/esbuild were unavailable.
- Tests cover all five dashboard renderings, 28 complete card links, absence of nested buttons/links, destination count consistency, personal ownership, pagination, and restricted service access. Existing page tests cover role guards and listing rendering.
- `npm run build`: passed. Next.js reported the existing multiple-lockfile workspace warning and the Node SQLite experimental warning.
- `npm run lint`: unavailable because the repository has no lint script or configured lint tool. Existing static checks ran as part of `npm test`.
- `git diff --check`: passed.
- Desktop/responsive behavior, hover, keyboard activation, and browser back/forward were implemented but not verified in a live browser. Pixel measurements and browser interaction tests remain unverified.

## Unconnected cards

None of the existing dashboard cards are unconnected. Illustrative cards in the request that do not exist in this application (such as System Issues) were not invented; existing role-specific cards and entities were retained.
