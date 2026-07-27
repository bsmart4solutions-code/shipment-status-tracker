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
- [ ] Remaining open: M1 (notes against DRAFT invoices), M5 (`notes.issue` permission before non-admin billing users), M7 (AP model decision — belongs in the Sprint 03 AP plan), M8 (notes in job P&L), M9 (broader service-test coverage), M10 (single outstanding-balance owner — partially addressed by `issuedNoteNet`), L1–L6.

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
  M-7 (generalized attachment model — belongs in the Sprint 03 AP plan),
  L-1 … L-8.

## Next sprint candidate (needs Product Owner approval first)

- **Sprint 03 is not started.** Per process, a `SPRINT_03_PLAN.md` must be
  produced and explicitly approved before any implementation. The expected
  subject is **P0-3 Accounts Payable**, and its plan must open with two model
  decisions it already owes: the vendor credit/debit-note model
  (`ARCHITECTURE_REVIEW.md` M7) and the generalized document-attachment model
  (`ARCHITECTURE_REVIEW_SPRINT02.md` M-7). Other P0 candidates: P0-7
  (credit-limit enforcement — S), P0-4 (booking + milestones — L),
  P0-8 (AR automation + SOA — M).
