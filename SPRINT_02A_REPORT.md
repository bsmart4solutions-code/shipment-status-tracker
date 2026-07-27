# SPRINT 02A REPORT — Remediation of ARCHITECTURE_REVIEW_SPRINT02 High finding

**Scope:** H-1 only (per approval). No Medium or Low findings implemented.
**Status:** ✅ COMPLETE — fixed, regression-tested, live-verified
**Date:** 2026-07-27
**Suite:** 14 backend suites, **153/153 passing** (was 140; +13). Backend typecheck and production build clean. **No database changes. No frontend changes. Storage Driver architecture unchanged. API compatible.**

---

## Root Cause

`FileStorageService.buildDriver()` treated an incomplete `STORAGE_DRIVER=s3`
configuration as a recoverable condition in **every** environment: it logged an
error and returned the local-disk driver so the application would keep booting.
That is the correct trade-off in development (zero-config setup) and precisely
the wrong one in production, where the local disk on Render's free tier is
erased on every deploy.

Sprint 02 then shipped `render.yaml` with `STORAGE_DRIVER=s3` and the four
credentials marked `sync: false` (entered by hand in the dashboard). Until they
are entered — and after any later typo, rotation mistake, or cleared variable —
production would boot **successfully**, report healthy, accept document
uploads, and silently write statutory shipping documents to a disk that the
next deploy wipes. A single console line was the only signal, and nothing
exposed the active driver for monitoring.

In short: the durability guarantee P0-5 was built to deliver depended on a
configuration step that nothing enforced.

## Fix

Three layers, defence in depth, matching the approved requirements:

1. **Startup validation (the primary gate).** `env.validation.ts` now marks
   `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` as
   required — via `@ValidateIf(requiresS3Config)` + `@IsNotEmpty` — exactly
   when `NODE_ENV=production` **and** `STORAGE_DRIVER=s3`. Missing *or blank*
   values abort `bootstrap()` before Nest is created, so the process exits 1
   and Render marks the deploy failed. Each message names the variable and the
   reason ("refusing to fall back to ephemeral local storage").

2. **Service-level guard (defence in depth).** `FileStorageService` throws
   instead of falling back when `NODE_ENV=production` and the S3 configuration
   is incomplete, covering any path that constructs the service without going
   through `validateEnv()` (tests, scripts, future entry points).

3. **Observability.** `GET /api/health` now reports the active driver at
   `checks.storageDriver`. `"local"` appearing in a production health payload
   is now an alertable condition rather than an invisible one.

**Development is unchanged:** with an incomplete S3 configuration it still
falls back to the local driver, logs the reason, and boots — verified live.

## Files Modified

**Backend (4 modified, 2 new specs):**
- `src/config/env.validation.ts` — conditional `@ValidateIf(requiresS3Config)` + `@IsNotEmpty` on the four S3 variables; `requiresS3Config()` helper
- `src/common/file-storage.service.ts` — production throws instead of falling back; development keeps the graceful path (log wording clarified as "development only")
- `src/modules/health/health.controller.ts` — injects `FileStorageService`, adds `checks.storageDriver` to the full health payload
- `src/common/storage/storage.spec.ts` — existing fallback test scoped to development; production cases added
- `src/config/env.validation.spec.ts` — **NEW**
- `src/modules/health/health.controller.spec.ts` — **NEW**

**Not touched:** Prisma schema (no migration), any frontend file, the storage
driver interface and both driver implementations, every other module.

**API compatibility:** no endpoint added, removed or reshaped.
`GET /api/health` gains one additive field inside the existing `checks`
object; `/health/live`, `/health/ready` and `/health/metrics` are byte-for-byte
unchanged (covered by a test).

## Tests Added (13 new; suite 153/153)

**`env.validation.spec.ts` — production startup validation (7):**
rejects production+s3 with no S3 config · rejects when a single credential is
missing · rejects when a credential is blank · accepts production+s3 fully
configured · accepts production on the local driver · accepts
development+s3 with incomplete config · accepts a bare default environment.

**`storage.spec.ts` — driver selection (2 added, 1 rescoped):**
refuses to construct in production when the config is incomplete · still builds
the s3 driver in production when fully configured · (existing fallback test now
explicitly asserts *development* behaviour).

**`health.controller.spec.ts` — driver reporting (4):**
reports `s3` when active · reports `local` when active · keeps reporting the
driver when the database is down (degraded) · `/health/live` shape unchanged.

## Live Verification

Against the compiled production bundle (`dist/main.js`), real Postgres:

| Check | Command | Result |
|---|---|---|
| ✓ Production rejects incomplete S3 config | `NODE_ENV=production STORAGE_DRIVER=s3` (no credentials) | **Startup aborted, exit code 1**, four named errors: `S3_ENDPOINT is required in production when STORAGE_DRIVER=s3 (refusing to fall back to ephemeral local storage)` (and the same for `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) |
| ✓ Production boots when fully configured | same + the four credentials | Boots; log `File storage driver: s3`; health `status: ok, storageDriver: s3` |
| ✓ Development still falls back | `NODE_ENV=development STORAGE_DRIVER=s3` (no credentials) | Boots normally; log `File storage driver: local`; reason recorded in `logs/error.log` |
| ✓ Health reports the active driver | `GET /api/health` | `checks.storageDriver` observed as both `local` and `s3` across the runs above |

**Note on process hygiene:** the first production-with-full-config run returned
`storageDriver: local` — investigation showed the new instance had failed to
bind its port (`EADDRINUSE`) and the probe had reached a stale development
instance from the previous check. Re-run on a clean port: `s3`, zero
`EADDRINUSE`. Recording it because the raw first reading looked like a code
defect and was not one.

No test data was created (no database writes in any check). Test ports released,
`backend/.env` confirmed to contain no S3 variables, so local development
continues on the local driver exactly as before.

## Risks

1. **Intended breaking change for misconfigured production deploys.** A
   production instance with `STORAGE_DRIVER=s3` and incomplete credentials will
   now **refuse to start**. This is the point of the sprint, but it means the
   R2 credentials must be entered in Render *before* the next production deploy
   — otherwise that deploy fails (loudly, which is the desired outcome, and the
   previous release keeps serving). Steps: `STORAGE.md` §3.
   *Escape hatch if ever needed:* set `STORAGE_DRIVER=local` explicitly to boot
   without S3 — an explicit, auditable choice rather than a silent fallback.
2. **Not a connectivity check.** Validation proves the variables are *present*,
   not that the endpoint, bucket or keys are *valid* — wrong credentials still
   surface on first use. Closing that is M-1 (boot-time `HeadBucket` probe),
   deliberately out of this sprint's approved scope.
3. **`/health` is public** (no JWT, by design for uptime monitors). It now
   discloses one additional fact: whether storage is `local` or `s3`. No
   endpoint, bucket, credential or key is exposed. Judged acceptable; noted for
   the record.
4. **Pre-existing defect found, deliberately NOT fixed (out of scope):** the
   winston *console* formatter renders `logger.error('message')` as an empty
   line — its `stack || message` expression picks a truthy `[null]` stack that
   stringifies to `""`. It affects every `.error(string)` call app-wide, not
   just storage. The message is written correctly to `logs/error.log` and
   `logs/combined.log`, so nothing is lost, but console-only observers see a
   blank error. Logged in `TODO.md` for Product Owner prioritisation.
5. **Unchanged by design:** M-1 through M-7 and L-1 through L-8 from
   `ARCHITECTURE_REVIEW_SPRINT02.md` remain open, including R2 object
   versioning (M-4) and the delete-ordering seam (M-3).
