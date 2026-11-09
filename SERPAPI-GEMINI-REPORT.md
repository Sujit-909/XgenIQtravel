# GENIQ Employee Assistant — SerpApi Gemini

The existing `/assistant` screen now uses live SerpApi Google Gemini for general assistance and local, read-only GENIQ data for company-specific questions. No duplicate assistant page was created. The blue-and-white theme, font family, sidebar, header, navigation and existing trip/expense workflows are retained. Flight and Hotel Booking integrations were not changed for this task.

## Changed files

Created:

- `src/app/api/employee-assistant/chat/route.ts`: the requested App Router POST entry point, reusing the existing API dispatcher.
- `src/lib/providers/gemini.js`: server-only Gemini request, response normalization, source/suggestion parsing, timeout and safe errors.
- `src/lib/assistant-safety.js`: shared input normalization, credential/private-content guards and permitted links.
- `src/components/AssistantMarkdown.jsx`: Markdown, GFM lists/tables/code, safe links and disabled raw HTML/images.
- `tests/55-employee-assistant.test.js`: eight integration/security/rendering tests.
- `scripts/verify-gemini.mjs`: explicit live first-question/follow-up verification using public IT questions.
- `tsconfig.json`: minimal TypeScript setup for the requested route, preserving the existing JavaScript application.
- `SERPAPI-GEMINI-REPORT.md`: this report.

Modified:

- `src/lib/services/assistant.js`: replaces deterministic trip-creation chat with session-isolated Gemini conversations and local, read-only business answers.
- `src/views/assistant.jsx`: modern chat, modes, sources, suggestions, loading, copy, new conversation, error/edit/retry controls and existing workflow links.
- `src/app/(app)/assistant/page.jsx`: renders the existing assistant without loading persistent message history.
- `src/lib/api/routes.js`: registers the new chat endpoint and routes legacy `/api/assistant` calls to the same read-only implementation.
- `src/lib/api/router.js`: optional bounded JSON parsing used only by assistant routes; unrelated endpoints retain their behavior.
- `src/lib/schema.js`: additive assistant conversation-token and rate-limit tables.
- `src/app/globals.css`: scoped Employee Assistant chat/Markdown/responsive styles.
- `package.json`, `package-lock.json`: `react-markdown`, `remark-gfm`, and TypeScript/React/Node type tooling.
- `.gitignore`: ignores generated Next.js type declarations and TypeScript build metadata.
- `tests/40-modules.test.js`, `tests/50-pages.test.js`, `tests/70-e2e.test.js`: updated assistant expectations for its new title and read-only workflow behavior.

The generated `next-env.d.ts` is ignored. `.env.example` already contains `SERPAPI_API_KEY=` and was preserved. `.env.local` and the existing key were reused without adding another key variable. Earlier unrelated work remains in the working tree.

## API and configuration

`POST /api/employee-assistant/chat` accepts existing authenticated session cookies and same-origin JSON requests.

```json
{
  "message": "How can I troubleshoot unstable Wi-Fi?",
  "scope": "general",
  "request_id": "a-client-generated-UUID",
  "conversation_token": "the-opaque-GENIQ-handle-from-the-previous-response"
}
```

`scope` is `auto` (default), `company`, or `general`. A first message omits `conversation_token`. `request_id` provides idempotency for client retries; the browser always supplies it. A new chat sends `{ "action": "new_conversation", "request_id": "<UUID>" }` without sending another employee’s handle.

Responses contain `answer` (Markdown), `references`, `related_questions`, `conversation_token`, `answer_kind`, `conversation_reset`, and an expiry timestamp. The new-conversation action returns an empty answer and fresh opaque handle. The legacy `/api/assistant` endpoint is an alias of this implementation, with a compatibility `messages` field; its old transaction-creation path is gone. Legacy GET history returns an empty list.

The provider call is server-only:

```text
https://serpapi.com/search.json
engine=google_gemini
q=<general-assistance instructions plus the employee's public question>
output=json
api_key=<existing server-side SERPAPI_API_KEY>
subsequent_request_token=<server-held continuation token, when available>
no_cache=true
```

`no_cache=true` prevents SerpApi query-cache hits from reusing a provider conversation across employees who ask identical questions. GENIQ performs its own short, session-scoped request deduplication instead. No currency, airport or hotel parameters are sent to Gemini, and no flight/hotel provider code was changed.

The application’s existing `AUTH_SECRET` configuration remains required for production session signing. Token encryption derives its key from that authentication secret and the current session cookie. No extra Gemini credential variable is required. Development continues to use the application’s existing authentication configuration.

## Conversation security and retention

- The raw SerpApi `subsequent_request_token` never goes to the browser. The public `conversation_token` is a random GENIQ handle.
- Continuation tokens are AES-256-GCM encrypted at rest and bound to both the authenticated user and an HMAC fingerprint of the current sign-in session. Another employee, or another session for the same employee, cannot resume the conversation.
- Provider conversations expire after ten minutes of inactivity on the GENIQ side. An expired local handle starts fresh context; an upstream expired token is cleared and retried once without it. The response tells the UI when context was reset.
- New conversation deletes this employee/session’s previous token context and clears chat messages in the UI.
- Chat messages are not written to server history or browser persistent storage. Current messages exist only in page memory. Previous legacy message records are not loaded or extended by the new assistant.
- A bounded, two-minute memory cache retains completed responses for safe network retries. Timed cleanup removes entries; it is not a persistent chat transcript. No raw provider tokens are cached in client responses.
- SQLite stores encrypted continuation tokens, opaque handles, session fingerprints, topic categories, request IDs, leases and counters. Expired records are cleaned opportunistically during later requests.
- Conversation leases prevent overlapping turns. Identical simultaneous/retried requests share a response; request-ID reuse with different input is rejected.

## Company information and business actions

The assistant does not send internal company documents, database rows, employee profiles, names, emails, approval records or financial records to Gemini as prompt context.

Company-specific answers run locally:

- Active travel policy records, filtered for applicable employee grade, link to `/policy`. Returned rule descriptions and supported terms come from actual stored records.
- Travel requests use `traveller_id` for the signed-in employee only.
- Expense and payment information uses expense reports belonging to the signed-in employee only.
- No approved HR or leave policy source is connected in this application; the assistant explicitly says it cannot verify those entitlements instead of inventing them.
- Requests for other employees’ records do not result in an external lookup or privileged data access.

Internal conversations do not carry internal context into Gemini. Switching to general guidance starts with only the public question, not the previous business answer.

General Gemini answers are labelled **General AI guidance** and **not official company policy**. The provider receives generic workplace-assistance instructions covering writing, travel planning, general expense processes, HR concepts, IT help and research, without employee metadata.

The assistant cannot create, approve, submit, reject, cancel or pay business transactions. It supplies links to existing trip, booking and expense workflows. The old “Yes, create the trip request” chat path was removed to meet this restriction. No assistant code imports a transaction-creation or approval service.

## Input, output and abuse protection

- Maximum 2,000 normalized message characters and a 16 KiB streamed JSON body limit; multipart requests are rejected.
- Existing authentication and CSRF checks are reused. Unknown or unrelated conversation handles are rejected without revealing another user’s context.
- Credential patterns, known API keys, private-key blocks and common access-token formats are rejected before any provider request. Recognized personal/confidential material is kept local or refused rather than forwarded.
- Limits: 20 assistant requests per employee/minute, six Gemini calls per employee/minute, 100 Gemini calls per employee/day, and 60 Gemini calls per application database/minute.
- Provider attempts use a 40-second timeout within a bounded expiry-retry budget. Errors and rate limits return safe messages; upstream URLs, tokens, keys and internal exceptions are not logged or echoed.
- Markdown supports headings, ordered/unordered lists, tables and fenced code. Raw HTML is disabled; Markdown images are not loaded; code is displayed rather than executed.
- Links accept vetted HTTPS URLs or existing read-only GENIQ page destinations. Unsafe protocols, credential/token URLs and SerpApi continuation links are excluded. External sources use `noopener`, `noreferrer` and no referrer.
- Related questions come from SerpApi’s actual `related_questions`; their provider continuation URLs are discarded. Source references and optional fields are shown only when returned.

## Verification

- `npm test`: **176 tests, 167 passed, zero failed, nine optional Playwright harness tests skipped** because its browser dependencies are unavailable. Existing flight and hotel tests remain passing.
- Added tests cover first question, subsequent token use, encrypted storage, employee/session ownership, new chat, local/upstream expiry, idempotency, failures/timeouts/quota, empty/oversized/malformed messages, credentials, private-data handling, local authorized records, no transactions, authentication, CSRF, body size, Markdown safety, sources and suggestions.
- `npm run build`: passed, including TypeScript route validation.
- `npm run lint`: unavailable because the repository has no lint script or configured lint tool. Existing static checks ran in the suite, and the production build checked types.
- Live SerpApi checks passed for a first public IT question and token-based follow-up; both returned actual answers and continuation tokens.
- Independent Chrome checks passed at **1366px, 1920px and 390px** with no page/chat-panel horizontal overflow. They exercised local read-only records, a live Gemini question and follow-up, Markdown tables, sources/links, a returned suggested question, new conversation, network-error retry and focused-tab copy-to-clipboard. The final live source answer included a table and eight references; an earlier response returned a suggested follow-up. Optional suggestions/references vary by provider response and are not fabricated.
- Client-bundle and `.env.example` scans found no actual SerpApi key. `.env.local` remains Git-ignored. `git diff --check` passed.
- `npm audit` reported two advisories through the existing Next.js/PostCSS dependency chain (one moderate, one high). Next.js 15.5.28 and PostCSS 8.4.31 match the pre-existing lockfile; the added Markdown packages have no reported advisory in that result. Framework upgrades were not made as part of this bounded integration.

Local browser screenshots and diagnostics are ignored under `.next-dev/gemini-qa/`.

## Remaining limitations

- Privacy filtering is a conservative, pattern-based guardrail, not a comprehensive enterprise DLP system. Employees must not paste confidential material into general AI mode; formal document classification or a private inference deployment would be needed for confidential free-form content.
- Official HR/leave explanations require an approved internal document source, which this application currently lacks. The assistant does not claim otherwise.
- Messages intentionally disappear on page reload/navigation; there is no persistent transcript feature. Continuation is available while the current page/session retains its opaque handle and the provider context is valid.
- SerpApi/Gemini controls external retention and availability. The application can discard its token but cannot delete a provider-side conversation through this search API.
- General AI answers can be inaccurate; they remain clearly distinct from locally sourced official business records.

Primary references: [SerpApi Gemini engine and continuation tokens](https://serpapi.com/google-gemini-api), [react-markdown](https://github.com/remarkjs/react-markdown), [remark-gfm](https://github.com/remarkjs/remark-gfm).
