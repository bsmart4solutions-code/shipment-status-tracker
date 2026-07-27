# SPRINT 03A REPORT — Remediation of ARCHITECTURE_REVIEW_SPRINT03 High findings

**Scope:** H-1, H-2 and the approved P2002 → 409 improvement. **No other Medium or Low finding implemented.**
**Status:** ✅ COMPLETE — fixed, regression-tested, live-verified
**Date:** 2026-07-28
**Suite:** 18 backend suites, **242/242 passing** (was 219; +23) · frontend 12/12 · both typechecks clean · both production builds clean · one additive migration

---

## H-1 — A VOID bill no longer consumes the vendor invoice number

### Root cause
`@@unique([vendorId, vendorInvoiceNo])` carried no status dimension, and
`assertNoDuplicate()` did not exclude VOID rows. Once any bill used a number,
that number was gone for that vendor forever — including after the bill was
voided. `SPRINT_03_PLAN.md` §12 documents the Sprint-03 correction path as
*"VOID + re-entry"*, so the shipped schema made the documented workflow
impossible, and the 409 pointed the user at a bill that was already VOID.

### Fix
Duplicate protection is now a **partial unique index** — unchanged for live
bills, released on void:

```sql
DROP INDEX "vendor_bills_vendorId_vendorInvoiceNo_key";
CREATE UNIQUE INDEX "vendor_bills_vendor_invoice_active_key"
  ON "vendor_bills" ("vendorId", "vendorInvoiceNo")
  WHERE "status" <> 'VOID';
```

`assertNoDuplicate()` now filters `status: { not: 'VOID' }`, so the service check
and the database agree. `approve()`'s existing VOID exclusion — dead logic in
Sprint 03 because create and the constraint were both stricter — is now
meaningful and consistent.

**Prisma cannot express a partial index**, so it is owned by the migration and
deliberately absent from `schema.prisma`, with a comment on the model warning
against "restoring" `@@unique`. Verified that Prisma does not fight this:
`prisma migrate diff` between the live database and the schema reports
**"This is an empty migration"** — no drift, no attempt to drop the index.

Duplicate protection for active bills is **not weakened**: two live bills with
the same vendor invoice number remain impossible at both layers.

## H-2 — Variance uses the bill-date rate, and never silently converts 1:1

### Root cause
`FxService.converter()` builds a map of the **latest** rate per pair and
`toBase()` takes no date, so every variance silently re-valued whenever a rate
changed — while the cost panel stated *"converted at their bill-date rate"*. The
code did the opposite of the sentence. Separately, `toBase()` returns an
unconverted amount 1:1 when no rate exists and records it in `missing`;
`FxService.warning()` exists for this and `PnlService` surfaces it, but
`jobCostVariance()` used neither — so a variance could add USD to MYR at 1:1 and
present it as a confident figure.

### Fix
- **New `FxService.historicalConverter()`** — resolves, per conversion, the
  latest rate whose `effectiveDate` is **on or before** the supplied date.
  Deliberately shares `missing` and `baseCurrency` with `FxConverter`, and
  `warning()` was re-typed to `Pick<FxConverter, 'missing' | 'baseCurrency'>` so
  **one** warning mechanism serves both converters rather than two diverging ones.
- **`jobCostVariance()`** converts each line at its own bill's `billDate` (both
  legs: bill currency → base → job currency).
- **Missing rates are never silent.** The response now carries `fxWarning`
  (the existing message, identical to the P&L's) and `fxIncomplete`, and the
  **variance is suppressed to `null`** when a rate could not be resolved — an
  unconverted mix of currencies must never be presented as a comparable number.
- **The UI now tells the truth:** the footer says figures use each bill's own
  bill-date rate and therefore do not move when newer rates are added; a missing
  rate renders a red banner explaining that the variance is hidden and how to fix it.

## Approved improvement — Prisma P2002 → 409

`AllExceptionsFilter` now maps unique-constraint violations to **409 Conflict**
with an actionable message instead of a 500. Detected structurally (`code ===
'P2002'`) so the filter keeps no runtime dependency on the Prisma client.
Column names map to plain language ("bill number", "vendor's invoice number");
named indexes — which is what Postgres reports for a **partial** index — map to
targeted guidance, including *"void that bill first if you need to re-enter it"*
for the AP index. Benefits every module with a unique constraint, not just AP.

## Files Modified

**Backend**
- `prisma/schema.prisma` — `@@unique` replaced by a documented comment (H-1)
- `prisma/migrations/20260728020000_vendor_bill_void_releases_invoice_no/` — **NEW**, partial unique index
- `src/common/fx.service.ts` — `HistoricalFxConverter` + `historicalConverter()`; `warning()` re-typed to serve both (H-2)
- `src/common/filters/http-exception.filter.ts` — P2002 → 409 with field/index labels
- `src/modules/payables/payables.service.ts` — VOID excluded from the duplicate check (H-1); bill-date conversion, `fxWarning`, `fxIncomplete`, suppressed variance (H-2)

**Frontend**
- `src/app/jobs/cost-panel.tsx` — FX warning banner, incomplete-conversion notice, corrected footer copy

**Tests — new**
- `src/common/fx.historical.spec.ts` (9) · `src/common/filters/http-exception.filter.spec.ts` (8)

**Tests — extended**
- `src/modules/payables/payables.service.spec.ts` (+6, and the FX stubs moved to the date-aware converter)

**Not touched:** invoices · credit/debit notes · quotations · customers · vendors master · storage layer · P&L · the AP lifecycle, payment and reversal logic.

## Tests Added (23 new; suite 242/242)

| Area | Coverage |
|---|---|
| H-1 | Duplicate check queries `status: { not: 'VOID' }` on create and on update; a live duplicate is still blocked |
| H-2 (FX) | Rate chosen by date across three rate epochs; **a historical figure is unchanged when a newer rate is added**; boundary date inclusive; base currency 1:1 without a false "missing"; inverse pair resolution; currency with no rate recorded; currency whose rates all post-date the bill recorded; the same `warning()` serves the historical converter |
| H-2 (variance) | Bill-date rate not latest rate; two bills priced at their own dates; missing rate ⇒ warning + `fxIncomplete` + **variance null**; clean case ⇒ no warning and a real variance |
| P2002 | Partial-index name → re-entry guidance; index name as a single-element array; single column in plain language; multiple columns; unknown column fallback; HttpExceptions untouched; genuine errors still 500; non-P2002 Prisma errors still 500 |

## Live Verification

**H-1 — the workflow that was previously impossible**

| Step | Result |
|---|---|
| Create `INV-777` (wrong amount) → approve | BILL-2026-0001 **APPROVED** |
| Duplicate `INV-777` while live | **409** — "already been recorded for this vendor as BILL-2026-0001" (protection intact) |
| Void it | BILL-2026-0001 **VOID** |
| **Re-enter `INV-777` with the corrected amount** | **BILL-2026-0002 created, total 1200, same invoice number** ✅ |

**H-2 — historical stability, proven by changing a rate underneath**

| Step | Result |
|---|---|
| USD 100 bill dated **2026-03-01**, USD→MYR = 4.45 (from 2026-01-01) | billed **445** |
| Second USD 100 bill dated **2026-08-01** | billed total **890** (both at 4.45) |
| **Insert USD→MYR 9.99 effective 2026-07-01** | — |
| Re-read the same variance | billed total **1444** = **445 (March bill unchanged)** + **999 (August bill at the new rate)** ✅ |

The March figure did not move, and the new rate applied only to the bill dated
after it — exactly the required behaviour.

**H-2 — missing rate no longer silently 1:1**

A EUR bill dated **2025-06-01** (every configured rate starts 2026-01-01, so no
rate is in effect at that date) produced:
- `fxWarning`: *"No exchange rate configured to MYR for: EUR — those amounts were included 1:1 and totals are unreliable until rates are added"*
- `fxIncomplete`: **true**
- `variance`: **null** — suppressed rather than computed from unconverted amounts ✅

**P2002 → 409**

A duplicate `POST /api/fx` (an endpoint with no service-level pre-check, so the
violation reaches Prisma) returned **409** with *"A record with these details
already exists"* instead of a 500. A 6-way concurrent duplicate bill create
returned **1×201 + 5×409**, every 409 carrying the service check's friendly
message — the pre-check wins the race in practice, and the filter is the safety
net beneath it (covered deterministically by unit tests).

### Regression

| Value | Baseline | After Sprint 03A activity | After cleanup |
|---|---|---|---|
| AR aging outstanding | 2,138.40 | **2,138.40** | 2,138.40 |
| JOB-2026-0001 cost / profit | 1585 / 395 | **identical** | identical |
| JOB-2026-0005 cost / profit | 180 / 36 | **identical** | identical |
| P&L revenue / cost / profit | 3157.2 / 2521 / 636.2 | *see note* | **3157.2 / 2521 / 636.2** |
| Invoices / notes | 2 / 0 | 2 / 0 | 2 / 0 |

**Note on the P&L reading.** During verification the P&L showed
4353.84 / 3518.2 / 835.64. This was **not** caused by AP: JOB-2026-0005 is
denominated in USD and `PnlService` converts using the **latest** rate, so the
test rate inserted for the H-2 proof (USD→MYR 4.45 → 9.99) re-valued it. The
delta was arithmetically confirmed to the cent — `180 × (9.99 − 4.45)` for cost
and `216 × (9.99 − 4.45)` for revenue — and the P&L returned to the exact
baseline the moment the test rate was deleted. Recorded because the raw reading
looked like a regression and was not one. It does, however, demonstrate that
**the P&L itself is not historically stable** — see Risks.

**Cleanup:** all vendor bills, lines and payments deleted; AP audit rows
removed; the test exchange rate deleted; `vendorBill` sequence reset to 1.
Post-cleanup state matches the baseline exactly.

## Risks

1. **The partial index is invisible to Prisma.** `schema.prisma` no longer
   declares the uniqueness, so a future developer reading only the schema will
   not see it. Mitigated by an explicit comment on the model and by the
   verified absence of drift, but it is a knowledge dependency on the migration.
2. **Behaviour change (intended):** a voided bill's invoice number becomes
   reusable. If any process relied on "this number was used once, ever", it no
   longer holds. Duplicate protection for live bills is unchanged.
3. **The same currency-drift problem still exists in the P&L** (and anywhere
   else using `FxService.converter()`): those figures move when rates change.
   Out of Sprint 03A's approved scope — the historical converter now exists and
   is the ready-made fix if the Product Owner wants P&L stability too.
   Logged in `TODO.md`.
4. **Historical stability depends on rate data being dated correctly.** A rate
   back-dated after the fact will legitimately change past variances; that is
   correct behaviour, but it means "stable" holds only if rates are entered with
   accurate effective dates.
5. **The intermittent test flake recurred once** during this sprint, in
   `rate-sheet.parser.spec.ts` (1 of 242), and did not reproduce across four
   subsequent full runs or in isolation. Best evidence points at the exceljs
   round-trip test (~1.5 s alone) exceeding Jest's 5 s default under parallel
   load rather than at any product defect. Not fixed — raising that test's
   timeout is outside this sprint's approved scope — but now diagnosed rather
   than merely observed. Logged in `TODO.md`.
6. **Unchanged and still outstanding:** the production R2 cutover
   (`STORAGE.md` §3), and every Medium/Low finding from the Sprint 03 review
   that was deliberately excluded here.

## Migration Notes

- Run `npx prisma migrate deploy` (applies `20260728020000_vendor_bill_void_releases_invoice_no`).
- The migration drops the old unique index and creates the partial one. It is
  safe on existing data: any current data satisfying the stricter old constraint
  necessarily satisfies the looser new one.
- **Rollback** (only if required): drop `vendor_bills_vendor_invoice_active_key`
  and recreate `vendor_bills_vendorId_vendorInvoiceNo_key` — but note this will
  fail if a voided number has since been re-used, which is precisely the
  behaviour this sprint enabled. Prefer rolling forward.
- No other schema change; no data migration; no downtime.
