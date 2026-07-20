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

## Sprint 01 follow-ups (deferred by design)

- [ ] PDF generation + email sending for credit/debit notes (invoice email exists; reuse it).
- [ ] Customer credit-balance ledger (belongs with P0-8 Statement of Account work). Since Sprint 01A this also gates two flows: crediting a PAID invoice (refund-on-account), and surfacing a debit-note remainder on a PAID invoice in aging.
- [ ] Optional approval workflow for notes above a threshold (deferred per approved Sprint 01 defaults).

## ARCHITECTURE_REVIEW remediation status

- [x] **H1–H4 fixed in Sprint 01A** (2026-07-20) — see `SPRINT_01A_REPORT.md`.
- [x] **M2, M3, M4, M6 fixed in Sprint 02** (2026-07-21) — see `SPRINT_02_REPORT.md`.
- [ ] Remaining open: M1 (notes against DRAFT invoices), M5 (`notes.issue` permission before non-admin billing users), M7 (AP model decision — belongs in the Sprint 03 AP plan), M8 (notes in job P&L), M9 (broader service-test coverage), M10 (single outstanding-balance owner — partially addressed by `issuedNoteNet`), L1–L6.

## Sprint 02 follow-ups

- [ ] **Production R2 cutover (user action):** create the R2 bucket + scoped API token, set the five `S3_*`/`STORAGE_DRIVER` env vars in Render (`STORAGE.md` §3). Until then production stays on the ephemeral local driver.
- [ ] Consider `rclone` bucket backup sync + restore drill (`STORAGE.md` §10).
- [ ] Presigned-URL download path when the Customer Portal lands (`STORAGE.md` §11).

## Next sprint candidate (needs Product Owner approval first)

- Sprint 02 is **not started** — per process, a `SPRINT_02_PLAN.md` must be
  produced and explicitly approved before any implementation. Leading P0
  candidates by value/dependency order: P0-7 (credit-limit enforcement — S),
  P0-5 (persistent document storage — M), P0-6 (replace `xlsx` — M),
  P0-3 (AP — L), P0-4 (booking + milestones — L), P0-8 (AR automation + SOA — M).
