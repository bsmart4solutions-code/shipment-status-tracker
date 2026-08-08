# TODO

Working list maintained at the end of each sprint. Backlog priorities live in
`PRODUCT_BACKLOG.md`; this file tracks discovered bugs and near-term follow-ups.

## Bugs discovered (pre-existing, not yet fixed)

_(none open — both items below were fixed 2026-08-02)_

## Bugs fixed

- [x] **List-filter query params returned 400 on quotations / invoices / jobs
  / customers / vendors / rates.** Fixed 2026-08-02. The global ValidationPipe
  runs with `forbidNonWhitelisted: true`, but these controllers declared filters
  (`status`, `customerId`, `salesPersonId`, `from`, `to`, `vendorId`,
  `serviceId`, etc.) as extra `@Query('...')` params next to `@Query() dto:
  PaginationDto` — the pipe validated the whole query object against
  `PaginationDto` and rejected the extra keys. Fixed by declaring a per-module
  `ListXDto extends PaginationDto` with the filter fields (the pattern already
  used by `credit-debit-notes` and `payables`) in all six affected controllers:
  `quotations`, `invoices`, `jobs`, `customers`, `vendors`, `rates`.

- [x] **Winston console formatter printed `logger.error('message')` as a blank
  line.** Fixed 2026-08-02. In `common/logger/winston.logger.ts` the console
  format returned `` `${timestamp} ${level}${ctx} ${stack || message}` ``; for a
  plain string error nest-winston supplies `stack = [null]`, which is truthy and
  stringifies to `""`, so the message was swallowed. File logs were never
  affected — only the console stream (Render's log stream included). Fixed by
  preferring `message` and appending `stack` only when it is a non-empty string.

- [x] **`docker compose up -d --build` could not start the API container —
  `prisma db seed` crashed at every startup.** Fixed 2026-08-02, found while
  rebuilding the stack to verify Sprint 05. `Dockerfile`'s runtime stage never
  copied `src/` or `tsconfig.json` into the image, but `prisma/seed.ts` runs
  via `ts-node` **at container startup** (`CMD`, not just at build time) and
  imports `../src/modules/settings/company.default` — added 2026-07-19
  (`ce805ea`) without anyone rebuilding the Docker image since, so it went
  unnoticed until this rebuild. Without `src/` present ts-node failed to
  resolve the module at all; adding only `src/` (without `tsconfig.json`)
  produced a *different* failure — ts-node fell back to its own default
  compiler options instead of the project's (`module: commonjs`), and Node's
  native ESM resolver rejected the extensionless import. Fixed by copying both
  `src/` and `tsconfig.json` into the runtime stage. **Does not affect the
  Render deploy** — `render.yaml` bypasses the Dockerfile entirely (native
  `runtime: node`, single-stage `npm install`), so `src/` was always present
  there. Confirmed fixed: `docker compose up -d --build` now reaches a healthy
  API container and the full Playwright suite passes against it.

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

- [x] **P&L is now historically stable.** Fixed 2026-08-08. `PnlService` converts
  through `FxService.historicalConverter()`, valuing every row at **the same
  date that decides which bucket it lands in** — quotations at `quoteDate`, jobs
  at `shipmentDate ?? createdAt`. That answered the open "which date?" question
  without needing a policy decision: any other choice lets period membership and
  valuation disagree, so a document counted in March could be priced at August's
  rate. Also adds `fxIncomplete` alongside the existing `fxWarning`, matching the
  AP variance response.

  Verified live by reproducing the original incident: with a USD quotation dated
  2026-07-18, inserting a `USD→MYR 9.99` rate effective 2026-08-01 left the P&L
  **numerically identical** (3157.20 / 2521.00 / 636.20), while the dashboard —
  which still uses the latest rate — moved to 4353.84. Same rate, same moment:
  proof the rate really took effect and that only the P&L is now immune.
  7 unit tests, mutation-checked (reverting to `converter()` fails 4 of them).

- [ ] **Same defect still present in every other latest-rate consumer.** Surfaced
  by the verification above — the dashboard revenue moved by 1196.64 on a single
  back-filled rate. `FxService.converter()` is still used by `dashboard`,
  `customers` (×3, incl. credit exposure), `invoices` (×2, incl. AR aging),
  `quotations`, `reports` (×2) and `vendors`. **Not all of these are wrong**:
  credit exposure *should* use today's rate, because it answers "what is this
  customer worth to us right now". The ones that need the historical basis are
  the ones making statements about a **past period** — `reports` most of all,
  since exported figures get filed. Needs a per-caller decision, not a blanket
  swap.
- [ ] **Intermittent test flake diagnosed, not fixed.** One run in five failed on `rate-sheet.parser.spec.ts` (1 of 242) and never reproduced in isolation or across four further full runs. Most likely the exceljs round-trip test (~1.5 s alone) exceeding Jest's 5 s default under parallel load. Fix is a per-test timeout; out of Sprint 03A's approved scope.

## Sprint 04 follow-ups

- [ ] **Confirm C-1: should `Customer.blacklist` block invoice issue like `creditHold`?** No approved decision covers it, so Sprint 04 enforces `creditHold` only and leaves `blacklist` untouched.
- [ ] **Confirm C-2: fail-closed on unresolvable FX.** Implemented as planned — a customer holding an invoice in an unrated currency cannot be evaluated and is refused with a distinct message rather than silently allowed.
- [x] **CUST-0003's `creditLimit = 0` — decided 2026-08-08.** The customer
  (FORWARD LOGISTICS SDN BHD) had additionally been soft-deleted on 2026-07-31,
  which hid the problem rather than solving it: a zero limit refuses every
  invoice, and `0` is not the same as `NULL`. Restored through the recycle-bin
  API (audit-logged `RESTORE`) and the limit set to **MYR 50,000** — deliberately
  below the existing customers (Sunrise 250,000 / Golden Harvest 150,000) because
  this account has no settled invoice or payment history yet. Credit evaluation
  now returns `ALLOW` with 50,000 headroom; `outstandingLimit` stays NULL so the
  single limit governs. Its DRAFT quotation QT-2026-0015 came back intact.
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

## 🎯 MVP GA reached — 2026-08-02

All 8 P0 items are complete (`PRODUCT_BACKLOG.md`), and every `MVP_SCOPE.md` §4
exit criterion passes on code — see `SPRINT_06_REPORT.md` §9 for the
item-by-item checklist.

**The one action left before a real go-live is yours, not development's:**
the **Cloudflare R2 storage cutover** (`STORAGE.md` §3). Until it is done,
production documents do not survive a redeploy, so real customer documents
should not go into production first.

## Newly logged during Sprint 06

- [ ] **Split `bookings.write` if segregation is wanted.** One code covers
  raise / confirm / cancel. Confirming is the meaningful commitment (it opens
  the shipment file), so the natural split is `bookings.write` vs a new
  `bookings.confirm`. Not built: no approved decision covers it, and Sales
  already had this exact capability before Sprint 06 via the old
  `quotations.write`-gated convert endpoint — this is that exposure renamed,
  not widened.
- [ ] **Decide whether a COMPLETED job may still advance milestones.** Today
  only CANCELLED is blocked. Permissive on purpose (lets an operator backfill a
  legacy job's journey; touches only the timeline and the milestone field,
  never money or status), but it is a Product Owner call — see
  `SPRINT_06_REPORT.md` §10.6.
- [ ] **Cut-off alerting.** The bookings screen colours a passed SI/VGM cut-off
  red, but nothing pushes a notification. Wiring it into the existing
  `NotificationsService.scan()` is small and follows the pattern Sprint 05 used
  for overdue invoices.

## Next sprint candidate (needs Product Owner approval first)

- **Sprint 04 (credit-limit enforcement + integration-test layer + R2 cutover)
  is complete** — see `SPRINT_04_REPORT.md` (2026-07-29). This file's own
  status table above was stale for a few days after that landed; corrected here.
- **Sprint 05 (AR overdue automation + Statement of Account, P0-8) is
  complete** — see `SPRINT_05_REPORT.md` (2026-08-02).
- **Sprint 06 (Booking object + shipment operational milestones, P0-4) is
  complete** — see `SPRINT_06_REPORT.md` (2026-08-02). **This was the last P0;
  MVP GA is reached.**
- **Next is Phase 3 (fast-follow to R1)** per `IMPLEMENTATION_ROADMAP.md`, in
  dependency order: **P1-1** accounting integration (Xero/QuickBooks — closes
  the "no book of accounts" gap without building a GL), **P1-3 + P1-4**
  shipping-document generation + task engine, **P1-5/6/7** structured parties,
  containers and rate depth, then **P1-2** the Customer Portal (XL, the
  competitive-parity item). Per process each needs its own plan approved before
  implementation.
