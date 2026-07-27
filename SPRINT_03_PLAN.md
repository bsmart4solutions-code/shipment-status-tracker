# SPRINT 03 PLAN — Accounts Payable (P0-3)

**Status:** PROPOSED (rewritten against approved decisions) — awaiting Product Owner approval. **No code written.**
**Architectural authority:** `AP_ARCHITECTURE_DECISION.md` (approved). This plan carries execution detail only; where the two differ, the ADR wins.
**Aligned with:** `PROJECT_AUDIT.md` · `BUSINESS_AUDIT.md` §16 · `PRODUCT_BACKLOG.md` (P0-3) · `MVP_SCOPE.md` §2B · `IMPLEMENTATION_ROADMAP.md` · `ARCHITECTURE_REVIEW.md` · `ARCHITECTURE_REVIEW_SPRINT02.md`
**Supersedes:** the previous SPRINT_03_PLAN.md in full.
**Date:** 2026-07-28

> **Change from the ADR — read first.** The approved decisions moved **General
> Attachments out of Sprint 03** (PO Decision 5). The ADR had scoped bill
> attachments as included. This plan reflects the final decision: **no
> `attachments` table, no attachment endpoints, no upload UI in Sprint 03.**
> Consequences are worked through in §5, §15 (Risk H-2) and §18 (effort drops).
> **Payment Reversal is now included** (PO Decision 1), which resolves the ADR's
> Risk H-2 and is designed in full in §11.

---

## 1. Sprint Goal

> Give the business a working payables ledger: capture what each vendor has
> billed us, control it through an approval lifecycle, pay it (in full or in
> parts), correct payment mistakes without destroying the audit trail, and see
> what is owed and when — then connect that spend to jobs as a read-only cost
> variance that never overwrites an existing figure.

## 2. Business Objectives

1. **Close the largest capability gap in the system.** AP scores **5%**
   (`BUSINESS_AUDIT.md` §16): the vendor master has an `apAccount` field and jobs
   hold a cost number, but no vendor-bill document or payable ledger exists at all.
2. **Answer "what do we owe, to whom, and when."** Today that question has no
   answer inside the system — it lives in a spreadsheet or in someone's memory.
3. **Complete the sub-ledger pair.** AR (invoices + credit/debit notes, Sprints
   01/01A) already exists. AP completes it so the books can be closed by export
   until accounting integration (P1-1) lands — the substitution `MVP_SCOPE.md` §3
   explicitly relies on.
4. **Make margin leakage visible.** Expose Estimated / Recorded / Billed /
   Variance per job so the gap between what was quoted, what was recorded and
   what carriers actually billed becomes a number someone can act on.
5. **Satisfy an MVP go-live requirement.** P0-3 is a `MVP_SCOPE.md` §2B blocker:
   "a forwarder that can bill but can't see what it owes is not commercially safe."

## 3. Business Value

| Value | Mechanism | Who feels it |
|---|---|---|
| **Stop paying the same invoice twice** | Unique `(vendorId, vendorInvoiceNo)` — the single most expensive clerical error in AP, prevented structurally | Finance |
| **Cash-flow visibility** | AP aging by due date + per-vendor totals, alongside the existing AR aging | Owner / Finance |
| **Margin control** | Billed-vs-recorded variance per job (Phase B) | Sales / Operations |
| **Consolidated carrier invoices handled natively** | Line-level job allocation — one carrier invoice covering ten shipments is the normal case, not an exception | Operations |
| **Correctable without damage** | Payment reversal keeps a full audit trail instead of forcing database edits | Finance / Audit |
| **Audit readiness** | Every create/approve/void/pay/reverse audit-logged with user, IP, user-agent | Owner / external auditor |

## 4. Included Scope

### Phase A — **AP Core** (must ship)

| # | Deliverable |
|---|---|
| A1 | **Vendor Bill** document — header + line items, SST-aware, multi-currency, server-computed totals |
| A2 | **Lifecycle** DRAFT → APPROVED → PARTIALLY_PAID → PAID, plus **VOID** (state machine enforced) |
| A3 | **Multi-job allocation** — line-level `jobId` overriding an optional header `jobId` (PO Decision 4) |
| A4 | **Bills without a job** — overheads, rent, monthly charges (PO Decision 7) |
| A5 | **Duplicate-bill control** — unique `(vendorId, vendorInvoiceNo)`, DB constraint + in-transaction re-check |
| A6 | **Vendor payments** — partial payments, overpayment prevention, derived status |
| A7 | **Payment reversal** — reverse a vendor payment with audit trail, outstanding recalculation and aging recalculation (PO Decision 1; designed in §11) |
| A8 | **AP Aging report** — buckets by due date + per-vendor totals |
| A9 | **Frontend** — `/payables` list, bill builder, payment dialog, payment reversal, AP aging modal, sidebar entry |
| A10 | **Permissions** — new `payables.read` / `payables.write` scope |

### Phase B — **AP Extended** (ships if Phase A completes on schedule)

| # | Deliverable |
|---|---|
| B1 | **Job cost variance API** — `GET /jobs/:id/cost-variance`, read-only |
| B2 | **Job cost panel** — four independent values: Estimated Cost · Recorded Cost · Vendor Bill Total · Variance (PO Decision 3) |
| B3 | **Honest-labelling rule** — when Recorded Cost still equals the quotation estimate and has never been edited, the UI says so (ADR Fact 1 / Risk H-1) |
| B4 | **Variance context** — bill count, latest bill date, "bills may still be outstanding" until the job is COMPLETED |

**Phase gate:** Phase B is *reporting on top of* Phase A data. If Phase A runs
long, Phase B moves to **Sprint 03B** without leaving anything half-built — the
line-level allocation it reads is stored in Phase A regardless.

## 5. Explicitly Excluded Scope

| Excluded | Authority | Note |
|---|---|---|
| **General Attachments / bill document upload** | **PO Decision 5** | No `attachments` table, no endpoints, no UI. See Risk **H-2** for the consequence and its interim mitigation |
| **Vendor Credit/Debit Notes** | PO Decision 4 | Design settled (ADR §6, separate model); built later |
| **Purchase Orders** | PO Decision 9 | |
| **Three-way matching** | PO Decision 10 | Requires POs *and* receipts |
| **Payment batches / bank files** | PO Decision 11 + Decision 1 exclusion | |
| **Journal reversal, accounting posting** | Decision 1 exclusion + Decisions 13/14 | Reversal is a sub-ledger correction, **not** a contra journal entry |
| **Payment allocation rewrite** | Decision 1 exclusion | A payment belongs to exactly one bill; no on-account/unapplied cash |
| **FX revaluation** | PO Decision 12 | Bill-date rate only |
| **Recoverable SST / input-tax credit** | **PO Decision 2** | No recoverable-tax fields, no tax-credit logic anywhere |
| **Any write to `Job.actualCost`, `Job.profit`, `Job.actualRevenue`, or P&L** | **PO Decision 3** | Regression-tested (§17 AC-12) |
| **`JobDocument` consolidation** | PO Decision 5 | Untouched |
| **Approval matrix** | PO Decision 8 | Any `payables.write` user may approve |

## 6. Architecture Decisions

All binding decisions live in `AP_ARCHITECTURE_DECISION.md`. The ones that
directly shape implementation:

| # | Decision | Implementation consequence |
|---|---|---|
| 1 | **Bills never write `Job.actualCost`** | Billed total is **derived and never stored**; job cost panel shows four independent values |
| 2 | **VOID (not CANCELLED)** | Accounting-correct term for nullifying a posted payable; deliberate deviation from the codebase's `CANCELLED`, documented in ADR §2.2 |
| 3 | **One tax engine** | `computeVendorBillTotals` delegates to `priceInvoiceItem` / `computeInvoiceTotals` — AP tax arithmetic *cannot* drift from AR |
| 4 | **SST is cost** | `taxAmt` is part of what is owed and part of job cost; no recoverable field exists to misuse |
| 5 | **One writer per value** | ADR §4 table; `outstandingOfBill()` is the single owner of AP outstanding from day one (avoids repeating open finding M-10) |
| 6 | **Payment reversal is a soft reversal** | Row preserved and flagged, never deleted (§11) |
| 7 | **List filters on a DTO** | `ListPayablesDto extends PaginationDto` — avoids the 400-bug still open on quotations/invoices/jobs (`TODO.md`) |
| 8 | **Separate permission scope** | `payables.*`, not `invoices.*` — AR clerks do not silently gain payable creation (addresses the shape of open finding M-5) |
| 9 | **Transactional writes with row lock** | approve / pay / reverse / void each `FOR UPDATE` the bill row — the M2 pattern proven in Sprint 02 |

## 7. Database Design

**One additive migration. No existing table is altered destructively — no column
dropped, renamed or retyped.** *(Attachments table removed from the ADR's design
per PO Decision 5.)*

### New enum

`VendorBillStatus` — `DRAFT`, `APPROVED`, `PARTIALLY_PAID`, `PAID`, `VOID`.

### `vendor_bills` (Phase A)

`id` · `billNumber` **UNIQUE** (`BILL-YYYY-####`) · `vendorInvoiceNo` **NOT NULL** ·
`vendorId` **FK→vendors RESTRICT** · `jobId?` **FK→jobs RESTRICT** · `currency` ·
`subtotal` `taxAmt` `totalAmount` Decimal(14,2) · `taxPct` Decimal(7,4) ·
`amountPaid` Decimal(14,2) default 0 · `status` · `billDate` (vendor's invoice
date = SST tax point) · `dueDate?` · `terms?` · `notes?` · `createdById?`
`updatedById?` **FK→users SET NULL** · `createdAt` `updatedAt`

- **UNIQUE `(vendorId, vendorInvoiceNo)`** — duplicate control, scoped per vendor because invoice numbers repeat across vendors.
- `vendorInvoiceNo` is **NOT NULL by design**: PostgreSQL treats NULLs as distinct, so a nullable column would silently allow unlimited blank-numbered duplicates — the control would fail exactly when data quality is worst.
- **Indexes:** `vendorId`, `status`, `dueDate`, `jobId`.

### `vendor_bill_items` (Phase A)

`id` · `billId` **FK→vendor_bills CASCADE** · `description` · `unitPrice`
Decimal(14,4) · `unit?` · `quantity` Decimal(14,4) · `lineCurrency` · `fxRate`
Decimal(14,6) · `amount` Decimal(14,2) · `taxExempt` · `accNo?` ·
**`jobId?` FK→jobs RESTRICT** (line-level allocation) · `sortOrder`

- **Indexes:** `billId`, `jobId` — the second *is* the job-billed-total query path (Phase B).

### `vendor_payments` (Phase A)

`id` · `billId` **FK→vendor_bills RESTRICT** · `amount` Decimal(14,2) · `paidAt` ·
`method?` · `reference?` · `recordedById?` **FK→users RESTRICT** · `createdAt`
**plus reversal columns (§11):** `reversedAt?` · `reversedById?` **FK→users
RESTRICT** · `reversalReason?`

- **Index:** `billId`.
- RESTRICT on both user FKs: who moved — or unwound — money must stay resolvable.

### Non-schema data changes

- `sequences`: one new row `vendorBill` (prefix `BILL`, year-scoped, padding 4).
- Permissions seed: new `payables` group; `payables.read` + `payables.write`
  granted to **Administrator, Manager, Finance**.

### Tables gaining Prisma back-relations only (zero SQL change)

`vendors` · `jobs` · `users`.

## 8. Backend Modules

New module `modules/payables/`, deliberately mirroring `modules/invoices/`:

| File | Phase | Contents |
|---|---|---|
| `vendor-bill.calc.ts` | A | `computeVendorBillTotals()` (delegates to the AR tax engine), `outstandingOfBill()`, `applyVendorPayment()` (reuses `applyPayment`), `recomputeAfterReversal()` |
| `payables.dto.ts` | A | `CreateVendorBillDto`, `UpdateVendorBillDto`, `VendorBillItemDto`, `RecordVendorPaymentDto`, `ReverseVendorPaymentDto`, `ListPayablesDto extends PaginationDto` |
| `payables.service.ts` | A | list · get · create · update (DRAFT only) · approve · void · recordPayment · **reversePayment** · agingReport |
| `payables.service.ts` (cont.) | B | `jobCostVariance(jobId)` · `jobBilledTotals(jobIds[])` (batch groupBy) |
| `payables.controller.ts` | A/B | Routes per §10 |
| `payables.module.ts` | A | Registered in `app.module.ts` |
| `common/state-machine.ts` | A | `VENDOR_BILL_EDGES` + `VENDOR_BILL_REVERSAL_EDGES` + `assertVendorBillStatusTransition` / `assertVendorBillReversal` |

**Reused, not rebuilt:** `PrismaService` · `SequenceService` · `AuditService` ·
`FxService` · `invoice.calc` money functions · guards · global validation pipe ·
pagination helpers. No new infrastructure of any kind; the Sprint 02 storage
layer is untouched (nothing in Sprint 03 stores files).

## 9. Frontend Modules

| File | Phase | Contents |
|---|---|---|
| `app/payables/page.tsx` | A | List: search, status + vendor filter, pagination; **loading / empty / error states**; responsive; actions Edit (DRAFT) · Approve · Record Payment · Void |
| `app/payables/bill-form.tsx` | A | Bill builder modal — vendor picker (adopts currency + terms), line items with per-line job allocation, SST-exempt flag, live SVE-aware totals, guards before save |
| `app/payables/payment-dialog.tsx` | A | Record payment + payment history with **reverse** action and confirmation |
| `app/payables/ap-aging.tsx` | A | Aging modal: buckets + per-vendor totals |
| `components/shell.tsx` | A | Sidebar "Payables" entry under `payables.read` |
| `app/jobs/page.tsx` | B | Job cost panel — four values + honest labelling + variance context |

**Confirmation dialogs** (the M6 pattern from Sprint 02) on Approve, Void and
Reverse Payment — each states the amount and the consequence.

## 10. API Design

All under `/api`, `JwtAuthGuard` + `PermissionsGuard`. **Every route is new — no
existing endpoint is changed, reshaped or removed.**

| # | Ph | Method | URL | Permission | Request | Response | Errors |
|---|---|---|---|---|---|---|---|
| 1 | A | GET | `/payables` | `payables.read` | `ListPayablesDto`: `status? vendorId? jobId? search? page pageSize` | paginated bills | 400, 401, 403 |
| 2 | A | GET | `/payables/aging` | `payables.read` | — | `{rows, buckets, byVendor, totalPayable}` | 401, 403 |
| 3 | A | GET | `/payables/:id` | `payables.read` | — | bill + items + vendor + payments (incl. reversal state) | 401, 403, 404 |
| 4 | A | POST | `/payables` | `payables.write` | `CreateVendorBillDto` | created bill (DRAFT) | 400, 401, 403, 404, **409** dup |
| 5 | A | PATCH | `/payables/:id` | `payables.write` | `UpdateVendorBillDto` | updated bill | 400, 401, 403, 404, 409 |
| 6 | A | POST | `/payables/:id/approve` | `payables.write` | — | APPROVED bill | 400, 401, 403, 404, **409** dup |
| 7 | A | POST | `/payables/:id/void` | `payables.write` | `{reason?}` | VOID bill | 400, 401, 403, 404, **409** payments exist |
| 8 | A | POST | `/payables/:id/payments` | `payables.write` | `{amount, paidAt?, method?, reference?}` | payment + new bill status | **400** non-positive / overpayment / wrong status, 401, 403, 404 |
| 9 | A | POST | `/payables/payments/:id/reverse` | `payables.write` | `{reason}` **required** | reversed payment + recomputed bill | **400** already reversed / illegal, 401, 403, 404 |
| 10 | B | GET | `/jobs/:id/cost-variance` | `jobs.read` | — | `{estimated, recorded, billed, variance, currency, billCount, latestBillDate, recordedIsUnconfirmed, jobStatus}` | 401, 403, 404 |

**Route-order note:** `/payables/aging` and `/payables/payments/:id/reverse` are
declared **before** `/payables/:id` so a literal segment is never captured as an id.

## 11. Payment Reversal Design

*(PO Decision 1 — in scope. Resolves ADR Risk H-2.)*

### 11.1 Model — soft reversal, never deletion

A reversed payment is **preserved and flagged**, not removed:
`reversedAt`, `reversedById`, `reversalReason` on `vendor_payments`.

**Rejected alternatives and why:**
- *Hard delete* — destroys the audit trail; unacceptable for a cash record.
- *Contra-entry (negative payment row)* — the classic GL technique, but PO
  Decision 1 explicitly excludes journal reversal and accounting posting, and
  Decisions 13/14 exclude journals and a GL entirely. Contra-entries also make
  every payment list show phantom rows in a system with no journal to net them.

### 11.2 Outstanding recalculation

```
amountPaid  = Σ vendor_payments.amount  WHERE billId = :id AND reversedAt IS NULL
outstanding = totalAmount − amountPaid          (APPROVED / PARTIALLY_PAID only)
```

`amountPaid` is rewritten **in the same transaction** as the reversal, exactly as
`recordPayment` writes it — the denormalized total never diverges from its rows.

### 11.3 Status re-derivation (backward transitions)

Reversal is the **only** operation that can move a bill backwards:

| amountPaid after reversal | New status |
|---|---|
| `= 0` | **APPROVED** |
| `0 < amountPaid < totalAmount` | **PARTIALLY_PAID** |
| `≥ totalAmount` | **PAID** (unchanged — a partial reversal of an over-covered bill) |

`PAID` is terminal in the forward state machine, so reversal consults a separate,
explicit edge set:

```
VENDOR_BILL_REVERSAL_EDGES:
  PAID            → PARTIALLY_PAID | APPROVED
  PARTIALLY_PAID  → APPROVED | PARTIALLY_PAID
```

Only `reversePayment()` consults it. No generic "set status" endpoint exists, so
backward transitions remain unreachable by any other path — the capability is
created deliberately and confined by construction.

### 11.4 AP aging recalculation

**Aging needs no recalculation step, by design.** It is *derived* from
`totalAmount − amountPaid` at query time; there is no stored aging bucket, no
snapshot table and no batch job. The moment `amountPaid` changes inside the
reversal transaction, the next aging read is already correct. This satisfies the
"AP Aging Recalculation" scope item and is stated explicitly so nobody later
builds a recalculation job that has nothing to recalculate.

### 11.5 Guards

| Rule | Behaviour |
|---|---|
| Reason is **required** | Blank → 400 (cash movement is never unwound anonymously) |
| Payment already reversed | 400, idempotency guard — a payment cannot be reversed twice |
| Bill is VOID | Not reachable: bills with payments cannot be voided (§7 rule). Asserted defensively |
| Concurrency | Whole operation in one `$transaction` with the bill row `SELECT … FOR UPDATE` — two simultaneous reversals cannot both recompute from a stale `amountPaid` |

### 11.6 Audit trail

`AuditService` entry: action `REVERSE_PAYMENT`, entity `vendorPayment`, detail
`{ billId, billNumber, paymentId, amount, reason, previousAmountPaid,
newAmountPaid, previousStatus, newStatus }` — with user, IP and user-agent from
the existing request context. The reversal is visible in the payment history UI
(struck through, with reason, who and when), not only in the audit table.

### 11.7 Explicitly out (Decision 1 exclusions)

No payment batch · no journal reversal · no accounting posting · no payment
allocation rewrite. Reversal corrects **one payment on one bill** and nothing else.

## 12. Validation Rules

**Bill header**

| Field | Rule |
|---|---|
| `vendorId` | Required; must exist; must not be soft-deleted |
| `vendorInvoiceNo` | Required, non-empty; unique per vendor (DB + in-transaction re-check) |
| `billDate` | Required; defaults today; the SST tax point |
| `dueDate` | Optional; best-effort from `Vendor.paymentTerm`, **null when unparseable** (never guessed) |
| `currency` | Required; defaults from vendor, else `MYR` |
| `taxPct` | ≥ 0 |
| `jobId` | Optional; must exist and not be soft-deleted |
| `items` | **`@ArrayMinSize(1)`** on create **and** update (the M4 lesson applied from day one) |
| totals | **Never accepted from the client** — always recomputed server-side |

**Bill line:** `description` required non-empty · `unitPrice` ≥ 0 ·
`quantity` > 0 · `fxRate` > 0 (default 1) · `taxExempt` boolean ·
`jobId?` must exist when supplied.

**Editability:** DRAFT only. APPROVED and later are immutable — correction is
VOID + re-entry in Sprint 03.

**Payment:** `amount` > 0 · `amount ≤ outstanding` · bill must be
APPROVED or PARTIALLY_PAID.

**Reversal:** `reason` required non-empty · payment not already reversed.

**Cross-cutting:** global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`)
— list filters therefore **must** be DTO fields (§6 decision 7).

## 13. Security Considerations

| Area | Control |
|---|---|
| **Authorization** | `payables.read` / `payables.write` on every route; deliberately separate from `invoices.*` so AR clerks gain no payable rights |
| **Segregation note** | Any `payables.write` user may approve *and* pay *and* reverse (PO Decision 8 — no approval matrix). Acceptable for an owner-operated forwarder; flagged as Risk M-4 for when non-owner finance staff are onboarded |
| **Duplicate invoice** | DB unique constraint **plus** in-transaction re-check at create and approve — the constraint wins the race, the check produces the friendly 409 |
| **Overpayment** | Server-side only, via the Sprint-01A-hardened `applyPayment`; client-supplied totals or statuses are never trusted |
| **Reversal abuse** | Requires `payables.write`, a mandatory reason, is idempotent, and is fully audit-logged with before/after amounts and statuses |
| **Audit logging** | create · update · approve · void · payment · **reverse**, each with user, IP, user-agent |
| **Currency integrity** | One currency per bill; per-line `fxRate` into the bill currency; base-currency aggregation only through `FxService` at bill date. *(Direct application of Sprint 01A's H4.)* |
| **Data integrity** | RESTRICT on every financial FK; CASCADE only for component lines; state machine on every transition; row-locked transactions for approve/pay/reverse/void |
| **No new attack surface** | No file upload, no new storage code, no new external dependency in Sprint 03 |

## 14. Performance Considerations

| Concern | Design |
|---|---|
| Payable outstanding on every read | Avoided — `amountPaid` is denormalized and written in-transaction (same pattern as `Invoice.amountPaid`) |
| AP aging | One indexed query over APPROVED/PARTIALLY_PAID bills + one `groupBy` for per-vendor totals. Mirrors AR aging; fine at SME volume (Risk L-3 notes the shared ceiling) |
| **Job billed totals (Phase B)** | **Never per-row queries.** A job list uses a single `groupBy` over `vendor_bill_items` filtered by `jobId IN (…)`; the job detail panel uses one aggregate. The `vendor_bill_items(jobId)` index exists for exactly this |
| Bill list | Paginated, indexed on `vendorId` / `status` / `dueDate`; search bounded to bill number, vendor invoice number and vendor name |
| Payment history | Bounded by bill; index on `billId` |
| FX conversion | In-memory via the existing `FxService` cache; no per-row rate lookups |
| Transactions | Short and single-row-scoped; the `FOR UPDATE` lock is held only for the guard-check + write |

## 15. Risks

### HIGH

**H-1 — Recorded Cost will look wrong before it looks right (Phase B)**
- **Description:** `Job.actualCost` is seeded from the quotation estimate at
  conversion (ADR Fact 1), so most jobs will show *Recorded ≈ Estimated* while
  *Billed* differs. Users will read the variance as a system error.
- **Impact:** Loss of trust in AP's first report; pressure to "just auto-update
  it" — i.e. to reverse PO Decision 3 under duress.
- **Recommendation:** Deliverable **B3** is mandatory, not cosmetic — when
  Recorded Cost still equals the estimate and has never been edited, label it
  *"from quotation, not yet confirmed."* Schedule job cost detail lines
  (ADR §5.6) as the next AP increment so the fix is a planned migration.

**H-2 — Vendor bills carry no evidence in Sprint 03 (new — from PO Decision 5)**
- **Description:** Attachments are deferred, so an approved payable has no
  attached carrier invoice inside the system.
- **Impact:** A payable is an assertion until someone finds the PDF elsewhere;
  weakens audit readiness and dispute handling — the very control AP capture is
  meant to provide.
- **Recommendation:** Accepted PO decision, with two interim mitigations to state
  in training: (a) **for job-linked bills the carrier invoice can already be
  uploaded today** as a Job Document (existing feature, unchanged); (b) the
  mandatory `vendorInvoiceNo` remains the primary duplicate control and the key
  for locating the paper. Prioritise the attachments sprint immediately after
  Sprint 03 — and note that its value depends on the R2 cutover (Risk M-3).

### MEDIUM

**M-1 — Scope pressure from the excluded list**
- **Description:** POs, matching, batches and approval matrices are all natural "while we're here" additions; Phase A + B is ~4 dw with little slack.
- **Impact:** A half-built control is worse than none — it implies protection that does not exist.
- **Recommendation:** Treat §5 as a contract. If something becomes mandatory, ship Phase A and move Phase B to Sprint 03B rather than compressing quality.

**M-2 — Multi-currency AP drifts between bill and payment**
- **Description:** Bill-date FX with no revaluation (PO Decision 12).
- **Impact:** Base-currency payables drift from reality; unrecognised FX gain/loss.
- **Recommendation:** Accept for MVP; display the rate basis on every converted figure; schedule FX gain/loss with accounting integration (P1-1).

**M-3 — Production R2 credentials are still not set**
- **Description:** Open item in `TODO.md`. Sprint 03 adds no attachments, so AP itself is unaffected — but existing **job documents** remain at risk, and the deferred attachments sprint cannot safely ship until the cutover is done.
- **Impact:** Document loss on redeploy for existing job documents; a blocked follow-up sprint.
- **Recommendation:** Complete the cutover (`STORAGE.md` §3) during Sprint 03 — it is configuration, not development.

**M-4 — No segregation of duties on payables**
- **Description:** One permission (`payables.write`) covers create, approve, pay and reverse (PO Decision 8).
- **Impact:** The classic AP fraud shape — the same person can invent a vendor bill and pay it.
- **Recommendation:** Acceptable while the owner is the approver. Before onboarding non-owner finance staff, split `payables.approve` / `payables.pay` — cheap, since the permission system already exists.

**M-5 — Variance excludes bills that have not arrived (Phase B)**
- **Description:** Carrier invoices routinely arrive weeks after delivery, so Billed is structurally incomplete early in a job's life.
- **Impact:** Negative variance misread as over-recording; premature profit reads.
- **Recommendation:** Deliverable **B4** — show bill count, latest bill date, and "bills may still be outstanding" until the job is COMPLETED.

### LOW

**L-1 — `VOID` vs `CANCELLED` naming** — deliberate and documented (ADR §2.2); risk is only that a future reviewer files it as an inconsistency.
**L-2 — AP imports pure money functions from the AR module** — precedent exists (`credit-debit-note.calc.ts`); the clean fix is a later `common/money.calc.ts` promotion, deliberately not done during an AP sprint.
**L-3 — Aging loads open bills into memory** — mirrors the existing AR pattern; revisit both together.
**L-4 — `dueDate` parsed from free-text `Vendor.paymentTerm`** — best-effort; null when unparseable rather than guessed.
**L-5 — No vendor statement reconciliation** — monthly vendor statements are matched manually until a later sprint.

## 16. Testing Strategy

**Unit — pure logic (no DB)**
- Tax parity: a vendor bill's totals equal the AR engine's for identical lines (guarantees the single-engine claim).
- SVE exclusion; per-line FX conversion; zero-tax bills.
- `outstandingOfBill` across every status.
- `applyVendorPayment`: partial, exact settlement to the cent (float tolerance), overpayment rejection, non-positive rejection.
- Reversal recomputation: full reversal → APPROVED; partial reversal → PARTIALLY_PAID; reversal of one of several payments; already-reversed rejection.
- State machine: every allowed forward edge, every forbidden edge, and the reversal edge set — including that `PAID → PARTIALLY_PAID` is reachable **only** through the reversal assertion.

**Service level — stubbed Prisma (the pattern established in Sprints 01A/02)**
- Duplicate `(vendorId, vendorInvoiceNo)` → 409 on create and on approve.
- Void guards: DRAFT ok · APPROVED with no payments ok · with payments → 409.
- Editability: PATCH on a non-DRAFT bill → 400.
- Payment on a DRAFT or VOID bill → 400.
- Reversal: recomputes `amountPaid` and re-derives status; writes an audit entry; requires a reason.
- **Concurrency:** two simultaneous payments, and two simultaneous reversals, against one bill — serialized by the row lock so totals cannot diverge (mirrors the Sprint 02 M2 test, which was also verified live).
- Aging: buckets by due date, per-vendor totals, reversed payments correctly excluded, DRAFT/VOID bills excluded.
- Variance (Phase B): header vs line allocation precedence; multi-job split; FX conversion; "no bills" ≠ zero.

**Regression — the critical one**
- A full AP cycle (create → approve → pay → reverse → void) leaves
  `Job.actualCost`, `Job.profit`, `Job.actualRevenue`, the P&L output and every
  AR figure **numerically identical**. This is the test that protects PO
  Decision 3 and prevents a repeat of Sprint 01A's H1/H2 class of defect.

**Frontend** — existing vitest suite kept green; loading/empty/error states present on every new page.

**Live verification (with test data removed afterwards, as in Sprints 01/01A/02)**
create bill → duplicate rejected (409) → approve → partial payment → aging shows
the remainder → reverse the payment → aging returns to the full amount and the
status returns to APPROVED → settle in full → PAID → void attempt blocked (409) →
Phase B: variance panel shows four values on a two-job consolidated bill.

## 17. Acceptance Criteria

| # | Criterion | Ph |
|---|---|---|
| AC-1 | A vendor bill can be created (DRAFT) with lines in a foreign currency and correct SST-aware totals; totals recomputed server-side and never trusted from the client | A |
| AC-2 | A second bill with the same `vendorInvoiceNo` for the same vendor is rejected with **409**; the same number for a *different* vendor is accepted | A |
| AC-3 | A bill with no job, and a bill whose lines are split across two jobs, can both be saved and approved | A |
| AC-4 | Approve moves DRAFT → APPROVED and the bill appears in AP aging in the correct due-date bucket with correct per-vendor totals | A |
| AC-5 | Editing a non-DRAFT bill is rejected (400); DRAFT edits replace lines transactionally | A |
| AC-6 | A partial payment sets PARTIALLY_PAID; settling the balance sets PAID; overpayment and non-positive amounts are rejected (400) | A |
| AC-7 | **Reversing a payment** restores `amountPaid`, re-derives the status (PAID → PARTIALLY_PAID → APPROVED as applicable), removes the effect from AP aging immediately, and preserves the payment row flagged with reason, user and timestamp | A |
| AC-8 | Reversing an already-reversed payment is rejected (400); reversal without a reason is rejected (400) | A |
| AC-9 | Voiding a DRAFT succeeds; voiding an APPROVED bill with no payments succeeds; voiding a bill with payments is rejected with **409** — and the message is actionable because reversal exists | A |
| AC-10 | Every write is audit-logged with user, IP and user-agent; reversal logs before/after amounts and statuses | A |
| AC-11 | All new routes enforce `payables.read` / `payables.write`; a user without them receives 403 | A |
| AC-12 | **A full AP cycle leaves `Job.actualCost`, `Job.profit`, `Job.actualRevenue`, P&L and all AR figures numerically unchanged** (regression-tested) | A |
| AC-13 | Job cost panel shows four independent values — Estimated · Recorded · Vendor Bill Total · Variance — in the job's currency, with the FX basis stated | B |
| AC-14 | When Recorded Cost still equals the quotation estimate and has never been edited, the UI labels it as unconfirmed; a job with no bills shows "no bills yet", **not** a 0.00 variance | B |
| AC-15 | A consolidated bill split across two jobs contributes the correct billed amount to **each** job's variance | B |
| AC-16 | All pages have loading / empty / error states and are responsive | A/B |
| AC-17 | Full suite green (153 existing + new; target ≥ 195), backend + frontend typecheck, both production builds, one migration applying cleanly | A/B |
| AC-18 | Live verification performed and **all test data removed**, sequences reset | A/B |
| AC-19 | `SPRINT_03_REPORT.md`, `CHANGELOG.md`, `TODO.md`, `PRODUCT_BACKLOG.md` (P0-3 marked done) updated | A/B |

## 18. Estimated Development Time

2-week sprint, ~1.5 effective devs (dev-weeks = dw), per `IMPLEMENTATION_ROADMAP.md`.

### Phase A — AP Core

| Work | dw |
|---|---|
| Schema + migration + sequence + permissions seed | 0.4 |
| Backend: calc, service (CRUD/approve/void/payments/**reversal**), state machine, DTOs, controller | 1.3 |
| Frontend: payables list, bill builder, payment dialog + reversal, AP aging, nav | 1.0 |
| Tests (unit + service + concurrency + AR/P&L regression) | 0.4 |
| **Phase A subtotal** | **≈ 3.1 dw** |

### Phase B — AP Extended

| Work | dw |
|---|---|
| Variance service + batch `groupBy` + endpoint | 0.3 |
| Job cost panel UI (four values, honest labelling, context) | 0.35 |
| Tests (allocation precedence, FX, no-bills case) | 0.15 |
| **Phase B subtotal** | **≈ 0.8 dw** |

### Total

| | dw |
|---|---|
| Phase A + Phase B | **≈ 3.9 dw** |
| Docs, live verification, cleanup, report | 0.25 |
| **Sprint total** | **≈ 4.15 dw** |

**Read on the estimate.** Deferring attachments (PO Decision 5) removed ~0.75 dw;
adding payment reversal (PO Decision 1) added ~0.3 dw. Net, the sprint is
**smaller than the ADR's ~4.5 dw** and now fits a 2-week sprint with a thin
margin. **Phase A is the commitment; Phase B is the stretch.** If Phase A
overruns, Phase B moves to Sprint 03B with nothing left half-built.

## 19. Rollback Plan

**Why rollback is clean:** the migration is purely additive and no existing table,
column, endpoint or service behaviour is modified. AP is a **leaf module** —
nothing existing depends on it.

| Layer | Rollback action | Risk |
|---|---|---|
| **Code** | Revert the Sprint 03 commit(s); `payables.module` unregisters from `app.module`; no other module imports it | None |
| **Frontend** | Reverted with the same commit; the sidebar entry disappears | None |
| **Database** | Drop `vendor_payments`, `vendor_bill_items`, `vendor_bills` (in that order — FK-safe) and the `VendorBillStatus` enum; delete the `vendorBill` sequence row; revert the permission seed | **Destroys any bills already entered** |
| **Existing data** | Untouched throughout — invoices, notes, jobs, customers, vendors and documents are byte-identical before and after | None |

**Soft-disable (preferred over rollback once live):** revoke `payables.read` /
`payables.write` from every role. The UI entry disappears and all routes return
403 — data is preserved and the feature can be re-enabled instantly. This is the
recommended first response to any post-release problem; a database rollback is a
last resort and only safe **before first production use**.

**Migration reversibility:** a `down` path is written and tested locally
(drop-order documented above) before the migration is applied to production.

## 20. Files Expected To Change

**Backend — new**
`src/modules/payables/vendor-bill.calc.ts` · `payables.dto.ts` ·
`payables.service.ts` · `payables.controller.ts` · `payables.module.ts` ·
`vendor-bill.calc.spec.ts` · `payables.service.spec.ts` ·
`prisma/migrations/<timestamp>_accounts_payable/migration.sql`

**Backend — modified**
`prisma/schema.prisma` (3 new models + 1 enum + back-relations) ·
`prisma/seed.ts` (sequence row, `payables` permission group, role matrix) ·
`src/app.module.ts` (register module) ·
`src/common/state-machine.ts` (vendor-bill forward + reversal edges) ·
`src/common/state-machine.spec.ts` (extend) ·
`src/modules/jobs/jobs.controller.ts` + `jobs.service.ts` (**Phase B, read-only**
cost-variance query — no write-path change)

**Frontend — new**
`src/app/payables/page.tsx` · `bill-form.tsx` · `payment-dialog.tsx` · `ap-aging.tsx`

**Frontend — modified**
`src/components/shell.tsx` (nav) · `src/app/jobs/page.tsx` (**Phase B** cost panel)

**Docs (at completion)**
`SPRINT_03_REPORT.md` (new) · `CHANGELOG.md` · `TODO.md` · `PRODUCT_BACKLOG.md`

**Explicitly NOT touched:** invoices · credit/debit notes · quotations ·
customers · vendors master · `JobDocument` · the storage driver layer · P&L ·
`invoice.calc.ts` (imported, never edited).

---

*No implementation code has been written and no source file has been modified.
Awaiting Product Owner approval of this plan before Sprint 03 implementation begins.*
