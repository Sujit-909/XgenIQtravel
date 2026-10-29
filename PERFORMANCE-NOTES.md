# Interaction and performance changes — 29 October 2026

The existing layout, spacing, palette, typography, dimensions, responsive behavior, and XgenIQ text branding are retained. No dependencies, lockfiles, authentication logic, API contracts, schemas, or environment files were changed.

## Findings and measurements

Readiness (also used by the manager dashboard) fetched the traveller, bookings, failed services, documents, and emergency contact separately for every trip. The new implementation batches these reads in groups of up to 400 trips and uses request-local maps. It does not retain sensitive data between requests. Individual assessment calls keep their original behavior.

Measured with the seeded in-memory database, admin user, 365-day window, 21 trips, 10 warmups and 100 iterations:

| Metric | Before | After |
| --- | ---: | ---: |
| Database reads per readiness call | 109 | 9 |
| Median readiness function duration | 1.324 ms | 0.940 ms |
| 95th percentile duration | 1.938 ms | 1.807 ms |

These are local service measurements, not browser navigation or production latency measurements. Timing varies with load; the query-count reduction is deterministic for this fixture. The prior production build and the new build both report 103 kB shared first-load JavaScript. Dashboard first-load total changed from approximately 117 to 118 kB; trip detail from 127 to 128 kB. No bundle-size improvement is claimed.

Reproduce the service benchmark in PowerShell:

```powershell
$env:TSX_TSCONFIG_PATH='tests/tsconfig.json'
node --no-warnings --require ./tests/setup.cjs --import tsx tests/perf-readiness.mjs
```

The test bootstrap uses an in-memory database by default. Run without an externally supplied DATABASE_PATH to retain that isolation.

## Implementation

- `src/lib/services/queries.js`: bounded batched readiness reads, with identical assessment and filtering rules.
- `src/components/Shell.jsx`: isolated header search state; menu listeners only while open; collapsed-navigation tooltip labels; a 160 ms content-only opacity transition after pathname navigation. Header/sidebar stay mounted; no keyed wrappers, navigation delays, or query-change animations. Reduced motion and active form fields skip the transition.
- `src/components/TooltipLayer.jsx`: one delegated, body-portaled tooltip layer. Uses existing accessible names on icon-only buttons/links and explicit collapsed-navigation labels. Supports hover/focus, 160 ms delay, Escape dismissal, viewport clamping, and cleanup on scroll/resize/unmount. Pointer events pass through; touch interaction does not depend on hover. No wrappers change control dimensions.
- `src/app/layout.jsx`: mounts the shared tooltip layer once.
- `src/components/ui.jsx`: async shared button handlers expose busy state and guard duplicate clicks until completion; existing explicit busy states and native form behavior remain. Toast timers are cleaned up; dropdown outside-click listeners attach only while open.
- `src/app/globals.css`: short background/border/color transitions, pressed feedback, interactive-card border feedback, dropdown/tooltip opacity entry, and reduced-motion overrides. Static cards receive no clickable hover treatment. No continuous animation or layout-property animation was added.
- `tests/45-performance.test.js`: verifies equivalence to individual assessments, bounded read count, and freshness after an emergency-contact change.
- `tests/perf-readiness.mjs`: reproducible benchmark.

Earlier UI changes in the working tree remain intact; the page view files were not edited for this animation/performance task.

## Validation and limits

- Production build passes, including Next.js's configured validation phase. No standalone lint or type-check script is configured.
- Regression suite: 132 passed, zero failed, nine optional browser tests skipped. Covers authentication/MFA/logout service flows, role guards, dashboards, trip details/edit/itinerary, bookings, expenses, forms through service and server-render checks, imports and client/server boundaries.
- `git diff --check` passes.
- One intermediate build failed during page-data collection with a Next.js `_not-found` page-entry invariant; subsequent builds passed.
- Playwright/browser tooling is unavailable. Desktop/mobile visual verification, actual tooltip placement, keyboard interaction, reduced-motion emulation, hydration/console checks, and browser performance traces remain unverified. Passing server tests is not equivalent to browser verification.
- Existing workspace-lockfile warning and experimental SQLite warnings remain.
- Remaining scaling work: synchronous SQLite work and status/alert synchronization still run on server requests; readiness still evaluates all eligible trips to calculate accurate KPIs before pagination. Production profiling and realistic large-dataset/browser measurements are needed before further changes or broader performance claims.
