# GENIQ Travel Management (Next.js full-stack)

Corporate travel, booking, expense and reimbursement platform built from **Travel_Application_v1_.docx**.
Frontend, backend (REST API) and database layer are in one Next.js 15 (App Router) project. Blue / white UI matching the document's screens.

## Quick start

Requirements: **Node.js 22.13 or newer** (the database layer uses Node's built-in SQLite, so there are no native modules to compile).

```bash
npm install
cp .env.example .env.local     # then set AUTH_SECRET and DATA_KEY
npm run dev                    # http://localhost:3000
```

The SQLite database (`data/geniq.db`) is created and seeded with demo data on first start. `npm run db:reset` deletes it so it is re-seeded.

### Demo accounts (password `Sujit@909`, MFA code `246810`)

| Role | Sign-in | What to look at |
|---|---|---|
| Employee | sujit@xgeniq.com | Dashboard, trips, bookings, expenses, profile, assistant |
| Manager | manager@xgeniq.com | Approvals, team bookings, compliance, trip readiness |
| Travel Desk | travel@xgeniq.com | Operations queue, quotes, SLA, refunds |
| Finance | karan.mehta@abccorp.com | Expense approvals, reimbursement tracker, reconciliation |
| Administrator | admin@xgeniq.com | Policy rules, users, master data, audit log |

Other seeded users: arvind.kapoor@ (department head), meera.iyer@ (budget owner), and a team of employees reporting to Amit Singh.

## Production checklist

* Set `AUTH_SECRET` (session signing) and `DATA_KEY` (encrypts bank account numbers). The app refuses to start in production without `AUTH_SECRET`.
* The MFA / OTP screens accept a fixed demo code (`DEMO_OTP`, default `246810`) until an SMS / email gateway is wired into `src/lib/services/auth.js` (`issueOtp`). Set `NEXT_PUBLIC_DEMO_HINTS=false` to hide the demo hints on the login screens.
* SQLite is fine for a single instance. To use another database, replace `src/lib/db.js` (the rest of the code only uses `all / get / run / tx`).
* Uploads are stored under `data/uploads` (override with `UPLOAD_DIR`).

## Integration points (offline stand-ins are provided)

| Area | File | Stand-in behaviour |
|---|---|---|
| Flight / hotel / cab inventory | `src/lib/providers/mock.js` | Deterministic mock inventory. Replace `searchFlights / searchHotels / searchVehicles` with supplier / GDS APIs. |
| Receipt OCR / AI extraction | `src/lib/ocr.js` | Filename / text based extractor with confidence scores. Replace `extractFromReceipt` with a document-AI service. |
| OTP & notifications | `src/lib/services/auth.js`, `notify()` in `util.js` | Fixed OTP; notifications are stored in-app only (email / WhatsApp / Teams / push need a gateway). |
| Company SSO | `POST /api/auth/sso` | Returns 501 until configured. |
| ERP / finance posting | `invoices.erp_*` columns, reconciliation screen | Status tracked in the DB; "Retry ERP posting" marks it posted. Connect your ERP there. |
| Travel assistant | `src/lib/services/assistant.js` | Deterministic intent handling. Always requires explicit confirmation before creating anything. |

## What is implemented (by document section)

* **Authentication**: sign-in (email / mobile), MFA step, forgot password with OTP, create account, lockout after repeated failures, signed HttpOnly session cookies, same-origin check on mutations.
* **Employee dashboard**, quick actions, waiting-for-reply, expiring-soon documents.
* **Profile** (8 tabs): personal info, travel preferences, documents, payment methods & reimbursement accounts (encrypted, masked, reveal is audited), emergency & family, addresses, loyalty programs, alert settings. Standalone Travel Documents, Reimbursement Accounts, Loyalty Programs and Notifications pages. Expiry alerts exclude PAN / Aadhaar.
* **Trips**: create for Self / Colleague (traveller verification & consent) / Agency; request form with live approval-route preview; Draft → Submitted → Under Approval → Approved → Booking → Travel → Expenses → Closed, plus Rejected / Cancelled / Pending for Review; copy, cancel, close rules (blocks closure while bookings, refunds, services, expenses or payments are outstanding).
* **Approval routing**: standard, project (budget owner), above-threshold, international, emergency; no self-approval; sequential levels; approve / reject (reason mandatory) / request info.
* **Services**: flights, hotels, ground transport, visa (passport 6-month rule, international only), other services; each via the **portal** or a **travel-agency request**; mandatory comments; drafts.
* **Policy-aware search & fare comparison**: policy status per option, "lowest logical fare" recommendation, total-trip-cost comparison, justification + approval for exceptions / over-budget, duplicate-booking guard, supplier failure handling.
* **Travel desk**: operations queue, quotes (send / accept), SLA tracking, request info, ticketing, failures, escalation, supplier SLA view.
* **Bookings**, **cancellations & refunds**: refund terms, refund workflow, overdue tracking, recovery-rate KPI (credited ÷ expected refundable, penalties excluded, unresolved reported separately).
* **Expenses**: 4-step report flow, bulk / single receipt upload with extraction, manual items with itemization, cost allocation (percentage / amount, validated to 100 %), FX conversion, personal and company-paid items, duplicate detection, mandatory receipts, review & submit, overall PDF, manager → finance approval, reimbursement (initiate / paid / failed / resubmit / hold), bank-account verification.
* **Finance**: reimbursement tracker with payment batches, supplier & finance reconciliation (match statuses, exceptions, ERP posting state).
* **Manager / admin**: team bookings analytics, team travel compliance (masked document numbers, reminders), trip readiness & disruption centre, policy rules with versioning and a rule tester, approval workflows, master data, user management, integration monitor, immutable audit log (database triggers block updates / deletes), reports (CSV export).

Role navigation follows the document's role table and the sidebar designs.

## Project layout

```
src/app/            Next.js routes: (auth)/ sign-in screens, (app)/ authenticated pages, api/[...path]/ REST API
src/views/          Client components (one file per area)
src/components/     UI kit (tables, modals, forms, charts, shell)
src/lib/services/   Business logic (trips, approvals, expenses, finance, desk, policy, profile, ...)
src/lib/api/        Router + route table for /api/*
src/lib/db.js       SQLite layer      src/lib/schema.js  Tables, indexes, audit triggers
src/lib/seed*.js    Demo data         tests/             Test suite
```

All endpoints live under `/api` (see `src/lib/api/routes.js`); pages read through the same service functions as the API, so rules are enforced in one place. Every endpoint checks the session and role.

## Tests

```bash
npm test
```

* API / business-rule tests (auth, workflows, policy, bookings, refunds, expenses, payments, RBAC, security).
* Server-render tests for **every page and every role** with seeded data; they also verify props passed to client components are serialisable.
* Static checks for Next.js pitfalls (client/server import boundaries, `"use client"`, unresolved imports).
* Optional real-browser tests (`tests/70-e2e.test.js`) run automatically when Playwright + Chromium are installed (`npm i -D playwright && npx playwright install chromium`), otherwise they are skipped.
