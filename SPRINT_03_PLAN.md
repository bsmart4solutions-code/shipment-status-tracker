# SPRINT 03 PLAN — Accounts Payable (P0-3)

**Status:** PROPOSED — awaiting Product Owner approval. **No code has been written.**
**Sources:** `PRODUCT_BACKLOG.md` (P0-3) · `BUSINESS_AUDIT.md` §16 · `MVP_SCOPE.md` §2B · `IMPLEMENTATION_ROADMAP.md` · `ARCHITECTURE_REVIEW.md` (M7) · `ARCHITECTURE_REVIEW_SPRINT02.md` (M-7)
**Date:** 2026-07-27

---

## 0. Model decisions this plan owes (read first)

Two prior reviews recorded decisions that had to be made **before** AP starts, and
a third surfaced while researching this plan. Each is presented with a
recommendation; **approving this plan approves the recommendations unless you say
otherwise.**

### Decision A — Vendor credit/debit notes (`ARCHITECTURE_REVIEW.md` M7)

The Sprint-01 note model is AR-only by construction (required `customerId`,
`invoices.*` permissions). AP will eventually need the vendor-side equivalent.

| Option | Trade-off |
|---|---|
| **A1. Widen `credit_debit_notes`** (nullable customerId + vendorId + partyType) | One document engine, but a migration on the live billing table and permanent AR/AP entanglement in every query |
| **A2. Separate `vendor_credit_debit_notes`** reusing the calc engine + state machine | Mirrors the existing customer/vendor master split; no migration on live AR data; AP tax treatment free to diverge |

**Recommendation: A2 — and NOT in this sprint.** `BUSINESS_AUDIT.md` §16 does not
require vendor notes for AP MVP; a bill can be cancelled and re-entered. The
decision is recorded now only so Sprint 03's schema does not block it.

### Decision B — Document attachments for non-job entities (`ARCHITECTURE_REVIEW_SPRINT02.md` M-7)

A vendor bill **must** carry the scanned carrier invoice — that evidence is the
point of AP capture. Today the only attachment table is `JobDocument`, which
requires a `jobId` and carries OCR-specific fields.

| Option | Trade-off |
|---|---|
| **B1. Polymorphic `attachments`** (`entityType` + `entityId`), used for bills now; `JobDocument` untouched | Booking/statements later cost zero schema; loses DB-level FK integrity for attachments; two attachment systems coexist until someone consolidates |
| **B2. Per-module `vendor_bill_documents`** mirroring `JobDocument` | Keeps FK integrity (codebase convention); third module later makes three near-identical tables |

**Recommendation: B1 (polymorphic), with `JobDocument` explicitly NOT migrated in
this sprint.** It costs least across the known roadmap (AP now, Booking next),
and FK integrity matters less for binary attachments than for financial rows —
the storage facade (the expensive, shared part) is already common to both.
Migrating `JobDocument` would drag live OCR data, the recycle bin and
`documents.service` into an AP sprint; that is a separate, deliberate change.

### Decision C — How vendor bills relate to `Job.actualCost` (**new — found while planning**)

`Job.actualCost` is today a **single manually-entered Decimal** (or copied from
the quotation's total cost at conversion). There are **no job cost lines** — the
roadmap's original acceptance wording ("matches the job's cost line") described
something that does not exist. P&L reads `actualCost` directly.

| Option | Trade-off |
|---|---|
| **C1. Bills become the source of truth** — `actualCost` derived from approved bills | Cleanest long-term, but silently redefines a number every existing P&L and job screen depends on, and needs a backfill for historical jobs |
| **C2. Bills are independent; show a billed-vs-recorded variance** | Non-destructive; delivers exactly the "cost accrual vs actual matching" BA §16 asks for; two numbers coexist until a later deliberate migration |
| C3. Auto-roll-up with manual override | Ambiguous source of truth — the worst of both |

**Recommendation: C2.** This is the direct lesson of Sprint 01A: new code must
not quietly change the meaning of figures that existing reports already publish.
Sprint 03 shows **Recorded cost / Billed cost / Variance** on the job; promoting
bills to the source of truth becomes its own small, deliberate sprint once bills
are the habitual entry point.

---

## 1. Goal

A forwarder can capture what it owes: record vendor bills (against a job, across
several jobs, or standalone), attach the carrier's invoice, control them through
an approval lifecycle, record payments, and see an AP aging report — with job-level
billed-vs-recorded cost variance.

## 2. Business Objective

- **Know what the company owes.** Today AP scores 5% (`BUSINESS_AUDIT.md` §16):
  vendor bills exist only as an amount typed into a job. There is no payables
  ledger, so the business cannot answer "what do we owe carriers this month?"
- **Control cost leakage.** Billed-vs-recorded variance surfaces the case where a
  carrier bills more than was quoted/recorded — the single most common margin
  leak in forwarding.
- **Complete the sub-ledger pair.** AR (invoices + CN/DN) already exists; AP
  completes the picture so books can be closed by export until accounting
  integration (P1-1) lands.

## 3. Database Changes

One migration, additive only — no existing table is altered destructively.

- **Enums:** `VendorBillStatus` (DRAFT | APPROVED | PARTIALLY_PAID | PAID | CANCELLED); `AttachmentEntity` (VENDOR_BILL) — extended as later modules adopt it.
- **`vendor_bills`** — billNumber (unique, `BILL-YYYY-####`), vendorInvoiceNo, vendorId (FK Restrict), jobId? (FK Restrict — header-level default), currency, fxRate, subtotal, taxPct, taxAmt, totalAmount, amountPaid, status, billDate, dueDate, terms, notes, createdById/updatedById.
  **Unique `(vendorId, vendorInvoiceNo)`** — a carrier's invoice number cannot be entered twice (duplicate-bill control).
- **`vendor_bill_items`** — description, unitPrice, unit, quantity, lineCurrency, fxRate, amount, taxExempt, accNo, sortOrder, **`jobId?`** (line-level job allocation, overrides the header — this is what lets one consolidated carrier invoice cover ten shipments).
- **`vendor_payments`** — mirrors `invoice_payments` (billId FK Restrict, amount, paidAt, method, reference, recordedById).
- **`attachments`** (Decision B1) — entityType, entityId, storedPath, originalName, mimeType, sizeBytes, uploadedById, uploadedAt. Indexed on `(entityType, entityId)`.
- **Sequence row:** `vendorBill` → prefix `BILL`, year-scoped, padding 4.
- **Permissions:** new group `payables` → `payables.read` / `payables.write`, granted to Administrator, Manager and Finance in the role matrix (seed only — additive).

`Job.actualCost` is **not** touched (Decision C2).

## 4. Backend Changes

New module `modules/payables/`, deliberately mirroring `modules/invoices/`:

- **`vendor-bill.calc.ts`** — pure arithmetic reusing `priceInvoiceItem` /
  `computeInvoiceTotals` (the single tax engine, exactly as CN/DN did), plus
  `applyVendorPayment()` reusing the AR overpayment/status-derivation rules.
- **`payables.service.ts`** — list/get/create/update (DRAFT only)/approve/cancel,
  `recordPayment`, `agingReport`, `jobCostVariance(jobId)`.
- **State machine** — `VENDOR_BILL_EDGES` added to `common/state-machine.ts`
  (DRAFT→APPROVED/CANCELLED; APPROVED→PARTIALLY_PAID/PAID/CANCELLED;
  PARTIALLY_PAID→PAID/CANCELLED; PAID/CANCELLED terminal), with
  `assertVendorBillStatusTransition`.
- **`attachments.service.ts`** (`common/`) — thin wrapper over the existing
  `FileStorageService` facade; **no new storage code** (Sprint 02 architecture
  unchanged, per its review).
- **Guards applied consistently:** payment only on APPROVED/PARTIALLY_PAID; no
  overpayment; cancel blocked once payments exist (mirrors the invoice rule and
  Sprint 01A's H3 lesson); approve is transactional.
- **Validation/authz/errors/tests on every endpoint**, per the standing rules.
- List filters declared as **`ListPayablesDto extends PaginationDto`** — applying
  the Sprint-01 lesson, never the extra-`@Query()` pattern that still 400s on
  quotations/invoices/jobs (`TODO.md`).

## 5. Frontend Changes

- **`/payables`** — list (search, status + vendor filter, pagination) with
  loading / empty / error states and responsive layout; actions Edit (DRAFT),
  Approve, Record Payment, Attach/View document, Cancel, Print.
- **Bill builder modal** — vendor picker (adopts currency + payment terms),
  line items with per-line job allocation, SST-exempt flag, live totals, file
  attach.
- **Payment dialog** — reuses the invoice payment dialog pattern.
- **AP Aging modal** — mirrors the AR aging view (buckets + per-vendor totals).
- **Job detail** — a small "Cost" panel: Recorded / Billed / Variance (Decision C2).
- **Sidebar** — "Payables" entry under `payables.read`.
- No changes to any AR/invoice screen.

## 6. API Design

All under `/api/payables`, permissions `payables.read` / `payables.write`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/payables` | paginated; filters `status`, `vendorId`, `jobId`, `search` |
| GET | `/payables/aging` | buckets + per-vendor totals (declared before `:id`) |
| GET | `/payables/:id` | bill + items + vendor + payments + attachments |
| POST | `/payables` | create (server-computed totals; duplicate vendor-invoice guard) |
| PATCH | `/payables/:id` | DRAFT only; transactional item replace |
| POST | `/payables/:id/approve` | DRAFT → APPROVED (transactional) |
| POST | `/payables/:id/cancel` | → CANCELLED (blocked when payments exist) |
| POST | `/payables/:id/payments` | record payment; derives PARTIALLY_PAID / PAID |
| POST | `/payables/:id/attachments` | multipart upload (5 MB cap, reuses storage facade) |
| GET | `/attachments/:id/download` | streamed download, permission-checked |
| DELETE | `/attachments/:id` | remove attachment |
| GET | `/jobs/:id/cost-variance` | recorded vs billed vs variance |

**No existing endpoint is changed or removed.**

## 7. Business questions — proposed defaults (confirm or correct)

Per the standing rule "never guess business logic", these are the assumptions
this plan is costed on. **Silence = approval of the default.**

1. **SST on vendor bills** → treated as **part of cost, not recoverable** (Malaysia's SST has no input-tax credit like GST). *If you reclaim input tax, say so — it changes the schema.*
2. **Bill without a job** → **allowed** (office rent, monthly line charges).
3. **One bill across several jobs** → **allowed** via line-level `jobId` (consolidated carrier invoices).
4. **Approval workflow** → **none** — anyone with `payables.write` can approve (same default approved for CN/DN in Sprint 01).
5. **Overpaying a bill** → **blocked** (mirrors AR).
6. **Duplicate vendor invoice number for the same vendor** → **blocked** by unique constraint.
7. **Foreign-currency bills** → booked at the **bill-date FX rate**; no month-end revaluation (FX gain/loss is out of MVP scope).
8. **Approving a bill** → does **not** change `Job.actualCost` (Decision C2 — variance shown instead).

## 8. Risks

1. **Scope creep — this is the largest P0 (L, 4–5 dw).** Purchase Orders,
   3-way match, payment runs/bank files and vendor CN/DN are **explicitly out**.
   If any is required for go-live, say so now: the sprint splits in two.
2. **Decision C is a judgement call.** C2 leaves two cost numbers on a job until
   a later migration. The alternative (C1) is cleaner but rewrites a published
   figure — rejected here on Sprint-01A precedent.
3. **Two attachment systems coexist** under B1 until someone consolidates
   `JobDocument`. Named trigger: do it when a third module needs attachments.
4. **Multi-currency AP is where forwarders lose money quietly.** Booking at
   bill-date rate without revaluation is correct for MVP but will need FX
   gain/loss when accounting integration (P1-1) lands.
5. **Test-data hygiene:** AP touches money; all live verification data will be
   removed and sequences reset, as in Sprints 01/01A/02.
6. **Unrelated open risk (not this sprint):** production R2 credentials are still
   not set — see `TODO.md`. Sprint 03 adds attachments, which makes durable
   storage matter more, not less.

## 9. Acceptance Criteria

1. Record a vendor bill against a job (DRAFT), attach the carrier PDF, approve it, and see it in `/payables` with the correct SST-aware totals.
2. Record a partial payment → status `PARTIALLY_PAID`; settle the balance → `PAID`; an overpayment is rejected with a typed 400.
3. A second bill with the same vendor invoice number for that vendor is rejected.
4. A consolidated bill with lines allocated to two different jobs shows the correct billed amount on **each** job's variance panel.
5. AP aging buckets payables by due date with correct per-vendor totals; cancelled and fully-paid bills drop off.
6. Cancelling a bill with recorded payments is blocked with a 409; cancelling a DRAFT succeeds.
7. Job cost panel shows Recorded / Billed / Variance, and `Job.actualCost`, P&L and every AR figure are **unchanged** by AP activity (regression-tested).
8. Every new endpoint enforces `payables.read` / `payables.write`; every write is audit-logged.
9. All pages have loading / empty / error states and are responsive.
10. Full suite green (153 existing + new; target ≥ 185), backend typecheck, frontend typecheck, both production builds; one migration applying cleanly; live verification performed and test data removed.
11. `SPRINT_03_REPORT.md`, `CHANGELOG.md`, `TODO.md`, `PRODUCT_BACKLOG.md` (P0-3 marked done) updated.

## 10. Estimated Development Time

2-week sprint, ~1.5 effective devs (dev-weeks = dw), per roadmap assumptions.

| Work item | Estimate |
|---|---|
| A. Schema + migration + sequence + permissions seed | 0.75 dw |
| B. Backend: calc, service, state machine, DTOs, controller, attachments service | 1.5 dw |
| C. Frontend: payables list, bill builder, payment dialog, AP aging, job variance panel, nav | 1.25 dw |
| D. Tests (calc, guards, lifecycle, variance, aging, attachments) | 0.5 dw |
| E. Live verification, cleanup, docs, report | 0.25 dw |
| **Total** | **~4.25 dw — a full 2-week sprint, no slack** |

If the sprint must fit with margin, the natural split is **AP-core** (schema,
bills, approval, payments, aging) in Sprint 03 and **attachments + variance
panel** in Sprint 03B.

## 11. Files Expected To Change

**Backend — new:** `modules/payables/` (`vendor-bill.calc.ts`, `payables.dto.ts`,
`payables.service.ts`, `payables.controller.ts`, `payables.module.ts`, +2 spec
files) · `common/attachments.service.ts` + controller + spec ·
`prisma/migrations/<ts>_accounts_payable/`
**Backend — modified:** `prisma/schema.prisma` · `prisma/seed.ts` (sequence +
permission group + role matrix) · `src/app.module.ts` (register module) ·
`src/common/state-machine.ts` (+ vendor-bill edges) · `src/common/prisma.module.ts`
(provide attachments service) · `src/modules/jobs/jobs.service.ts` (**read-only**
cost-variance query — no write-path change)
**Frontend — new:** `app/payables/page.tsx`, `app/payables/bill-form.tsx`,
`app/payables/bill-print.tsx`, `app/payables/ap-aging.tsx`
**Frontend — modified:** `components/shell.tsx` (nav) · `app/jobs/page.tsx` (cost panel)
**Docs:** `SPRINT_03_REPORT.md` (at completion) · `CHANGELOG.md` · `TODO.md` ·
`PRODUCT_BACKLOG.md`

**Explicitly NOT touched:** invoices, credit/debit notes, quotations, customers,
vendors master, the storage driver layer (Sprint 02 architecture unchanged), and
`JobDocument`.

---

*No code has been written. Awaiting approval — including the three model
decisions in §0 and the eight business defaults in §7.*
