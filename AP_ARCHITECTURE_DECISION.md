# AP ARCHITECTURE DECISION RECORD

**Status:** PROPOSED — awaiting Product Owner approval. **No code written, no migration created.**
**Roles:** Enterprise ERP Solution Architect · Principal Software Engineer · Senior Product Owner · Enterprise Data Architect · Financial Systems Architect
**Purpose:** Finalize every architectural decision required before Sprint 03 (Accounts Payable) implementation begins.
**Sources read:** `PROJECT_AUDIT.md` · `BUSINESS_AUDIT.md` §16 · `PRODUCT_BACKLOG.md` · `MVP_SCOPE.md` · `IMPLEMENTATION_ROADMAP.md` · `ARCHITECTURE_REVIEW.md` · `ARCHITECTURE_REVIEW_SPRINT02.md` · `SPRINT_03_PLAN.md` · `STORAGE.md` · `TODO.md` · `CHANGELOG.md` — plus the live schema and services being mirrored.
**Date:** 2026-07-28

> **Ratified business decisions.** All 15 Product Owner decisions are adopted verbatim and are treated as binding throughout this document. Where this record adds detail, it refines *how* to honour them — never *whether*.

---

## 0. Two facts discovered while finalizing this design

Both materially shape the decisions below and were not visible in any prior document.

**Fact 1 — `Job.actualCost` is seeded with the *estimate*.** On quotation→job
conversion (`quotations.service.ts`), the job is created with
`actualCost: quote.totalCost`. So a job's "actual cost" is really *"the
quoted estimate unless an operator has since edited it."* The field's name has
been describing an intention, not a fact. This is the strongest possible
argument for ratified Decision 3 (bills must not overwrite it) — but it also
means "Estimated Cost" and "Actual Cost" are, for untouched jobs, **the same
number from the same source**, and the variance view must say so honestly
rather than implying two independent measurements.

**Fact 2 — there is no payment-reversal endpoint anywhere in the system.**
`invoices.service.cancel()` refuses to cancel an invoice with payments and
tells the user to "reverse the payments first", but no API can do that:
`InvoicePayment` rows are write-only (`POST /invoices/:id/payments` is the sole
payment route). The instruction is a dead end today. AP must not silently
inherit that dead end (see §3 Void rules and §12 Risk H-2).

---

# 1. AP Business Scope

## 1.1 Included in Sprint 03

| # | Capability | Why it is in |
|---|---|---|
| 1 | **Vendor Bill capture** — header + line items, SST-aware, multi-currency, server-computed totals | The core missing object; AP scores 5% today (`BUSINESS_AUDIT.md` §16) purely because this does not exist |
| 2 | **Multi-job allocation** — line-level `jobId` overriding an optional header `jobId` | Ratified Decision 4. A carrier's consolidated invoice covering ten shipments is the normal case in forwarding, not an edge case |
| 3 | **Bill without a job** | Ratified Decision 7 — office rent, monthly line charges, annual licences |
| 4 | **Lifecycle** DRAFT → APPROVED → PARTIALLY_PAID → PAID, plus VOID | Control over what has been accepted as owed; APPROVED is the posting event that makes a bill a payable |
| 5 | **Vendor payments** — partial payments, overpayment prevention, derived status | Without payments a payable ledger cannot tell you what is still owed |
| 6 | **AP Aging report** — buckets by due date, per-vendor totals | The report the business actually asks for: "what do we owe, and when" |
| 7 | **Duplicate-bill control** — unique `(vendorId, vendorInvoiceNo)` | Ratified Decision 5. Paying the same carrier invoice twice is the single most expensive clerical error in AP |
| 8 | **Bill attachments** — the scanned vendor invoice, via the new `attachments` table | The evidence *is* the point of AP capture; an unevidenced payable is an assertion |
| 9 | **Job cost variance view** — Estimated / Actual / Billed / Variance, read-only | Ratified Decision 3, and the deliverable that turns AP from bookkeeping into margin control |

## 1.2 Excluded from Sprint 03 (ratified — not to be built)

Purchase Orders (Decision 9) · Three-way matching (Decision 10) · Payment batches
and bank files (Decision 11) · FX revaluation (Decision 12) · Accounting journals
(Decision 13) · General Ledger (Decision 14) · Approval matrix / multi-level
approval (Decision 8).

**Reasoning.** Every one of these presupposes something that does not exist yet.
Three-way matching needs Purchase Orders *and* goods receipts; a payment batch
needs a bank integration and an approval matrix to be meaningful; journals and a
GL are explicitly replaced at MVP scale by the AR/AP sub-ledger pair plus export
(`MVP_SCOPE.md` §3). Building any of them now buys capability the target
segment — a 1–20 user forwarder — cannot yet operate.

## 1.3 Deferred (design settled here, built later)

| Item | Settled decision | Trigger to build |
|---|---|---|
| **Vendor credit/debit notes** | Separate model (Decision 1, designed in §6) | First real vendor credit dispute, or the accounting-integration sprint |
| **`JobDocument` consolidation into `attachments`** | Not migrated in Sprint 03 (Decision 2, §7) | When a **third** module needs attachments (Booking) |
| **Job cost detail lines** | Designed in §5.6; bills become the source of truth only then | A deliberate sprint after bills are the habitual entry point |
| **Payment reversal / void payment** | Designed in §3.6 | See Risk H-2 — recommended as a small Sprint 03 inclusion |

## 1.4 Future Sprint (sequenced, not designed here)

P1-1 Accounting integration (consumes AP + AR) · P0-4 Booking · P0-7 Credit-limit
enforcement · P0-8 AR automation + SOA · P1-2 Customer Portal · Supplier Portal
(P2) · Purchase Orders (P1) · Multi-company / multi-tenant (epic, §11).

---

# 2. Vendor Bill Domain Model

## 2.1 Conceptual definition

> A **Vendor Bill** is our record of a *specific invoice issued to us by a
> specific vendor*. It is evidence-backed (attachment), uniquely identified by
> the vendor's own invoice number, and once **APPROVED** it is a legal payable
> that appears in AP aging.

A bill is **not** a cost allocation instrument. It *may* be allocated to jobs for
reporting, but its truth is "vendor X billed us Y on date Z".

## 2.2 Lifecycle

```
                    ┌──────────────────────────────┐
                    ▼                              │
   ┌─────────┐  approve   ┌──────────┐  payment (partial)   ┌─────────────────┐
   │  DRAFT  │──────────▶ │ APPROVED │ ───────────────────▶ │ PARTIALLY_PAID  │
   └────┬────┘            └────┬─────┘                      └────────┬────────┘
        │                      │  payment (full)                     │ payment (final)
        │ void                 │                                     │
        │                      ▼                                     ▼
        │                 ┌────────┐                            ┌────────┐
        │                 │  PAID  │ ◀──────────────────────────│  PAID  │
        │                 └────────┘                            └────────┘
        ▼
   ┌────────┐   ◀── void (only while no payment exists)
   │  VOID  │   ◀────────────── APPROVED
   └────────┘
```

**Naming note (deliberate deviation).** Every other document in this system uses
`CANCELLED` (invoices, quotations, jobs, credit/debit notes). AP uses **`VOID`**
per the Product Owner's specification. This is accepted rather than "corrected"
because it is accounting-correct: *cancelling* describes abandoning an unposted
draft, *voiding* describes nullifying a document that was posted. Both meanings
apply here through a single state, and `VOID` is the term an auditor expects on
a payable. The deviation is documented so no future reviewer files it as an
inconsistency bug.

## 2.3 Allowed transitions (authoritative)

| From | To | Guard |
|---|---|---|
| DRAFT | APPROVED | ≥1 line; totals recomputed server-side; duplicate `(vendorId, vendorInvoiceNo)` re-checked inside the transaction |
| DRAFT | VOID | Always allowed |
| APPROVED | PARTIALLY_PAID | Payment recorded, `amountPaid < totalAmount` |
| APPROVED | PAID | Payment recorded, `amountPaid ≥ totalAmount` |
| APPROVED | VOID | **Only when `amountPaid = 0`** |
| PARTIALLY_PAID | PAID | Final payment settles the balance |
| PARTIALLY_PAID | VOID | **Blocked (409)** — payments exist |
| PAID | VOID | **Blocked (409)** — payments exist |
| PAID / VOID | anything | **Terminal** |

Implemented as `VENDOR_BILL_EDGES` + `assertVendorBillStatusTransition` in the
existing `common/state-machine.ts`, following the established pattern
(`QUOTATION_EDGES`, `INVOICE_EDGES`, `ADJUSTMENT_EDGES`). Illegal transitions
throw `BadRequestException` (400), consistent with existing behaviour.

## 2.4 Validation rules

**Header**
| Field | Rule |
|---|---|
| `vendorId` | Required, must exist, must not be soft-deleted |
| `vendorInvoiceNo` | **Required, non-empty.** Must be unique per vendor (§2.5) |
| `billDate` | Required; defaults to today; the vendor's invoice date and the SST tax point |
| `dueDate` | Optional; defaults from `Vendor.paymentTerm` when parseable, else null |
| `currency` | Required; defaults from `Vendor.currency`, else `MYR` |
| `taxPct` | ≥ 0; defaults 0 |
| `jobId` | Optional; when present must exist and not be soft-deleted |
| `items` | **≥ 1 line** (`@ArrayMinSize(1)` — the M4 lesson from Sprint 02, applied from day one) |
| totals | **Never accepted from the client** — always recomputed server-side |

**Line**
| Field | Rule |
|---|---|
| `description` | Required, non-empty |
| `unitPrice` | Number ≥ 0 |
| `quantity` | Number > 0 |
| `fxRate` | > 0, default 1 (lineCurrency → bill currency) |
| `taxExempt` | Boolean, default false (SVE vs SV — same semantics as AR) |
| `jobId` | Optional; when present overrides the header allocation for that line |

**Editability:** a bill is editable **only in DRAFT**. APPROVED and later are
immutable documents; corrections are made by VOID + re-entry (Sprint 03) or, in
future, by a vendor credit note (§6).

## 2.5 Business rules

1. **Duplicate control (Decision 5).** `(vendorId, vendorInvoiceNo)` is unique —
   *not* globally unique, because two different carriers legitimately both issue
   "INV-001". Enforced by a database unique constraint **and** re-checked inside
   the approve transaction. The column is **NOT NULL by design**: PostgreSQL
   treats NULLs as distinct, so a nullable column would silently permit unlimited
   duplicate blank-numbered bills — defeating the control precisely when data
   quality is worst.
2. **SST is a cost (Decision 6).** Tax on a vendor bill is *not* recoverable
   input tax; it is part of what we owe and part of job cost. Consequence: there
   is no input-tax account, no tax-recovery report, and `taxAmt` on a bill is
   never netted against AR output tax anywhere.
3. **Tax base mirrors AR exactly.** `taxExempt` lines (SVE 0%, e.g. ocean
   freight) are excluded from the tax base; the same single tax engine computes
   both sides (§4, `computeInvoiceTotals`). AP tax arithmetic can never drift
   from AR tax arithmetic because there is only one implementation.
4. **Only APPROVED-or-later bills are financially real.** DRAFT and VOID bills
   are invisible to AP aging, to vendor payable totals, and to job billed cost.
   This mirrors the Sprint 01A rule that only *ISSUED* credit notes affect AR.
5. **Allocation is reporting, not accounting.** Splitting a bill across jobs
   changes what each job's variance view shows; it never changes the amount owed
   to the vendor, which is always the bill total.
6. **Unallocated lines are permitted and visible.** A line with no `jobId` (and
   no header `jobId`) counts toward the payable and toward "unallocated overhead"
   — never silently toward some default job.
7. **Currency integrity (Decision 12).** A bill is denominated in one currency.
   Lines may be entered in another currency with a per-line `fxRate` into the
   bill currency (identical to `InvoiceItem`). Conversion *into base currency*
   for job/P&L views uses `FxService` at **bill date**; no revaluation ever runs.

---

# 3. Payment Model

## 3.1 Vendor Payment

`vendor_payments` mirrors the proven `invoice_payments` shape one-for-one:
`billId` (FK **Restrict**), `amount`, `paidAt`, `method`, `reference`,
`recordedById` (FK **Restrict** — who paid money must stay resolvable), `createdAt`.

**Restrict, not Cascade, is deliberate:** a bill with payments is a cash record
and must never be deletable out from under its payments.

## 3.2 Partial payment

Recording a payment for less than the outstanding balance moves
APPROVED → PARTIALLY_PAID. Any number of partial payments is allowed. Status is
**derived from the arithmetic**, never set by the client.

## 3.3 Overpayment prevention

Reuses the AR algorithm `applyPayment(totalAmount, amountPaid, paymentAmount, noteNet = 0)`
from `invoices/invoice.calc.ts` — the same function Sprint 01A hardened.

- Non-positive amount → `NonPositivePaymentError` → **400**
- `paymentAmount > remaining` → `OverpaymentError` → **400**
- `noteNet` is passed **0** in Sprint 03 (no vendor credit notes exist). The
  parameter already exists, so vendor credit notes plug in later with **no
  signature change** — §6's design is pre-wired.

**Reuse precedent:** `credit-debit-note.calc.ts` already imports
`priceInvoiceItem` / `computeInvoiceTotals` from `invoices/invoice.calc`. AP
follows the identical pattern. *(Recommended future cleanup, not Sprint 03:
promote these pure money functions to `common/money.calc.ts` so AP does not
import from the AR module — a rename-only refactor, deferred to avoid touching
AR during an AP sprint.)*

## 3.4 Outstanding calculation

> **Outstanding(bill) = totalAmount − amountPaid**
> counted only when `status ∈ {APPROVED, PARTIALLY_PAID}`.

- `amountPaid` is a **denormalized running total**, written in the *same
  transaction* as the `vendor_payments` row — exactly as `Invoice.amountPaid` is.
- **Vendor payable** = Σ Outstanding(bill) for that vendor.
- **Total payables** = Σ Outstanding over all APPROVED/PARTIALLY_PAID bills.
- Rows with `Outstanding ≤ 0.005` drop off aging (the float-tolerance rule
  already used by AR aging).
- Exactly **one** function owns this formula (`outstandingOfBill`), consumed by
  aging, the list screen and the payment guard — the M-10 lesson applied from
  day one rather than retrofitted.

## 3.5 Payment allocation

**Sprint 03: a payment belongs to exactly one bill** (`billId` is required and
non-null). No cross-bill or on-account allocation.

Rationale: allocation across bills requires an unapplied-cash concept
(a vendor advance/credit balance), which is the AP twin of the customer
credit-balance ledger already deferred to P0-8. Introducing half of it here
would create the same "two sources of truth" trap this document exists to avoid.

## 3.6 Void rules

| Action | Sprint 03 behaviour |
|---|---|
| VOID a DRAFT bill | Allowed |
| VOID an APPROVED bill, `amountPaid = 0` | Allowed |
| VOID a bill with any payment | **Blocked — 409 Conflict**, message names the payments |
| Delete/reverse an individual payment | **See Risk H-2 — recommended addition** |

The block mirrors `invoices.service.cancel()` and directly applies the Sprint 01A
H3 lesson (never allow a document to be voided out from under dependent financial
records). **But** Fact 2 (§0) means that, exactly as in AR, the 409's advice
("reverse the payments first") would be un-actionable. Two honest options:

- **Recommended:** include a minimal `POST /payables/payments/:id/void` in
  Sprint 03 — reverses the row, recomputes `amountPaid`, re-derives status,
  audit-logged, permission `payables.write`. ~0.25 dw. Makes the 409 truthful.
- **Alternative:** accept the same dead end AR has, and fix both together in a
  later "payment corrections" sprint. Consistent, but knowingly ships a message
  the system cannot honour.

## 3.7 Future payment-batch compatibility

A future batch feature adds `vendor_payment_batches` (batch header: reference,
payment date, bank account, status) and a **nullable `batchId`** on
`vendor_payments`. Both are purely additive; nothing designed here blocks it, and
**no speculative `batchId` column is added now** — `PROJECT_AUDIT.md` §6
specifically criticised write-only speculative fields, and this design does not
repeat that.

---

# 4. Source of Truth

**Governing principle: every financial value has exactly one writer. Everything
else derives from it, and no consumer re-implements a formula.**

| # | Financial value | Single owner (writer) | Stored / derived | Formula | AP effect |
|---|---|---|---|---|---|
| 1 | **Invoice Total** | `computeInvoiceTotals()` (server) | Stored `invoices.totalAmount` | Σ lines + tax on non-exempt base | none |
| 2 | **Credit Note Total** | `computeNoteTotals()` | Stored `credit_debit_notes.totalAmount` (type=CREDIT) | same engine | none |
| 3 | **Debit Note Total** | `computeNoteTotals()` | Stored, type=DEBIT | same engine | none |
| 4 | **AR Payment Total (per invoice)** | `InvoicesService.recordPayment()` | Stored `invoices.amountPaid` | Σ `invoice_payments.amount`, written in-transaction | none |
| 5 | **Customer Receivable (per invoice)** | `issuedNoteNet()` + the AR balance formula | **Derived** | `totalAmount − amountPaid + noteNet` (CREDIT −, DEBIT +; ISSUED only) | none |
| 6 | **Customer Receivable (aggregate)** | `InvoicesService.agingReport()` | Derived | Σ of #5 over ISSUED/PARTIALLY_PAID | none |
| 7 | **Vendor Bill Total** | `computeVendorBillTotals()` (server, same tax engine) | Stored `vendor_bills.totalAmount` | Σ lines + tax on non-exempt base | **new** |
| 8 | **AP Payment Total (per bill)** | `PayablesService.recordPayment()` | Stored `vendor_bills.amountPaid` | Σ `vendor_payments.amount`, in-transaction | **new** |
| 9 | **Vendor Payable (per bill) = Outstanding** | `outstandingOfBill()` | **Derived** | `totalAmount − amountPaid`, APPROVED/PARTIALLY_PAID only | **new** |
| 10 | **Vendor Payable (per vendor / aggregate)** | `PayablesService.agingReport()` | Derived | Σ of #9 | **new** |
| 11 | **Job Estimated Cost** | `Quotation.totalCost` (via the job's linked quotation) | Derived (read through the link) | quote's costed total | read-only |
| 12 | **Job Actual Cost** | **Operations, by hand** — `jobs.service.update()` | Stored `jobs.actualCost` | manual; *seeded from #11 at conversion* (Fact 1) | **never written by AP (Decision 3)** |
| 13 | **Job Vendor Bill Total (Billed)** | `PayablesService.jobBilledTotal()` | **Derived, never stored** | Σ allocated line `amount` (+ proportional tax) of APPROVED/PARTIALLY_PAID/PAID bills, FX-converted at bill date | **new** |
| 14 | **Job Cost Variance** | `PayablesService.jobCostVariance()` | Derived | `#13 − #12` (see §5.4) | **new** |
| 15 | **Job Actual Revenue** | `jobs.service` / quotation conversion | Stored `jobs.actualRevenue` | manual / from quote, tax-excluded | none |
| 16 | **Job Profit** | `jobs.service` | Stored `jobs.profit` | `actualRevenue − actualCost` (#15 − #12) | **unchanged in Sprint 03** |
| 17 | **P&L cost** | `PnlService` | Derived | `fx.toBase(jobs.actualCost)` (#12) | **unchanged** |
| 18 | **FX conversion to base** | `FxService` | Derived | single converter, bill-date rate | reused |
| 19 | **Document numbers** (`BILL-YYYY-####`) | `SequenceService` | Stored | row-locked counter | reused |

**Explicit non-ownership statements** (the point of the table):

- AP **never** writes #12, #16 or #17. A job's profit and the P&L are numerically
  identical before and after any AP activity in Sprint 03. This is regression-tested.
- #13 is **never stored**. Storing it would create a second cost number needing
  synchronisation on every bill edit, approve, void and payment — the exact
  denormalization trap that produced Sprint 01A's H1.
- #5 has one formula but, per open finding **M-10**, currently two call sites
  (`agingReport` and `recordPayment` via `issuedNoteNet`). Sprint 03 does not
  touch AR, but AP is built with a single `outstandingOfBill()` from the start so
  the AP side never acquires the same debt.

---

# 5. Job Cost Strategy

## 5.1 Decision

**Option B — Vendor Bills NEVER modify `Job.actualCost`** (ratified Decision 3).

## 5.2 Why (beyond the ratification)

1. **`actualCost` is not what its name claims (Fact 1).** It is seeded with the
   quotation estimate. Auto-overwriting it with billed amounts would replace one
   half-truth with another while destroying the operator's own figure — the only
   number a human has deliberately asserted.
2. **Sprint 01A precedent.** H1 and H2 were both caused by new code silently
   changing the meaning of figures that existing reports already published.
   `actualCost` feeds `Job.profit` and the entire P&L module. Redefining it
   inside an AP sprint would repeat that failure at larger blast radius.
3. **Variance is the actual business value.** A forwarder does not want "billed
   cost" replacing "expected cost" — they want to *see the gap*, because the gap
   is where margin leaks. Overwriting deletes the signal; comparison surfaces it.
4. **Reversibility.** Deriving `actualCost` from bills later is a deliberate,
   testable migration (§5.6). Un-deriving it after an auto-overwrite means
   recovering data that no longer exists.

## 5.3 The four exposed values

| Value | Source | Nature | Notes |
|---|---|---|---|
| **Estimated Cost** | `Quotation.totalCost` via `job.quotationId` | Derived | `null` for jobs with no quotation — displayed as "—", never as 0 |
| **Actual Cost** | `jobs.actualCost` | Stored, manual | Labelled *"Recorded cost"* in the UI. When it still equals the estimate and no edit has occurred, the UI says so rather than implying independent confirmation (Fact 1) |
| **Vendor Bill Total (Billed)** | Derived (§4 #13) | Derived | Only APPROVED/PARTIALLY_PAID/PAID bills; FX-converted to the job currency at bill date |
| **Variance** | Derived (§5.4) | Derived | The deliverable |

## 5.4 Variance definition (authoritative)

> **Variance = Vendor Bill Total (Billed) − Job Actual Cost (Recorded)**

- **Positive** → vendors billed **more** than recorded → *margin risk*, shown amber/red.
- **Negative** → recorded more than billed → either bills are still outstanding
  (normal early in a job's life) or the recorded cost was over-stated.
- **Zero / no bills** → shown as "no bills yet", **never** as a 0.00 variance;
  an absent measurement and a measured zero are different facts.

A secondary **Estimate Variance** (`Billed − Estimated`) is displayed when the job
has a quotation, answering "did we quote this lane correctly?" — a sales question,
distinct from the operations question above.

**Currency rule.** All four values are presented in the **job's** currency.
Foreign-currency bills convert via `FxService` at **bill date** (Decision 12 — no
revaluation). The UI states the rate basis; silent mixed-currency arithmetic is
prohibited.

## 5.5 What is explicitly NOT built

No writes to `jobs.actualCost`, `jobs.profit` or `jobs.actualRevenue`. No change
to `PnlService`. No new stored column on `jobs`. The variance endpoint is
**read-only**.

## 5.6 Future: Job Cost Detail (design only)

When bills are the habitual entry point, a dedicated sprint introduces:

- **`job_cost_lines`** — `jobId`, `sourceType` (VENDOR_BILL | MANUAL | ALLOCATION),
  `sourceId`, `description`, `amount`, `currency`, `baseAmount`, `incurredAt`.
- Approving a bill writes one cost line per allocated bill line (idempotent by
  `(sourceType, sourceId)`); voiding reverses them.
- A **one-time backfill** converts each job's current `actualCost` into a single
  `MANUAL` opening line, so no historical number is lost.
- `jobs.actualCost` then becomes **derived** (`Σ job_cost_lines`) — at which point
  it finally means what its name says.

## 5.7 Future: Profit Calculation

Today `profit = actualRevenue − actualCost`, stored. After §5.6:

> `profit = actualRevenue − Σ job_cost_lines`

with `actualRevenue` similarly derived from issued invoices net of credit/debit
notes (the AR twin, and the natural home for open finding **M-8**: credit notes
currently do not reach job P&L at all). Both sides become derived in the same
sprint, or neither — deriving one while the other stays stored would reintroduce
exactly the asymmetry §4 exists to prevent.

---

# 6. Vendor Credit Note Strategy

**Design only. Nothing in §6 is built in Sprint 03.**

## 6.1 The two options

| | **Option A — separate `vendor_credit_debit_notes`** | **Option B — shared note engine (widen `credit_debit_notes`)** |
|---|---|---|
| Schema | New table mirroring the AR note; `vendorId` + `billId?` | Make `customerId` nullable, add `vendorId`, add `partyType` discriminator |
| Migration risk | **None** on live AR data | **Alters the live billing table**, requires backfilling `partyType` on every existing row |
| Query clarity | AR and AP queries stay independent | Every existing AR note query must add `partyType = 'CUSTOMER'` — miss one and AP notes leak into AR aging |
| Tax divergence | Free — AP tax is non-recoverable cost (Decision 6), AR tax is output tax | Constrained — one table implies one tax treatment |
| Permissions | Clean `payables.*` scope | `invoices.*` and `payables.*` collide on one table |
| Code reuse | Calc engine, state machine, sequence service reused by **import** | Reused by **inheritance** |
| Precedent in repo | Matches the customer/vendor master split already chosen twice | Would be the first shared-party table |

## 6.2 Recommendation — **Option A** (ratified Decision 1)

**Reasoning:**

1. **The valuable reuse is the engine, not the table.** `computeNoteTotals`,
   `assertWithinCreditable`, the state machine and `SequenceService` are all
   *functions* — Option A reuses 100% of them by import, exactly as
   `credit-debit-note.calc.ts` already reuses `invoice.calc.ts`. Sharing a
   *table* adds no code reuse; it only adds coupling.
2. **AR is live, hardened, and paid for.** Sprints 01 and 01A spent four High
   findings getting the AR note ↔ invoice ↔ payment seams correct. Widening that
   table re-opens every one of those seams for a feature not yet needed.
3. **`ARCHITECTURE_REVIEW.md` M7 predicted this exact fork** and warned against
   widening; the codebase has twice chosen the split (customer vs vendor master,
   AR vs AP documents) and consistency has value of its own.
4. **Tax treatments genuinely differ.** Decision 6 makes AP tax a cost with no
   input credit; AR tax is collected output tax. One table would force a
   conditional tax rule into shared code — the precise seam that produced H4.

## 6.3 Sketch (for the future sprint)

`vendor_credit_debit_notes`: `noteNumber` (`VCN-`/`VDN-YYYY-####`, own sequences),
`type`, `vendorId` (required), `billId?` (Restrict), currency/subtotal/taxPct/
taxAmt/totalAmount, `status` (DRAFT/ISSUED/VOID), `reason` (required), audit
columns — plus `vendor_credit_debit_note_items`. Guard mirror: a vendor credit
cannot exceed the bill's unpaid remainder (the H2 formula, already
parameterised). AP aging nets issued vendor notes via the **`noteNet` parameter
already present** in `applyPayment` and in `outstandingOfBill`'s intended
signature — which is why §3.3 passes 0 today rather than omitting the concept.

---

# 7. Attachment Strategy

## 7.1 Decision (ratified Decision 2)

New polymorphic **`attachments`** table keyed by `entityType` + `entityId`, used
by Vendor Bills in Sprint 03. **`JobDocument` is NOT migrated.**

## 7.2 Design

| Column | Purpose |
|---|---|
| `id` | PK |
| `entityType` | Enum `AttachmentEntity` — `VENDOR_BILL` initially; extended per adopting module |
| `entityId` | UUID of the owning row (**no FK — see 7.3**) |
| `storedPath` | Opaque storage key (`uuid.ext`) produced by `FileStorageService` — identical convention to `JobDocument.storedPath`, so both tables address the same bucket |
| `originalName`, `mimeType`, `sizeBytes` | Download headers and display |
| `category` | Optional label (e.g. "Vendor Invoice", "Proof of Payment") |
| `uploadedById` | FK → `users`, `SetNull` |
| `uploadedAt` | Timestamp |
| Index | `(entityType, entityId)` — the only access path |

**An enum, not free text, for `entityType`:** a typo'd string silently orphans a
document; an enum makes the same mistake a compile error and a migration.

## 7.3 Integrity trade-off — stated plainly

A polymorphic `entityId` **cannot carry a database foreign key**. Consequences
and mitigations:

- Deleting an owner row will not cascade → the owning service must delete its
  attachments explicitly (bills use `Restrict` for financial rows, so hard
  deletion is already prevented; a voided bill retains its evidence deliberately).
- Orphans are possible → the orphan-sweep script recommended for storage
  (`ARCHITECTURE_REVIEW_SPRINT02.md` M-3) covers `attachments` too, by design.
- **Why accepted:** binary evidence is not a financial record. Losing referential
  integrity on an attachment costs a stale row; the alternative (a third, fourth
  and fifth near-identical per-module table) costs permanent duplication across
  the whole roadmap.

## 7.4 Migration strategy for `JobDocument`

**Sprint 03: none.** `job_documents` is untouched — no schema change, no data
movement, no service change.

**Trigger:** when a **third** module needs attachments (Booking, P0-4). Two is a
coincidence; three is a pattern that must be factored.

**Method when triggered:** copy rows into `attachments` with
`entityType = JOB`, keeping `storedPath` **unchanged** (both tables already point
at the same bucket keys, so *no object is moved or re-uploaded* — the migration
is metadata-only and instantly reversible). `JobDocument.extracted` (OCR output)
either moves to an `ocr_extractions` side table or stays with a retained
`job_documents` row during a dual-read window.

## 7.5 Compatibility matrix

| Consumer | Compatible? | Notes |
|---|---|---|
| **OCR / BL extraction** | ✅ Untouched | OCR reads `JobDocument`, which does not change. `attachments` deliberately has **no** `extracted` column — AP bills need evidence, not extraction. If bill OCR is wanted later it gets its own side table rather than bloating a generic one |
| **Booking** (P0-4) | ✅ Zero schema | Add `BOOKING` to the enum; that is the entire change |
| **AP** (this sprint) | ✅ Native | `VENDOR_BILL` is the first adopter |
| **Customer Portal** (P1-2) | ⚠️ Needs scoping | Attachments must be filtered by the portal user's own entities. `attachments` has no tenant/customer column — access control resolves through the **owning entity**, so the portal's row-level scoping (its own prerequisite) covers attachments automatically. Never expose `/attachments/:id` without resolving the owner's permission first |
| **Email attachments** | ✅ Additive | MailService needs bytes; `FileStorageService.stream()` already provides them. A `getBuffer()` convenience is the only likely addition |
| **Supplier Portal** (P2) | ⚠️ Same as Customer Portal | Plus: a vendor must see only their own bills' attachments — same owner-resolution rule |

## 7.6 Backward compatibility

Nothing existing changes. `JobDocument`, `documents.service`, the OCR pipeline,
the recycle bin and every existing document endpoint behave identically. The two
systems coexist by explicit decision, with a named consolidation trigger — this
is recorded so the coexistence reads as a decision, not as neglect.

---

# 8. Database Design

**One additive migration. No existing table is altered destructively; no column
is dropped, renamed or retyped.**

## 8.1 New enums

| Enum | Values | Why |
|---|---|---|
| `VendorBillStatus` | DRAFT, APPROVED, PARTIALLY_PAID, PAID, VOID | The lifecycle in §2.2; a DB enum makes an invalid state unrepresentable |
| `AttachmentEntity` | VENDOR_BILL | Type-safe polymorphic discriminator (§7.2) |

## 8.2 New tables

### `vendor_bills`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `billNumber` | String **UNIQUE** | `BILL-YYYY-####` from `SequenceService` |
| `vendorInvoiceNo` | String **NOT NULL** | The vendor's own number (§2.5 — not nullable, deliberately) |
| `vendorId` | uuid **FK → vendors(id) RESTRICT** | A vendor with bills must not be deletable |
| `jobId` | uuid? **FK → jobs(id) RESTRICT** | Header-level default allocation |
| `currency` | String default `MYR` | |
| `subtotal` / `taxAmt` / `totalAmount` | Decimal(14,2) | Server-computed |
| `taxPct` | Decimal(7,4) | Matches AR precision exactly |
| `amountPaid` | Decimal(14,2) default 0 | Denormalized, written in-transaction |
| `status` | `VendorBillStatus` default DRAFT | |
| `billDate` | DateTime default now() | Vendor's invoice date = SST tax point |
| `dueDate` | DateTime? | Drives aging buckets |
| `terms`, `notes` | String? | |
| `createdById` / `updatedById` | uuid? **FK → users SET NULL** | Audit; matches the note tables |
| `createdAt` / `updatedAt` | DateTime | |

**Unique:** `(vendorId, vendorInvoiceNo)` — duplicate-bill control (Decision 5).
**Indexes:** `vendorId` (vendor drill-down), `status` (list filter), `dueDate`
(aging sort/buckets), `jobId` (job cost lookups).

### `vendor_bill_items`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `billId` | uuid **FK → vendor_bills(id) CASCADE** | Lines have no life without the bill |
| `description` | String | |
| `unitPrice` | Decimal(14,4) | Same precision as `invoice_items` |
| `unit` | String? | UOM |
| `quantity` | Decimal(14,4) | |
| `lineCurrency` | String default `MYR` | |
| `fxRate` | Decimal(14,6) | line → bill currency |
| `amount` | Decimal(14,2) | qty × unitPrice × fx, excl. tax |
| `taxExempt` | Boolean default false | SVE vs SV |
| `accNo` | String? | Cost account code |
| `jobId` | uuid? **FK → jobs(id) RESTRICT** | **Line-level allocation (Decision 4)** |
| `sortOrder` | Int | |

**Indexes:** `billId`; `jobId` (this index *is* the job-billed-total query path).

### `vendor_payments`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `billId` | uuid **FK → vendor_bills(id) RESTRICT** | Cash records pin their bill |
| `amount` | Decimal(14,2) | |
| `paidAt` | DateTime default now() | |
| `method`, `reference` | String? | |
| `recordedById` | uuid? **FK → users RESTRICT** | Mirrors `invoice_payments` — who moved money stays resolvable |
| `createdAt` | DateTime | |

**Index:** `billId`.

### `attachments`

Columns per §7.2. **Index:** `(entityType, entityId)`. **FK:** `uploadedById →
users SET NULL` only; `entityId` intentionally has **no FK** (§7.3).

## 8.3 Modified tables

**No table gains, loses or changes a column.** The only changes are Prisma-level
**back-relations**, which emit no SQL:

| Table | Change | SQL impact |
|---|---|---|
| `vendors` | `bills VendorBill[]` back-relation | none |
| `jobs` | `vendorBills` / `vendorBillItems` back-relations | none |
| `users` | `billsCreated` / `billsUpdated` / `vendorPaymentsRecorded` / `attachmentsUploaded` back-relations | none |
| `sequences` | **one new row** (`vendorBill`) | data, not schema |
| Permissions/roles | `payables` group + role-matrix grants | seed data, not schema |

## 8.4 Constraint rationale summary

| Constraint | Why |
|---|---|
| `billNumber` UNIQUE | Statutory document numbering must be gap-controlled and collision-free |
| `(vendorId, vendorInvoiceNo)` UNIQUE | Prevents paying one carrier invoice twice; scoped per vendor because numbers repeat across vendors |
| `vendorId` RESTRICT | Financial history must not lose its counterparty |
| `jobId` RESTRICT (both tables) | A job with costs booked against it must not vanish |
| `billId` CASCADE (items) | Lines are components, not records |
| `billId` RESTRICT (payments) | Cash records outrank their document |
| `recordedById` RESTRICT | Accountability for money movement is non-negotiable |
| `createdById`/`updatedById` SET NULL | Deactivating a user must not block document history |
| Index `(entityType, entityId)` | The sole access path for attachments |

---

# 9. API Design

All routes under `/api`, guarded by `JwtAuthGuard` + `PermissionsGuard`.
**Design only — no implementation.**

**New permissions:** `payables.read`, `payables.write` (new `payables` group;
granted to Administrator, Manager, Finance).

| # | Method | URL | Permission | Request | Response | Key validation | Errors |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/payables` | `payables.read` | `ListPayablesDto extends PaginationDto`: `status?`, `vendorId?`, `jobId?`, `search?` | `{items, total, page, pageSize, pageCount}` | Filters **declared on the DTO** (never extra `@Query()` — the open 400 bug in `TODO.md`); `status` ∈ enum | 400, 401, 403 |
| 2 | GET | `/payables/aging` | `payables.read` | — | `{rows, buckets, byVendor, totalPayable}` | Route declared **before** `:id` | 401, 403 |
| 3 | GET | `/payables/:id` | `payables.read` | — | bill + items + vendor + payments + attachments | UUID | 401, 403, 404 |
| 4 | POST | `/payables` | `payables.write` | `CreateVendorBillDto` | created bill | ≥1 line; vendor exists; `vendorInvoiceNo` non-empty; totals **server-computed** | 400, 401, 403, 404, **409** (duplicate `vendorId+vendorInvoiceNo`) |
| 5 | PATCH | `/payables/:id` | `payables.write` | `UpdateVendorBillDto` | updated bill | **DRAFT only**; `items` (if sent) `@ArrayMinSize(1)`; transactional replace | 400, 401, 403, 404, 409 |
| 6 | POST | `/payables/:id/approve` | `payables.write` | — | approved bill | Transactional; state machine; duplicate re-check inside txn | 400 (illegal transition), 401, 403, 404, 409 |
| 7 | POST | `/payables/:id/void` | `payables.write` | `{reason?}` | voided bill | Blocked when `amountPaid > 0` | 400, 401, 403, 404, **409** (payments exist) |
| 8 | POST | `/payables/:id/payments` | `payables.write` | `{amount, paidAt?, method?, reference?}` | payment + new status | `amount > 0`; ≤ outstanding; bill APPROVED/PARTIALLY_PAID; transactional | **400** (non-positive / overpayment / wrong status), 401, 403, 404 |
| 9 | POST | `/payables/payments/:id/void` *(recommended, §3.6)* | `payables.write` | `{reason?}` | recomputed bill | Recompute `amountPaid`, re-derive status | 400, 401, 403, 404 |
| 10 | GET | `/payables/:id/print` *(client route)* | `payables.read` | — | print view data (reuses #3) | — | 401, 403, 404 |
| 11 | POST | `/payables/:id/attachments` | `payables.write` | multipart `file` (≤5 MB) | attachment metadata | Memory storage; generated key; MIME/size recorded | 400, 401, 403, 404, **413** |
| 12 | GET | `/attachments/:id/download` | resolved from owner | — | streamed binary | **Owner-permission resolution before streaming** (§10) | 401, 403, 404 |
| 13 | DELETE | `/attachments/:id` | resolved from owner | — | `{deleted:true}` | Owner-permission resolution | 401, 403, 404 |
| 14 | GET | `/jobs/:id/cost-variance` | `jobs.read` | — | `{estimated, actual, billed, variance, currency, billCount, unallocatedNote}` | **Read-only** — writes nothing | 401, 403, 404 |

**Compatibility guarantee:** no existing endpoint is added to, changed, reshaped
or removed. Every route above is new.

---

# 10. Security

| Area | Control |
|---|---|
| **Authorization** | Every route carries `@RequirePermission`. New `payables.read` / `payables.write` scope — deliberately **not** reusing `invoices.*`, so AR clerks do not silently gain the ability to create payables. (This also avoids repeating open finding **M-5**, where notes reused `invoices.write` with no segregation.) |
| **Duplicate vendor invoice** | DB unique `(vendorId, vendorInvoiceNo)` **plus** an in-transaction re-check at approve. Defence in depth: the constraint stops the race, the check produces the friendly 409 |
| **Overpayment prevention** | Server-side only, via the Sprint-01A-hardened `applyPayment`. Client-supplied totals or statuses are never trusted |
| **Audit logging** | `AuditService` on create / update / approve / void / payment / attachment upload+delete, with user, IP and user-agent — matching every other financial module |
| **Document permissions** | `/attachments/:id/*` **must resolve the owning entity first** and apply that entity's permission (`payables.read` for a bill). A bare attachment id must never be a capability token. Storage keys stay opaque UUIDs; objects stay private; every byte flows through the authenticated API (`STORAGE.md` §9) |
| **Currency integrity** | A bill has exactly one currency; lines convert via explicit `fxRate`; cross-currency arithmetic without conversion is impossible by construction. Aggregations to base currency go through `FxService` only. *(Direct application of Sprint 01A's H4 — the AR bug where a note's currency was not pinned to its invoice.)* |
| **Data integrity** | RESTRICT on every financial FK; CASCADE only for component lines; server-computed money; state machine on every transition; approve/void/payment each in a single transaction with the bill row locked (`FOR UPDATE`) — the **M2** pattern proven in Sprint 02 |
| **Input hardening** | Global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`); attachment uploads capped at 5 MB with memory storage and generated keys — never a user-supplied path |

---

# 11. Future Compatibility

| Target | Verdict | Basis |
|---|---|---|
| **Booking** (P0-4) | ✅ Ready | Attachments: add one enum value. A booking-linked bill later needs only a nullable `bookingId` (additive) |
| **Customer Portal** (P1-2) | ✅ Unaffected | AP is internal; a customer never sees vendor bills. The portal's own row-level-scoping prerequisite is unchanged by this design |
| **Supplier Portal** (P2) | ⚠️ Two prerequisites | (a) vendor-scoped identity + row-level filtering by `vendorId`; (b) attachment access resolved through the owning bill (§7.5). Neither is blocked, both are unbuilt |
| **OCR** | ✅ Isolated | `JobDocument` untouched; `attachments` carries no `extracted` column by design. Bill OCR, if ever wanted, gets its own side table |
| **Email** | ✅ Additive | Remittance advice = existing MailService + `FileStorageService.stream()`; no model change |
| **Accounting Integration** (P1-1) | ✅ Designed for | AP is a clean sub-ledger: bills = payable postings, payments = cash postings, `billDate` = tax point, `accNo` per line = the account mapping hook. Decision 6 (SST as cost) keeps the mapping single-sided and simple |
| **Purchase Orders** (P1) | ✅ Non-blocking | A future `purchase_orders` table + nullable `poId` on `vendor_bills` (additive). Deliberately not stubbed now |
| **Vendor Credit Notes** | ✅ Pre-wired | §6 Option A; the `noteNet` parameter already exists in `applyPayment` and is reserved in `outstandingOfBill`, so netting arrives without a signature change |
| **Three-way Matching** | ⚠️ Needs two prerequisites | Requires POs **and** goods/service receipts. The bill line is already the right granularity to match against; nothing here blocks it |
| **Approval Workflow** | ✅ Non-blocking | An `approvals` module already exists. A future matrix inserts a PENDING_APPROVAL state between DRAFT and APPROVED — one enum value and one edge in the state machine |
| **Payment Batch** | ✅ Non-blocking | §3.7 — batch header + nullable `batchId`, purely additive; no speculative column added now |
| **Multi-Company** | ⚠️ Distance: moderate | Needs a `companyId` on every financial table plus scoped queries. AP adds 3 tables to that eventual migration; it does not make it harder in kind |
| **Multi-Tenant** | ⚠️ Distance: large (epic) | Unchanged from `ARCHITECTURE_REVIEW_SPRINT02.md`: the blocker is the app-wide absence of row-level tenancy, not storage or AP. Attachment keys would take a tenant prefix (`STORAGE.md` §5 seam). Treat as an epic, never as a sprint tweak |

---

# 12. Risks

## CRITICAL — none.

## HIGH

**H-1 — `Job.actualCost` will look wrong to users before it looks right**
- **Description:** Because `actualCost` is seeded from the quotation estimate
  (Fact 1), most jobs will show *Actual ≈ Estimated* while *Billed* differs.
  Users will read the variance as "the system is wrong" rather than "nobody has
  updated the recorded cost".
- **Impact:** Loss of trust in the first report AP delivers; pressure to
  "just make it auto-update" — i.e. to reverse ratified Decision 3 under duress.
- **Recommendation:** Label the UI honestly — "Recorded cost (from quotation,
  not yet confirmed)" when `actualCost` still equals the estimate and no manual
  edit has occurred. Ship §5.6 (cost detail lines) as the *next* AP increment so
  the fix is a planned migration, not a panic.

**H-2 — The void-with-payments 409 tells users to do something the API cannot do**
- **Description:** Fact 2 — no payment-reversal endpoint exists in AR, and AP
  would inherit the same gap. A mistyped payment permanently blocks voiding a bill.
- **Impact:** Operationally stuck records with no in-app remedy; the workaround
  is direct database editing, which destroys the audit trail.
- **Recommendation:** Include endpoint #9 (`POST /payables/payments/:id/void`,
  ~0.25 dw) in Sprint 03 so AP's own message is truthful, and log the AR twin as
  a separate follow-up. Do **not** ship the 409 without it.

## MEDIUM

**M-1 — Scope pressure from the excluded list**
- **Description:** PO, three-way match, payment batches and approval matrices are
  all natural "while we're here" additions, and AP is already the largest P0 (~4.25 dw with no slack).
- **Impact:** A half-built PO or matching feature is worse than none — it implies
  a control that does not exist.
- **Recommendation:** Treat §1.2 as a contract. If any becomes mandatory, split
  the sprint (AP-core / AP-extended) rather than compressing.

**M-2 — Multi-currency AP is where forwarders quietly lose money**
- **Description:** Bill-date FX with no revaluation (Decision 12) means the
  payable's base-currency value drifts from reality between bill and payment.
- **Impact:** Understated or overstated payables in base currency; unrecognised
  FX gain/loss.
- **Recommendation:** Accept for MVP, display the rate basis on every converted
  figure, and schedule FX gain/loss with accounting integration (P1-1).

**M-3 — Polymorphic attachments have no referential integrity**
- **Description:** `entityId` carries no FK (§7.3).
- **Impact:** Orphaned rows and orphaned objects over time; bucket cost and audit noise.
- **Recommendation:** Extend the orphan-sweep script already recommended by
  `ARCHITECTURE_REVIEW_SPRINT02.md` M-3 to cover `attachments` in the same pass.

**M-4 — Two attachment systems coexist**
- **Description:** `JobDocument` + `attachments` (§7.4).
- **Impact:** A future developer may add a third pattern, or extend the wrong one.
- **Recommendation:** The named trigger (third module) is recorded in this
  document and in `TODO.md`; enforce it at Booking's plan review.

**M-5 — Variance excludes bills that have not arrived**
- **Description:** Carrier invoices routinely arrive weeks after delivery, so a
  job's Billed total is structurally incomplete early in its life.
- **Impact:** Negative variance misread as over-recording; premature "profit" reads.
- **Recommendation:** Show bill count and latest bill date alongside the
  variance; state "bills may still be outstanding" until the job is COMPLETED.
  (True accrual handling belongs with §5.6.)

**M-6 — Production R2 credentials are still not set**
- **Description:** Open item in `TODO.md`; Sprint 03 adds attachments, increasing
  what is at stake.
- **Impact:** With `STORAGE_DRIVER=local` in production, every bill's evidence is
  destroyed on the next deploy — the exact loss P0-5 removed for job documents.
- **Recommendation:** **Complete the R2 cutover before Sprint 03 ships**
  (`STORAGE.md` §3). Not a code blocker; a go-live blocker.

## LOW

**L-1 — `VOID` vs `CANCELLED` naming** — deliberate (§2.2), documented; risk is only that a future reviewer files it as an inconsistency.
**L-2 — AP imports pure functions from the AR module** — acceptable (precedent exists); the clean fix is a later `common/money.calc.ts` promotion.
**L-3 — No vendor statement reconciliation** — vendors send monthly statements; matching them is manual until a later sprint.
**L-4 — `dueDate` derived from free-text `Vendor.paymentTerm`** — parsing "NET 30" is best-effort; leave null when unparseable rather than guessing.
**L-5 — Aging report loads all open bills into memory** — mirrors the existing AR pattern; fine at SME volume, revisit with AR together.

---

# 13. Sprint 03 Readiness

## Verdict: **READY to begin — conditional on two confirmations, neither of which is code.**

Every architectural question that blocked AP is now settled: the three model
decisions (§6 vendor notes, §7 attachments, §5 job cost) are ratified and
designed, the source-of-truth table (§4) assigns exactly one owner to every
financial value, and the schema, API and security surfaces are fully specified
against the real codebase.

### Confirmations required before implementation starts

| # | Item | Why it must be answered first | Default if silent |
|---|---|---|---|
| **C-1** | **Payment void in scope?** (Risk H-2 / endpoint #9) | It changes the void design and adds ~0.25 dw. Shipping the 409 without it knowingly ships an un-actionable message | **Include it** — recommended |
| **C-2** | **SST truly non-recoverable?** (Decision 6) | If input tax is in fact reclaimed, the schema needs a recoverable-tax column and AP reporting changes shape. This is business logic that must not be guessed | **Non-recoverable**, as ratified |

### Non-blocking but time-sensitive

| Item | Status |
|---|---|
| **R2 production cutover** (Risk M-6) | Not a code blocker; **must be done before Sprint 03 reaches production**, because bill evidence would otherwise be destroyed on each deploy |
| Open Medium/Low findings from prior reviews (M-1…M-7, L-1…L-8) | Remain open by decision; none blocks AP |
| Known bugs in `TODO.md` (list-filter 400s; winston blank error lines) | Unrelated to AP; AP avoids the list-filter bug by design (§9 #1) |

### Not blockers (explicitly)

Purchase Orders, three-way matching, approval matrix, payment batches, FX
revaluation, journals, GL, vendor credit notes, `JobDocument` consolidation —
all excluded or deferred with designs recorded above.

---

# 14. Review of `SPRINT_03_PLAN.md`

**Verdict: the plan must be REWRITTEN.** It is directionally correct — its three
proposed decisions match what has now been ratified — but four sections are no
longer accurate, and a stale plan is worse than none because implementation
follows it literally.

| Section | Why it changes |
|---|---|
| §0 Model decisions | Were *proposals with options*; now **ratified decisions**. The alternatives must move to this ADR and out of the plan |
| §3/§4 Lifecycle | Plan says `CANCELLED`; ratified lifecycle is **`VOID`** (§2.2) — a schema-level difference |
| §5 Job cost panel | Plan lists three values; the ratified design exposes **four** (Estimated / Actual / Billed / Variance) with a defined variance formula, currency rule and the Fact-1 labelling requirement |
| §6/§7 API + defaults | Endpoint list lacks payment-void (C-1) and the `/attachments` routes; the eight defaults are now superseded by the 15 ratified decisions |
| §9 Acceptance criteria | Must assert VOID semantics, the four-value variance, and the "AR/P&L numerically unchanged" regression |
| §10 Estimate | Payment void (+0.25 dw) pushes ~4.25 → **~4.5 dw**, past a comfortable 2-week sprint — the AP-core / AP-extended split becomes the recommended shape rather than a footnote |

**Recommendation:** on approval of this ADR, `SPRINT_03_PLAN.md` is rewritten to
reference it as the single architectural authority and to carry only execution
detail (scope, sequence, effort, acceptance, files). **That rewrite is not
performed in this document** — it awaits approval, together with answers to C-1
and C-2, so the plan is written once against final decisions.

---

*No implementation code was written. No migration was created. No source file was
modified. Awaiting Product Owner approval of: this ADR, confirmation **C-1**
(payment void in scope) and confirmation **C-2** (SST non-recoverable).*
