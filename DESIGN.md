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
- **Phase 2 onward — not started.** Academic years, terms, classes,
  students, parents (sibling linking), fee structures, invoices, manual +
  online payments, Paystack webhook, arrears, SMS reminders, the Friday
  automation job, reports, audit logs — all per the spec's own Phases
  2–11, picked up in future sessions.

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
