# SPRINT 03 REPORT — Accounts Payable (P0-3)

**Plan:** `SPRINT_03_PLAN.md` (approved) · **Architecture:** `AP_ARCHITECTURE_DECISION.md` (approved)
**Status:** ✅ COMPLETE — **Phase A and Phase B both delivered**, tested and live-verified
**Date:** 2026-07-28
**Suite:** 16 backend suites, **219/219 passing** (was 153; +66) · frontend 12/12 · both typechecks clean · both production builds clean · **one additive migration**

---

## 1. Summary

The system now has a working payables ledger. A vendor bill can be captured
against one job, several jobs, or none; approved into a payable; paid in parts;
corrected by reversing a payment without destroying the audit trail; voided when
it should never have existed; and seen in an AP aging report by due date and by
vendor. Phase B adds a read-only job cost view that compares what was estimated,
what was recorded and what vendors actually billed.

**The boundary that defined this sprint held.** A full AP cycle — create,
approve, pay twice, reverse twice, void — left `Job.actualCost`, `Job.profit`,
`Job.actualRevenue`, the P&L and every AR figure **numerically identical**,
verified live against captured baselines and enforced by a structural test.

## 2. Business Features Delivered

### Phase A — AP Core

| # | Feature | Result |
|---|---|---|
| A1 | Vendor bill capture — header + lines, SST-aware, multi-currency, server-computed totals | ✅ |
| A2 | Lifecycle DRAFT → APPROVED → PARTIALLY_PAID → PAID, plus VOID | ✅ |
| A3 | Multi-job allocation — line-level `jobId` overriding the header | ✅ |
| A4 | Bills with no job (overheads) | ✅ |
| A5 | Duplicate control — unique `(vendorId, vendorInvoiceNo)` | ✅ |
| A6 | Vendor payments — partial, overpayment-guarded, status derived | ✅ |
| A7 | **Payment reversal** — audit trail, outstanding + aging recalculation | ✅ |
| A8 | AP aging — due-date buckets + per-vendor totals | ✅ |
| A9 | Frontend — list, bill builder, payment dialog with reversal, aging modal, nav | ✅ |
| A10 | `payables.read` / `payables.write` permission scope | ✅ |

### Phase B — AP Extended

| # | Feature | Result |
|---|---|---|
| B1 | `GET /jobs/:id/cost-variance` — read-only | ✅ |
| B2 | Job cost panel — Estimated · Recorded · Vendor Bill Total · Variance | ✅ |
| B3 | Honest labelling when the recorded cost is still the quotation estimate | ✅ |
| B4 | Variance context — bill count, latest bill date, outstanding-bills warning | ✅ |

## 3. Database Changes

Migration `20260727212330_accounts_payable` — **additive only; no existing table
altered destructively, no column dropped, renamed or retyped.**

- **Enum** `VendorBillStatus` (DRAFT, APPROVED, PARTIALLY_PAID, PAID, VOID).
- **`vendor_bills`** — `billNumber` UNIQUE, `vendorInvoiceNo` NOT NULL, `vendorId`
  (FK Restrict), `jobId?` (FK Restrict), currency, subtotal/taxPct/taxAmt/
  totalAmount, amountPaid, status, billDate, dueDate, terms, notes, voidReason,
  audit columns. **UNIQUE `(vendorId, vendorInvoiceNo)`**; indexes on `vendorId`,
  `status`, `dueDate`, `jobId`.
- **`vendor_bill_items`** — mirrors `invoice_items` plus **`jobId?`** (line-level
  allocation, FK Restrict); indexes on `billId`, `jobId`.
- **`vendor_payments`** — mirrors `invoice_payments` plus the soft-reversal
  columns `reversedAt`, `reversedById` (FK Restrict), `reversalReason`.
- **Data, not schema:** one `sequences` row (`vendorBill` → `BILL-YYYY-####`);
  `payables` permission group granted to Administrator, Manager, Finance.
- `vendors`, `jobs`, `users` gain Prisma back-relations only — **zero SQL change**.

`Job.actualCost` and every other job/AR column are untouched.

## 4. API Changes

**All new. No existing endpoint changed, reshaped or removed.**

| Method | Path | Permission |
|---|---|---|
| GET | `/payables` | `payables.read` (filters `status`, `vendorId`, `jobId`, `search` — declared on `ListPayablesDto`) |
| GET | `/payables/aging` | `payables.read` |
| GET | `/payables/:id` | `payables.read` |
| POST | `/payables` | `payables.write` |
| PATCH | `/payables/:id` | `payables.write` (DRAFT only) |
| POST | `/payables/:id/approve` | `payables.write` |
| POST | `/payables/:id/void` | `payables.write` |
| POST | `/payables/:id/payments` | `payables.write` |
| POST | `/payables/payments/:paymentId/reverse` | `payables.write` |
| GET | `/jobs/:id/cost-variance` | `jobs.read` (read-only, Phase B) |

## 5. Payment Reversal (PO Decision 1)

- **Soft reversal:** the payment row is preserved and flagged
  (`reversedAt`/`reversedById`/`reversalReason`) — never deleted.
- **Outstanding recalculated** from the remaining non-reversed payments inside
  the same transaction that flags the row.
- **Status re-derived**, never set by a caller: 0 → APPROVED, partial →
  PARTIALLY_PAID, still covered → PAID.
- **Backward transitions are confined by construction.** PAID is terminal in the
  forward edge set; reversal consults a separate `VENDOR_BILL_REVERSAL_EDGES`
  that only `reversePayment()` reads. There is no generic "set status" endpoint,
  so no other path can reach a backward move.
- **AP aging needs no recalculation job** — it derives from `amountPaid` at query
  time, so it is correct the moment the transaction commits. Verified live:
  aging went 990 → 990 → 1590 → 0 across reversals and the void.
- **Audit:** `REVERSE_PAYMENT` logged with amount, reason, previous/new status
  and previous/new amountPaid.
- **Guards:** reason mandatory; a payment cannot be reversed twice; the bill row
  is locked `FOR UPDATE` for the whole operation.

## 6. Files Modified

**Backend — new:** `modules/payables/vendor-bill.calc.ts` · `payables.dto.ts` ·
`payables.service.ts` · `payables.controller.ts` · `payables.module.ts` ·
`vendor-bill.calc.spec.ts` · `payables.service.spec.ts` ·
`prisma/migrations/20260727212330_accounts_payable/`
**Backend — modified:** `prisma/schema.prisma` (3 models + 1 enum + back-relations) ·
`prisma/seed.ts` (sequence, permission group, role matrix) · `src/app.module.ts` ·
`src/common/state-machine.ts` (+ forward and reversal edge sets) ·
`src/common/state-machine.spec.ts` · `src/common/permissions.ts` (typed codes) ·
`src/modules/jobs/jobs.module.ts` · `src/modules/jobs/jobs.controller.ts` (read-only variance route)
**Frontend — new:** `app/payables/page.tsx` · `bill-form.tsx` ·
`payment-dialog.tsx` · `ap-aging.tsx` · `app/jobs/cost-panel.tsx`
**Frontend — modified:** `components/shell.tsx` (nav) · `app/jobs/page.tsx` (Cost action + panel mount)

**Not touched:** invoices · credit/debit notes · quotations · customers · vendors
master · `JobDocument` · the storage driver layer · P&L · `invoice.calc.ts`
(imported, never edited).

## 7. Tests (66 new; suite 219/219)

| Area | Coverage |
|---|---|
| Bill totals | Tax parity with the invoice engine (proves the single tax engine), SVE exclusion, per-line FX, SST-as-cost |
| Outstanding | Live vs non-live statuses |
| Payments | Partial, exact settlement to the cent, overpayment, non-positive |
| Reversal maths | Full/partial reversal, still-covered case, float drift, rounding |
| State machine | Every forward edge and non-edge; reversal edges; **proof the forward set forbids what only reversal may do** |
| Service — duplicates | Rejected on create and re-checked inside the approve transaction; same number allowed for a different vendor |
| Service — guards | Unknown vendor/job, no-job bills, non-DRAFT edit, approve with no lines, `FOR UPDATE` asserted in SQL |
| Service — void | 409 with live payments (including the PAID case where the actionable message must beat the state machine), state-machine block once payments are reversed |
| Service — payments | DRAFT rejection, overpayment, PARTIALLY_PAID/PAID derivation |
| Service — reversal | Flag-not-delete, status re-derivation, double-reversal rejection, unknown payment, row lock + audit detail |
| **Ownership boundary** | Every mutating operation asserted to never touch the job / invoice / note write delegates; payment writes asserted to contain only `amountPaid` and `status` |
| Phase B variance | Four values, SST as cost, FX conversion, null-not-zero with no bills, unconfirmed-label on/off, distinct bill count, COMPLETED warning, unknown job, **writes nothing** |

## 8. Live Verification

Against the running stack, with a regression baseline captured beforehand.

| Check | Result |
|---|---|
| Vendor bill | Consolidated bill created: 1,000 → job A, 500 → job B, SST 6% ⇒ **1,590.00**, DRAFT |
| Duplicate protection | Same vendor + `TCL-9001` ⇒ **409** "already been recorded for this vendor as BILL-2026-0001"; **same number for a different vendor accepted** (BILL-2026-0002) |
| Payment on DRAFT | Rejected — "Cannot record a payment on a DRAFT bill" |
| Approval | DRAFT → **APPROVED** |
| Overpayment | 2,000 against 1,590 ⇒ "Payment of 2000 exceeds remaining balance of 1590" |
| Payment | 600 ⇒ **PARTIALLY_PAID**, outstanding **990** |
| AP Aging | Total payable **990**, bucket Current, per-vendor total correct |
| Void with payments | **409** — "Cannot void a bill with 2 recorded payment(s) — reverse the payment(s) first" |
| Outstanding | Settled 990 ⇒ **PAID**, outstanding **0** |
| Payment reversal | Blank reason rejected · 990 reversed ⇒ **PAID → PARTIALLY_PAID**, paid 600 · re-reversal rejected · aging back to **990** · 600 reversed ⇒ **PARTIALLY_PAID → APPROVED**, aging **1,590** |
| Void flow | After all reversals ⇒ **VOID** with reason; aging **0** |
| Multi-job allocation | Two lines stored against two different jobs; each job's variance received only its own allocation |
| Phase B variance | Job A (USD): recorded 180, billed **238.20** (MYR 1,060 ÷ 4.45), variance **+58.20**, labelled *"from quotation — not yet confirmed"*; Job B (MYR, COMPLETED): billed **530.00**, no outstanding-bills warning |
| UI | `/payables` list, AP aging modal, and the four-value cost panel all render correctly |

### Regression — all unchanged

| Value | Baseline | With a live approved AP bill | After cleanup |
|---|---|---|---|
| AR aging outstanding | 2,138.40 | **2,138.40** | 2,138.40 |
| JOB-2026-0001 cost / revenue / profit | 1585 / 1980 / 395 | **identical** | identical |
| JOB-2026-0005 cost / revenue / profit | 180 / 216 / 36 | **identical** | identical |
| P&L revenue / cost / gross profit | 3157.2 / 2521 / 636.2 | **identical** | identical |
| Invoices / credit-debit notes | 2 / 0 | **2 / 0** | 2 / 0 |

**Test data removed:** all bills, lines and payments deleted; AP audit rows
removed; `vendorBill` sequence reset to 1. Post-cleanup state matches the
baseline exactly.

## 9. Two Defects Found and Fixed During Verification

Both were found by live verification, not by unit tests — worth recording.

1. **`::uuid` cast in the row-lock queries.** Prisma maps `String @id` to
   Postgres `text`, so `WHERE id = $1::uuid` failed with
   `operator does not exist: text = uuid`, breaking approve, pay, void and
   reverse. Removed the casts to match the existing pattern in
   `credit-debit-notes.service.ts`. **Unit tests could not catch this** — they
   stub `$queryRaw`.
2. **Void returned the wrong error.** A bill with payments is PARTIALLY_PAID or
   PAID, so the state-machine assertion fired first and returned a generic
   **400** instead of the actionable **409** required by plan AC-9. Reordered so
   the payment check runs first; two regression tests added, including the PAID
   case and the "all payments reversed" case where the state machine should
   still win.

## 10. Known Limitations

1. **Attachments deferred** (PO Decision 5) — an approved payable carries no
   scanned vendor invoice inside the system. For job-linked bills the carrier
   invoice can already be uploaded today as a **Job Document** (existing
   feature); standalone bills have no home yet. Plan Risk H-2.
2. **Recorded cost is seeded from the quotation estimate**, so most jobs show
   *Recorded ≈ Estimated*. Deliverable B3 labels this honestly; the structural
   fix is job cost detail lines (ADR §5.6), a future increment. Plan Risk H-1.
3. **No FX revaluation** (PO Decision 12) — foreign-currency payables are
   converted at bill-date rates and drift until paid. Plan Risk M-2.
4. **No segregation of duties** (PO Decision 8) — one `payables.write` covers
   create, approve, pay and reverse. Plan Risk M-4.
5. **Variance excludes bills that have not arrived** — surfaced in the UI rather
   than hidden. Plan Risk M-5.
6. **Vendor credit notes, POs, three-way matching, payment batches, journals and
   a GL** remain out of scope by decision.
7. **One transient test failure** was observed in a single early run
   (205/206) and never reproduced across four subsequent full runs, including an
   in-band run with the environment-mutating specs. Recorded rather than
   dismissed; no cause identified.

## 11. Migration Notes

- Run `npx prisma migrate deploy` (applies `20260727212330_accounts_payable`).
- Run the seed (idempotent) or insert the `vendorBill` sequence row and the
  `payables` permission rows manually — **the module is unusable without the
  permission grants**.
- No existing data is modified; no downtime.
- **Rollback:** preferred first response is the soft-disable — revoke
  `payables.read`/`payables.write` from all roles; the UI entry disappears and
  every route returns 403 with data preserved. A database rollback (drop
  `vendor_payments`, `vendor_bill_items`, `vendor_bills`, then the enum, delete
  the sequence row) is safe only before first production use, since it destroys
  any bills entered.
- **Unchanged and still outstanding:** the production R2 cutover
  (`STORAGE.md` §3) — unrelated to AP, but still open in `TODO.md`.
