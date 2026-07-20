# STORAGE.md — Document Storage Architecture

**Since:** Sprint 02 (P0-5) · **Production backend:** Cloudflare R2 · **Dev default:** local disk
**Code:** `backend/src/common/storage/` + `backend/src/common/file-storage.service.ts`

---

## 1. Architecture Overview

Uploaded binaries (Bills of Lading, PDFs, OCR sources) flow through a single
facade, `FileStorageService`, which delegates to a pluggable **StorageDriver**.
Business modules never know which backend is active:

```
DocumentsService / RecycleBinService
            │  save · stream · materialize · remove
            ▼
   FileStorageService (facade — driver chosen from env at boot)
            │
   ┌────────┴────────┐
   ▼                 ▼
LocalStorageDriver  S3StorageDriver
(UPLOAD_DIR disk)   (Cloudflare R2 / MinIO / AWS S3 / any S3 API)
```

The database is unchanged: `JobDocument.storedPath` holds the same opaque
`uuid.ext` value it always did — on the local driver it is a filename, on S3 it
is the object key. Switching drivers requires **zero schema or data migration**.

## 2. Driver Design

`storage-driver.ts` defines the contract:

| Method | Purpose |
|---|---|
| `put(key, buffer)` | persist a binary under a generated key |
| `getStream(key)` | `Readable` of the object, `null` when missing |
| `materialize(key)` | local file path + `dispose()` for tools needing filesystem access (pdf-parse, OCR); local driver returns its real path with a no-op dispose, S3 downloads to a temp file that dispose removes |
| `remove(key)` | delete; never throws for an already-gone object |

Adding a future provider (GCS, Azure Blob…) = one new class implementing this
interface + one branch in `FileStorageService.buildDriver()`. No business-logic
changes — this is the pluggability requirement of Sprint 02 made concrete.

Driver selection (boot-time, logged):
- `STORAGE_DRIVER=local` (default) → `LocalStorageDriver(UPLOAD_DIR)`
- `STORAGE_DRIVER=s3` + complete `S3_*` config → `S3StorageDriver`
- `STORAGE_DRIVER=s3` with **incomplete** config → logs an error and falls back
  to local so the app stays usable; the log line `File storage driver: …`
  states what is actually active.

## 3. Cloudflare R2 Configuration

One-time setup (Cloudflare dashboard):
1. **R2 → Create bucket** — name e.g. `erp-documents`. Region: automatic.
2. **R2 → Manage API Tokens → Create API Token** — permission *Object Read &
   Write*, scoped to that bucket only.
3. Note the **Account ID**, **Access Key ID**, **Secret Access Key**.

Environment variables (Render → service → Environment; never committed):

```
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_BUCKET=erp-documents
S3_ACCESS_KEY_ID=<access key id>
S3_SECRET_ACCESS_KEY=<secret access key>
# S3_REGION defaults to "auto" (correct for R2)
```

Free-tier fit: 10 GB storage, zero egress fees, 1M class-A + 10M class-B
operations/month — far above this system's document volume.

The same variables pointed at MinIO (`http://localhost:9100`, any bucket) give
a full local S3 test rig; Sprint 02's live verification ran exactly that.

## 4. Object Key Strategy

Keys are generated in `newStorageKey()`: `<uuidv4><.ext>` — e.g.
`52209120-76d1-44d8-9ae9-0b671349c388.pdf`.

- The original filename is **never** part of the key (no path traversal, no
  collision, no encoding issues); it is stored separately in
  `JobDocument.originalName` for the download filename.
- Extension is sanitized (alphanumeric, ≤10 chars, lowercased) and kept only to
  aid manual bucket inspection.
- `isValidStorageKey()` re-validates the shape at every driver boundary
  (defence-in-depth): a non-generated key is rejected before any bucket or
  filesystem call.

## 5. Folder Structure

Flat, no prefixes. Rationale: keys are already globally unique; a flat
namespace keeps local disk and bucket layouts 1:1 with `storedPath`, which is
what makes the local→R2 migration a straight copy. If future modules need
segregation (e.g. AP bills, statements), introduce a per-module *prefix* inside
the key at generation time — the driver contract does not change.

## 6. Upload Flow

```
POST /api/jobs/:jobId/documents/upload  (multipart, permission jobs.write)
 → multer memoryStorage (global 5 MB body cap; filename never used as a path)
 → DocumentsService.upload
    → FileStorageService.save(buffer, originalName)
       → newStorageKey() → driver.put(key, buffer)
    → prisma.jobDocument.create({ storedPath: key, originalName, mimeType, sizeBytes … })
    → audit log (user, ip, user-agent)
```

## 7. Download Flow

```
GET /api/documents/:id/download  (permission jobs.read)
 → DocumentsService.getForDownload
    → jobDocument lookup → FileStorageService.stream(storedPath)
    → 404 when the record or object is missing
 → controller sets Content-Type + Content-Disposition (encoded originalName)
 → object streamed to the client (no full-file buffering, both drivers)
```

Extraction (OCR/BL) uses `materialize()` instead of `stream()` — on R2 the
object is downloaded to a private temp file, parsed, then `dispose()` deletes
the temp file in a `finally` block.

## 8. Delete Flow

```
DELETE /api/documents/:id  (permission jobs.write)
 → FileStorageService.remove(storedPath)   — object deleted from bucket/disk
 → jobDocument row deleted → audit log
```

Recycle-bin purges of jobs delete each attached document's object the same way.
`remove()` is deliberately tolerant: an already-gone object logs a warning and
never breaks the user's flow. Live-verified in Sprint 02 (HeadObject → 404
after API delete).

## 9. Security Considerations

- **Private bucket, no public URLs.** Every byte flows through the
  authenticated API: JWT + RBAC (`jobs.read`/`jobs.write`) + audit logging.
  Presigned URLs are deliberately not used yet (see §11).
- **No path traversal:** keys are generated UUIDs; user filenames never touch a
  path; `isValidStorageKey` re-checked at driver level; local driver
  additionally resolves against its root and rejects escapes.
- **Credentials** live only in environment variables (Render dashboard / local
  `.env`, both untracked); the R2 API token is scoped to the single bucket with
  object-level permissions only.
- **Size limits:** global 5 MB request cap bounds upload size.
- **Fallback is fail-safe, not fail-silent:** misconfigured S3 logs an
  explicit error at boot and the health of the switch is visible in one log line.

## 10. Backup Strategy

- **Current (SME-appropriate):** R2 stores objects redundantly within
  Cloudflare's infrastructure; the database (document metadata) is backed up
  with the regular Postgres backups. Object keys ↔ DB rows are 1:1, so a DB
  restore plus the untouched bucket is a full recovery.
- **Recommended next step (documented, not yet implemented):** periodic
  `rclone sync` of the bucket to a second provider (or R2's S3-compatible
  replication once out of beta), monthly restore drill: pick a random
  `storedPath`, verify byte-identical fetch.
- The migration script (`backend/scripts/migrate-uploads-to-s3.ts`) doubles as
  a verification tool: it hash-compares local files against bucket objects and
  is idempotent — usable any time as a consistency check between a disk copy
  and the bucket.

## 11. Future CDN Strategy

Not needed at current scale (internal users, private documents), but the path
is clean when the Customer Portal (P1-2) ships:

1. **Presigned GET URLs** — the API issues short-lived (minutes) presigned R2
   URLs instead of proxying bytes; portal downloads then bypass the backend
   dyno entirely. One method on `S3StorageDriver`; the driver contract gains
   `presignGet(key, ttl)` with the local driver returning `null` (keep
   proxying).
2. **Cloudflare CDN in front of R2** — R2 integrates natively with Cloudflare's
   edge; enabling a custom domain on the bucket gives cached, zero-egress
   delivery for *public* assets only (e.g. company logos) — customer documents
   stay private/presigned.
3. **Cache rules:** immutable objects (keys are UUIDs, content never changes
   under a key) allow `Cache-Control: immutable` with long TTLs safely.
