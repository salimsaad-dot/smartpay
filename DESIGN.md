# SmartPay — Build Notes & Decisions Log

## For AI assistants reading this file

SmartPay is a **separate, standalone, multi-tenant** product from Academia
Hub — own database, own auth, own git repo
(github.com/salimsaad-dot/smartpay), no code or data dependency on
Academia Hub whatsoever. It mirrors Academia Hub's backend/frontend stack
and conventions for speed and consistency (same tech, same people building
both), not because the two are coupled.

Full product spec: `../standalone/Standalone_School_Fee_Collection_Platform_Claude_Code_Specification.docx`
— read this first for the complete schema, API, business rules, and
11-phase build plan. This file tracks what's actually been *built* against
that spec, plus decisions and deviations worth remembering — it doesn't
restate the spec.

Backend = `smartpay-backend` (Node/Express/MySQL, local dev DB
`smartpay_db`, port 5100). Frontend = `smartpay-frontend` (Next.js 16 App
Router + Tailwind v4, port 3100). A visual redesign (replicating a set of
reference mockups the user supplies incrementally) is in progress,
page-by-page, on top of the original UI/UX-spec pass below — see the
redesign entries in Build Progress for what's been replaced so far
(`components/ui2.js` is its shared component library, alongside the
original `components/ui.js`).

## Product Context

A real headmaster, met in person, tried a school-management system before
and dropped it — not for lacking features, but because parents couldn't
navigate an account-based portal just to pay a fee. SmartPay's entire
premise is the opposite of that failure mode: SMS → secure payment link →
simple mobile checkout → pay → done, **no parent account required**. The
school gets fee structures, invoices, manual + online payment recording,
and automatic Friday SMS reminders to parents in arrears.

User's explicit framing (2026-10-01): multi-tenant from day one — this is
meant to be sold to multiple schools, not a one-off for this one. It
replaces the failed system at the originating school, which isn't ready
for a full management system.

## Build Progress

- **Phase 1 — Foundation: SHIPPED 2026-10-02.** Multi-tenant school
  registration, login, session management (httpOnly JWT cookie,
  live-re-verified `school_id`/`token_version` on every request). Backend
  test suite green (12 tests, including a real cross-tenant-isolation
  proof and a concurrent-registration race test). Clean frontend build.
  Live-verified via a real Puppeteer browser run: register → dashboard,
  correct school name shown. See Decisions Log for the real gaps a
  Plan-agent pressure-test caught before this shipped.
- **Phase 2 — Academic data: SHIPPED 2026-10-03.** Academic years + terms
  (with set-current, full-replace semantics so exactly one of each is ever
  current per school), classes, students, parents, and parent-student
  sibling linking. Every new table re-verified for tenant isolation with
  its own test (not assumed from Phase 1's generic proof) — including a
  direct IDOR check (school B cannot fetch school A's student/parent by
  ID even though the IDs are small guessable integers) and a cross-tenant
  foreign-key check (school B cannot create a student against school A's
  class/year by guessing the ID). 20 backend tests green. Live-verified
  through the real UI: registered a school, created a year/term/class,
  added two students in the same class, added one parent, linked that
  parent to both students, and confirmed the parent's own record shows
  both children — proving the sibling model end-to-end, not just via the
  schema. A real date-display bug (mysql2 returns DATE columns as JS Date
  objects, which serialize to a full ISO timestamp like
  "2026-09-01T00:00:00.000Z" instead of a plain date) was caught during
  this live pass and fixed with a `formatDate()` helper on the Academic
  Setup page — not a backend issue, every date field needs this same
  treatment as more pages render dates going forward.
- **Phase 3 — Fee engine: SHIPPED 2026-10-03.** Fee structures (with
  line items, created together in one transaction — a structure with zero
  items is never allowed to exist even momentarily) and bulk invoice
  generation. The spec's critical invoice-snapshot rule (editing a fee
  structure's items must never change an already-generated invoice) is
  enforced by construction — `invoice_items` is a real copied table, not
  a view/join onto `fee_structure_items` — and proven with a test that
  mutates a fee item's amount in the DB directly after generation and
  confirms the existing invoice is untouched. Generation is idempotent
  per student via `invoices`' `UNIQUE(student_id, fee_structure_id)`
  (caught as `ER_DUP_ENTRY`, never a pre-check — same TOCTOU-safe pattern
  as `register-school`), processed sequentially so each student's
  invoice+items commit as one transaction before the next starts. 29
  backend tests green, including a student added to a class *after* the
  first generation run being correctly picked up by a second run without
  re-billing anyone already invoiced. Live-verified through the real UI:
  created a fee structure with two line items through the actual form,
  generated invoices for 2 students, re-ran generation and confirmed
  "Created 0, skipped 2 (already billed)" — idempotency proven through
  the product, not just the API.
- **Phase 4 — Manual payments: SHIPPED 2026-10-03.** Recording a manual
  payment (cash/mobile money/bank transfer/other) against an invoice, and
  voiding one. `payments` is append-only — a void never deletes a row,
  only marks it `status='void'` with a required reason, voider, and
  timestamp, preserving full history. `invoices.paid_amount`/`balance`/
  `status` are never written anywhere except inside the one shared
  `recalculateInvoiceBalance()` helper, which re-sums straight from
  `payments` (excluding voided rows) every time — called after both
  recording and voiding, so the two code paths can't drift out of sync.
  Overpayment is rejected outright (amount validated against the
  invoice's current balance, re-read fresh inside the transaction, not
  trusted from an earlier page load) — matches the spec's stated v1
  default of no credit/unallocated-payment handling. 13 new backend tests
  (42 total), covering partial→paid status transitions, overpayment
  rejection, void correctly reversing balance impact while leaving the
  payment row intact, a voided payment excluded from `paid_amount` while
  a sibling active payment on the same invoice still counts, and tenant
  isolation on both recording and voiding. Frontend: a "Pay" action and a
  "History" toggle added to the existing Invoices page (no new route) —
  a modal records a payment, an inline expandable panel lists an
  invoice's payment history with per-payment void. Live-verified through
  the real UI via a real browser run: recorded a GHS 200 partial payment
  against a GHS 500 invoice (confirmed Partially Paid, balance GHS 300),
  expanded history, voided it, and confirmed the invoice correctly
  reverted to Unpaid/GHS 500 while the payment row stayed visible marked
  Voided rather than disappearing.
- **Phase 5 — Online payments: SHIPPED 2026-10-03 (code-complete; real
  Paystack keys pending).** A provider-agnostic `PaymentGateway` contract
  (`utils/paymentGateway.js`) with a real Paystack adapter
  (`utils/paystackGateway.js`) implementing initialize/verify/webhook
  parsing/signature validation — same proven shape as Academia Hub's
  already-shipped, already-pentested Paystack integration, extended with
  a `verifyTransaction()` server-to-server check used by the public
  status page (not the webhook itself — see Decisions Log). Secure
  payment links (`payment_links`, token hashed with SHA-256, raw token
  shown exactly once at generation) resolve to a parent's full
  consolidated view of every child's outstanding balance, with **no
  account or login** — the entire point of the product. A payment still
  maps 1:1 to one invoice (parent picks which invoice to pay from the
  consolidated list, same as Phase 4's manual payments), rather than
  building multi-invoice payment splitting in this pass. The webhook
  (`POST /api/payments/webhook`) is signature-verified
  (HMAC-SHA512 of the raw body), idempotent (a payment already
  `success`/`failed`/`cancelled` is never reprocessed), amount-checked
  against the original payment record, filtered to only recognized
  charge events (`charge.success`/`charge.failed` — Paystack sends many
  other event types, e.g. disputes/transfers, that can also carry a
  `data.reference` and must never be misread as a charge update), and
  logs every delivery to `payment_attempts` regardless of outcome. The
  public payment-status endpoint doesn't just report a live Paystack
  check's result — it *finalizes* the payment through the same shared
  code path the webhook uses (`finalizePaymentEvent`), so a permanently
  lost webhook can't leave a parent seeing "Payment successful" while
  the invoice balance silently never updates (a real gap caught and
  fixed during this phase's live testing, not a hypothetical). 23 new
  backend tests (66 total, all passing with real keys configured —
  see below): link generation/revocation/expiry, tenant isolation,
  token-hash-never-equals-raw-token, checkout scoping, overpayment/
  non-positive-amount/cross-parent rejection, webhook signature
  rejection, success/failure/amount-mismatch/duplicate-delivery/
  unknown-reference/unrecognized-event-type handling, status-poll
  reconciliation actually crediting the invoice, and a status-poll
  finalize followed by a redelivered webhook being a no-op (not a
  double credit). Frontend: a "Payment Link" action on the Parents page
  (admin-generated, copies a shareable URL), a standalone public
  `/pay/[token]` checkout page (outside the authenticated dashboard
  shell entirely — no `AuthContext` gating), and a `/pay/status/[reference]`
  page that polls real payment status rather than trusting the gateway
  redirect alone (the spec is explicit that a browser redirect is never
  proof of payment). Live-verified end-to-end via a real browser run
  twice: once against a placeholder key (confirmed the full checkout UI
  and a clean, friendly failure rather than a crash) and once more after
  real test keys were added — confirmed the backend genuinely talks to
  Paystack's live test API and the browser is redirected to a real
  `checkout.paystack.com` session. Completing an actual test-card payment
  couldn't be automated further: Paystack's checkout is behind
  Cloudflare bot-protection that blocks headless browsers, which is the
  correct, expected behavior for a real payment page, not a bug to route
  around. The crediting logic itself (webhook + status-poll finalize) is
  proven by the automated test suite rather than a manual click-through.
  **SmartPay uses its own, separate Paystack business profile**
  (business ID 2038714, added under the same login via Paystack's
  "Add a business" feature — no second email was actually needed), kept
  fully separate from Academia Hub's, per the user's explicit choice on
  2026-10-03. Real test keys are live in `.env` (gitignored, never
  committed).
- **Phase 6 — Arrears: SHIPPED 2026-10-03.** A new Arrears page
  (`GET /api/arrears`, `app/dashboard/arrears/page.js`) listing every
  outstanding invoice (`balance > 0`, not void) with the spec's exact
  column set — student, parent/guardian, class, term, total, paid,
  balance, last payment date — plus filters (class, term, min/max
  balance, parent) and summary totals (total outstanding, students in
  arrears, invoices in arrears) computed from the same filtered rowset
  the table renders, not a second query that could silently disagree
  with it. "Parent aggregation" is a client-side grouped view over the
  same flat invoice list (a "Group by parent" toggle consolidates
  siblings into one row with a combined balance and child list) rather
  than a separate backend endpoint, since the underlying facts are
  invoice-level and aggregation is just a different lens on them.
  Payment-link generation reuses Phase 5's existing
  `POST /api/parents/:id/payment-link` endpoint directly — no new
  link-generation logic was needed, confirming that phase's groundwork.
  Reminder status and a "Send Reminder" action are both in the spec's
  page description but intentionally not represented anywhere in this
  UI, not even as a disabled placeholder — SMS doesn't exist until
  Phase 7, and a stale-disabled control is worse than no control (a
  recurring, previously-learned lesson). 9 new backend tests (75 total):
  fully-paid invoices correctly excluded, summary totals match the
  filtered set exactly, correct primary-parent attribution, parent/
  class/term/balance-range filtering (including a shared parent's two
  children both returning), a voided invoice never appearing even with
  a positive balance, and tenant isolation. Live-verified through the
  real UI: seeded three students (two siblings under one parent, one
  fully paid elsewhere), confirmed the fully-paid student correctly
  never appeared, confirmed the flat and grouped-by-parent views both
  showed correct totals, confirmed the min-balance filter worked, and
  generated a real payment link directly from the grouped view.
- **Phase 7 — SMS: SHIPPED 2026-10-03 (code-complete; real mNotify key
  pending).** A provider-agnostic `SmsProvider` contract
  (`utils/smsProvider.js`) with an mNotify adapter
  (`utils/mnotifyProvider.js`) — same architectural pattern as Phase 5's
  `PaymentGateway`/`paystackGateway.js`, independently reimplemented
  rather than shared code (matches Academia Hub's own proven mNotify
  integration in shape, but returns a structured
  `{success, providerMessageId, error}` result instead of Academia Hub's
  fire-and-forget console-log pattern, since `sms_reminders` needs a real
  outcome to persist per reminder). Every new school is auto-seeded with
  one active default template at registration — a school can send a
  reminder immediately with zero configuration, matching the product's
  "replacement for an overly complicated system" premise. The manual
  reminder workflow (spec 4.8) resolves a scope from whatever the admin
  selected — one invoice, one student's invoices, or a parent's full
  consolidated balance — through one shared `resolveReminderScope()`
  function; `{{student_name}}`/`{{total_balance}}` render as a joined
  list/sum for the multi-child case rather than the spec's richer
  per-child breakdown format (a documented scope cut, see Decisions Log).
  Preview never generates a real payment link (would needlessly revoke
  a parent's existing one for a message that might never be sent) — only
  an actual Send does, via the same `createPaymentLink()` helper Phase 5
  built, extracted into a shared util during this phase specifically so
  both flows stay identical. Validation order is phone-number-specific
  errors before provider-configuration errors, and both are checked
  *before* any payment link is generated, so a doomed send never burns a
  working link. 18 new backend tests (85 total): auto-seeded default
  template, template CRUD with duplicate-name rejection, single-invoice
  vs. consolidated-parent preview rendering, no-balance-in-scope
  rejection, invalid-phone rejection, provider-not-configured rejection
  (the real path, not a mock — this test environment has no API key
  configured), tenant isolation, and failed attempts correctly absent
  from reminder history (nothing was actually attempted, so nothing is
  logged). Frontend: an SMS Templates page (CRUD, variable reference),
  a Reminder History page (status, expandable message view, failure
  reasons), and a "Send Reminder" action on both Arrears table views
  (per-invoice and per-parent-grouped) opening a preview-then-confirm
  modal — matching the spec's explicit "preview... admin confirms" flow,
  no free-text editing. Live-verified end-to-end through the real UI:
  confirmed the auto-seeded template renders correctly, confirmed the
  preview modal shows the real rendered message before sending, and
  confirmed the send path fails cleanly with "SMS provider is not
  configured" (no real mNotify key yet) rather than crashing — and
  correctly does **not** appear in reminder history, since nothing was
  actually attempted. **Update 2026-10-03, later same day:** real
  mNotify credentials were added — SmartPay uses its own project/API key
  ("SmartPay"), kept separate from Academia Hub's ("AcademiaHub"
  project), on the same underlying BMS.africa/mNotify account (no
  separate-business feature exists there the way Paystack has one; the
  project-scoped key is the closest real equivalent and was confirmed
  sufficient). The "SmartPay" Sender ID itself was still pending mNotify's
  approval (they require a business registration certificate before
  releasing a custom sender ID) — live-verified that the integration
  itself is wired correctly by triggering a real send against the real
  API: it returned a genuine `401` from mNotify (not a code-side error),
  which the app recorded cleanly as a failed reminder rather than
  crashing. **Update 2026-10-07: real end-to-end delivery confirmed.**
  With "SmartPay" still on hold, switched `MNOTIFY_SENDER_ID` to the
  already-approved `"AcademiaHub"` as a deliberate, user-approved stopgap
  (local `.env` + Render) — same underlying mNotify account, different
  registered business name, so messages read "From: AcademiaHub" until
  "SmartPay" clears review, at which point it switches back. Confirmed
  live, in this order: (1) a real send attempt failed cleanly with `402`
  (account balance was 0, not a code or sender-ID problem — mNotify's
  balance-check API, read-only, confirmed this directly); (2) after the
  user topped up the wallet, the exact same send succeeded
  (`success: true`) and **the SMS was independently confirmed received**
  on a real phone. Along the way, found and fixed a real bug in
  `mnotifyProvider.js`'s `providerMessageId` extraction — it checked
  `summary.id` and `data[0]._id`, neither of which the real API response
  shape (`{ summary: { message_id, _id, ... } }`) ever contains, so the
  field was silently `null` on every real send since Phase 7 shipped.
  Fixed to read `summary.message_id` (falling back to `summary._id`),
  pinned down with 3 new mocked-fetch unit tests
  (`tests/mnotifyProvider.test.js`) built from the real captured response
  — no further live sends needed to verify it. 124/125 backend tests
  passing (1 pre-existing skip).
- **Phase 8 — Friday automation: SHIPPED 2026-10-03.** The actual
  weekly engine: `utils/fridayJob.js` runs the spec's exact 14.1
  algorithm (acquire lock → query eligible invoices → group by parent →
  validate phone → create/reuse link → render → send → record → release)
  for one school (`runFridayJobForSchool`) or every Friday-enabled school
  at once (`runFridayJobForAllSchools`, what the real external scheduler
  calls). The job lock is the same TOCTOU-safe "insert and catch
  `ER_DUP_ENTRY`" pattern used everywhere else in this codebase, keyed on
  `(school_id, job_type, cycle_key)` — `cycle_key` is the actual calendar
  Friday being processed *in the school's own timezone*
  (`friday-YYYY-MM-DD`), not server time, so a UTC-hosted server can't
  silently process the wrong day for a Ghana-based school. A stale
  `running` lock (server crashed mid-cycle) is reclaimed after 30
  minutes rather than blocking that cycle forever; a genuine re-run of
  an already-`completed` cycle is a safe no-op, and even a crash-and-retry
  mid-cycle can't double-send, since each parent is independently checked
  against `sms_reminders` for an existing `sent`/`delivered` row in *this*
  `cycle_key` before anything goes out. One bad parent (invalid phone, no
  template, mid-loop exception) is isolated and recorded as a failure —
  it never aborts the rest of the school's cycle, and one school's
  failure never blocks another's in the all-schools run. New per-school
  settings (`friday_reminders_enabled`, `friday_send_time`,
  `friday_template_id`, `reminder_min_balance`, `reminder_cooldown_days`)
  live as columns on `schools` rather than a separate settings table —
  they're genuinely school-profile data, the same category as the
  `currency`/`timezone` columns already there. The cron-facing endpoint
  (`POST /api/cron/friday-reminders`) is guarded by the exact same
  timing-safe secret-header pattern Academia Hub already has in
  production (`middleware/cronAuth.js`, independently reimplemented) —
  a new auth style deliberately kept narrowly scoped to this one route,
  since every other route in this app is JWT-session-only. A separate,
  admin-authenticated `POST /api/scheduled-jobs/friday/run` is the
  spec's own explicitly-requested "protected manual test/run endpoint,"
  scoped to only the caller's school. 11 new backend tests (96 total, 1
  skipped): enabled-by-default, disabling stops the job, an arrears-free
  school completes cleanly with zero processed, full processing with
  correct success/failure counts and per-parent records, same-cycle
  re-run is a true no-op, cooldown correctly excludes a recently-reminded
  parent (and correctly does *not* exclude one outside the window — this
  caught a real math error in the test itself, not the app), min-balance
  threshold exclusion, job-history tenant isolation, and the cron
  endpoint's auth (no header / wrong header / correct header). Along the
  way, live testing surfaced and fixed a real bug: `PATCH
  /api/settings/friday-reminders` was overwriting every column from
  whatever the request body happened to contain, so a caller updating
  only `reminderCooldownDays` silently reset `friday_reminders_enabled`
  to `false` and wiped the template/min-balance — now a true partial
  update, merged against the row's current values. Frontend: a "Friday
  Automation" panel added to the SMS Templates page (enabled toggle,
  template picker, min balance, cooldown, a "Run Now" button, and a job
  history table) — grouped there rather than as a separate page, matching
  the spec's own "SMS Center" screen concept (templates + Friday settings
  + history together). Live-verified end-to-end through the real UI:
  clicked Run Now, watched the job complete and the history table update
  with real counts, confirmed via the API that the underlying
  `scheduled_jobs` and `sms_reminders` rows were written correctly — the
  one real send attempted failed with mNotify's live `401` (sender ID
  still pending approval), recorded cleanly as `failed`, exactly the
  same graceful path already proven for the manual-reminder flow.
- **Phase 9 — Reports: SHIPPED 2026-10-03.** All seven report types from
  the spec's section 15, plus CSV export where the report is a list
  (`utils/csv.js`, a small dependency-free RFC-4180 serializer):
  **Collection Summary** (expected/collected/outstanding/rate, filterable
  by term/class/date range — reads straight from invoices' own materialized
  `total`/`paid_amount`/`balance` columns, never re-derived from payments,
  consistent with how those columns are trusted everywhere else in this
  app), **Outstanding Fees** (the same underlying facts as the Arrears
  page, reformatted as an exportable report rather than an actionable
  workflow view — kept as its own query in `reportsController.js` rather
  than importing from `arrearsController.js`, matching this codebase's
  convention that each controller owns its SQL), **Payment History**
  (explicitly splits online vs. manual collection totals, per the spec's
  own requirement), **Invoice Report**, **SMS Activity** (sent/failed
  counts + a dated, recipient-level list), and **Student/Parent
  Statements** (invoices + payments + running totals for one
  student/family — rendered on-screen with a browser print button rather
  than generating real PDFs server-side, since the spec explicitly frames
  PDF as optional: "can be added... where useful," and a print-to-PDF
  browser dialog covers the same real need — producing something a
  parent can save or hand over — without adding a PDF-generation
  dependency this phase doesn't otherwise need). 12 new backend tests
  (108 total, 1 skipped): correct expected/collected/outstanding math,
  fully-paid invoices correctly excluded from Outstanding Fees, CSV
  export has a real header row and real data, online/manual collection
  split is correct, parent-filtering on payments (which required joining
  through `parent_student`, since `payments` itself has no `parent_id`
  column — caught before ever hitting a live server, not after), method
  filtering, per-student and per-parent statement totals, and tenant
  isolation across every report and both statement types. Frontend: one
  Reports page with an internal tab switcher (Collection Summary,
  Outstanding Fees, Payment History, Invoice Report, SMS Activity,
  Statements) rather than six separate nav entries — matches the spec's
  own "Reports" screen concept as a single destination with multiple
  report types, not six independent pages competing for sidebar space.
  CSV export links are plain `<a target="_blank">` tags pointing straight
  at the backend's CSV endpoints (not routed through `apiRequest()`,
  which always calls `.json()`) — the browser's top-level navigation
  still carries the `sameSite:'lax'` auth cookie automatically, so no
  separate download-auth mechanism was needed. Live-verified end-to-end
  through the real UI: seeded two students (one fully paid, one
  partially), confirmed Collection Summary's math, confirmed Outstanding
  Fees correctly excluded the fully-paid student, confirmed Payment
  History's online/manual split, and confirmed a Student Statement
  rendered the right student with the right totals.
- **Phase 10 — Security/QA: SHIPPED 2026-10-03.** A systematic pass
  against the spec's own section 13 checklist, item by item, rather than
  generic hardening busywork. What it found and fixed:
  - **Audit logs** (`audit_logs` table, `utils/auditLog.js`) — the one
    clearly-named, clearly-missing requirement. Scoped to financial and
    administrative actions specifically (matching the spec's own phrase),
    not instrumented into every mutation: payment create/void, invoice
    generation, Friday-settings changes, and SMS template create/update.
    Never throws into its caller — a failed audit write must not undo or
    block the real action it was recording. A new admin-only
    `GET /api/audit-logs` endpoint and Audit Log page expose it (an audit
    trail nobody can read isn't much of one). 6 new tests confirm each
    action is recorded with the correct before/after values, the acting
    user, and a real IP address, and that it's tenant-isolated like
    everything else.
  - **A real, critical dependency vulnerability** — `npm audit` on the
    frontend surfaced an unauthenticated RCE in Next.js 16.3.0
    (GHSA-p293-qw3h-jr36 and two related advisories). Fixed with a
    same-minor-line patch bump to 16.3.8 (no breaking changes); confirmed
    with both `npm audit --omit=dev` (0 vulnerabilities) and a clean
    production build afterward. A separate set of *dev-only*
    `eslint-config-next` advisories (a transitive `braces` DoS) was
    reviewed and deliberately left alone — that dependency chain never
    ships to production or runs against user input, so it has no
    exploitable path in the deployed app.
  - **Two real rate-limiting gaps** — the spec explicitly names "webhook
    abuse surfaces" and payment/login endpoints as needing rate limits;
    `POST /api/payments/webhook` had none at all (signature-protected,
    but an unthrottled endpoint still costs an HMAC computation and a DB
    lookup per request). Added a generous limiter sized to never throttle
    Paystack's own legitimate redelivery retries. Also added a limiter on
    `POST /api/reminders/send` — not explicitly named in the spec's list,
    but added for the same underlying reason as the ones that are: each
    call can trigger a real, billable SMS send, and an admin-authenticated
    endpoint shouldn't be exempt from protecting a school's SMS credit
    just because it requires a session.
  - **`app.set('trust proxy', 1)`** — added so `req.ip` (used by both the
    new audit log and every rate limiter) reflects the real client address
    once deployed behind Render/Railway's reverse proxy, not the proxy's
    own address.
  - **CSRF reviewed, no new mechanism added.** The frontend's `next.config.mjs`
    rewrite proxy means every production request is genuinely same-origin
    from the browser's perspective (not merely same-site) — a third-party
    site cannot make same-origin requests to SmartPay's own domain at all,
    which structurally rules out CSRF regardless of the `sameSite:'lax'`
    cookie setting underneath it. Confirmed by re-reading the actual proxy
    config rather than assuming the reasoning still held.
  - **Full route-by-route authorization sweep** — every route file
    checked by hand: every protected route has `verifyToken` (and
    `verifyRole('school_admin')` on every state-changing one); the only
    unauthenticated routes are the ones deliberately designed to be
    (public checkout, the signature-verified webhook, the secret-header
    cron trigger, login/register); no controller anywhere trusts a
    client-supplied `schoolId`; `password_hash` is never spread into a
    response anywhere it's fetched. All confirmed clean — no changes
    needed, which is itself the point of doing the sweep rather than
    assuming.
  - **`npm audit` on the backend** — 0 vulnerabilities, no action needed.
  - **Edge cases (spec section 17) reviewed against what's actually
    built.** Most are already provably handled by earlier phases' own
    tests (duplicate invoice generation, partial/over-payment, webhook
    redelivery, Friday job crash/retry, missing phone, expired link, "no
    arrears"). Two are deliberately out of scope, not overlooked: SMS
    *delivery*-status tracking (mNotify's `getDeliveryStatus()` is
    explicitly marked optional in the spec's own `SmsProvider` interface,
    and reminders already correctly report `sent`/`failed` from the send
    attempt itself) and "two admins edit the same record" (moot — Phase 1
    deliberately ships exactly one admin per school with no UI to add
    more, so concurrent-edit conflicts aren't a reachable scenario yet).
  - Along the way, fixed a regression the new `audit_logs` table's own
    foreign keys exposed: every existing test file's cleanup needed the
    same `audit_logs` delete added as `sms_templates` did in Phase 7, and
    four of them had it in the wrong order relative to the `users`
    delete (`audit_logs.user_id` also references `users`, so it must be
    deleted first) — caught by running the full suite, not assumed correct
    from the individual file's own test run.
- **Phase 11 — started 2026-10-03, paused mid-way.** Hosting choice
  confirmed (same providers Academia Hub uses — Vercel, Render, Aiven —
  but as entirely separate projects/services, not nested inside Academia
  Hub's own). Two pieces of real, code-side Phase 11 work landed before
  pausing to go live-host anything:
  - **A real gap closed in the Friday job**: `friday_send_time` (built in
    Phase 8, editable in the UI) was stored but never actually checked
    anywhere — the job ran for every enabled school regardless of its
    configured time. Fixed with a `respectSendTime` flag, applied only to
    the all-schools scheduler path (`runFridayJobForAllSchools`), never
    to the admin-facing manual-run endpoint (which must stay immediate,
    per the spec's own "protected manual test/run" framing). The real
    production trigger, `.github/workflows/friday-reminders.yml`
    (mirroring Academia Hub's own already-proven GitHub-Actions +
    `x-cron-secret` pattern exactly), now fires **hourly on Fridays**
    rather than once at a single global time, so each school's own
    configured send time is actually honored — a school not yet due this
    hour is simply skipped and picked up by a later firing the same day,
    with the existing cycle lock preventing any duplicate once it does
    fire. 3 new tests confirm the gate correctly blocks/allows based on
    time, and that the manual-run path is unaffected by it. 117 tests
    total, 1 skipped.
  - **A real, pre-existing mobile-responsiveness gap, found and fixed**:
    the admin dashboard's `DashboardShell` had zero mobile treatment — a
    fixed-width sidebar with no breakpoint, squeezing the entire desktop
    layout into a sliver of the screen and forcing full-page horizontal
    scroll on a phone. Fixed with the same hamburger-menu + slide-in-drawer
    pattern Academia Hub already proved (its own dashboard hit and fixed
    this identical bug), independently reimplemented against SmartPay's
    own plain-Tailwind palette rather than Academia Hub's ink+gold one —
    off-canvas below `md` (768px), static and always-visible at `md` and
    above, closing automatically on route change (covers both a nav-link
    click and the browser back button). Separately, every data-table
    wrapper across all 11 list pages used `overflow-hidden`, which would
    have silently *clipped* a wide table's rightmost columns on a narrow
    screen with no way to scroll to them, rather than let it be
    scrolled — changed to `overflow-x-auto` everywhere, a one-line,
    mechanically-applied fix. Live-verified on a real 390px mobile
    viewport, caught by the user's own interrupt mid-deployment-walkthrough
    to go check this first: before the fix, both Arrears and Reports
    showed real horizontal page overflow; after, every page (the parent-
    facing checkout/status pages were already fine, unaffected by this
    bug) fits cleanly, and the drawer opens/closes correctly including
    auto-closing on navigation.
- **Phase 11 — deployment: completed 2026-10-04/06.** Resumed and
  finished live-hosting. Aiven MySQL (new, separate account/org from
  Academia Hub's — SmartPay's first attempt to share Academia Hub's
  existing Aiven server ran into a grant-scoping mistake that nearly
  weakened Academia Hub's own DB access; abandoned in favor of a clean
  separate account rather than risk it), Render web service (`smartpay`,
  free tier, Frankfurt, public-Git-URL deploy — not the GitHub App
  integration, which matters below), Vercel frontend (`smartpay-tan.vercel.app`,
  `/api/:path*` rewrite proxy to the Render origin so cookies work
  cross-origin the same way Academia Hub's already-proven pattern does),
  GitHub Actions secrets for the Friday-reminders cron, fresh
  production `JWT_SECRET`/`CRON_SECRET`. End-to-end verified live, not
  just via `curl`: registered a school and logged in through the real
  deployed frontend.
  - **A real production incident, caught and fixed same-day**: the live
    backend started 500ing on login (and on every other DB-touching
    route) — Aiven's free tier had auto-paused the database from
    inactivity, the same failure mode Academia Hub hit before. Added a
    `GET /api/keepalive` endpoint for UptimeRobot to hit every 5
    minutes, modeled on Academia Hub's own unconfirmed experiment: a
    real `UPDATE` against a dedicated single-row table rather than a
    read-only health check, on the theory that write I/O is more likely
    to register as genuine activity than a read (Aiven doesn't publish
    the actual threshold, so this remains unconfirmed, not a guaranteed
    fix). Deliberately self-bootstrapping — it creates its own table and
    seeds its row on first call if missing — since production DB
    credentials live only in Render/Aiven, never in this codebase or any
    local `.env`, so there was no safe way to run a one-off `CREATE
    TABLE` against prod from outside it.
  - **Auto-deploy left off on purpose**: Render's "On Commit" setting
    was already enabled by default, but a service connected via a
    public Git URL (rather than the GitHub App) only polls for new
    commits instead of getting an instant webhook — in practice two
    pushes sat live-stale for roughly two days before anyone noticed.
    Rather than reconnect through the GitHub App for truly instant
    deploys, the user chose to keep deploying manually ("Deploy latest
    commit", one click) — low push frequency on this project makes
    knowing exactly when prod changes more valuable than automatic
    speed.
- **UI/UX refinement pass: SHIPPED 2026-10-03/06**, against a
  29-section spec document (`SmartPay_UI_UX_Improvement_Specification_Claude_Code.docx`)
  covering every page. No backend changes — this was a pure frontend
  pass, phase-by-phase against the spec's own implementation order,
  each step committed and verified independently:
  - **Design tokens + shell** (`globals.css`, `DashboardShell`): the
    spec's full color/radius/shadow token set, a visible focus ring, a
    reduced-motion guard; navigation regrouped into the spec's named
    sections (School setup / Fees & payments / Reminders / Reports /
    Admin) with `aria-current` on the active link.
  - **A shared `components/ui.js`** grew incrementally across the whole
    pass rather than being designed upfront: `Button`/`LinkButton`,
    `PageHeader`/`Panel`/`MetricCard`/`AmountDisplay`/`StatusBadge` (+ a
    single `statusTone()` mapping every status word across invoices,
    payments, SMS, and scheduled jobs to one of 4 tones), `EmptyState`/
    `LoadingSkeleton`/`ErrorState`, `MobileRecordCard`, a page-local
    `useToast()`/`<Toast/>` (deliberately not a global context/queue —
    this app only ever has one toast live from one financial action at
    a time, so a provider would be more machinery than the actual
    need), and a `<Field>` wrapper (see below).
  - **Dashboard** rebuilt from a static "coming soon" placeholder into
    real data — collection summary, largest outstanding balances, last
    Friday run, recent payments — reading only existing endpoints; two
    backend additions (child-count on the parent list, a payment
    reference on the status endpoint) were proposed and explicitly
    **not approved**, so neither was built, and nothing downstream
    depends on them.
  - **Every list page** (Arrears, Invoices, Fee Structures, Students,
    Parents, Classes, Academic Setup, Reminders, SMS Templates,
    Reports, Audit Log) got the same treatment: shared components,
    stacked mobile cards below `md` with the existing desktop table
    kept above it, loading/empty/error states, and a toast on every
    create/update/set-current action per the spec's explicit feedback-
    states section — broader than just payments, as the spec actually
    asks for it on all CRUD.
  - **Two real bugs found and fixed along the way, not just cosmetic
    changes**: the Fee Structures builder's live running total called
    `formatMoney()` with no currency argument, silently defaulting to
    GHS regardless of a school's actual configured currency — exactly
    the mistake the spec's own Fee Structures section warns against by
    name. And a stray `key` field added to the first toast draft (for
    no real purpose — `Toast` isn't rendered in a list) triggered a
    React key-spread warning in the console, caught by a Puppeteer
    console listener during verification, not by code review.
  - **Dialog focus management** (`Modal`, used by Record Payment and
    Send Reminder): the first draft closed on Escape but never managed
    focus otherwise. Rebuilt to move focus into the dialog on open, trap
    Tab/Shift+Tab inside it, and return focus to the trigger element on
    close — spec section 23 calls this out by name, and it's the kind
    of gap that's easy to ship silently since the dialog still looks
    and functions fine without it.
  - **Site-wide accessible-label sweep**: every form on the site used
    a label and its input as markup-adjacent siblings with no `for`/`id`
    pairing — reads fine visually, fails "every field needs an
    accessible label" programmatically. Added `<Field>` (wires
    `htmlFor`/`id` via `useId()` + `cloneElement` automatically) and
    applied it across all ~35 affected fields in one pass, plus
    `aria-label` on a few inputs too compact for a visible label (the
    inline link-parent row, the repeating fee-item rows, two previously
    fully-unlabeled filter selects on Reminders/Audit Log). Verified
    with an automated Puppeteer sweep across all 12 dashboard pages at
    once (not spot-checked) confirming zero orphaned labels, rather
    than trusting the refactor by inspection.
  - **Public payment pages** (`/pay/[token]`, `/pay/status/[reference]`)
    deliberately kept visually distinct from the admin dashboard per
    spec section 18 ("should not resemble the admin dashboard") — no
    shared shell, no dashboard chrome — while still fixing real issues
    on the app's single highest-stakes form: `htmlFor`/`id` label
    pairing, input font-size bumped to 16px to stop iOS Safari's
    auto-zoom-on-focus at 320–414px, touch targets bumped toward the
    spec's ~44px, two hard-coded Tailwind colors swapped for the shared
    tokens already used everywhere else. The status page now shows the
    payment reference on success (already available client-side from
    the URL, no backend change needed) and turns the failed/cancelled
    state's "go back" text into a real working button.
  - **One known gap flagged, not fixed**: every route — including the
    public, unauthenticated payment pages — gets wrapped in
    `AuthProvider` by the root layout, which fires a session-restore
    call on mount regardless of path, producing a harmless but
    unnecessary 401 on every public-page load. Pre-existing, affects
    every route in the app, and restructuring the root layout was
    judged out of scope for a page-by-page UI pass — left as a known
    inefficiency for a future, deliberate pass rather than touched
    unprompted.
  - Verified throughout with real Puppeteer browser runs against
    freshly seeded test schools (never against production) at
    320/390/414/1280px — not just `next build` passing — catching, among
    other things, that reminder history in the admin UI renders twice
    in the DOM (once per responsive layout, CSS-hidden rather than
    unmounted) when picking a target for an automated click, and that
    Puppeteer's own `.type()` doesn't reliably fill a native
    `<input type="date">` (an apparent "Nov 30, 1899" date bug was
    traced to the test script, not the app, and the app's real date
    handling was separately re-confirmed correct).
- **Visual redesign (reference mockups), page by page**: replaces the
  UI/UX-spec pass above with a closely-matched implementation of mockups
  the user supplies incrementally, on `components/ui2.js` (`Avatar`,
  `Badge2`, `Card2`, `IconBadge`, `StatCard`, `Button2`, `SearchBar`) plus
  a redesigned `DashboardShell`/`Logo`/`ThemeToggle`. Shipped so far:
  foundation + Login/Register, Dashboard, Students (2026-10-06), dark mode
  across the whole app (2026-10-06), then **Classes, Parents, and
  Academic Setup (2026-10-07)**:
  - **Classes**: Grade Level ("Basic" vs "Junior High") is derived from
    the class name's own naming convention, not a stored field — no
    `capacity` column exists in the schema, so the mockup's Capacity
    column was dropped rather than fabricated (user's explicit call).
    Added a real per-class `student_count` (active students only) and an
    archive/reactivate status toggle (`PATCH /classes/:id/status`) — a
    class is never hard-deleted since fee structures and students
    reference it historically.
  - **Parents**: added real aggregates to `GET /parents` — `children_count`,
    `outstanding_balance` (summed from each child's non-void invoices
    with a balance), and `child_class_ids` (lets the class filter work
    entirely client-side, matching the rest of the app's fetch-once
    pattern) — plus an active/inactive status toggle
    (`PATCH /parents/:id/status`), mirroring Classes'.
  - **Academic Setup**: the mockup's 4 tabs (Academic Year, Terms,
    Grading System, School Settings) don't all map to a real feature —
    SmartPay has no grading/results concept at all. User chose (via
    explicit options, not assumed): drop Grading System entirely, and
    relabel "School Settings" to **"Reminder Settings"**, the first UI
    ever built for the Friday-SMS-automation backend
    (`schoolSettingsController.js`'s `friday-reminders` endpoints), which
    has existed since Phase 8 with no way for an admin to see or change
    it until now.
  - **A real crash found and fixed**: `Field`'s `cloneElement(children,
    ...)` pattern (see the UI/UX pass above) requires exactly one child
    element — the new Reminder Settings tab passed a `<select>` plus a
    conditional helper `<p>` as two children, which crashed the whole
    tab (`Element type is invalid: ... undefined`) the moment a user with
    no "Friday reminder" SMS template opened it. Caught via a live
    Puppeteer run with full page-error stack capture, not `next build`
    (which doesn't exercise this runtime branch) — fixed by moving the
    helper text outside the `Field` wrapper.
  - **A real environment bug, not an app bug, caught by the same QA
    pass**: the backend dev server had been running since the previous
    day via a direct `node server.js` (no file-watcher), so it was
    silently serving yesterday's code — new parents showed "GHS NaN" for
    Outstanding Balance because the live response simply had none of
    today's new aggregate fields. Restarted on `nodemon` (already the
    project's own `npm run dev` script) so this can't recur silently.
  - **One pre-existing issue flagged, not fixed**: generating a payment
    link (`parentController.generatePaymentLink`, untouched by this
    pass) hit a real `ER_LOCK_DEADLOCK` once during QA. Out of scope for
    a page-redesign pass; the new `PaymentLinkModal` was confirmed to
    surface it as a clean in-modal error message rather than crashing,
    which is the behavior that actually mattered for today's work.
  - 5 new integration tests (`tests/classesParents.integration.test.js`)
    cover the new aggregates and both status endpoints, including a
    cross-tenant check. 121/121 backend tests passing. Verified live via
    Puppeteer at 1440px and 390px against a freshly registered test
    school — all QA data cleaned from the DB afterward.
  - **mNotify real end-to-end delivery confirmed, 2026-10-07**: real send,
    real receipt on a real phone, via the already-approved `"AcademiaHub"`
    sender ID as a deliberate stopgap while `"SmartPay"` is still pending
    mNotify's own approval (env var updated in both Render and local
    `.env` — see Decisions Log). Found and fixed a real bug in
    `mnotifyProvider.js`'s `providerMessageId` extraction along the way
    (checked `summary.id`/`data[0]._id`, neither of which the real API
    response ever contains — silently `null` on every send since Phase
    7), pinned down with 3 new mocked-fetch unit tests
    (`tests/mnotifyProvider.test.js`) built from the real captured
    response shape.
  - **Parent/guardian collection moved onto Add Student, 2026-10-07**:
    the Add Student modal now has an optional "Parent/Guardian" section
    (name, phone, relationship) collected in the same request, mirroring
    Academia Hub's `enrollOneStudent` lookup-or-create-parent pattern —
    user's explicit request, having found the old two-step flow (add
    student, then separately add-and-link a parent) unnecessarily
    cumbersome. `POST /students` now does student-create + parent-
    lookup-or-create + link, all in one transaction: an existing parent
    sharing the same phone *within that school* is reused, not
    duplicated (the real sibling case — two children, one parent, added
    separately) — matched by exact phone string, same as the rest of
    this codebase's phone handling (no format normalization at storage
    time anywhere else either). Deliberately stayed **optional**, not
    required like Academia Hub's version (user's explicit choice): a
    student can still be added with no parent on file and linked later
    from the Students page, unchanged from before. 5 new integration
    tests (`tests/studentEnrollment.integration.test.js`) cover the
    no-parent path, partial-parent-fields rejection, new-parent
    creation, sibling dedup (confirmed only one parent row exists after
    two linked students), and that a matching phone in a *different*
    school is never reused across tenants. 129/130 backend tests passing
    (1 pre-existing skip). Verified live via Puppeteer: registered a
    fresh school, added two children under the same parent phone through
    the real modal, confirmed the Students table showed the parent
    immediately on both rows with zero extra steps, confirmed the
    Parents page showed exactly one parent with 2 children (not two
    duplicate rows), and confirmed a third student added with no parent
    fields still works exactly as before.
  - **Bulk student import, 2026-10-07**: a "Bulk Import" toggle on the
    Students page, mirroring Academia Hub's own bulk-enrollment feature
    (download template -> upload CSV/Excel -> preview -> import ->
    per-row results) — independently reimplemented against this app's own
    component library, not a cross-repo dependency, same as every other
    port in this build. `lib/csv.js` (quote-aware CSV parsing, an Excel
    reader with the same two-pass raw/text cell handling Academia Hub's
    version uses to avoid silently corrupting a real date cell into a
    lossy short-date string, and an `.xlsx` template generator) and
    `components/BulkImportPanel.js` are new, generic (column spec + an
    endpoint passed in), reused by nothing else today but built that way
    on purpose. `xlsx` is installed from SheetJS's own CDN release, not
    the npm registry — the npm-published version carries two unpatched
    high-severity advisories (prototype pollution, ReDoS) with no fix
    available there; Academia Hub already made this exact call for the
    same reason, confirmed by inspecting its own `package.json` before
    installing anything.
    - Backend: `POST /students/bulk-enroll`, sharing the single Add
      Student endpoint's core (`enrollOneStudent`, extracted into a
      function both now call) rather than duplicating the student-create
      + parent-lookup-or-create + link logic. Each CSV row names its
      Class and Academic Year as plain text, resolved against this
      school's own records before being handed to that shared core — a
      human filling in a spreadsheet has no reason to know an internal
      id. Academic Year can be left blank, defaulting to whichever year
      is marked current (every other row in one real import is
      overwhelmingly likely to share the same year; re-typing it on
      every line is pure friction). Each row gets its own transaction,
      not all-or-nothing, same 200-row cap as Academia Hub's own version.
      8 new integration tests (`tests/studentBulkEnroll.integration.test.js`):
      empty/oversized batch rejection, a good row succeeding alongside a
      bad one failing independently, the current-year default, an
      unknown class/year name failing with a clear message, sibling
      dedup across rows, partial parent fields rejected, and a duplicate
      admission number within one batch failing only on its second
      occurrence.
    - **A real bug found and fixed during live QA, not by inspection**:
      the Academic Year column's header text —
      `"Academic Year (optional, defaults to current)"` — had a literal
      comma inside it. An unquoted CSV (anything short of a properly
      quoted export, which this app's own auto-generated `.xlsx`
      template never produces, but a hand-typed or differently-exported
      CSV could) silently splits on that comma, shifting every column
      after it by one — live-reproduced exactly this way: Parent Name
      and Parent Phone landed swapped (a parent literally named
      "0241234567" with phone "Mother"), caught by actually reading the
      Parents page after import, not just checking the success count.
      Fixed by shortening the header to `"Academic Year"` and moving the
      "defaults to current" explanation to plain text next to the panel
      instead — the underlying CSV parser (ported from Academia Hub's
      already-proven version) was never the problem; a column header
      containing a comma was always a latent landmine for a
      comma-*delimited* format regardless of which parser reads it.
    - Verified live via Puppeteer with both file types: a hand-built CSV
      (3 successful rows including a sibling-dedup pair, 1 row failing on
      a deliberately unknown class name, confirmed isolated from the
      other 3) and a real generated `.xlsx` workbook (2 sibling rows,
      100% success, confirmed the Students and Parents pages both
      reflected it correctly with zero extra steps).
  - **A real, repeating test-suite flakiness traced to its actual root
    cause and fixed, 2026-10-07**: `npm test` had been intermittently
    hanging all session (never exiting, no output) specifically when
    `tests/studentEnrollment.integration.test.js` and
    `tests/onlinePayments.integration.test.js` ran in the same
    `--runInBand` process. Root cause, confirmed by reproducing it
    directly rather than guessed at: `studentEnrollment`'s own
    cross-tenant test asserted a **global, unscoped** `COUNT(*) FROM
    parents WHERE phone = ?` — safe in isolation, but false once another
    file in the same suite run (`studentBulkEnroll`, this same session)
    reuses the identical fixture phone number, since the count then
    reflects every school in the shared test database, not just the two
    this test created. The resulting assertion failure threw mid-test,
    skipping that test's own manual cleanup of its second school's
    academic year — which then made that *file's* own `afterAll` throw
    on a foreign-key constraint trying to delete a school still
    referenced by it, which skipped `db.end()`, which left the Jest
    process with an open database handle and nothing to make it exit.
    Separately, `onlinePayments.integration.test.js` had a pre-existing,
    unrelated hazard of its own — `DELETE FROM parents WHERE full_name
    LIKE '%Mensah%'`, global and unscoped the same way, which fails the
    same way the moment any other test's same-named fixture data is
    still present. Both fixed: the cross-tenant assertion now checks
    per-school, not globally; that test's cleanup now runs inside a
    `try/finally` so an assertion failure can never again skip it;
    `onlinePayments`' parent cleanup is now scoped by `school_id` (both
    schools it creates) instead of matching by name. Confirmed fixed by
    running the full suite twice in direct succession after the fix —
    137/138 passing, clean exit, no hang, both times.
  - **Students page: class cards replace the always-visible flat list,
    2026-10-07** — user's explicit request, mirroring Academia Hub's own
    Students structure, prompted by a real concern (the flat list only
    gets longer as a school's roll grows, meaning more scrolling over
    time with no ceiling). Discussed before building, not assumed:
    confirmed the one genuinely open question (what the top-nav search
    redirect should do once the landing view is cards, not a list) before
    writing any code.
    - Default view is a grid of class cards (name, student count, an
      "N inactive" hint) — the same role the old "Filter by Class"
      sidebar panel and the "All Classes"/"All Statuses" dropdowns used
      to play, now the primary navigation instead of a secondary control;
      both are gone. Clicking a card shows just that class's roster, with
      a breadcrumb back, and an inactive-student toggle (hidden by
      default) replacing the old status dropdown — same hidden-by-default
      reasoning Academia Hub's own class roster page uses.
    - Implemented as `?classId`-equivalent local component state on the
      existing Students route, not a new nested route the way Academia
      Hub's `/students/class/[gradeLevel]` is — SmartPay's classes are
      admin-named text, not a fixed enum, and the existing single-page
      pattern this app already uses elsewhere (`?search=`) covers the
      same need without a second route to maintain.
    - Search stays a single box, but doubles as an intentional override:
      typing anything shows a flat, cross-class match list (so the
      top-nav search redirect, which lands here with `?search=`, keeps
      working exactly as before) and takes priority over whichever class
      is open; clearing it returns to cards or the previously-open class.
      Decided via a direct question rather than assumed, since it's the
      one place "card-ify everything" could have silently broken an
      existing, separate feature.
    - Add Student now pre-selects the open class in its Class dropdown
      when launched from inside a class's roster (still editable) — a
      small but real improvement to the exact workflow this redesign is
      about: adding a student without extra clicks.
    - Verified live via Puppeteer, desktop and 390px mobile: cards show
      correct per-class counts, clicking in shows the right roster with
      correct breadcrumb, clearing a class-scoped view and returning to
      cards works, global search correctly finds a student in a class
      that isn't currently open, and the Add Student class-prefill was
      confirmed via the actual selected `<option>` text, not just that a
      value was set. `next build` clean; no backend changes this pass, so
      only a frontend QA round was needed.
  - **`createPaymentLink` deadlock: actually fixed, 2026-10-07** — the
    `ER_LOCK_DEADLOCK` first flagged-but-not-fixed during the earlier
    redesign's QA (found again live in production: a real "Send Reminder"
    attempt on a real invoice failed with "Server error while sending the
    reminder") now retries automatically instead of surfacing as a bare
    500. New `utils/retryOnDeadlock.js` — on `ER_LOCK_DEADLOCK`
    specifically (MySQL's own documented guidance is "the application
    should retry the transaction," since InnoDB already rolled the losing
    attempt back entirely as its resolution mechanism), re-runs the
    *whole* attempt (fresh connection, fresh `beginTransaction`) up to 3
    times with a short increasing delay, not just the one query that
    happened to report it. Wired into both call sites that share
    `createPaymentLink` — `reminderController.send` (where this was hit
    live) and `parentController.generatePaymentLink`. 4 new unit tests on
    the retry logic itself (mocked), plus a real concurrency integration
    test (`tests/paymentLinkConcurrency.integration.test.js`): 10 truly
    simultaneous payment-link requests for the *same* parent — the exact
    shape of contention that deadlocks InnoDB's gap locking on
    `payment_links`' `UPDATE`-then-`INSERT` pattern — all 10 succeed, and
    exactly one active link survives (confirming `createPaymentLink`'s
    own revoke-before-insert behavior still holds under real concurrent
    load, not just sequentially). 142/143 backend tests passing.
  - **The actual cause of the production "Send Reminder" failure — found
    via real Render logs, 2026-10-07.** The deadlock fix above shipped
    first on a plausible-but-wrong diagnosis (the generic client-side
    "Server error" message gave no real signal) and genuinely improved a
    real, separate hazard — but deploying it did **not** fix the user's
    actual failure, which recurred identically on retry. Only reading the
    real Render log (not guessable from here, no production access)
    surfaced the true cause: `ER_BAD_FIELD_ERROR` / "Unknown column
    'active' in 'where clause'" on `... AND status = "active" ...`.
    **Local MySQL (XAMPP) and Aiven (production) evidently run different
    SQL modes** — under `ANSI_QUOTES` (or a mode that includes it),
    double-quoted text is parsed as an *identifier*, not a string
    literal, so `"active"` was read as a column named `active` rather
    than the word "active". Every other SQL string literal in this
    codebase already uses single quotes; these were the sole
    exceptions — genuine, pre-existing typos, not something this
    session's own changes introduced, that could only ever surface in
    production, never locally. Three occurrences, all in reminder code,
    fixed to single quotes: `reminderController.js` (the exact line that
    failed live), `fridayJob.js` (the **automated Friday reminder job
    shares this same line** — would have failed in production the first
    time it ran for any school, silently, until someone noticed reminders
    weren't arriving), and `reminderCore.js`'s `getTemplate` (hit only
    when a specific `templateId` is requested). Since no local test can
    exercise the actual bug (local SQL mode doesn't reproduce it), added
    a static-source regression test instead
    (`tests/noDoubleQuotedSqlStrings.test.js`) that scans every
    `controllers/`/`utils/` file for a double-quoted bareword next to
    `=` inside a `pool.query`/`connection.query` call — verified it
    actually catches the bug by deliberately reintroducing it and
    confirming the test fails, then reverting. 144 backend tests passing
    (1 skipped).
  - **`mnotifyProvider.js` error logging, 2026-10-07**: after the fix
    above, the real "Send Reminder" attempt got past the SQL bug but
    then failed with a genuine, non-standard `mNotify error (419)` — and
    `sendSms`'s own error path (`response.json().catch(() => null)`) was
    silently discarding whatever mNotify's actual response body said,
    leaving nothing in the server logs beyond the bare status code.
    Neither mNotify's own docs (JS-rendered, already known to be
    incomplete — see Phase 7) nor a general web search turned up a
    documented meaning for `419` specifically. Rather than keep
    guessing, fixed the real, fixable gap: `sendSms` now reads the
    response as text first (never assumes JSON), attempts to parse it,
    and `console.error`s the raw body (truncated to 1000 chars, server-
    side only, never in the client-facing message) whenever a send
    fails — so the *next* unexplained provider error is actually
    diagnosable from Render's logs instead of a bare, undocumented code.
    1 new unit test (a non-JSON/HTML-shaped failure response, confirming
    both that it's still handled cleanly and that its content reaches
    the log). 145 backend tests passing (1 skipped).
  - **Second real SMS provider: Arkesel, 2026-10-07.** mNotify's account
    was flagged as fraudulent and suspended mid-use (likely triggered by
    today's real test-send volume combined with sending under
    `"AcademiaHub"`, a sender ID that doesn't match this account's own
    name — flagged as the probable cause in the support request sent to
    mNotify, not confirmed). Rather than wait on that resolution with no
    ETA, added a second, independent provider — the whole point of
    `utils/smsProvider.js`'s documented contract from Phase 7, now used
    for real for the first time. New `utils/arkeselProvider.js`
    implements the same 3-function shape (Ghana-specific: direct
    MTN/Telecel/AirtelTigo connections, GHS/Mobile-Money billing).
    `utils/smsProvider.js` itself now does the actual provider selection
    (previously just a documented contract with nothing routing through
    it) — a new `SMS_PROVIDER` env var picks the active adapter,
    defaulting to `mnotify` (explicit opt-in to Arkesel, not a silent
    default flip, since Arkesel's failure-response shape started
    unconfirmed). `reminderController.js` and `fridayJob.js` — the only
    two real call sites — now import `./smsProvider` instead of a
    specific adapter directly; neither needed any other change, since
    both already named the import `smsProvider`.
    - **A real bug this surfaced, not introduced**: `fridayJob`'s own
      integration test explicitly mocks `sendSms` specifically *because*
      "a real Friday-job send is a billable, irreversible side effect" —
      but it mocked `mnotifyProvider` directly, which stopped being what
      `fridayJob.js` actually calls the moment the import changed to go
      through the switch. The mock silently stopped intercepting, and a
      live test run made real, unmocked calls to the real Arkesel API
      with the real key — caught by the full suite's own `ECONNREFUSED`
      failure (MySQL had separately gone down) forcing a second full run,
      which is what surfaced the real-send log lines. Fixed: the test now
      mocks `utils/smsProvider` instead. Checked every other test file
      for the same mock-target mismatch — `sms.integration.test.js` had a
      related, less acute version (`hasRealMnotifyKey`, hardcoded to one
      adapter's env var, by coincidence still correctly gated the
      real-send test today only because `MNOTIFY_API_KEY` also happens to
      be set) — tightened to check `smsProvider.validateConfiguration()`
      instead, so it tracks whichever provider is actually active rather
      than one adapter by name. Confirmed no real credits were actually
      consumed by the incident (Arkesel balance unchanged on the
      dashboard before and after).
    - **A second real response-shape surprise, found the same way as
      mNotify's**: a real, deliberate verification send returned
      `success: true` but a silently-null `providerMessageId` — Arkesel's
      real response is `{ data: [{ id, recipient }], ... }`, `data` an
      *array*, not an object with `.id` directly, which their documented
      example didn't make obvious. Fixed and pinned down with a real
      captured response in the unit test, same discipline as
      `mnotifyProvider.js`'s identical class of bug a few hours earlier
      in this same session.
    - **Real send confirmed working end-to-end**, after fixing an
      unrelated issue (the generated Arkesel API key had to be explicitly
      "Updated"/committed in their dashboard before it was valid — an
      earlier attempt correctly failed clean with `"Invalid key"`, not a
      crash). Arkesel's own SMS History initially showed the message as
      `PENDING APPROVAL` (sender ID `"SmartPay"` is brand-new on this
      account too, same approval queue already seen with mNotify) — but
      unlike what that status label suggested, the text was actually
      received on a real phone within minutes, confirmed by the user
      directly. `PENDING APPROVAL` evidently doesn't block real delivery
      on Arkesel the way it was assumed to.
    - **Confirmed end-to-end on the live production "Send Reminder" flow
      too**, not just the earlier adapter-level test send: the real
      reminder for the live "Saad Salim" dummy-data student was sent from
      production, the UI showed "Reminder sent.", and the user confirmed
      actual receipt on their phone — this time taking closer to 20
      minutes to arrive rather than the few minutes seen on the first test
      send, still well within a usable range for a Friday-arrears
      reminder (not a time-sensitive OTP).
  - **Council-audited security fix, 2026-10-07: session revocation +
    per-account login lockout.** A product-tester security/multi-tenancy
    audit (live adversarial cross-tenant testing — 36/36 passed — plus a
    full controller/route trace) found tenant isolation itself sound, but
    surfaced a real, provably-exploitable gap pressure-tested further via
    the `llm-council` skill: `token_version` (the field `verifyToken`
    already checked on every request for revocation) was never
    incremented anywhere, there was no password-change endpoint, and
    login had only a per-IP rate limit, no per-account lockout. Combined
    with exactly one `school_admin` per school, a phished or stuffed
    credential was valid and **unrevokable for up to 24 hours** — no
    multi-tenancy bug required to do real damage to a school's live fee
    ledger. The council's own peer-review round converged hard on this
    being the single highest-priority item, ahead of the multi-tenancy
    result itself. Fixed same day:
    - `POST /auth/change-password` — verifies the current password,
      updates the hash, and bumps `token_version`, which immediately
      kills every other already-issued token for that user; the request's
      own session is kept alive by re-signing a fresh token against the
      new version in the same response.
    - `POST /auth/revoke-sessions` — a separate, faster kill-switch for
      "I think a device is compromised but can't change the password
      right now": bumps `token_version` and clears the *calling* device's
      own cookie too, so the only way back in anywhere is a fresh login.
    - Per-account lockout: 5 wrong passwords locks the account for 15
      minutes (`423`), independent of source IP — closes the gap the
      existing generous 60-req/15min per-IP limit couldn't, since that
      budget is deliberately wide to tolerate a shared staffroom IP. A
      correct login always clears both counters.
    - `users.failed_login_attempts`/`locked_until` added via a direct
      `ALTER TABLE` (no migrations system, same convention as everything
      else here) — `schema.sql` regenerated.
    - A minimal `/dashboard/account` page shipped in the same pass so
      these aren't dead API routes — without a UI, this would repeat the
      exact "machinery exists but nothing ever calls it" failure the
      audit just found.
    - Verified twice: 18 new/updated Jest integration tests (lockout,
      change-password's old-token-dies/new-token-lives/new-password-login
      behavior, revoke-sessions including killing the calling session) —
      full suite 21/21 suites, 197 passed + 1 skipped — and independently
      against the real running local server via raw HTTP calls (register
      → change password → confirm old cookie dead/new cookie alive/old
      password rejected/new password accepted → revoke → confirm dead →
      6 failed logins → confirm `423`), not just the test suite.
  - **Follow-up to the same council pressure-test, 2026-10-07: independent
    verification of the multi-tenancy result beyond ID-substitution.** The
    council's sharpest objection to the original audit: 36/36 passing
    tests only proved the `WHERE id = ? AND school_id = ?` ownership-check
    path. It never exercised this codebase's real SQL-level aggregate
    queries (`GROUP BY` + `SUM`/`COUNT`) — `classController.list`'s
    student count, `feeStructureController.list`'s fee total/item count,
    `parentController.list`'s children count/outstanding balance — which
    could in principle leak silently as a contaminated 200 instead of a
    404. Checked two ways:
    - **Read every one.** All three correctly scope the GROUP BY to an
      already-`school_id`-filtered base row (`fs.id`/`c.id`/`p.id`) and
      join down to child tables only via exact foreign-key paths, never a
      second independently-filterable `school_id`. `classController.js`
      additionally double-guards with `s.school_id = c.school_id` in the
      join condition itself — the most explicit version of this defense
      found anywhere in the codebase.
    - **Then proved it empirically rather than trusting the read**, per
      the council's own recommendation: a new test,
      `tests/tenantIsolationAggregates.integration.test.js`, seeds School
      A with small, specific numbers and School B with deliberately huge,
      unmistakable ones (10 students vs. 3, a 99,999-range fee total vs.
      150, a 99,999-range unpaid balance vs. 200) and confirms School A's
      own `/classes`, `/fee-structures`, and `/parents` totals reconcile
      exactly to School A's own rows — not inflated by School B's. All 4
      assertions passed on the real DB. This doesn't replace a genuinely
      independent (different-author) adversarial pass, which the council
      also recommended and which hasn't happened — noted honestly rather
      than claimed.
    - **Also checked the audit's route-inventory completeness claim**,
      which the council flagged as unverified: "only 2 routes without
      `verifyToken`" turned out to be undercounting by one.
      `POST /api/payments/webhook` (Paystack's server-to-server callback)
      is a third, legitimately unauthenticated route — correctly protected
      instead by an HMAC-SHA512 signature check against the raw request
      body with `crypto.timingSafeEqual` (`utils/paystackGateway.js`), not
      a vulnerability, but the original "2 unauthenticated routes" count
      was simply wrong and needed correcting rather than left standing.
    - Full suite after adding the new test: 22/22 suites, 201 passed + 1
      skipped.
  - **Two remaining ship-today items from the same council audit, closed
    2026-10-07: JWT algorithm pin + CSV/formula-injection guard.**
    - `verifyToken` now calls `jwt.verify(token, process.env.JWT_SECRET,
      { algorithms: ['HS256'] })` instead of leaving `algorithms` unset.
      Confirmed this was a real, demonstrable gap before the fix, not
      just theoretical: a token forged with the correct secret but signed
      `HS384` instead of `HS256` was silently accepted by the old code (a
      direct `jwt.verify` call proved it), and is correctly rejected now.
      Real risk was always low here — no RSA/asymmetric keys exist
      anywhere in this app, so the classic RS256-to-HS256 confusion
      attack has no public key to exploit — but the HMAC-variant gap was
      real, not hypothetical. Regression test added to
      `tests/authFlow.integration.test.js`.
    - `utils/csv.js`'s `csvEscape` now prefixes any cell value starting
      with `=`, `+`, `-`, or `@` with a leading apostrophe before RFC 4180
      quoting, per OWASP's standard CSV/formula-injection mitigation.
      Affects all 4 report exports that include parent/student-entered
      names. New `tests/csv.test.js` covers all four trigger characters,
      the combined prefix+RFC4180-quoting case, and confirms ordinary
      values are left untouched.
    - Full suite: 23/23 suites, 209 passed + 1 skipped (one
      `onlinePayments.integration.test.js` timeout seen once, against a
      real Paystack sandbox call, reproduced as flaky/network-load-
      dependent by re-running — passes 24/24 alone and on a clean rerun
      of the full suite; unrelated to anything changed in this pass).
  - **Last item from the same council audit, closed 2026-10-07: auth
    event logging (detection, not just prevention).** Every fix above
    (lockout, revocation, algorithm pin, CSV guard) prevents or narrows a
    specific attack. None of them helped anyone *notice* a credential-
    stuffing run, a suspicious password change, or a lockout happening —
    the council flagged this as a gap the entire audit shared, missed by
    all five advisors individually and only caught in peer review.
    `audit_logs` already existed for financial/administrative actions
    (`logAction`, used by payments/invoices/settings/templates) but
    nothing in `authController.js` ever wrote to it — login itself is a
    pre-auth endpoint with no `req.user` yet, so the existing helper
    couldn't be reused as-is.
    - New `logAuthEvent(req, { schoolId, userId, action })` in
      `utils/auditLog.js`, alongside the existing `logAction`, for the
      pre-auth case where `schoolId`/`userId` have to be passed in
      explicitly rather than read off `req.user`.
    - Now logged: `auth.login_success`, `auth.login_failed`,
      `auth.login_blocked` (attempted while locked out),
      `auth.account_locked` (the moment the 5th failure actually sets the
      lock — written alongside, not instead of, that attempt's own
      `auth.login_failed`), `auth.password_changed`,
      `auth.sessions_revoked` — all visible on the existing
      `/dashboard/audit-log` page a school admin already has, no new UI
      surface needed, just new labels added to its `ACTION_LABELS` map.
    - **Deliberately out of scope, not an oversight**: a login attempt
      against a *non-existent* email is never logged. `audit_logs.school_
      id` is `NOT NULL` and the table is inherently per-tenant (surfaced
      to a school's own admin as their own trail) — there's no school to
      attach an unknown-email attempt to. A platform-wide log of
      unauthenticated attempts would need its own schema and is a
      separate, bigger decision than this pass; noted here so it isn't
      mistaken for something missed.
    - **Also deliberately out of scope**: alerting/paging on these
      events (e.g. notifying someone in real time on repeated failures).
      This pass is logging only — someone has to actually open the Audit
      Log page to see it. The council's own recommendation called this a
      "new workstream," not a same-day patch; logging first, since
      alerting needs a real decision about who gets notified and how
      (email? SMS? which threshold?) that shouldn't be invented
      unprompted.
    - 8 new tests in `tests/authFlow.integration.test.js` confirm real
      rows land in `audit_logs` (not just correct HTTP responses) for
      every case above, including that hitting the lockout threshold logs
      both the triggering failure AND the lock itself, and that the
      nonexistent-email case correctly writes nothing. Full suite: 23/23
      suites, 216 passed + 1 skipped.
  - **mNotify account reactivated, 2026-10-07.** User received a real SMS
    from mNotify confirming the fraud-flag suspension (see the Arkesel
    entry above) has been lifted — resolution came through on its own;
    the drafted support email's role in that, if any, is unconfirmed.
    No code change made: `SMS_PROVIDER=arkesel` stays the active default
    (Arkesel is the one already proven end-to-end in production), mNotify
    credentials stay configured alongside as a working second provider
    rather than being removed. Revisit which provider is primary only as
    a deliberate choice, not as a side effect of this reactivation.
  - **Production incident + fix, 2026-10-07: login broken in production
    after the security-audit deploy.** The new lockout logic touches
    `failed_login_attempts`/`locked_until` on every login (success and
    failure), but the `ALTER TABLE` that added those columns had only
    been run against the local dev database, not production — Render's
    backend deploy picked up the new code expecting columns that didn't
    exist yet there. Every login (success or failure) threw
    `ER_BAD_FIELD_ERROR` and returned a 500, which is exactly the "error
    during login" the user hit minutes after deploying. Fixed live: the
    user shared the production Aiven credentials, the same `ALTER TABLE`
    was run directly against it (found the live database is actually
    named `smartpay_db`, not the Aiven service's own default `defaultdb`
    — checked via `SHOW DATABASES` rather than assumed), verified both by
    schema (`SHOW COLUMNS`) and by the login route no longer 500ing.
    Lesson, worth remembering for any future schema change: this
    project's "no migrations system" convention means a schema change
    has to be manually applied to **both** databases as two separate
    steps — running it locally is necessary but not sufficient, and nothing
    currently prevents forgetting the production half.
  - **Two real product fixes from live user feedback, 2026-10-07.**
    - **Every modal in the app was missing a close button.** The shared
      `Modal` component (`components/ui.js`) only ever closed via Escape
      — no visible X, no backdrop-click. A couple of call sites happened
      to add their own "Close"/"Cancel" button inside their own content;
      most didn't, including Manage Parents on the Students page (the
      one the user actually got stuck in) and the "linked children" view
      on the Parents page. Fixed at the root: added a close (X) button to
      the shared `Modal` header itself, so every current and future modal
      gets it automatically rather than depending on each call site
      remembering to add one. Verified via a clean build and matching an
      already-proven identical close-button pattern elsewhere in this
      codebase (`DashboardShell`'s mobile nav drawer) — not a live
      click-through, since this project has no browser-automation tooling
      installed; flagged honestly rather than claimed as fully verified.
    - **New standalone Payments page** (`/dashboard/payments`). Before
      this, the only way to see or void a payment was from inside its
      specific invoice on the Invoices page. The backend already fully
      supported a standalone view (`GET /payments` with filters,
      `POST /payments/:id/void`) — only `startDate`/`endDate` filters
      were added (mirroring the existing pattern in
      `reportsController.paymentHistory`), covered by a new test. The
      page itself: date-range + method filters server-side, a client-side
      text search over student/invoice/reference (same "fetch once,
      filter in the browser" pattern as Students/Parents), a running
      total of collected amount, inline void with a required reason, and
      a "Record Payment" flow that — since this page isn't launched from
      inside one specific invoice — first searches/picks an outstanding
      invoice, then shows the same fields as the Invoices page's own
      in-context payment form (duplicated rather than shared, matching
      this codebase's existing per-page-owns-its-own-form convention).
      Added to the sidebar under "Fees & payments", after Invoices.
      Verified: full backend suite green (23/23 suites, 217 passed + 1
      skipped) and a clean frontend build; the page was also confirmed to
      actually render (HTTP 200, no server-side crash) against a real
      local dev server — short of a full interactive click-through, for
      the same browser-automation-tooling reason as above.
  - **Direct MoMo payment option for parents without a smartphone,
    2026-10-07.** Raised by the user from their own test of the real
    parent journey: the online checkout link requires an email (a real,
    hard constraint from Paystack's own `/transaction/initialize` API,
    not a SmartPay choice — confirmed by reading `paystackGateway.js`
    before proposing anything), and more fundamentally, a parent with no
    smartphone/data can't open the link at all. Considered and rejected:
    inferring "has email → has a smartphone" from parent records to
    decide who gets which flow — a weak, unreliable proxy (a parent can
    have one without the other). Instead: every reminder can now offer a
    second, phone-agnostic path to the same outcome, available to every
    parent uniformly rather than guessed per-parent.
    - New `schools.momo_number` column + `GET`/`PATCH /settings/profile`
      (separate from the existing Friday-reminder settings endpoint —
      different concern, its own partial-update logic). Surfaced as a
      small "Direct Payment Number" panel on the SMS Templates page,
      right above Friday Automation, since that's where an admin already
      goes to manage what reminders say.
    - New `{{school_momo_number}}` template variable, wired into
      `reminderCore.js`'s `buildVariables` (and `fridayJob.js`'s own
      pre-fetched school row, which needed the same column added to its
      explicit `SELECT` list) — renders as the real number when set, or
      an **empty string**, not the literal text `"null"`, when a school
      hasn't set one yet. This product's template syntax has no
      conditionals (a deliberate, already-documented Phase 7 scope cut),
      so a template author including this variable is trusting it to be
      set; the default template was deliberately left unchanged rather
      than unconditionally appending it, since most schools won't have
      filled this in immediately after it ships and "MoMo: " trailing
      into nothing reads worse than the variable simply not being there
      yet. A school adds it to their own template text once they've set
      a number.
    - The actual manual-payment recording this enables once a parent
      sends money directly — an admin marking it received against the
      right invoice — isn't new: it's the existing `POST /payments`
      (method `mobile_money`), now with a dedicated page (see the
      Payments entry above) rather than only reachable per-invoice.
    - 10 new tests: 5 for the profile endpoint itself (including that a
      PATCH with no `momoNumber` field is a true no-op, and that school
      B's own profile is unaffected by school A's change — this project's
      standard tenant-isolation discipline applied to a new endpoint, not
      skipped because it's "just a settings field"), plus a test
      confirming the rendered variable is the real number when set and
      genuinely empty (not `"null"`) when not. Full suite: 24/24 suites,
      223 passed + 1 skipped. Clean frontend build; the SMS Templates
      page confirmed to render (HTTP 200) against a real local dev
      server.
    - **Production migration applied proactively this time**, correcting
      the order that caused the lockout-column incident earlier this
      session: the `ALTER TABLE` was run directly against the live Aiven
      database (`smartpay_db`) right after pushing this commit and
      *before* the next Render deploy, confirmed via `SHOW COLUMNS`. Not
      left to be remembered or discovered via a production 500.
  - **Login/register hero image, 2026-10-07.** The left panel on Login
    and Register (`AuthSplitLayout`, shared by both) had no real image —
    just a plain gradient. User supplied a real photo
    (`smartpay redesigned/login image.jpg`, schoolchildren in uniform),
    copied into the frontend as `public/login-hero.jpg` and set as the
    panel's background via a dark navy gradient scrim
    (`linear-gradient(135deg, rgba(15,23,42,.82), rgba(15,23,42,.60))`)
    layered over the photo, with the heading/body/feature text switched
    to explicit white/white-with-opacity rather than the theme-driven
    navy/slate variables they used before.
    - The `Logo`/`LogoMark` components (shared elsewhere — `DashboardShell`
      sidebar, etc.) read their ink color from `--brand-navy` and
      `--slate-quiet` CSS variables, which flip between dark and light
      hex values depending on site theme — on a dark photo scrim, the
      *light-mode* value of `--brand-navy` (`#0F172A`, near-black) would
      have made the logo's graduation-cap icon nearly invisible. Fixed by
      scoping `--brand-navy: #FFFFFF` and `--slate-quiet:
      rgba(255,255,255,.75)` as inline-style overrides on just this one
      panel's wrapper `div` — CSS custom properties cascade, so
      `Logo`/`LogoMark` render correctly here without any change to the
      shared components themselves (which still need to work normally
      everywhere else, in both themes). This panel is now always a
      dark-photo panel regardless of the site's own light/dark toggle,
      which is the correct behavior for a background photo, not a bug.
    - **Actually verified visually**, not just via a clean build — this
      is a purely visual change, so a build passing proves nothing about
      whether it looks right. Installed Puppeteer + Chromium (not
      previously present in this exact `node_modules`, though earlier
      phases of this project clearly used it before, per the many
      existing QA screenshots in the scratchpad) and took real screenshots
      of both `/login` and `/register` at 1440×900: text is fully legible
      over the photo, the icon badges keep their own contrast, and the
      overall composition reads clean and professional. Also confirmed
      the panel is unaffected by the site's dark-mode toggle, as intended
      (the override is a fixed inline style, not theme-reactive).
    - The source image is 736×736 (66KB) — on a very large/wide desktop
      screen this could read slightly soft since it's being stretched
      wider than its native resolution via `background-size: cover`; not
      a problem at the 1440px width actually tested, worth knowing if a
      future higher-resolution version becomes available.
  - **Forgot-password flow, 2026-10-08.** Raised by the user from the
    login page itself: there was no recovery path at all if an admin
    forgot their password (not just a wrong guess — actually forgot it).
    The `change-password` work from the security audit only helps a user
    who's already logged in and remembers their *current* password; this
    closes the gap underneath it. Combined with exactly one admin account
    per school, this was a real "locked out of the whole school, no way
    back in except someone manually touching the database" risk, not a
    hypothetical one.
    - Reused Academia Hub's own already-proven Resend-based forgot/reset
      flow pattern wholesale rather than designing a new one — same
      hashed-token-in-DB approach (`password_reset_tokens`: `user_id`,
      `token_hash` — the raw token is never stored, only its SHA-256 —
      `expires_at`, `used_at`), same 30-minute TTL, same generic
      "if an account matches..." response regardless of whether the
      email is real (standard enumeration-prevention), same
      `emailDeliveryConfigured` flag so the frontend can honestly tell a
      user a reset link probably won't arrive when no real Resend sender
      is configured yet, rather than silently promising an email that
      never comes. SmartPay's version is simpler than Academia Hub's in
      one way: email *is* the login identifier here (no separate
      `login_id`/student-no-email case to special-case), so the form is
      just one field.
    - New `utils/emailSender.js`, adapted from Academia Hub's — same
      Resend wrapper, SmartPay-branded subject/copy.
    - **Caught, before it could ship broken, the exact mock-target-
      mismatch bug class this project already hit once with SMS provider
      testing**: `authController.js` initially destructured
      `{ sendPasswordResetEmail, isEmailDeliveryConfigured }` out of
      `emailSender` at require-time, which meant `jest.spyOn(emailSender,
      'sendPasswordResetEmail')` in the test silently failed to intercept
      the real call — same root cause as the Friday-job SMS incident
      (a local destructured reference doesn't see a later patch to the
      module object's property). Fixed by requiring `emailSender` as a
      module object and calling `emailSender.sendPasswordResetEmail(...)`
      directly, matching the exact convention `smsProvider` already uses
      everywhere else in this codebase for the identical reason.
    - New pages: `/forgot-password` (email → generic
      confirmation-or-not-configured message) and `/reset-password`
      (token from the URL query string → new password, with its own
      invalid-link and already-done states) — both on the same
      `AuthSplitLayout` shell as Login/Register, so they also pick up the
      new hero photo. A "Forgot password?" link added next to the
      Password label on the login form.
    - 6 new backend tests, including the full real path: a real token
      generated, captured via `jest.spyOn` on the email send (not read
      from an actual inbox), used to really change the password, confirm
      it kills existing sessions and rejects a replay of the same token,
      and that an expired token is rejected. Full suite: 25/25 suites,
      229 passed + 1 skipped.
    - **Verified visually, not just via a clean build**, same discipline
      as the hero-photo change: real Puppeteer screenshots of all three
      states on both pages against the real local backend (not just
      mocked) — the "Forgot password?" link on Login, the real
      `emailDeliveryConfigured: false` warning (correct, since no
      `RESEND_API_KEY` is set locally), and a real invalid-token
      rejection message on Reset Password.
    - **Production migration applied proactively**, same
      production-first discipline as the last two schema changes:
      `password_reset_tokens` was created directly on the live Aiven
      database (`smartpay_db`) right after pushing this commit, before
      the next Render deploy, confirmed via `SHOW TABLES`. Safe to
      deploy whenever.
    - **Real Resend sender added and confirmed working, 2026-10-08.** A
      dedicated "SmartPay" API key created in Resend (separate key from
      Academia Hub's, same reasoning as SMS's separate mNotify project
      key), added to local `.env` as `RESEND_API_KEY`.
      `RESEND_FROM_EMAIL` deliberately left unset for now, so sending
      goes through Resend's sandbox sender — which only delivers to the
      Resend account owner's own signup email. Tested live: a real
      `forgot-password` call against the real local backend, confirmed
      actually received in a real inbox (not just a clean API response).
      `emailDeliveryConfigured` correctly still reports `false` in this
      state — that flag means "a verified domain is configured," not
      "can this account receive anything at all," and those are
      genuinely different right now: this works for the account owner
      testing it, not yet for a real customer admin's own email.
    - **`RESEND_API_KEY` added to Render and confirmed working live,
      2026-10-08.** Same key added to production; verified by actually
      triggering `forgot-password` against the real deployed backend
      (`https://smartpay-tan.vercel.app`, proxied through to Render) —
      first confirmed the target email had a real matching account in
      the live Aiven database (the generic response is identical whether
      or not a send was attempted, so a 200 alone proves nothing), then
      confirmed the email was actually received, not just that the API
      call returned success. Test token rows cleaned up from production
      afterward.
    - **Still outstanding**: sandbox-only delivery means this isn't
      usable by an actual customer yet regardless of env vars — a
      verified SmartPay domain in Resend is still needed (not yet
      decided: a new SmartPay-branded domain, or reusing Academia Hub's
      existing verified one the way SMS reused mNotify's account under a
      separate project key) before `RESEND_FROM_EMAIL` can be set to
      anything real and `emailDeliveryConfigured` can honestly report
      `true`.
  - **Register page password fields fixed, 2026-10-08.** Real gap found
    by the user while actually registering a school: the password field
    had no show/hide toggle (Login's already had one) and no Confirm
    Password field at all — a typo in a brand-new school's only admin
    password, with no recovery path at the time this was found (the
    forgot-password flow above didn't exist yet either), would have been
    a real lockout. Added the same Eye/EyeOff toggle Login already uses,
    plus a Confirm Password field (its own independent toggle) with a
    client-side match check before submit. Verified visually: typed
    mismatched passwords, confirmed the toggle reveals/hides each field
    independently, confirmed submission is blocked with "Passwords don't
    match." and the form's other fields stay filled in, not cleared.
  - **Per-school SMS usage visibility, 2026-10-08.** Raised by the user
    thinking ahead to multiple schools sharing one SMS wallet (Arkesel):
    with no per-school visibility, "School A is sending more than School
    B" becomes an unresolvable argument — neither school has their own
    number to check, only the platform owner's word for it. Checked
    first rather than assumed: every `sms_reminders` row is already
    tagged with `school_id` (full per-school attribution already
    exists), and `reportsController.smsActivity` already accepts an
    optional `startDate` — so this needed no backend change at all, only
    surfacing what already existed in a way that actually answers the
    trust question.
    - Dashboard's existing "Reminder Activity" card was all-time, not
      scoped to a billing period — not actually useful for "have I used
      too much this month." Renamed to "SMS Usage This Month," scoped to
      the current calendar month via the existing `startDate` param, with
      a "This is your school's own SMS count..." note making explicit
      that this number is theirs alone, not a shared/platform-wide
      figure. A new "Other periods" link to Reports covers any custom
      date range, unchanged.
    - This is visibility only, not enforcement — nothing stops a school
      from using more than "their share" of a shared wallet, it just
      makes usage checkable rather than disputed. Real per-school prepaid
      credit with a hard cap (a `schools.sms_credits` balance, deducted
      per send, blocking at zero) is the next step up, only needed once
      this is multiple unrelated paying customers rather than a few
      schools the user knows directly — deliberately not built yet,
      flagged as the next step when that's true.
    - Verified visually: registered a fresh test school, confirmed the
      card renders correctly in its empty (0/0/0) state with the new
      heading, link, and note; cleaned up the test data afterward. Clean
      frontend build.
  - **Same usage panel added to SMS Templates, 2026-10-08.** User looked
    for it on the Dashboard first, then specifically on SMS Templates —
    the page where sending is actually configured — and it genuinely
    wasn't there. Added the identical "SMS Usage This Month" panel (same
    three-stat sent/delivered/failed breakdown, same `startDate`-scoped
    `reportsController.smsActivity` call, same "this is your own count"
    note) just above the existing MoMo Number and Friday Automation
    panels. Also made explicit in response to the user's question: this
    shows a *count of messages sent*, not a *credit balance remaining* —
    there is no "messages left" figure anywhere in the app yet, because
    no credit-balance concept exists at all (that's the Future Work item
    directly above this one).
    - **A real Tailwind pitfall caught before it shipped broken**: the
      first draft built each stat's background/icon color by
      interpolating a tone variable into the class string at runtime
      (`` `bg-[var(--${tone}-wash)]` ``). Tailwind's build-time class
      scanner can't see a dynamically-constructed class name — it has to
      find the complete literal string somewhere in the source — so this
      would have compiled clean, looked fine in dev (where some setups
      are more permissive), and silently rendered as unstyled boxes in
      the actual production build. Rewritten as three literal JSX blocks
      instead, matching the Dashboard card's own already-correct pattern
      exactly rather than introducing a second, divergent way of doing
      the same thing.
    - Also fixed a correctness bug in the same draft: it used the
      backend's `summary.sent` (which is deliberately "sent OR delivered
      combined," per `reportsController.smsActivity`'s own code comment)
      directly as the "Delivered" count. The Dashboard card already
      derives true delivered-only by filtering the raw reminder list for
      `status === 'delivered'` and subtracting that from `summary.sent`
      to get "sent but not yet delivered" — this panel now does the
      identical derivation, not an approximation of it.
    - Verified visually: registered a fresh test school, navigated
      straight to SMS Templates, confirmed the panel renders in its
      empty state with correct colors (confirming the Tailwind fix
      actually took effect, not just that it compiled), in the right
      position above the other two panels. Clean frontend build.
- **AI Financial Summary — SHIPPED 2026-10-08.** User's idea, modeled
  directly on Academia Hub's own already-proven Financial/School
  Intelligence pattern: a daily, once-cached AI-written paragraph
  summarizing the school's financial position, shown automatically when
  the admin opens the Dashboard — "once per day" correctly implemented as
  "cached per school per calendar day," not literally tied to the login
  event (every dashboard load re-fires the request, the daily cache is
  what keeps that cheap), per the explicit discussion before building
  this of why Academia Hub's own "auto-generate on every login" version
  of this exact feature doesn't scale against a shared Gemini quota.
  - Ported, not reinvented: `@google/genai` SDK, the `GEMINI_TIMEOUT_MS =
    30000` `withTimeout()` wrapper around every `generateContent()` call
    (a confirmed-live Academia Hub gotcha — a Gemini 503 hangs the SDK
    forever instead of rejecting), structured JSON output with a
    `responseSchema` rather than free-text parsing, and the
    `interpretFinancialInsight` function's exact system instruction and
    `{summary, highlights}` response shape — copied directly from
    Academia Hub's `utils/geminiService.js`, adapted only to say
    "administrator" instead of "accountant" (SmartPay has one role,
    `school_admin`, not a separate accountant role).
  - **New, genuinely new infrastructure for this project** — no
    Gemini/LLM wiring existed in SmartPay before this. Needs its own
    `GEMINI_API_KEY`, deliberately separate from Academia Hub's, same
    reasoning as every other third-party credential this session (SMS,
    email, Paystack): a shared key means SmartPay's calls count against
    Academia Hub's own already-tight quota. **Not yet obtained** — the
    feature is fully code-complete and tested, but has never made a real
    Gemini call; only the "not configured" (`GEMINI_API_KEY` unset) path
    has actually executed so far, confirmed correct both in the test
    suite and via a real screenshot.
  - Evidence layer (`utils/financialIntelligenceData.js`) adapted to
    SmartPay's actual schema rather than copied verbatim: no
    academic_year_id/term dimension (SmartPay's own collection-summary
    report is already whole-school, not term-scoped, so this follows
    that same convention), `school_id`-scoped directly. Same two fixed
    attention thresholds as Academia Hub (`LOW_COLLECTION_RATE_THRESHOLD
    = 70`, `OVERDUE_BACKLOG_THRESHOLD = 5`) — not school-configurable,
    the same deliberate choice Academia Hub made for its own version, not
    revisited without a reason to.
  - Cache table `financial_insight_cache`: one row per school
    (`UNIQUE KEY` on `school_id`, no term dimension needed), `generated_at
    >= CURDATE()` staleness check, `ON DUPLICATE KEY UPDATE` on
    regeneration — direct port of Academia Hub's own caching shape.
  - **Caught the exact mock-target-mismatch bug class this session has
    now hit three times** (SMS provider testing, forgot-password email
    testing, now this) before it could repeat a fourth time: wrote
    `geminiService` as a required module object from the start, not a
    destructured import, so `jest.spyOn(geminiService,
    'interpretFinancialInsight')` actually intercepts the real call.
  - 5 new tests: the real "not configured" path (no mock needed — it's
    genuinely the current state), a successful generation caching
    correctly (second same-day call doesn't re-call Gemini), backdating
    `generated_at` by a day forcing real regeneration (the exact test
    Academia Hub's own DESIGN.md flags as worth replicating), school A's
    cached summary never leaking to school B (this project's standard
    tenant-isolation discipline, applied here too, not skipped because
    it's "just an AI feature"), and a malformed/failed Gemini response
    being treated as a clean failure that caches nothing. Full suite:
    26/26 suites, 234 passed + 1 skipped.
  - Verified visually both real states: registered a fresh school and
    confirmed the "not configured" card renders correctly end-to-end
    against the real backend; separately seeded a real cache row directly
    in the database (exercising the actual cached-read code path, not a
    mock) and confirmed the "success" rendering — paragraph, highlights,
    "Updated {time}" — displays correctly too.
  - **Not yet applied to production**: same `CREATE TABLE`-first
    discipline as the last three schema changes this session — needs to
    run against the live Aiven database before the next deploy, and
    needs a real `GEMINI_API_KEY` in Render before the feature does
    anything beyond showing "not configured" there too.

## Future Work

1. **Per-school prepaid SMS credit, with a hard cap — not built yet,
   deliberately deferred.** Today every school shares one SMS
   wallet/account (Arkesel, with mNotify as a proven working fallback —
   see the Decisions Log and the Build Progress entries above). There is
   real per-school *visibility* into usage (the Dashboard's "SMS Usage
   This Month" card, `reportsController.smsActivity`, both scoped by
   `sms_reminders.school_id`, which every row already carries) — but
   nothing *enforces* a fair share. One school could still consume
   another school's paid-for credit, with nothing to stop it beyond
   someone noticing after the fact. Deferred because with a handful of
   schools the user knows personally, usage visibility is enough to
   settle any dispute; it stops being enough the moment SmartPay has
   real, unrelated paying schools who don't just trust each other.
   **Trigger to build this**: a second (or third) school actually joins
   and pays for the system — not a specific date, a specific event.
   **What it would take**:
   - A `sms_credits` balance on `schools` (decimal, like `schools.balance`
     already pattern-matches for fee amounts), funded by whoever pays
     SmartPay for that school's SMS use — doesn't have to be the same
     mechanism as the shared Arkesel top-up.
   - Deduct from it wherever a send actually succeeds — `smsProvider
     .sendSms()`'s two real call sites, `reminderController.js`'s
     `exports.send` and `fridayJob.js`'s per-recipient loop — probably a
     small shared helper so both stay in sync, matching how `buildVariables`
     is already shared between the two instead of duplicated.
   - Block sending (a clean, specific error, not a generic failure) once
     a school's balance can't cover the next message — needs a real
     per-message cost figure from whichever provider is active to check
     against, not just "balance > 0."
   - A low-balance warning before it hits zero — the existing
     `reminder_min_balance`/Friday-automation settings pattern on
     `schools` is the nearest existing precedent for a school-configurable
     threshold, though that field means something different (a student's
     fee balance, not SMS credit) and shouldn't be reused for this
     directly, just modeled similarly.
   - A top-up flow — out of scope to design here without knowing how
     SmartPay will actually bill a second school (manual invoice? a
     payment page? Paystack again, but for SmartPay's own revenue this
     time, not a school's fees?) — a real product/business decision, not
     a technical one, and shouldn't be guessed at in code before it's
     made.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-02 | `schoolId` is re-derived from the database on every authenticated request (`verifyToken` queries `school_id` fresh alongside the existing `status`/`token_version` check) rather than trusted from the decoded JWT payload. | A Plan-agent pressure-test of the first draft caught this: trusting a JWT's `schoolId` claim is the same "trust the client" mistake the whole app exists to avoid, just moved one layer up from a request body into an old signed token. Costs nothing to close now, before any tenant-owned data exists to leak. |
| 2026-10-02 | `register-school` relies on a DB `UNIQUE KEY` on `schools.code` + catching `ER_DUP_ENTRY` → 409, never a SELECT-then-INSERT pre-check. | Unlike Academia Hub's one-time-ever bootstrap gate, this is a permanently open public signup endpoint — two schools racing for the same code is a real scenario, not theoretical. Verified live with a real concurrent-request test (`Promise.all` of two simultaneous registrations for the same code): exactly one succeeds. |
| 2026-10-02 | `register-school` gets its own, materially stricter rate limit (5/hour) than `/login` (60/15min). | Login's generous budget exists specifically to protect a legitimate shared staffroom IP from false positives — that justification doesn't extend to a public new-school signup form, which should resist automated spam-school creation instead. |
| 2026-10-02 | `users.email` is globally unique across the whole platform, not scoped per-school. | Login takes just email+password, no separate school-code field — the school is derived from whichever single row the email matches. Documented explicitly so a future "fix" to school-scope it doesn't quietly break login by making it ambiguous which school an email resolves to. |
| 2026-10-02 | Phase 1 ships with exactly one role, `school_admin`. `finance_staff` deferred (cheap to add later *only if* every route uses `verifyRole(...roles)`, never an inline check — enforced as a hard rule from the start). `system_admin` (a cross-tenant platform-operator role) is explicitly **not** modeled as a nullable-`school_id` row on the shared `users` table — if ever built, it belongs in its own separate `platform_admins` table with its own auth guard, since nulling out `school_id` on `users` would weaken the exact invariant the tenant-isolation test proves. | Keeps the one actually-novel, security-critical piece of Phase 1 (multi-tenant auth) as small and provable as possible; both deferrals are flagged now so nobody reaches for the easy-but-wrong path later when the need arises. |
| 2026-10-02 | Frontend deliberately does **not** reuse Academia Hub's ink+gold visual identity — plain default Tailwind styling for now. | Different product, different brand, different customers (schools, not students/teachers/parents). A real design pass is a separate, later decision once core functionality is proven — not blocking Phase 1. |
| 2026-10-02 | Set up as its own GitHub repo (`salimsaad-dot/smartpay`) from the start, not a folder inside Academia Hub's repo. Academia Hub's own `.gitignore` excludes `/smartpay/` to prevent accidental cross-contamination via a broad `git add`. | User's explicit choice — SmartPay is a genuinely separate product/business line, not a feature of Academia Hub, and its git history shouldn't be entangled with Academia Hub's from day one. |
| 2026-10-03 | `classes` has no `academic_year_id` — it's a fixed, reusable curriculum structure per school (e.g. "Basic 1"..."JHS 3"), not re-created every year. A student's class-for-a-given-year is instead captured on the `students` row itself (`class_id` + `academic_year_id` together). | Matches the spec's own suggested schema exactly (section 6 lists `classes` as `id, school_id, name, level, status` — no year column). Keeps "which classes exist" and "which class a student is in this year" as two separate, independently-correct facts — a student moving class year-to-year doesn't require touching the `classes` table at all. |
| 2026-10-03 | `parent_student` carries no `school_id` column of its own. Tenant isolation on link/unlink is enforced by joining back to `students.school_id` (and separately verifying the parent row belongs to the same school before inserting). | A join table's isolation is only as strong as the queries that touch it — `unlinkParent` explicitly joins through `students` rather than trusting a bare `parent_student.id`, since that column alone carries no tenant information to check against. |
| 2026-10-03 | `academic_years`/`terms` both get `is_current`, set via a full-replace transaction (clear every row for this school, then set the one requested) rather than a single UPDATE. | Same "current term" pattern Academia Hub already validated — makes "exactly one current year/term per school" true by construction instead of relying on every caller to remember to unset the old one. Verified live: setting a second year current correctly un-currents the first, confirmed via both a test and the real UI. |
| 2026-10-03 | Every new Phase 2 table got its own tenant-isolation test, not just a shared assumption from Phase 1's proof — including a direct IDOR check (school B fetching school A's student/parent by a guessed small-integer ID) and a cross-tenant foreign-key check (school B creating a student against school A's class/year ID). | Each new tenant-owned table and each new foreign-key relationship is a fresh place a missing `WHERE school_id = ?` or a missing ownership re-check could slip in — Phase 1's isolation proof covered auth only, not these new resources, so it doesn't substitute for re-testing here. |
| 2026-10-03 | `invoice_items` is a real, separately-stored copy of `fee_structure_items` at generation time, never a live join/view onto the fee structure. | This is the spec's single most load-bearing business rule (section 7's "invoice snapshot" row, section 4.2's explicit implementation note): a fee structure edited after invoices exist must never retroactively change what a student already owes. Proven with a test, not just asserted — mutated a fee item's amount directly in the DB after generation and confirmed the existing invoice's total and item amount were both untouched. |
| 2026-10-03 | Fee structures have no uniqueness constraint across `(term_id, class_id)` — only `(term_id, class_id, name)`, so a school can legitimately have multiple differently-named fee structures for the same class/term (e.g. "Day Student Fees" vs "Boarding Fees"). | The spec doesn't call for one-structure-per-class/term, and a school genuinely billing different student categories differently within the same class needs this — a stricter constraint would have blocked a real, foreseeable use case for no stated benefit. |
| 2026-10-03 | Invoice generation processes eligible students **sequentially**, each as its own transaction (not `Promise.all` in parallel), and uses a temporary `'PENDING'` placeholder for `invoice_no` before updating it to the real `INV-{schoolId}-{paddedId}` value once the row's real ID is known. | `invoice_no` is `UNIQUE(school_id, invoice_no)`, and the real number can't be computed before the insert (it depends on the auto-increment ID the insert produces). Sequential processing — each transaction fully commits before the next student's begins — means the placeholder can never collide with another student's still-placeholder row in the same batch; parallelizing this would reintroduce exactly that race. |
| 2026-10-03 | Invoice due date defaults to the term's own `end_date` when the caller doesn't supply one, rather than a fixed offset like "30 days from issue." | A fee is conceptually due *within the term it covers*, not some arbitrary number of days after billing — reuses a fact the system already has (the term's real end date) instead of inventing a second, independent due-date policy that could silently disagree with the academic calendar. |
| 2026-10-03 | `school.currency` (needed to format real money amounts on the new Fee Structures/Invoices pages) was missing from both the login and `/auth/me` response shapes — only `id`/`name`/`code` were ever selected from `schools`. Fixed by adding `currency` to both `SELECT` queries and both response shapes, and hardcoding `currency: "GHS"` client-side for the `register-school` success path (matches the real DB default; no currency-selection UI exists at signup to justify the backend returning it there). | Found while building the Fee Structures page, which needed `user.school.currency` to call the new `formatMoney()` helper — a reminder that a session payload only carries what an earlier phase happened to need, not everything a later phase will. |
| 2026-10-03 | A payment is never deleted, only marked `status='void'` with a required `void_reason`/`voided_at`/`voided_by`. `invoices.paid_amount`/`balance`/`status` are written in exactly one place, `recalculateInvoiceBalance()`, which always re-sums `SUM(amount) WHERE status = 'success'` from the real `payments` table rather than incrementing/decrementing a running total — called identically after recording a manual payment, voiding one, or a webhook confirming an online payment. (Phase 5 tightened the WHERE clause from `!= 'void'` to `= 'success'` once online payments introduced real intermediate states — `initiated`/`pending`/`failed`/`cancelled` — that must not count toward the balance either.) | A running total that gets directly incremented/decremented on each payment/void is exactly the kind of state that silently drifts after one missed edge case; re-deriving it fresh from the source-of-truth table every time makes that class of bug structurally impossible, at the cost of one extra query per write — a trade worth making for money. |
| 2026-10-03 | Overpayment is rejected outright in v1 — a payment amount greater than the invoice's current `balance` (re-read inside the transaction) returns 400, no credit or unallocated-payment handling exists. | Matches the spec's own stated default ("reject by default in v1 unless the product explicitly implements credits/unallocated payments") — credits are a real feature with their own rules (which invoice absorbs a credit next, whether it's visible to a parent) that shouldn't be improvised as a side effect of payment recording. |
| 2026-10-03 | The payment UI lives inside the existing Invoices page (a "Pay" action + an inline expandable "History" panel per row) rather than a new `/dashboard/payments` route. | A payment only ever makes sense in the context of a specific invoice — the user's task is always "pay this invoice" or "see this invoice's payment history," never "browse all payments platform-wide" (that's what Phase 9's reports are for) — so keeping it attached to the invoice row avoids a page whose only job would be re-deriving context the Invoices page already has. |
| 2026-10-03 | SmartPay uses its own, separate Paystack business profile — never Academia Hub's existing one. | User's explicit choice: SmartPay is a different product moving a different school's real money. Sharing one merchant account would blend two schools' transactions under one dashboard, complicate reconciliation, and tie SmartPay's payment uptime/compliance to an unrelated product's account. |
| 2026-10-03 | The Paystack webhook trusts the signature-verified payload directly (HMAC-SHA512 over the raw body) rather than making a second server-to-server `verifyTransaction()` call before crediting an invoice. `verifyTransaction()` is still built and used elsewhere — by the public payment-status endpoint, as a live fallback when a payment is still `initiated`/`pending` and the parent is waiting on the success page. | Matches Academia Hub's own Paystack integration exactly (`controllers/financeController.js`), which has been live in production and already passed a dedicated penetration test without this being flagged — signature verification against a secret only Paystack and this server know IS itself a strong authenticity proof, not a weaker substitute for one. A redundant verify-call on every webhook would also make the webhook's own test suite depend on live Paystack credentials just to prove idempotency/signature-rejection, which are really independent concerns. |
| 2026-10-03 | A payment always maps to exactly one invoice, even though a secure payment link shows a parent ALL of their children's outstanding invoices at once (consolidated, per the spec's step 48). The parent picks one invoice to pay per checkout rather than the backend splitting a single payment across several invoices. | Building payment-allocation/splitting (one gateway transaction crediting N invoices) is a materially bigger feature with its own edge cases (partial allocation order, display, refund semantics) that the spec itself frames as conditional ("if... configured for consolidated payment"), not mandatory. Shipping the real core journey now — secure link → see every balance → pick one → pay → webhook confirms → balance updates — and deferring true multi-invoice bundling keeps this phase's scope honest rather than quietly expanding it. |
| 2026-10-03 | `payment_links` has no true "reuse" — generating a new link for a parent immediately revokes any existing active one, then creates a fresh token. | Only the token's hash is ever stored (never the raw token), so there is no way to show an admin the SAME raw link twice once the page generating it has been left. Revoke-then-regenerate keeps "at most one active link per parent" a clean invariant instead of accumulating silently-still-valid old links every time an admin re-clicks "Payment Link." |
| 2026-10-03 | The "Payment Link" action lives on the Parents page as a manual, admin-triggered button for this phase, not on a dedicated Arrears page. | Phase 6 (Arrears) is what actually builds the aggregation/filtering view this belongs on long-term, and Phase 7/8's Friday SMS job will generate these links automatically without any admin click at all. Building the full Arrears UX now would be scope creep ahead of its own phase; a manual admin action is enough to make Phase 5's payment machinery real and testable today. |
| 2026-10-03 | Payment finalization (marking a payment `success`/`failed` and recalculating its invoice) was refactored into one shared `finalizePaymentEvent()` function, called from both the webhook handler and the public payment-status endpoint's live-check fallback — the status endpoint doesn't just *report* what a live Paystack check found, it *applies* it the same way a webhook would. | Caught during this phase's own live testing, not a hypothetical: the original status endpoint only returned a live-checked status to the browser without ever writing it back, so a parent could be shown "Payment successful" while `invoices.balance` silently never updated if that specific webhook was ever permanently lost (not just delayed). Sharing one finalize path makes the two trigger routes (webhook delivery, parent polling their status page) provably agree, instead of two independent, divergeable implementations of "what does a successful payment do." |
| 2026-10-03 | The webhook only processes `charge.success` and `charge.failed` event types — any other Paystack event (disputes, transfers, refunds, subscriptions) is ignored even if it happens to carry a `data.reference` matching one of our payments. | Paystack sends many event types beyond charges, and several of them can carry a `reference` field for unrelated reasons. Without an explicit allowlist, an unrelated event could be misinterpreted as a charge status update for a payment that merely shares that reference string — a correctness gap that cost nothing to close given the fix was a one-line filter. |
| 2026-10-03 | SmartPay's separate Paystack business was created via Paystack's own "Add a business" feature under the same login/email as Academia Hub's existing business, not a second email address. | Discovered live when the user went to sign up — Paystack natively supports multiple businesses per account, each with its own dashboard, transactions, and API keys, which is all the separation this needed (two different products, two schools' money, never mixed in one dashboard). Simpler than the Gmail `+alias` workaround originally suggested, since Paystack already solves this directly. |
| 2026-10-03 | Arrears "parent aggregation" is a client-side grouped view over the same flat `GET /api/arrears` invoice list, not a separate backend endpoint. | The underlying facts are invoice-level (term/total vary per invoice, per the spec's own column list) — aggregation is just a different lens on the same rows, not a materially different query. Building a second endpoint would mean keeping two filter implementations in sync for no real benefit, since the dataset size (one school's active arrears) makes client-side grouping cheap. |
| 2026-10-03 | The Arrears page's summary totals (total outstanding, students in arrears, invoices in arrears) are computed in JS by reducing over the same rows the table renders, not a second SQL query with duplicated filter logic. | Two independent queries computing "the same" numbers from the same filters is exactly the kind of thing that silently drifts apart the moment one filter is added to one query and not the other. Deriving the summary from the already-fetched, already-filtered rowset makes that class of bug structurally impossible. |
| 2026-10-03 | Arrears reuses Phase 5's existing `POST /api/parents/:id/payment-link` endpoint for link generation rather than building a new one scoped to the Arrears page. | No new capability was actually needed — Phase 5 already built parent-scoped, consolidated-balance payment links exactly matching what Arrears needs to hand a parent. Reusing it here is direct evidence that phase's groundwork was sized correctly, not scope creep to avoid. |
| 2026-10-03 | "Reminder status" and "Send Reminder" (both listed in the spec's own Arrears page description) are entirely absent from this page's UI — not even a disabled button. | SMS doesn't exist until Phase 7; a visible-but-disabled control invites exactly the "stale disabled feature despite it actually shipping later" class of bug this project has hit and fixed multiple times before in Academia Hub. Nothing to disable is safer than something to forget to re-enable. |
| 2026-10-03 | SmartPay's SMS adapter returns a structured `{success, providerMessageId, error}` result instead of Academia Hub's fire-and-forget, never-throws, console-log-only pattern — even though both wrap the same mNotify API. | Academia Hub's version is a side-channel notification with nothing to persist; SmartPay's `sms_reminders` table needs a real outcome to record against every reminder attempt (per spec: "record the failure without deleting the reminder"). A silently-swallowed result would make that table meaningless. |
| 2026-10-03 | A multi-child (parent-level) reminder renders `{{student_name}}` as a comma-joined list ("Kofi Mensah, Yaw Mensah") and `{{total_balance}}` as the combined sum, rather than the spec's richer per-child breakdown format ("Kwame GH₵500; Ama GH₵300"). | The breakdown format effectively needs a second, conditional template variant chosen by child count — real complexity beyond simple `{{variable}}` substitution. Phase 7's stated scope is the SMS adapter, templates, reminder records, and manual sending — not a templating engine; the simpler rendering is correct, shippable, and can be revisited later without changing the underlying data model. |
| 2026-10-03 | Previewing a reminder never generates a real payment link — it renders the message with placeholder text ("a secure payment link will be included") instead. Only an actual Send generates one. | A payment link's raw token can only ever be shown once (only its hash is stored), and generating one revokes any existing active link for that parent. Doing that on every preview click — which may never lead to an actual send — would needlessly invalidate a link a parent might already be mid-use with, just because an admin looked at a draft message. |
| 2026-10-03 | `createPaymentLink()` was extracted from `parentController.generatePaymentLink` into a shared `utils/paymentLink.js` function during this phase, used by both the admin "Payment Link" button and the reminder-send flow. | Both call sites need a fresh raw token to embed/display, and since only the hash is ever persisted, there's no way to "look up" an existing link's raw value for reuse — every caller that needs a working link in hand must go through the identical revoke-then-generate logic. Keeping it in one place means the two call sites can't drift apart. |
| 2026-10-03 | In the send flow, a parent's phone number is validated before the SMS provider's own configuration is checked, and payment-link generation happens only after both checks pass. | Phone validity is the more specific, actionable problem for an admin to fix, and is true regardless of whether the platform's SMS provider happens to be configured — "provider not configured" is a platform-wide condition unrelated to this particular parent. Checking both before touching `payment_links` also means a send that was never going to succeed doesn't needlessly burn a parent's existing link. |
| 2026-10-03 | SmartPay's SMS integration uses its own project-scoped API key ("SmartPay") on the same BMS.africa/mNotify account as Academia Hub's ("AcademiaHub" project) — not a fully separate account/business, unlike Paystack. | BMS.africa has no "add a business" feature the way Paystack does; its only separation mechanism is a project-scoped API key, each with its own key and quota. That's the closest real equivalent available, confirmed by checking the actual dashboard rather than assuming parity with Paystack's model. |
| 2026-10-03 | `resolveReminderScope`, `buildVariables`, and `getTemplate` were extracted from `reminderController.js` into a shared `utils/reminderCore.js` during Phase 8, used by both the manual-send HTTP flow and the Friday automation job. `getTemplate` gained a `preferType` parameter so the Friday job can ask for a `'friday_reminder'`-type template first but still fall back to any active template for a school that never configured one specifically. | The two call sites (an HTTP request from an admin, a cron-triggered loop over every parent in a school) must resolve "who gets reminded about what" and "what does the message look like" identically — a manually-sent reminder and an automated one need to read the same way to a parent. Keeping this in one place means they provably can't drift apart. |
| 2026-10-03 | The Friday job's cycle lock uses the actual calendar date in the *school's own configured timezone* (`Intl.DateTimeFormat` with `timeZone: school.timezone`), not server time, to compute `cycle_key`. | A server hosted in UTC could be on the wrong side of midnight relative to a Ghana-based school — using server time for "what day is it" could process the wrong Friday, or let a UTC-midnight boundary quietly create two different cycle keys for what a Ghana-based admin considers the same Friday. |
| 2026-10-03 | A `scheduled_jobs` row stuck in `'running'` for more than 30 minutes is treated as abandoned (the server crashed mid-cycle) and its lock is reclaimed by a later run, rather than left to block that cycle forever. | The spec explicitly lists "Friday job starts but server crashes halfway through" as an edge case to handle. Without reclaiming, a single crash would permanently wedge that school's Friday reminders until someone manually fixed the database — a 30-minute margin is generous for a job that normally finishes in seconds to a few minutes, so it's not a tight race against a genuinely still-running job. |
| 2026-10-03 | Even across a crash-and-retry of the *same* cycle, a parent is never reminded twice: each parent is checked against `sms_reminders` for an existing `sent`/`delivered` row in that exact `cycle_key` before anything is sent, independent of the job-level lock. | The job-level lock alone only prevents two *processes* from running the same cycle concurrently — it doesn't protect against a resumed run re-processing parents a crashed earlier attempt had already successfully reminded. The spec's "never blindly resend successful messages" rule has to be enforced per-parent, not just per-job. |
| 2026-10-03 | Friday-automation settings (`friday_reminders_enabled`, `friday_send_time`, `friday_template_id`, `reminder_min_balance`, `reminder_cooldown_days`) are columns directly on `schools`, not a separate settings table. | They're genuinely school-profile data — the same category as the `currency`/`timezone` columns already living there — not a growing, open-ended set of preferences that would justify a dedicated table. |
| 2026-10-03 | `PATCH /api/settings/friday-reminders` was rewritten to merge only the fields present in the request body against the school's current row, instead of writing every column from the body regardless of what was sent. | Caught live during Phase 8 testing: the original version defaulted every omitted field to `false`/`null`, so a caller updating only `reminderCooldownDays` silently disabled Friday reminders entirely and wiped the template/min-balance as a side effect. A PATCH endpoint must only change what it's actually given — this is the kind of bug that's invisible in a happy-path manual test (which tends to supply every field) and only surfaces once something calls it with a genuinely partial body, exactly as an automated test did. |
| 2026-10-03 | Student and Parent Statements render on-screen with a browser "Print / Save as PDF" button rather than generating real PDFs server-side. | The spec explicitly frames PDF as optional ("can be added for statements/receipts where useful"), not required. A browser's native print-to-PDF dialog already produces something a parent can save or print, covering the real underlying need, without pulling in a PDF-generation library this phase doesn't otherwise need — a deliberate scope cut, not an oversight. |
| 2026-10-03 | Reports' CSV export links are plain `<a target="_blank">` tags pointing directly at the backend's CSV endpoints, not routed through the frontend's `apiRequest()` wrapper. | `apiRequest()` always calls `.json()` on the response, which would break on a `text/csv` body. A top-level browser navigation (clicking a link, including one opened in a new tab) still carries the `sameSite:'lax'` auth cookie automatically, so no separate download-authentication mechanism was needed — the existing cookie-based session already covers it. |
| 2026-10-03 | The Reports page is one screen with an internal tab switcher across all six report types (Collection Summary, Outstanding Fees, Payment History, Invoice Report, SMS Activity, Statements), not six separate sidebar entries. | Matches the spec's own framing of "Reports" as a single screen with multiple report types inside it (section 18's Detailed Screen Specifications), and avoids the sidebar nav growing by six items for what is conceptually one destination. |
| 2026-10-03 | The Payment History report filters by `parentId` via `EXISTS (... parent_student ...)` rather than a direct `payments.parent_id = ?` column. | `payments` has no `parent_id` column — ownership is only derivable through `student_id` → `parent_student`. Caught while writing the controller, before it ever reached a live request, by checking the actual `schema.sql` rather than assuming the column existed because the report conceptually needed it. |
| 2026-10-03 | Audit logging is scoped to financial and administrative actions only (payment create/void, invoice generation, Friday-settings changes, SMS template create/update) — not every mutation in the app. | Matches the spec's own exact phrase ("Audit logging for financial and administrative actions"), not a looser "log everything" interpretation. Read-only list/view endpoints, academic-setup CRUD (classes/terms/years), and student/parent record edits were deliberately left uninstrumented — they're not financial, and administratively low-stakes compared to anything touching money or outbound communication. Can be widened later if a real need shows up; starting narrow and named beats starting broad and unreviewable. |
| 2026-10-03 | `utils/auditLog.js`'s `logAction()` never throws into its caller — a failed audit-log write is caught and logged to the console, not propagated. | Same reasoning already applied to post-payment notifications earlier in this project: a side-effect record of an action must never be able to undo or block the real action it's recording. A payment that succeeded but failed to audit-log is a monitoring gap to notice and fix; a payment that got rolled back because its own audit trail failed to write would be strictly worse. |
| 2026-10-03 | CSRF protection relies entirely on `sameSite:'lax'` plus the frontend's same-origin rewrite proxy — no separate CSRF token system was added. | Re-verified by reading the actual `next.config.mjs` rewrite rather than assuming: in production the browser only ever talks to the frontend's own origin, with the proxy forwarding to the real backend server-side. Every request is therefore genuinely same-origin, not merely same-site, which structurally rules out third-party CSRF regardless of the cookie attribute underneath it — a token system would be defense for a threat that can't reach this app's actual deployed topology. |
| 2026-10-03 | mNotify's optional `getDeliveryStatus()` capability (confirming an SMS was actually delivered, not just accepted by the provider) was not implemented — reminders report `sent`/`failed` from the send attempt itself, and the schema's `delivered` status value is defined but currently unreachable. | The spec's own `SmsProvider` interface marks this capability explicitly optional. Implementing it would mean either polling mNotify per-message or handling a delivery-status webhook, both real integration work with no spec-mandated urgency — a documented, deliberate scope cut rather than a silent gap, picked up later only if real delivery visibility becomes a stated need. |
| 2026-10-03 | The "two admins edit the same invoice/payment record" edge case (spec section 17) has no optimistic-locking or conflict-detection mechanism. | Not reachable in the current build: Phase 1 deliberately ships exactly one `school_admin` user per school at registration, with no endpoint to invite or create additional admin users yet. A concurrency-conflict mechanism for a scenario the product can't currently produce would be unverifiable speculation; revisit if/when multi-admin-per-school ever ships. |
| 2026-10-03 | `friday_send_time` gating (`respectSendTime`) is applied only to `runFridayJobForAllSchools`, never to the admin-facing manual-run endpoint, and the real GitHub Actions trigger fires hourly on Fridays rather than once at a single time. | The spec's own manual-run endpoint exists specifically so an admin can test/troubleshoot immediately, not wait for a configured time — gating it would contradict its purpose. Firing the real scheduler hourly (rather than once) is what actually makes a *per-school* configurable send time meaningful at all; a single daily/weekly firing could only ever honor one global time for every school, which isn't what the settings UI promises. |
| 2026-10-03 | The mobile hamburger/drawer pattern was independently reimplemented against SmartPay's own plain-Tailwind color palette, not copied verbatim from Academia Hub's (which uses a dark navy `#0F172A` sidebar and its own `app-modal-backdrop` CSS keyframe animation). | Matches the standing decision that SmartPay deliberately doesn't reuse Academia Hub's ink+gold visual identity (different product, different customers) — only the *structural* interaction pattern (off-canvas drawer, hamburger trigger, overlay, `md` breakpoint) was worth replicating, since that's what was actually proven to work, not the specific color scheme underneath it. |
| 2026-10-03 | Every table wrapper across the app was changed from `overflow-hidden` to `overflow-x-auto`. | `overflow-hidden` on a container narrower than its table doesn't make the table responsive — it silently *clips* the rightmost columns with no way to ever see them, which is strictly worse than a plain unstyled table. `overflow-x-auto` lets a wide table scroll within its own card on a narrow screen, which is the actual, standard fix once the page itself (via the sidebar drawer fix) no longer forces full-page horizontal scroll. |
| 2026-10-04/06 | The UI/UX refinement's toast (`useToast()`/`<Toast/>`) is a page-local hook, not a global context/provider with a queue. | This app only ever has one toast visible at a time, triggered by one financial action a user just took — a global queue/provider (the "normal" toast-library pattern) would be real added machinery solving a problem that doesn't exist here. If a page ever needs to show two overlapping toasts, that's the signal to revisit this, not a reason to build it upfront. |
| 2026-10-06 | The Parents list page does not show a child-count badge on each collapsed row, even though the UI/UX spec asks for it "where available." | `GET /api/parents` doesn't return a child count — only the earlier-proposed, user-not-approved backend addition would add one — and fetching each parent's full detail just to get a count before the row is even expanded would be exactly the kind of unnecessary decorative API call the same spec explicitly warns against elsewhere. The count stays inside the existing expand-to-view-children action instead, which already has the real data. |
| 2026-10-06 | Reports' six report tables keep horizontal-scroll as their mobile strategy, not stacked cards (the pattern used everywhere else in this pass). | The spec itself lists horizontal scroll as one of three explicitly acceptable mobile strategies, alongside cards and stacked rows. Reports is read-only, data-dense, column-heavy, and column order/alignment is part of how a report is actually read — rebuilding six different tables as cards would be a large amount of work for a strictly worse reading experience on exactly the pages where comparing numbers across columns matters most. |
| 2026-10-06 | `GET /api/keepalive` is self-bootstrapping (creates its own table and seeds its row on first call if missing) rather than requiring a one-off migration step against production. | Production DB credentials live only in Render/Aiven, never in this codebase or any local `.env` — there was no safe way to run a one-off `CREATE TABLE` against prod from outside it without asking for those credentials, which is something this project's standing practice avoids. Self-bootstrapping means the feature just works the moment the code deploys, with no manual DB step for anyone to remember. |
| 2026-10-06 | Render's auto-deploy stayed on (it already defaults to "On Commit"), but deploys are done manually ("Deploy latest commit") rather than reconnecting through the GitHub App for instant webhook-triggered deploys. | A service connected via a public Git URL only polls for commits instead of getting an instant webhook, which let two real pushes sit live-stale for about two days before anyone noticed — a genuine incident, not theoretical. Given how infrequently this project pushes, the user chose predictability (always knowing exactly when prod changes) over automatic speed, rather than spending the effort to reconnect through GitHub's App integration. |
| 2026-10-06 | `linkParent` now auto-marks a student's *first* linked parent/guardian as primary (`is_primary = 1`) when the request doesn't explicitly say otherwise, rather than always defaulting to `false`. | Found via the UI/UX pass's own end-to-end regression test, not inspection: the only UI that links a parent (the Students page) never sends `isPrimary`, so every parent linked through it was silently non-primary — and Arrears' parent/payment-link column and the Outstanding Fees report both require `is_primary = 1` to show a parent at all. A school admin linking a parent the only way the UI lets them meant that parent could never appear in Arrears or receive a payment link, with no error anywhere. User explicitly chose this fix (over adding a "set primary" UI control, or dropping the `is_primary` requirement in Arrears/Reports) as the simplest option matching how the feature is actually used — one parent per student in practice. Locks the student's existing `parent_student` rows (`SELECT ... FOR UPDATE`) before deciding, so two concurrent first-links for the same student can't both claim to be first. A one-time backfill (`scripts/backfill-primary-parent.sql`) fixes existing data — not run automatically, since production DB credentials aren't available from the codebase; the user runs it once via Aiven. The Friday automation job and manual reminder-sending were separately confirmed **not** to depend on `is_primary`, so SMS reminders to arrears parents were never affected by this gap. |
| 2026-10-07 | Academic Setup's redesigned tabs drop the mockup's "Grading System" tab entirely and relabel "School Settings" to "Reminder Settings", scoped to only the Friday-SMS-automation fields that actually have a backend. | User's explicit choice between three options. SmartPay has no grading/results feature at all (it's a fees-only product, per the original spec) — a Grading System tab would have nothing real behind it. The Friday-reminder backend (`friday_reminders_enabled`/`friday_send_time`/`friday_template_id`/`reminder_min_balance`/`reminder_cooldown_days` on `schools`) has existed since Phase 8 with zero UI anywhere until this tab. |
| 2026-10-07 | The Classes mockup's "Capacity" column was dropped rather than added to the schema. | User's explicit choice. No `capacity` field exists on `classes`, and showing the column would mean fabricating data — consistent with this project's standing rule of never inventing content a live mockup implies but the real data model doesn't back. |
| 2026-10-07 | `GET /classes` takes an optional `?status=` filter (default: active-only, unchanged for every existing caller) instead of always returning active classes. | The redesigned Classes page needs to show archived classes too (via `?status=all`), but every other existing caller (Students' and Academic Setup's class dropdowns, invoice generation) has always assumed active-only — changing the default would have silently broken them. |
| 2026-10-07 | `MNOTIFY_SENDER_ID` is temporarily `"AcademiaHub"` (the already-approved sender ID on the shared mNotify account) instead of `"SmartPay"` (still pending mNotify's own approval), in both local `.env` and Render production. | User's explicit, informed choice after being told the tradeoff: messages read "From: AcademiaHub" in the meantime, a different registered business than the one actually sending — not ideal, but it unblocks real SMS delivery now rather than leaving it dark until approval clears. **Must be switched back to `"SmartPay"` once that approval comes through** — nothing in the code enforces or reminds about this; it's a manual env-var flip in both places. |
| 2026-10-07 | Parent/guardian collection on Add Student stays optional (can still be left blank and linked later), not required like Academia Hub's `enrollOneStudent`. | User's explicit choice between the two, having asked for the *convenience* of one-step collection, not a hard requirement — forcing it would regress the existing ability to add a student before a parent's phone number is known. |
| 2026-10-07 | The new inline parent-at-enrollment flow dedups by exact phone-string match within the same school, not a normalized/E.164 comparison. | Matches every other phone-handling path already in this codebase (`parentController.create` also just trims and stores as typed, no normalization). Two siblings' parent typed differently across two separate Add Student submissions could still produce a duplicate parent row — a pre-existing class of imperfection, not a new gap introduced by this feature. |
| 2026-10-07 | `xlsx` (for bulk-import's Excel support) is installed from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, not `npm install xlsx`. | The npm-registry version carries two unpatched high-severity advisories (prototype pollution, ReDoS) with "No fix available" per `npm audit` — SheetJS ships patched releases only from their own CDN for licensing reasons, a well-known situation in this ecosystem. Academia Hub's own `package.json` already makes this exact same call; confirmed by inspecting it before installing anything here, rather than accepting the vulnerable default. |
| 2026-10-07 | Bulk-import column headers must never contain a literal comma, even though the UI also accepts `.xlsx` (which has no such risk). | Found live: `"Academic Year (optional, defaults to current)"` as a header silently broke column alignment in an unquoted CSV, swapping Parent Name and Parent Phone. The auto-generated `.xlsx` template is immune, but a hand-typed or differently-exported CSV isn't — a comma-containing header is a latent landmine for a comma-*delimited* format no matter how well the parser handles quoting. |
| 2026-10-07 | Every SQL string literal in this codebase must use single quotes, never double quotes — now enforced by a static regression test, not just convention. | Production (Aiven) and local (XAMPP) MySQL evidently run different SQL modes: a double-quoted literal like `status = "active"` works locally but throws `ER_BAD_FIELD_ERROR` in production under `ANSI_QUOTES`, since double quotes there mean identifier-quoting, not a string. Found live via Render's logs after a plausible-but-wrong deadlock diagnosis didn't fix a real Send Reminder failure. No local test can exercise this directly (local SQL mode doesn't reproduce it), so the guard is a static source scan instead — deliberately verified to actually catch the bug (reintroduced it, confirmed the test failed, reverted) before trusting it. |
| 2026-10-07 | Arkesel chosen as the second SMS provider over Africa's Talking/Hubtel. | Ghana-specific direct carrier connections (MTN/Telecel/AirtelTigo, not routed through a third country), GHS billing with Mobile Money top-up (easiest to fund from Ghana), free signup with an API key in minutes, pricing in line with what mNotify charged. Africa's Talking is more established pan-African but less Ghana-optimized; noted as the fallback option if Arkesel doesn't work out either. |
| 2026-10-07 | `SMS_PROVIDER` defaults to `mnotify` when unset, rather than defaulting to whichever provider was added most recently. | Arkesel's failure-response shape started out unconfirmed (unlike mNotify's, already proven against multiple real sends) — an explicit opt-in (`SMS_PROVIDER=arkesel`) avoids silently switching every school's live sends onto the less-proven path the moment the env var exists, versus only switching where someone deliberately set it. |
| 2026-10-07 | Tests that mock an SMS provider must mock `utils/smsProvider` (the switch), never a specific adapter module directly. | Found live: `fridayJob.integration.test.js`'s existing mock (there specifically to prevent real, billable sends during tests) silently stopped intercepting the moment `fridayJob.js`'s own import changed to go through the switch — a real, unmocked call reached the real Arkesel API during a routine test run before this was caught. A second, related gap in `sms.integration.test.js` (gated on one adapter's env var by name, not on whichever provider is actually active) was tightened the same way even though it hadn't yet caused a real failure, since the next provider added would have hit the identical mismatch. |
| 2026-10-07 | Password complexity stays at "length ≥ 8 only" — deliberately, not revisited as part of the council security audit. | Flagged by the audit as a finding to weigh, not assumed either way. Decision: this matches the product's own stated premise (a simpler alternative to the complicated system it replaces), and there's no incident or specific threat motivating more friction at signup right now. Documented here so a future audit doesn't re-flag it as an open gap — if revisited, the trigger should be a real incident or a customer/compliance requirement, not audit tidiness. |
| 2026-10-07 | File-upload validation is explicitly out of scope — confirmed absent, not a gap. | The same council audit confirmed via grep that no file-upload feature exists anywhere in this codebase. There is nothing to validate. Documented so this doesn't get listed as a missing control in a future pass; revisit only if a file-upload feature is actually added. |
