# ARCHITECTURE REVIEW — SPRINT 02 (Storage, xlsx Removal, Hardening)

**Reviewer roles:** Enterprise ERP Solution Architect · Principal Software Engineer · Security Reviewer · Infrastructure Architect
**Scope:** Sprint 02 deliverable (commit `f40b0a7`) — storage driver layer, R2 integration, exceljs migration, M2/M3/M4/M6 — plus its seams with pre-existing code
**Inputs:** `SPRINT_02_PLAN.md` · `SPRINT_02_REPORT.md` · `STORAGE.md` · `ARCHITECTURE_REVIEW.md` · `TODO.md` · `CHANGELOG.md` · full source of `common/storage/*`, `file-storage.service.ts`, `documents.*`, `imports.*`, `credit-debit-notes.*`, `scripts/migrate-uploads-to-s3.ts`, `render.yaml`, frontend dialog/export/note-list
**Date:** 2026-07-21
**Code changes made during this review:** NONE

---

## Verdict

**Sprint 02 delivered what it promised, the way it promised.** The driver
abstraction is genuinely pluggable, zero schema migrations was honoured, the
`xlsx` removal is total, and the live verification (including a real S3 API and
a real concurrency race) is the strongest evidence discipline shown so far.

**No Critical findings. One High** — and it is a *policy* defect, not a coding
defect: the storage facade's fail-safe fallback is the right behaviour in
development and exactly the wrong behaviour in production, where "keep booting
on local disk" silently re-creates the data-loss condition P0-5 exists to kill.

**Finding count: 0 Critical · 1 High · 7 Medium · 8 Low.**

---

## Part A — Area-by-area assessment

### 1. Storage Driver Architecture — ✅ Strong
The contract (`put / getStream / materialize / remove` + generated-key
discipline) is minimal, complete for today's flows, and honestly documented.
`materialize()` with mandatory `dispose()` is the correct answer to the
pdf-parse/OCR filesystem dependency — a lesser design would have leaked S3
buffers through the whole extraction path. Future-provider pluggability is
real: one class + one factory branch. **Weakness:** the contract has no
liveness primitive (no `healthCheck()`/`exists()`), so a dead bucket or bad
credentials is discovered by the first failing upload, not at boot or in
`/health` (M-1).

### 2. Cloudflare R2 Integration — ✅ Correct
`region: auto`, `forcePathStyle`, private-bucket-only access, bucket-scoped
token guidance, and free-tier arithmetic are all right; verifying against MinIO
exercises the identical code path. **Weaknesses:** objects are stored without
`ContentType` metadata (harmless while every download proxies through the API,
but the documented presigned-URL future would serve `octet-stream`) (M-5);
nothing prevents an `http://` endpoint in production (L-6).

### 3. Dependency Injection Design — ⚠️ Pragmatic, not idiomatic
`FileStorageService` constructs its own driver from `process.env` in the
constructor rather than receiving it via a Nest provider/factory token. It
stays a singleton (provided by the shared module), consumers are cleanly
decoupled, and tests proved swappability — but the driver itself is not
injectable, so a test that wants a mock *driver* (not a mock facade) has to
reach around DI, and ConfigService validation is bypassed in favour of raw env
reads (L-1). Acceptable at this scale; convert to a factory provider when the
third driver appears.

### 4. Security — ✅ Good, two real observations
Strong: keys are generated UUIDs re-validated at every driver boundary
(defence-in-depth is actually implemented, not just claimed); private bucket
with all bytes flowing through JWT + RBAC + audit; multer memoryStorage with a
5 MB cap; filename never used as a path; credentials only in env; the R2 token
scoping guidance is least-privilege. **Observations:** (a) the parse endpoint
checks the *extension*, then hands the buffer to exceljs — a crafted 5 MB
workbook can decompress to far more in memory before the row-count check runs
(zip-bomb shaped memory DoS; requires an authenticated `rates.write` user, so
exposure is internal) (M-2); (b) document upload still accepts any file type
and re-serves it with the user-declared MIME — `Content-Disposition:
attachment` mitigates rendering, and this is pre-existing, not Sprint 02 code
(L-5).

### 5. Object Storage Design — ✅ Sound, one inconsistency worth naming
Flat UUID namespace with immutable objects is the right call and honestly
argued in `STORAGE.md`. The inconsistency: the app has a recycle-bin concept
for entities, but `DELETE /documents/:id` **hard-deletes the binary
immediately** — a mis-click on a Bill of Lading is unrecoverable (pre-existing
behaviour, but the stakes rose now that storage is the system of record for
documents). R2 object versioning or delete-on-purge-only would close it (M-4).

### 6. Upload / Download Flow — ✅ Correct, two seams
Order of operations on upload is right (storage first, then DB row — a failure
leaves an orphaned object, never a dangling row). Streaming downloads on both
drivers, encoded `Content-Disposition`, 404s for missing record *or* missing
object. **Seams:** (a) a partial failure leaves orphaned objects with no sweep
tool, and *delete* runs in the reverse order (object first, then row) so a row
can survive pointing at nothing (M-3); (b) the download pipe has no
`stream.on('error')` — a mid-transfer S3/network failure aborts the socket
without a clean error, and `Content-Length` is never forwarded so browsers
can't show progress (L-2).

### 7. Backup Strategy — ⚠️ Documented, not implemented
`STORAGE.md` §10 is honest: R2 redundancy + DB backups today, `rclone` sync and
restore drills recommended, and the migration script doubles as a
hash-verifying consistency checker (genuinely useful). But recommendation ≠
protection: there is no second copy of the bucket and no object versioning, so
"deleted or overwritten by mistake" currently equals "gone" (M-4 covers the
sharpest edge; the rest is accepted risk, tracked in `TODO.md`).

### 8. Performance — ✅ Fine at target scale
Buffer-based puts are bounded by the 5 MB cap; exceljs loads lazily on both
tiers (bundle unaffected — verified); temp-file materialization only on the
rare extraction path. **Note:** workbook parsing is CPU-bound on the event
loop — a 10k-row sheet will stall other requests for the parse duration.
Acceptable for an internal SME tool; worker-thread it if parse traffic grows
(L-3).

### 9. Error Handling — ✅ Deliberate, one policy error
The error-handling *choices* are visibly deliberate: NoSuchKey → `null` →
clean 404; non-404 S3 errors rethrown to the global filter; `remove()`
tolerant by design with a warning log; the migration script verifies by
re-fetch + hash and exits non-zero on failure. The one wrong choice is the
production fallback (H-1, below). Minor: swallowed `remove()` failures are
observable only as log lines — fine until nobody reads logs (L-4).

### 10. Transaction Safety — ✅ M2 done properly
The issue() row-lock is the same proven pattern as the sequence service, the
unit test simulates the serialization honestly (and asserts `FOR UPDATE` is
actually in the SQL), and the **live race** (201 + 400) is the kind of
verification most teams skip. Remaining transactional gaps are the storage/DB
seams already covered in M-3 — object stores can't join Postgres transactions,
so the answer is ordering + sweeps, not distributed transactions.

### 11. API Compatibility — ✅ Preserved
One endpoint added; zero removed or reshaped. The `.xls` regression is real but
explicit, user-facing, and correctly messaged at both API and UI. M4's stricter
validation rejects only payloads the UI never sent. The export helper became
async with the same signature — all four callers unchanged. Verdict: the
"preserve compatibility" requirement was met in substance, not just letter.

### 12. Testing Coverage — ⚠️ Strong units, missing integration rung
34 new tests hit the right layers: driver contracts (including malicious-key
and tolerant-remove edges), facade selection incl. fallback, parser goldens
*plus* the exceljs round-trip identity test (the single best test in the
sprint — it pins parser fidelity forever). Gaps: nothing runs against a real
S3 API in CI (the MinIO proof was manual); `documents.service` upload/extract
paths and the migration script have no automated tests; controller/E2E rung
still absent (M9 from the Sprint-01 review remains open) (M-6).

### 13. Maintainability — ✅ Good
The driver folder is self-explanatory; `STORAGE.md` is the best doc in the
repo — a new developer could operate, extend, or debug storage from it alone.
Parser is pure and separately tested. Naming is consistent
(`storage-driver` / `*.driver.ts`). Nit: the facade lives at `common/` root
while its drivers live in `common/storage/` (L-7).

### 14. Scalability — ✅ With one honest caveat
With the s3 driver, the API is now genuinely stateless and horizontally
scalable. The caveat belongs in writing: **with the local driver, multiple
replicas are broken** (each instance has its own disk), and `docs/DEPLOYMENT.md`
§5 still says "the API is stateless — run multiple replicas" without that
qualifier (L-8).

### 15. Future Compatibility — see Part C.

---

## Part B — Findings register

### CRITICAL — none.

### HIGH

**H-1 — Production falls back to ephemeral local storage on S3 misconfiguration**
- **Description:** `FileStorageService.buildDriver()` treats incomplete
  `STORAGE_DRIVER=s3` config as "log an error, boot on local". `render.yaml`
  now ships `STORAGE_DRIVER=s3` with the four credentials unset until manually
  entered — so production today, and production after any future typo or
  accidentally-cleared env var, boots *successfully* while writing documents to
  a disk that is erased on the next deploy.
- **Risk:** Silent re-introduction of the exact data-loss failure P0-5 was
  built to eliminate, at the worst possible moment — after the team believes
  durability is solved. A single log line is the only signal.
- **Recommendation:** Fail fast where it matters: in `env.validation.ts`,
  when `NODE_ENV=production` **and** `STORAGE_DRIVER=s3`, make the four `S3_*`
  variables required (boot refuses, Render marks the deploy failed — impossible
  to miss). Keep the current graceful fallback for development only.
  Secondary: expose `driverName` in the `/health` payload so the active driver
  is monitorable, not just logged once at boot.

### MEDIUM

**M-1 — No storage connectivity probe at boot or in health checks**
- **Description:** The S3 driver never validates endpoint/credentials/bucket
  until the first real operation; `/health` reports the app healthy with a
  dead bucket.
- **Risk:** Bad credentials or a deleted bucket surface as a user's failed
  upload (or worse, a failed BL download during operations) instead of a
  deploy-time or monitoring signal.
- **Recommendation:** Add a cheap probe (`HeadBucket` or a `HeadObject` on a
  sentinel key) — run it at boot when driver=s3 (log loudly on failure) and
  surface driver + probe status in `/health`. One method on the driver
  contract, no business-logic change.

**M-2 — Workbook parsing is exposed to decompression-bomb memory pressure**
- **Description:** `parseRateSheet` checks the filename, then `wb.xlsx.load`s
  the entire buffer; the 10k-row/50-col limits run only *after* exceljs has
  fully inflated the workbook in memory. A crafted ≤5 MB `.xlsx` can inflate to
  hundreds of MB.
- **Risk:** Memory-pressure DoS of the single-process API. Mitigated by
  authentication (`rates.write`), the global 5 MB cap, and rate limiting — but
  a hostile or compromised internal account can stall the service.
- **Recommendation:** Cheap hardening in order of value: check the ZIP central
  directory's declared uncompressed size before loading (reject > ~50 MB);
  and/or parse in a worker thread with a memory/time budget (also fixes L-3).
  Document the residual risk either way.

**M-3 — Storage/DB seams can strand data (orphaned objects; delete ordering)**
- **Description:** Upload: object `put` succeeds → DB `create` fails ⇒ orphaned
  object, invisible forever (no sweep). Delete: object removed *before* the DB
  row ⇒ a row-delete failure leaves a record whose download 404s. The
  recycle-bin purge shares the pattern.
- **Risk:** Slow bucket bloat (cost, audit confusion) and occasional
  ghost-document rows after partial failures. No data *loss* — the orderings
  never lose a referenced object silently, which is why this is Medium.
- **Recommendation:** Invert delete order (row first, object second — a leaked
  object is strictly better than a dead row); wrap upload in
  `try { create } catch { remove(key); throw }`; add a small
  `sweep-orphans` script (list bucket keys − DB storedPaths) beside the
  migration script.

**M-4 — Hard delete of binaries; no object versioning; recycle-bin bypass**
- **Description:** `DELETE /documents/:id` permanently destroys the object at
  once (pre-existing behaviour); the recycle-bin safety net that protects every
  other entity does not protect document binaries, and R2 versioning is off.
- **Risk:** One mis-click (or one over-permissioned user) irreversibly destroys
  a statutory shipping document. The stakes rose in Sprint 02: the bucket is
  now the system of record.
- **Recommendation:** Either enable R2 object versioning on the bucket (config
  only, zero code) or move document deletes into the recycle-bin flow (row
  soft-deleted, object removed only at purge). Prefer versioning now, flow
  change later.

**M-5 — Objects stored without ContentType (presigned-URL future debt)**
- **Description:** `S3StorageDriver.put` never sets `ContentType` (the
  migration script does — the driver forgot the lesson its own script knew).
  Correct today because downloads proxy through the API, which sets headers
  from the DB.
- **Risk:** The moment presigned URLs ship (Portal, `STORAGE.md` §11), every
  object serves as `application/octet-stream`; fixing then means rewriting
  metadata on every existing object.
- **Recommendation:** Pass the known MIME through `save()` → `put()` now (tiny,
  compatible change when next touching the module); backfill via a variant of
  the migration script before presigned URLs launch.

**M-6 — No automated integration rung for storage or documents flows**
- **Description:** Driver units are mocked; the real-S3 proof (MinIO) was a
  manual live verification; `documents.service`, the download controller, and
  the migration script have no automated tests. M9 (controller/E2E layer) from
  the Sprint-01 review remains open.
- **Risk:** A regression in the upload→store→download chain (the exact chain
  protecting statutory documents) can only be caught manually.
- **Recommendation:** Add a CI job with a MinIO service container running a
  narrow storage integration spec (save → stream → restart-equivalent
  re-instantiate → stream → remove), and fold documents flows into the
  eventual supertest/E2E rung.

**M-7 — Attachment model is job-bound; AP / Booking will need documents**
- **Description:** The storage layer is entity-agnostic (good), but the only
  attachment table, `JobDocument`, requires a `jobId`. Vendor bills (Sprint 03
  AP), bookings, statements, and email attachments all need documents with no
  job.
- **Risk:** Sprint 03 either bends AP bills into fake jobs or migrates the
  attachment model under time pressure — the same trap M7 (AR-only notes)
  flagged for the notes table.
- **Recommendation:** Decide the generalized attachment shape (polymorphic
  `entityType`/`entityId` table, or per-module tables sharing the storage
  facade) **in the Sprint 03 AP plan**, alongside the vendor-notes model
  decision it already owes.

### LOW

**L-1 — Driver not DI-injected** — facade `new`s its driver from raw env; fine
today, but a factory provider (`STORAGE_DRIVER` token) would let Nest inject
mock drivers and reuse validated config. Adopt when adding a third driver.

**L-2 — Download stream lacks error handler and Content-Length** — a mid-pipe
S3 failure aborts the response without a clean error; no progress indication.
Add `stream.on('error', () => res.destroy())` and forward `ContentLength` when
the driver knows it.

**L-3 — Workbook parse blocks the event loop** — CPU-bound exceljs parse stalls
concurrent requests for its duration. Acceptable now; worker thread solves it
together with M-2.

**L-4 — Silent-tolerant `remove()` failures** — deletion failures are warn-logs
only; repeated failures (revoked token) accumulate invisibly. Fine until
metrics exist; note for the eventual observability pass.

**L-5 — Upload accepts any file type (pre-existing)** — no extension/MIME
allow-list on document upload; `attachment` disposition mitigates. Consider an
allow-list (pdf/images/office) as UX guardrail more than security fix.

**L-6 — No HTTPS enforcement on S3 endpoint** — an `http://` endpoint in
production would move credentials/documents in plaintext. One-line env
validation guard (allow http only outside production) closes it.

**L-7 — Facade file placement** — `file-storage.service.ts` sits at `common/`
root while its drivers live in `common/storage/`. Move on next touch; zero
functional impact.

**L-8 — DEPLOYMENT.md scaling claim now conditional** — "stateless, run
multiple replicas" is true only on the s3 driver; the local driver breaks
replicas. Add the one-sentence qualifier.

---

## Part C — Future compatibility

| Future | Verdict | Notes |
|---|---|---|
| **Customer Portal** | ✅ prepared | Presigned-GET path already designed (`STORAGE.md` §11) as a driver-contract extension; do M-5 (ContentType) *before* it ships. Row-level scoping of document access remains the portal's own prerequisite (as flagged in the Sprint-01 review). |
| **OCR** | ✅ solved | `materialize()`/`dispose()` was built exactly for this; works identically on both drivers, temp files cleaned in `finally`. |
| **Email attachments** | ✅ minor addition | MailService needs bytes; the facade exposes streams — add a `getBuffer()` convenience (or stream support in the mailer) when the feature lands. No design obstacle. |
| **AP (Sprint 03)** | ⚠️ decision owed | Storage layer ready; the *attachment table* is job-bound (M-7). The AP plan must open with two model decisions: vendor notes (prior review M7) and the generalized document attachment shape. |
| **Booking** | ⚠️ same as AP | Booking confirmations/SI docs need the same generalized attachment answer — one decision covers both. |
| **Multi-tenant** | ⚠️ known distance | Keys carry no tenant dimension and the bucket is single-tenant; the documented prefix strategy (`STORAGE.md` §5) is the correct seam — per-tenant key prefixes (or buckets) + tenant-scoped queries. Storage is not the blocker; the app-wide absence of row-level tenancy is. Treat multi-tenant as an epic, not a storage tweak. |

---

## Part D — Recommended remediation order (for the next approval)

| Priority | Items | Effort | Rationale |
|---|---|---|---|
| 1 | **H-1** fail-fast production env validation + driver in `/health` (with M-1's probe) | S | Closes the only path back to silent data loss; config-level, no business logic |
| 2 | M-4 enable R2 object versioning (bucket config, zero code) | XS | Biggest protection-per-effort in the sprint's blast radius |
| 3 | M-3 delete-order inversion + upload compensation + orphan-sweep script | S | Storage/DB seam hygiene |
| 4 | M-5 ContentType on put (+backfill script variant) | XS–S | Cheap now, expensive after presigned URLs |
| 5 | M-2 zip-size precheck (worker thread optional, also L-3) | S | Bounded DoS hardening |
| 6 | M-6 MinIO CI integration spec | S–M | Locks the durability chain in CI |
| 7 | M-7 attachment-model decision → **write into SPRINT_03 (AP) plan** | planning | Prevents the next "model is X-only" finding |
| 8 | L-2, L-6, L-8 (stream error/Content-Length, https guard, doc qualifier) | XS each | Polish batch |

---

*No code was modified during this review. Awaiting Product Owner approval.*
