# SPRINT 05 REPORT — AR Overdue Automation · Statement of Account

**Plan:** commercial-launch plan agreed 2026-08-02 (see conversation; formal `SPRINT_05_PLAN.md` was not produced separately — plan and delivery landed in one session at the Product Owner's request).
**Status:** ✅ **COMPLETE** — implemented, tested, live-verified in the browser.
**Date:** 2026-08-02
**Suite:** 20 backend unit suites **283/283** (+7 new) · **3/3 backend integration suites, 27/27 tests** (+1 new) · frontend unit **12/12** · Playwright golden-path **6/6** (+1 new, 1 skip unrelated to this sprint) · both typechecks and production builds clean · **one database migration**

---

## 1. Summary

Two P0-8 gaps are closed: invoices now surface as **overdue** (computed, not a
new state-machine status) with an automated daily alert and a rate-limited
reminder email, and customers get a **Statement of Account** — a chronological
ledger of invoices, issued credit/debit notes and payments with a running
balance, viewable and emailable from the customer list. This was the smaller of
the two remaining sprints on the path to **MVP GA** (see `TODO.md`'s Sprint 04
follow-up and `PRODUCT_BACKLOG.md` P0-8); Sprint 06 (Booking + shipment
milestones, P0-4) is the last remaining item.

## 2. Design decisions

- **Overdue is derived, not a state.** `PAID` is a terminal edge in
  `INVOICE_EDGES` (`common/state-machine.ts`), and `status` already drives
  payment/aging/credit-control guards throughout `InvoicesService`. Threading a
  new `OVERDUE` state through all of them risked breaking Sprint 04's credit
  work for no benefit. `isOverdue`/`daysOverdue` are computed at read time
  (`dueDate < now && status in (ISSUED, PARTIALLY_PAID)`) — the same rule
  `agingReport()` already used for its buckets — and returned on `list()`/`get()`.
- **One new column, not a new ledger.** `Invoice.lastReminderAt` gates the
  reminder email to at most once every 7 days; the in-app alert is deduped
  per ISO week via the existing `dedupeKey` idiom in
  `NotificationsService.push()`.
- **The obsolete "payment-due proxy" is gone.** It inferred payment due dates
  from `Job.updatedAt` + payment term because no real invoice due date existed
  when it was written (explicitly commented `// proxy until invoicing module
  lands`). Real due dates have existed since the AR work landed; the block is
  replaced outright, not layered alongside.
- **The Statement of Account reuses `issuedNoteNetMap()`/`customerExposure()`**
  — the single owner of note-netting and AR exposure since Sprint 04 — so the
  statement's authoritative closing balance can never disagree with what AR
  aging and credit control report. The per-row running balance is a
  native-currency convenience figure; a `mixedCurrency` flag warns when a
  customer's invoices span more than one currency, since summing raw amounts
  across currencies isn't meaningful.

## 3. Database Changes

**One migration** (`20260801170731_sprint05_overdue_reminder`):
`Invoice.lastReminderAt DateTime?` and `NotificationType.INVOICE_OVERDUE`.

## 4. Backend Changes

- **`InvoicesService`** — `overdueInfo()` computed on `list()`/`get()`;
  `customerStatement(customerId, asOfDate?)` builds the ledger; `emailStatement()`
  sends it, following the exact fetch → build-HTML → `mail.send()` → audit-log
  shape already used by `email()`.
- **`NotificationsService.scan()`** — new block: overdue `ISSUED`/`PARTIALLY_PAID`
  invoices get a deduped `INVOICE_OVERDUE` notification and, when the customer
  has an email and `lastReminderAt` is stale, a reminder email. The job-completion
  payment-due proxy block is removed.
- **`CustomersController`** — `GET /customers/:id/statement` (`customers.read`),
  `POST /customers/:id/statement/email` (`invoices.write`, matching how the
  existing invoice/quotation email endpoints are gated).
- No new permission codes.

## 5. Frontend Changes

- **Invoice list**: an "Overdue" badge next to the status badge when
  `isOverdue` is true.
- **Customer list**: a "Statement" action opening `StatementPanel` — ledger
  table, closing balance in base currency, FX-warning and mixed-currency
  banners (mirrors `CreditPanel`'s banner convention), and an "Email Statement"
  button reusing the existing generic `EmailDialog` component unmodified.

## 6. Tests

| Milestone | Backend unit | Integration |
|---|---|---|
| Sprint 04 close | 276 | 26 |
| **Sprint 05** | **283** (+7) | **27** (+1) |

New unit coverage (`invoices.statement.spec.ts`): overdue flagging across
ISSUED/PAID/DRAFT and past/future due dates; statement ledger ordering and
running-balance math; statement/credit-control agreement; mixed-currency
flagging. New integration coverage (`overdue-scan.e2e-spec.ts`): running the
scan twice against a real Postgres does not double-alert (dedupeKey) or
re-send the reminder (`lastReminderAt` staleness) — the same class of proof
Sprint 04 used for the AP concurrency fix, over real HTTP rather than a mocked
Prisma client. New Playwright coverage: the Statement panel opens and shows a
closing balance (`golden-path.spec.ts`).

## 7. Live Verification

Verified in the browser against the real dev stack (Postgres + rebuilt
NestJS/Next.js):

| Check | Result |
|---|---|
| Customer list → Statement | Opens; ledger shows CUST-0001's issued invoice; closing balance **MYR 2,138.40** matches the credit column's exposure figure exactly |
| Email Statement | Simulated-mode message shown correctly (no `SMTP_HOST` set locally) |
| Invoice list, non-overdue invoice | No "Overdue" badge shown (due 2026-08-18, today 2026-08-02) — negative case confirmed |
| Overdue positive case | Proven by `overdue-scan.e2e-spec.ts` over real HTTP: past-due invoice gets `lastReminderAt` set, one `INVOICE_OVERDUE` notification, both stable across a repeated scan |
| Playwright golden path (rebuilt Docker stack) | 6/6 pass, including the new Statement panel test |

## 8. A bug found and fixed while verifying (unrelated to this sprint's scope)

Rebuilding the Docker stack (`docker compose up -d --build`) to verify against
real containers surfaced a pre-existing defect: the API container could not
start at all. `Dockerfile`'s runtime stage never copied `src/` or
`tsconfig.json`, but `prisma/seed.ts` runs via `ts-node` **at every container
startup** (not just build time) and imports
`../src/modules/settings/company.default` — added 2026-07-19 without the
Docker image being rebuilt since, so nothing caught it until now. Fixed by
copying both `src/` and `tsconfig.json` into the runtime stage. **Render is
unaffected** — `render.yaml` deploys natively (`runtime: node`, single-stage
`npm install`), not through this Dockerfile, so `src/` was always present
there. See `TODO.md` "Bugs fixed" for the full diagnostic detail.

## 9. Known Limitations

1. Statement rows outside a single currency show a native running balance that
   is informational only — the `baseCurrencyExposure` figure is authoritative
   and flagged as such.
2. The reminder cadence (7 days) and dedupe window (ISO week) are fixed in
   code, not a `Settings` key — matches the existing thresholds pattern
   (`alerts.quotationExpiryDays` etc. are configurable; this one isn't) and can
   be moved to `SettingsService` if a real customer asks for a different
   cadence.
3. No SOA PDF export — the panel is view/email only, consistent with how the
   AR aging report itself has no PDF export today.

## 10. Deployment Notes

- **One migration** — run `prisma migrate deploy` before deploy.
- No seed changes, no new permissions.
- **Rollback:** revert the commit; the migration only adds a nullable column
  and an enum value, both safe to leave in place even if the code is rolled
  back. The Dockerfile fix (§8) is independent and safe to keep regardless.

## 11. Next

**Sprint 06 — Booking object + shipment operational milestones (P0-4)** is the
last item before MVP GA, per the agreed plan. Design already researched
(Booking as a new top-level entity between Quotation and Job; milestones on
the existing `JobTrackingEvent` timeline gated by a new
`assertMilestoneTransition()`) — see the session's approved plan for the full
design.
