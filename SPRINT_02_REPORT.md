# SPRINT 02 REPORT — Data Durability, Security Dependency & Sprint-01 Hardening

**Plan:** `SPRINT_02_PLAN.md` (approved; storage provider decision: **Cloudflare R2**)
**Status:** ✅ COMPLETE — implemented exactly to plan, tested, live-verified
**Date:** 2026-07-21
**Suite:** 12 backend suites, **140/140 passing** (was 106; +34) · frontend 12/12 · typechecks + production builds clean on both tiers · **zero Prisma migrations**

---

## 1. Summary

The two go-live data-safety blockers are closed: uploaded documents now live in
pluggable object storage (Cloudflare R2 in production) and survive every
redeploy, and the unpatchable `xlsx` dependency is completely removed —
spreadsheet parsing moved server-side onto `exceljs`, exports regenerated on
`exceljs`. The four approved review items (M2 concurrent-issue lock, M3
tax-point stamping, M4 DTO tightening, M6 confirm dialogs) are done. No new
business features, no schema changes, no breaking API changes.

## 2. P0-5 — Persistent object storage (Storage Driver abstraction)

- `FileStorageService` refactored into a facade over a **StorageDriver**
  interface with two implementations: `LocalStorageDriver` (default, zero-config
  dev, original behaviour) and `S3StorageDriver` (Cloudflare R2 / MinIO / AWS
  S3; private objects, path-style, streaming). Future providers plug in with
  one class — business logic is untouched by design.
- Env-driven selection with fail-safe fallback (misconfigured S3 → loud error
  log + local driver, app keeps booting). New optional env vars validated in
  `env.validation.ts`: `STORAGE_DRIVER`, `S3_ENDPOINT`, `S3_BUCKET`,
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`.
- OCR/BL extraction adapted via `materialize()` (temp-file download + disposal
  on remote drivers) — extraction works identically on both backends.
- One-off idempotent migration/verification script:
  `backend/scripts/migrate-uploads-to-s3.ts` (dry-run default, `--apply` to
  upload, hash-verified round-trip).
- Full design documented in **`STORAGE.md`** (11 sections incl. R2 setup,
  key strategy, flows, security, backup, CDN path).

## 3. P0-6 — `xlsx` fully replaced by `exceljs`

- **Import (security-critical path)** moved server-side: new endpoint
  `POST /api/imports/rates/parse` (multipart, `rates.write`, 5 MB multer cap,
  10k-row/50-col workbook limits, typed 400s for missing/oversize/corrupt/.xls
  files, audit-logged). The POL/POD grid-extraction logic moved verbatim to
  `imports/rate-sheet.parser.ts` and its golden tests moved with it — plus a
  new golden **round-trip** test that builds a real workbook with exceljs and
  asserts identical rows.
- **Frontend rate-import dialog** now uploads the file and renders the server's
  preview — no spreadsheet parser ships in the client. Loading state
  ("Parsing…" + spinner), error state (`ErrorText` + server warnings), and a
  responsive grid (2-col mobile / 4-col desktop) included.
- **Exports** (`lib/xlsx-export.ts`) regenerated on `exceljs` via dynamic
  import (loads only when exporting); same function signature — the four
  calling pages are unchanged.
- `xlsx` removed from **both** `package.json`s and lockfiles; CI-equivalent
  checks (typecheck + build + tests, both tiers) green without it.
- Behaviour note: legacy binary `.xls` files are no longer parseable (exceljs
  reads OOXML only) — the API and dialog say explicitly to re-save as `.xlsx`.

## 4. Architecture-review items (approved scope only)

- **M2** — `issue()` now runs in one transaction with a `SELECT … FOR UPDATE`
  row lock on the invoice (same pattern as `sequence.service.ts`): guard-check
  and status-write are atomic, so concurrent issues serialize.
- **M3** — on DRAFT→ISSUED, an auto-dated draft (issueDate ≈ createdAt) is
  restamped to the posting time — the SST tax point is now the issue date; an
  explicitly chosen document date is preserved.
- **M4** — `UpdateNoteDto.items` requires ≥1 line; `reason` rejects blank
  strings on create and update.
- **M6** — confirmation dialogs (the app's standard `confirm()` pattern) on
  note **Issue** and on **Cancel of an ISSUED** note, with amount and
  consequence spelled out.

## 5. Files Modified

**Backend new:** `common/storage/storage-driver.ts` · `local-storage.driver.ts`
· `s3-storage.driver.ts` · `storage.spec.ts` · `modules/imports/rate-sheet.parser.ts`
· `rate-sheet.parser.spec.ts` · `scripts/migrate-uploads-to-s3.ts`
**Backend modified:** `common/file-storage.service.ts` (facade) ·
`modules/documents/documents.service.ts` (async stream + materialize) ·
`modules/imports/imports.service.ts` + `imports.module.ts` (parse endpoint) ·
`modules/credit-debit-notes/credit-debit-notes.service.ts` (M2, M3) ·
`credit-debit-notes.dto.ts` (M4) · `credit-debit-notes.service.spec.ts` (+M2/M3/M4 tests)
· `config/env.validation.ts` · `package.json` (+`@aws-sdk/client-s3`, +`exceljs`)
**Frontend modified:** `components/rate-import-dialog.tsx` (upload flow) ·
`lib/xlsx-export.ts` (exceljs) · `app/adjustments/note-list.tsx` (M6) ·
`package.json` (+`exceljs`, **−`xlsx`**)
**Removed:** `frontend/src/components/rate-import-dialog.test.ts` (golden tests
moved to the backend parser spec)
**Docs:** `STORAGE.md` (new) · this report · `CHANGELOG.md` · `TODO.md` ·
`PRODUCT_BACKLOG.md`

**Zero Prisma migrations. No endpoint removed or reshaped** — one endpoint
added; `issue`/`PATCH` reject only payloads that were never legitimate.

## 6. Tests (34 new; suite 140/140)

| Area | Coverage |
|---|---|
| Storage keys | uuid.ext generation, sanitization, traversal rejection |
| Local driver | put/stream round-trip byte-identical, materialize no-op dispose, missing/malicious keys → null, tolerant double-remove, invalid-key put rejected |
| S3 driver (mocked client) | NoSuchKey → null, non-404 rethrown, malformed keys never reach the bucket, tolerant remove |
| Facade | local default, s3 when configured, fail-safe fallback when incomplete |
| Rate-sheet parser | 6 golden tests (ported) + exceljs round-trip identity, currency detect, warning path, missing/wrong-type/corrupt uploads rejected |
| M2 | two concurrent issues over the balance → exactly one succeeds (mutex-serialized fake mirroring the row lock, FOR UPDATE asserted); two that fit → both succeed |
| M3 | auto-dated draft restamped; explicit date preserved |
| M4 | `items: []` rejected, blank reason rejected (create + update), valid payload accepted |

## 7. Live verification (all 8 required checks ✓)

| Check | Result |
|---|---|
| ✓ Upload document | uploaded to a job with the **s3 driver against MinIO**; object confirmed in bucket, **not** on local disk |
| ✓ Download document | byte-identical (`cmp`) |
| ✓ Restart backend | full stop/start |
| ✓ File still exists | re-download after restart byte-identical |
| ✓ Import Excel | real .xlsx (built with exceljs) → `/imports/rates/parse` returned the exact expected 4 rows + `currency: USD`; fake `.xls` rejected with the guidance message |
| ✓ Export Excel | clicked Export Excel on /invoices; captured blob: correct MIME type, 6,975 bytes, valid `PK` zip signature |
| ✓ Confirmation dialogs | Issue and Cancel-of-ISSUED both prompted with the exact messages; declining left statuses unchanged (DRAFT/ISSUED untouched) |
| ✓ Concurrent issue protection | live race: two parallel `issue` calls for 600+600 against a 1,000 invoice → **201 + 400** ("exceeds the invoice's creditable balance of 400") |

Delete flow additionally verified: API delete removed the object from the
bucket (HeadObject → 404).

**Test-data cleanup:** test document deleted via API, M2 invoice + notes
deleted, CN/invoice sequences reset (0 notes remain; invoice numbering
continues at 0008), `.env` restored to the local driver (boot log confirms
`File storage driver: local`), MinIO test container removed.

## 8. Risks / notes for the Product Owner

1. **R2 credentials are the one outstanding user action** — production still
   runs the local driver until you create the bucket + token and enter the five
   env vars in Render (exact steps: `STORAGE.md` §3). Everything is verified
   against a real S3 API (MinIO); flipping the env vars is the only remaining step.
2. **Files uploaded to Render before this sprint** were on the ephemeral disk
   and are unrecoverable (known and accepted in the plan).
3. **`.xls` no longer parses** — users must re-save as `.xlsx` (clear message
   in UI and API).
4. **M3 behaviour change:** notes drafted earlier and issued later now carry
   the posting date as the SST tax point unless a date was explicitly chosen.
5. `exceljs` loads in the browser only on demand (dynamic import), keeping page
   bundles unchanged.
