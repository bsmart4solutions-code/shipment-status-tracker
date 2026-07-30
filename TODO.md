# TODO

Working list maintained at the end of each sprint. Backlog priorities live in
`PRODUCT_BACKLOG.md`; this file tracks discovered bugs and near-term follow-ups.

## Bugs discovered (pre-existing, not yet fixed)

- [ ] **List-filter query params return 400 on quotations / invoices / jobs.**
  The global ValidationPipe runs with `forbidNonWhitelisted: true`, but these
  controllers declare filters (`status`, `customerId`, `salesPersonId`, `from`,
  `to`) as extra `@Query('...')` params next to `@Query() dto: PaginationDto` —
  the pipe validates the whole query object against `PaginationDto` and rejects
  the extra keys (`property status should not exist`). The UI status filters on
  those pages therefore fail silently.
  **Fix pattern (already applied to credit-debit-notes in Sprint 01):** declare a
  per-module `ListXDto extends PaginationDto` with the filter fields and validate
  against that. Files: `quotations.controller.ts`, `invoices.controller.ts`,
  `jobs.controller.ts` (audit the rest of the controllers for the same pattern).

- [ ] **Winston console formatter prints `logger.error('message')` as a blank line.**
  Found during Sprint 02A live verification. In `common/logger/winston.logger.ts`
  the console format returns `` `${timestamp} ${level}${ctx} ${stack || message}` ``;
  for a plain string error nest-winston supplies `stack = [null]`, which is
  truthy and stringifies to `""`, so the message is swallowed. Affects **every**
  `.error(string)` call app-wide, not just storage. The message is still written
  correctly to `logs/error.log` and `logs/combined.log`, so nothing is lost —
  but anyone watching the console (Render's log stream included) sees an empty
  error line. **Fix:** prefer `message` and append `stack` only when it is a
  non-empty string. Out of Sprint 02A's approved scope.

## Sprint 01 follow-ups (deferred by design)

- [ ] PDF generation + email sending for credit/debit notes (invoice email exists; reuse it).
- [ ] Customer credit-balance ledger (belongs with P0-8 Statement of Account work). Since Sprint 01A this also gates two flows: crediting a PAID invoice (refund-on-account), and surfacing a debit-note remainder on a PAID invoice in aging.
- [ ] Optional approval workflow for notes above a threshold (deferred per approved Sprint 01 defaults).

## ARCHITECTURE_REVIEW remediation status

- [x] **H1–H4 fixed in Sprint 01A** (2026-07-20) — see `SPRINT_01A_REPORT.md`.
- [x] **M2, M3, M4, M6 fixed in Sprint 02** (2026-07-21) — see `SPRINT_02_REPORT.md`.
- [ ] Remaining open: M1 (notes against DRAFT invoices), M5 (`notes.issue` permission before non-admin billing users), M7 (vendor-note model — **decided** in `AP_ARCHITECTURE_DECISION.md` §6: separate model; build deferred), M8 (notes in job P&L), M9 (broader service-test coverage), L1–L6.
- [x] **M10 closed in Sprint 04** — the AR balance formula now has one owner (`issuedNoteNetMap`) shared by aging, payment recording and credit exposure.

## Sprint 02 follow-ups

- [ ] ⚠️ **Production R2 cutover (user action — now blocking deploys):** create the
  R2 bucket + scoped API token and set `S3_ENDPOINT`, `S3_BUCKET`,
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` in Render (`STORAGE.md` §3).
  Since Sprint 02A a production deploy with `STORAGE_DRIVER=s3` and missing
  credentials **fails at startup by design** (the previous release keeps
  serving). To deploy before the cutover, set `STORAGE_DRIVER=local`
  explicitly — an auditable choice, and documents remain ephemeral until R2 is live.
- [ ] Consider `rclone` bucket backup sync + restore drill (`STORAGE.md` §10).
- [ ] Presigned-URL download path when the Customer Portal lands (`STORAGE.md` §11).

## ARCHITECTURE_REVIEW_SPRINT02 remediation status

- [x] **H-1 fixed in Sprint 02A** (2026-07-27) — see `SPRINT_02A_REPORT.md`.
- [ ] Open, in the review's recommended order: M-4 (enable R2 object versioning —
  bucket config, zero code), M-3 (delete ordering + orphan sweep), M-5
  (`ContentType` on put, before presigned URLs), M-2 (workbook decompression
  guard), M-1 (boot-time bucket probe), M-6 (MinIO CI integration spec),
  M-7 (generalized attachment model — **decided** in ADR §7: polymorphic `attachments`; build deferred by PO Decision 5),
  L-1 … L-8.

## ARCHITECTURE_REVIEW_SPRINT03 remediation status

- [x] **H-1 and H-2 fixed in Sprint 03A** (2026-07-28), plus the approved P2002 → 409 mapping — see `SPRINT_03A_REPORT.md`.
- [x] **M-3 and M-7 closed in Sprint 04** — concurrency is asserted under genuinely concurrent requests, and the AP ownership-boundary regression is automated in CI. M-3's proof immediately found a real payment-reversal race, now fixed.
- [ ] Open, in the review's recommended order: M-9 (clearable header job), M-2 (one allocation predicate shared by the list filter and the variance), M-1 (unallocated spend visibility), M-8 (proportional tax allocation + AP/job reconciliation), M-5 (down migration or amend the plan), M-6 (state the `jobs.read` exposure decision), L-1 … L-9.

## Newly logged during Sprint 03A

- [ ] **P&L is not historically stable.** `PnlService` converts job revenue/cost with `FxService.converter()` (latest rate), so past periods re-value whenever a rate is added — the same class of problem H-2 fixed for AP. Demonstrated accidentally during Sprint 03A verification: inserting one test rate moved the P&L by exactly `180 × (9.99 − 4.45)` on cost. `FxService.historicalConverter()` now exists and is the ready-made fix; the question is which date each figure should use (job date? invoice date?) — a Product Owner decision, not a code change.
- [ ] **Intermittent test flake diagnosed, not fixed.** One run in five failed on `rate-sheet.parser.spec.ts` (1 of 242) and never reproduced in isolation or across four further full runs. Most likely the exceljs round-trip test (~1.5 s alone) exceeding Jest's 5 s default under parallel load. Fix is a per-test timeout; out of Sprint 03A's approved scope.

## Sprint 04 follow-ups

- [ ] **Confirm C-1: should `Customer.blacklist` block invoice issue like `creditHold`?** No approved decision covers it, so Sprint 04 enforces `creditHold` only and leaves `blacklist` untouched.
- [ ] **Confirm C-2: fail-closed on unresolvable FX.** Implemented as planned — a customer holding an invoice in an unrated currency cannot be evaluated and is refused with a distinct message rather than silently allowed.
- [ ] **Decide what to do about CUST-0003's `creditLimit = 0`.** Found in live data during verification. Under hard-block a zero limit refuses every invoice; the value was left exactly as found. Either clear it to NULL ("no limit") or confirm zero is intended.
- [x] **Phase B delivered** — customer-list credit column + blocked filter, AR aging credit cross-link, Playwright golden-path smoke test with its own CI job.
- [ ] Extend browser coverage beyond the golden path only if a real regression justifies it — the backend integration suite is the cheaper place for business rules.
- [ ] Add a **coverage gate** (the remaining part of T-6).
- [ ] Split `credit.override` further (per-transaction vs standing) only if overrides become routine — audit log will show it.

## Sprint 03 follow-ups (deferred by design)

- [ ] **Vendor bill attachments** — deferred by PO Decision 5, so an approved payable has no scanned vendor invoice in the system. Interim: job-linked bills can use the existing Job Documents feature; standalone bills have no home. Design settled in `AP_ARCHITECTURE_DECISION.md` §7 (polymorphic `attachments`). **Depends on the R2 cutover above.**
- [ ] **Vendor credit/debit notes** — design settled (ADR §6, separate `vendor_credit_debit_notes` model reusing the calc engine + state machine). The `noteNet` parameter is already wired through `applyVendorPayment`, so netting arrives without a signature change.
- [ ] **Job cost detail lines** (ADR §5.6) — the structural fix for `Job.actualCost` being seeded with the quotation estimate. Until then the cost panel labels the recorded cost as unconfirmed.
- [ ] **AR payment reversal** — AP now has it; AR still tells users to "reverse the payments first" with no endpoint to do so (`invoices.service.cancel`). Port the AP pattern.
- [ ] Segregation of duties: split `payables.approve` / `payables.pay` before non-owner finance staff are onboarded.

## Next sprint candidate (needs Product Owner approval first)

- **Sprint 03 (Accounts Payable) is complete** — see `SPRINT_03_REPORT.md`.
  **Sprint 04 is not started.** Per process, a `SPRINT_04_PLAN.md` must be
  produced and explicitly approved before any implementation. Remaining P0
  candidates by value/dependency order: **P0-7** credit-limit enforcement (S —
  data already captured, smallest remaining P0), **P0-8** AR overdue automation
  + Statement of Account (M — pairs naturally with the new AP side),
  **P0-4** booking + shipment milestones (L — the last MVP-scope blocker).
