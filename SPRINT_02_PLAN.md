# SPRINT 02 PLAN — Data Durability, Security Dependency & Sprint-01 Hardening

**Status:** PROPOSED — awaiting Product Owner approval. No code has been written.
**Sources re-read for this plan:** `PROJECT_AUDIT.md` · `BUSINESS_AUDIT.md` · `PRODUCT_BACKLOG.md` · `MVP_SCOPE.md` · `IMPLEMENTATION_ROADMAP.md` · `ARCHITECTURE_REVIEW.md`
**Date:** 2026-07-20

---

## 0. Roadmap Re-evaluation — why Sprint 02 is NOT Accounts Payable

The roadmap (`IMPLEMENTATION_ROADMAP.md`) scheduled **Sprint 2 = Accounts Payable
(P0-3)**. After Sprint 01/01A, I recommend changing the order. Four reasons:

**1. Phase 0 was skipped, and the risk it guards against is now *live*.**
The roadmap's Sprint 0 ("make it safe to hold real data" — P0-5 persistent
storage, P0-6 `xlsx` replacement) was never executed; we went straight to CN/DN.
Meanwhile the system is deployed on Render and holds real business data, and
**every sprint ends with a push to `main`, which auto-deploys and wipes the
ephemeral disk** — so our own delivery cadence is an active document-loss
mechanism that fires again at the end of every future sprint. `MVP_SCOPE.md` §2E
calls both items *"non-negotiable… before real customer data lands"*; MVP exit
criteria #3 (documents survive a redeploy) and #7 (non-`xlsx` import) cannot be
met without them. The longer we stack feature sprints on top, the more real data
sits on a disk that vanishes.

**2. AP's Definition of Ready is not met.**
`ARCHITECTURE_REVIEW.md` M7 established that the Sprint-01 note model is
AR-only by construction (required `customerId`, `invoices.*` permissions) and
that the **vendor-side notes/AP document model must be decided before AP
starts** (separate `vendor_*` model vs. widened shared table). The roadmap's own
governance section requires dependencies met and a migration plan noted before
a sprint starts. That decision belongs in the AP sprint plan — Sprint 03 —
written when it can be the plan's centrepiece, not rushed as a preamble.

**3. Sprint 01A proved the "harden the seam before building on it" lesson.**
All four High findings came from new code meeting old code. Four Medium
findings from the approved review (M2 transactional issue, M3 issue-date
stamping, M4 DTO tightening, M6 confirm dialogs) are small, sit in modules we
touched *this week* (cheapest to fix now, while context is fresh), and two of
them (M2, M3) protect the same financial integrity Sprint 01A restored. They
fit alongside the infra work without crowding a 2-week sprint.

**4. AP is the largest P0 (L, ~4–5 dw).** Running the biggest build while the
storage risk burns in production is the wrong order; the infra sprint is also
naturally lower-risk to the newly-hardened billing code (it barely touches it).

**Resulting roadmap change (only the order of two sprints):**

| Sprint | Was (roadmap) | Now proposed |
|---|---|---|
| 02 | Accounts Payable (P0-3) | **Deferred Phase-0 hardening: P0-5 + P0-6 + review items M2/M3/M4/M6** |
| 03 | Credit Control + Collections | **Accounts Payable (P0-3)** — plan must open with the M7 model decision |
| 04 | Booking | Credit Control + Collections (P0-7 + P0-8) |
| 05→ | shifts by one | Booking → Milestones → **MVP GA** (one sprint later than planned) |

MVP GA moves from "after Sprint 5" to "after Sprint 6" — a 2-week slip that buys
out the data-loss and no-patch-dependency risks *before* customer money data
accumulates. Phases 3–4 are unchanged.

---

## 1. Goal

Make the system safe to hold real customer data: documents survive redeploys
(persistent object storage), the only unpatchable security dependency (`xlsx`)
is removed, and the four approved Medium hardening items from
`ARCHITECTURE_REVIEW.md` (M2, M3, M4, M6) are closed.

## 2. Business Objective

- **No silent data loss:** an uploaded Bill of Lading, invoice PDF or OCR source
  file must survive every future deploy — losing a customer's BL is a
  trust-ending event for a forwarder (BA §21, PA §7-4).
- **No unpatchable exposure:** `xlsx` (SheetJS) has prototype-pollution/ReDoS
  advisories **with no upstream fix** (PA §7-1). Removing it closes the audit's
  #2 recommendation and MVP exit criterion #7.
- **Billing integrity stays watertight:** M2 closes the last known way to
  over-credit an invoice (concurrent issue race); M3 makes the SST tax-point
  date correct; M4 stops API clients creating degenerate notes; M6 prevents
  one-click accidental posting into the statutory document sequence.

## 3. Database Changes

**None. Zero migrations this sprint** (requirement: minimal schema change — met
at its minimum).

- Storage: `JobDocument.storedPath` already stores an opaque UUID key; the same
  column value becomes the object-storage key. Driver choice is env-driven, not
  data-driven, so no discriminator column is needed.
- M3 (issue-date stamping) reuses the existing `issueDate` column — the change
  is *when* it is written, not *what* is stored.
- M2/M4/M6 are logic/validation/UI only.

## 4. Backend Changes

### A. P0-5 — Persistent object storage (Cloudflare R2 / any S3-compatible)
- Refactor `common/file-storage.service.ts` into a driver interface with two
  implementations behind the existing public API (`save` / `stream` /
  `resolve` / `delete` signatures preserved — `documents.service` and
  `recycle-bin.service` keep working unchanged):
  - **`local`** (current behaviour) — default when no storage env vars set, so
    dev setup stays zero-config.
  - **`s3`** — `@aws-sdk/client-s3` against an S3-compatible endpoint
    (Cloudflare R2 free tier: 10 GB, zero egress fees — fits the free-cloud
    constraint). Env: `STORAGE_DRIVER`, `S3_ENDPOINT`, `S3_BUCKET`,
    `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Streaming download (no full-file buffering) preserved for both drivers.
- One-off migration script (`scripts/migrate-uploads-to-s3.ts`): uploads any
  existing local files to the bucket and verifies by re-fetch. (Production has
  likely already lost its ephemeral files — the script is mainly for the local
  instance and for documented completeness, MVP_SCOPE risk note.)
- `render.yaml`: document the five new env vars (values entered in the Render
  dashboard, never committed).

### B. P0-6 — Replace `xlsx` with `exceljs`
- **Import path (the security-relevant path):** move Excel *parsing*
  server-side — new endpoint in the existing `imports` module accepting the
  uploaded workbook (multer, 5 MB cap already global) and returning the same
  parsed-preview row shape the client parser produces today, using `exceljs`
  with row/column/cell-count limits. The existing JSON commit endpoint is
  unchanged.
- **Export path:** replace `frontend/src/lib/xlsx-export.ts` internals with
  `exceljs` browser build (generation only — no untrusted input). Same
  function signature, callers (invoices / jobs / quotations / rates pages)
  unchanged.
- Remove `xlsx` from both `package.json`s; CI proves the tree builds without it.

### C. ARCHITECTURE_REVIEW remediation (approved scope M2, M3, M4)
- **M2:** wrap `CreditDebitNotesService.issue()` in a `$transaction` with a
  `SELECT … FOR UPDATE` row lock on the invoice (same pattern
  `sequence.service.ts` already uses) so two concurrent issues cannot jointly
  over-credit.
- **M3:** on DRAFT→ISSUED, stamp `issueDate = now()` unless the user explicitly
  set a date on the draft (kept if provided) — making the SST tax point the
  posting date by default.
- **M4:** `UpdateNoteDto.items` gets `@ArrayMinSize(1)`; `reason` gets
  `@IsNotEmpty()` on create and update DTOs.

## 5. Frontend Changes

- **Rate import dialog** (`components/rate-import-dialog.tsx`): drop the
  client-side `XLSX.read` — upload the file to the new server parse endpoint
  and render the returned preview. UX (preview → commit) unchanged.
- **Excel exports**: `lib/xlsx-export.ts` reimplemented on `exceljs`; no caller
  changes.
- **M6:** confirmation dialogs (existing app pattern) on note **Issue** and on
  **Cancel of an ISSUED** note in `app/adjustments/note-list.tsx`.
- No new pages, no navigation changes, no visual redesign.

## 6. API Design

**New (1 endpoint):**

| Method | Path | Permission | Request | Response |
|---|---|---|---|---|
| POST | `/api/imports/rates/parse` | `rates.write` | multipart `file` (.xlsx/.csv, ≤5 MB) | `{ rows: ParsedRateRow[], warnings: string[] }` — same shape the client parser emits today |

Validation: extension + MIME allow-list, workbook limits (≤10k rows, ≤50 cols),
typed 400s for oversize/malformed files. Audit-logged like other imports.

**Changed behaviour, same contracts:**
- Document upload/download endpoints: identical routes/DTOs; storage backend
  swaps underneath.
- `POST /credit-debit-notes/:id/issue`: same route; now transactional (M2) and
  stamps `issueDate` (M3). `PATCH /credit-debit-notes/:id`: same route; rejects
  empty `items` array and blank `reason` (M4) — these were never legitimate
  calls, and the UI already prevents them, so no client breaks.

**No endpoint removed. No response shape changes.**

## 7. Risks

1. **External dependency — bucket credentials (the only user action).** R2/S3
   needs an account + bucket + keys entered in Render. Mitigation: `local`
   driver remains the default, so nothing breaks if credentials arrive late;
   acceptance simply can't be signed off until they exist. **Needs PO input:
   confirm Cloudflare R2 (proposed default) vs AWS S3/other.**
2. **Parser fidelity:** `exceljs` and SheetJS differ on dates, merged cells and
   number formats. Mitigation: golden-file tests — the existing sample rate
   sheets must parse to identical row sets before the old path is deleted.
3. **Production files already lost:** anything uploaded to Render before this
   sprint is likely already gone (ephemeral disk). The migration script
   documents/recovers what exists locally; no recovery is possible for
   already-wiped files. Set expectation now.
4. **M3 is a behaviour change:** notes drafted earlier and issued later now
   carry the issue day as tax point (unless a date was explicitly chosen).
   This is the compliant default, but finance should be told.
5. **Bundle size:** `exceljs` in the browser is heavier than `xlsx`.
   Mitigation: dynamic import so it loads only when exporting; measured in the
   build-size check.
6. **Scope discipline:** this sprint deliberately contains zero new business
   features. AP (P0-3) is next and starts with the M7 model decision.

## 8. Acceptance Criteria

1. Upload a document to a job → **restart/redeploy the backend** → download
   succeeds byte-identical (verified locally against MinIO/R2; on Render after
   credentials are set). *(MVP exit criterion #3)*
2. `xlsx` absent from both `package.json` / lockfiles; CI (typecheck + build +
   tests, both tiers) green without it. *(MVP exit criterion #7)*
3. The sample rate sheet imports through the server parser with the **same
   resulting rows** as the old client parser (golden-file test), and oversize /
   malformed / wrong-type uploads return typed 400s.
4. Invoice/job/quotation/rate Excel exports open correctly in Excel with the
   same columns as today.
5. **M2:** a concurrency regression test proves two simultaneous `issue()`
   calls on CNs that jointly exceed the creditable balance cannot both succeed.
6. **M3:** issuing a note drafted "yesterday" stamps today's `issueDate`
   (regression test); an explicitly-set draft date is preserved.
7. **M4:** `PATCH` with `items: []` or blank `reason` → 400 (regression tests).
8. **M6:** Issue and Cancel-of-ISSUED each show a confirmation dialog before
   firing.
9. Full suite green: all 106 existing tests + new ones (target ≥ 120); zero
   schema migrations in the diff; `CHANGELOG.md`, `TODO.md`,
   `PRODUCT_BACKLOG.md` (P0-5/P0-6 marked done) updated; `SPRINT_02_REPORT.md`
   generated.

## 9. Estimated Development Time

Assumptions per roadmap: 2-week sprint, ~1.5 effective devs (dev-weeks = dw).

| Work item | Estimate |
|---|---|
| A. Storage driver refactor + S3 impl + migration script + env/docs | 1.5 dw |
| B. Server-side import parse + exceljs exports + remove `xlsx` + golden-file tests | 1.5 dw |
| C. M2 + M3 + M4 + regression tests | 0.5 dw |
| D. M6 confirm dialogs + UI verification | 0.25 dw |
| E. Docs, CHANGELOG/TODO/backlog updates, report, live verification | 0.25 dw |
| **Total** | **~4 dw — fits one 2-week sprint** |

## 10. Files Expected To Change

**Backend**
- `src/common/file-storage.service.ts` — driver split (core of P0-5)
- `src/common/prisma.module.ts` — provider wiring for the storage driver
- `src/config/env.validation.ts` — new optional storage env vars
- `src/modules/imports/…` — new parse endpoint (controller + service + DTO)
- `src/modules/credit-debit-notes/credit-debit-notes.service.ts` — M2, M3
- `src/modules/credit-debit-notes/credit-debit-notes.dto.ts` — M4
- `scripts/migrate-uploads-to-s3.ts` — NEW (one-off migration)
- `package.json` — `+@aws-sdk/client-s3`, `+exceljs`, `−xlsx` (if present server-side)
- Tests: `file-storage` driver spec (NEW) · `imports` parse spec (NEW) ·
  `credit-debit-notes.service.spec.ts` (extend: M2/M3/M4)

**Frontend**
- `src/lib/xlsx-export.ts` — exceljs internals
- `src/components/rate-import-dialog.tsx` — upload-to-server flow
- `src/app/adjustments/note-list.tsx` — M6 dialogs
- `package.json` — `+exceljs`, `−xlsx`

**Infra / docs**
- `render.yaml` (env var documentation) · `docs/DEPLOYMENT.md` ·
  `CHANGELOG.md` · `TODO.md` · `PRODUCT_BACKLOG.md` · `SPRINT_02_REPORT.md` (at completion)

**Explicitly NOT touched:** schema.prisma (zero migrations) · invoices write
paths hardened in 01A · quotations/jobs/customers/vendors modules.

---

*No code has been written. Awaiting approval — including the one open decision
in Risk #1 (Cloudflare R2 as the proposed storage provider).*
