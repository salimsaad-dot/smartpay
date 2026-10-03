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
Router + Tailwind v4, port 3100). No visual design system yet — deliberate,
see Decisions Log.

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
- **Phase 5 onward — not started.** Online payments (Paystack webhook),
  arrears, SMS reminders, the Friday automation job, reports, audit logs
  — all per the spec's own Phases 5–11, picked up in future sessions.

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
| 2026-10-03 | A payment is never deleted, only marked `status='void'` with a required `void_reason`/`voided_at`/`voided_by`. `invoices.paid_amount`/`balance`/`status` are written in exactly one place, `recalculateInvoiceBalance()`, which always re-sums `SUM(amount) WHERE status != 'void'` from the real `payments` table rather than incrementing/decrementing a running total — called identically after both recording and voiding a payment. | A running total that gets directly incremented/decremented on each payment/void is exactly the kind of state that silently drifts after one missed edge case; re-deriving it fresh from the source-of-truth table every time makes that class of bug structurally impossible, at the cost of one extra query per write — a trade worth making for money. |
| 2026-10-03 | Overpayment is rejected outright in v1 — a payment amount greater than the invoice's current `balance` (re-read inside the transaction) returns 400, no credit or unallocated-payment handling exists. | Matches the spec's own stated default ("reject by default in v1 unless the product explicitly implements credits/unallocated payments") — credits are a real feature with their own rules (which invoice absorbs a credit next, whether it's visible to a parent) that shouldn't be improvised as a side effect of payment recording. |
| 2026-10-03 | The payment UI lives inside the existing Invoices page (a "Pay" action + an inline expandable "History" panel per row) rather than a new `/dashboard/payments` route. | A payment only ever makes sense in the context of a specific invoice — the user's task is always "pay this invoice" or "see this invoice's payment history," never "browse all payments platform-wide" (that's what Phase 9's reports are for) — so keeping it attached to the invoice row avoids a page whose only job would be re-deriving context the Invoices page already has. |
