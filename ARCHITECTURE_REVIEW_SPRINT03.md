# ARCHITECTURE REVIEW — SPRINT 03 (Accounts Payable)

**Reviewer roles:** Enterprise ERP Solution Architect · Principal Software Engineer · Financial Systems Architect · Security Reviewer
**Scope:** Sprint 03 deliverable (commit `fcb3324`) — Phase A (AP core) and Phase B (job cost variance) — plus its seams with the AR, jobs and P&L modules
**Inputs:** `AP_ARCHITECTURE_DECISION.md` · `SPRINT_03_PLAN.md` · `SPRINT_03_REPORT.md` · `CHANGELOG.md` · `TODO.md` · `PRODUCT_BACKLOG.md` · `ARCHITECTURE_REVIEW.md` · `ARCHITECTURE_REVIEW_SPRINT02.md` — plus full source of `modules/payables/*`, the AP migration, `state-machine.ts`, `permissions.ts`, `fx.service.ts`, `filters/http-exception.filter.ts`, `jobs.controller.ts`, and the four new frontend files
**Date:** 2026-07-28
**Code changes made during this review:** NONE

---

## Verdict

**Sprint 03 delivered the payables ledger it promised, and the boundary that
defined the sprint held.** The ownership rule (AP never writes `Job.actualCost`,
`Job.profit`, `actualRevenue` or the P&L) is enforced *structurally* — by tests
asserting the job/invoice/note write delegates are never touched — rather than
by spot-checking values. That is the right way to defend an invariant, and it is
the single best engineering decision in this sprint.

**No Critical findings. Two High** — both in areas the sprint's own documents
made claims about:

1. **Voiding a bill permanently burns the vendor's invoice number**, which makes
   the *documented* correction workflow ("VOID + re-entry", plan §12) impossible
   to execute.
2. **The job cost variance converts currency with the latest configured rate,
   not the bill-date rate the UI explicitly claims** — and it silently drops the
   missing-rate warning that every other money report in this codebase surfaces.

Neither is a data-integrity defect: the ledger itself is sound. Both are cases
where the shipped behaviour contradicts what the system tells its user.

**Finding count: 0 Critical · 2 High · 9 Medium · 9 Low.**

---

## Part A — Area assessment

### 1. AP Domain Model — ✅ Strong
`VendorBill` is defined as *"our record of one invoice issued to us by one
vendor"*, not as a cost-allocation instrument, and the model holds that line
consistently: allocation is reporting metadata, the payable is always the bill
total. Line-level `jobId` overriding a header default is the correct shape for
consolidated carrier invoices and is genuinely the industry case, not a
speculative feature. **Weakness:** unallocated spend has no home in any view
(M-1), and the list filter's notion of "belongs to this job" differs from the
variance calculator's (M-2).

### 2. Vendor Bill Lifecycle — ✅ Correct
DRAFT → APPROVED → PARTIALLY_PAID → PAID + VOID, with APPROVED as the posting
event and DRAFT-only editability. The `VOID` naming deviation from the
codebase's `CANCELLED` is deliberate, documented in the ADR, and defensible
(voiding a posted payable is the accountant's term). **Weakness:** the lifecycle
is one-way with no re-entry path after VOID (H-1).

### 3. Payment Lifecycle — ✅ Correct
Partial payments, server-derived status, overpayment rejection reusing the
AR algorithm hardened in Sprint 01A. `amountPaid` is denormalized but written
inside the same transaction as the payment row — the same pattern already proven
on the invoice side, so AP does not invent a second synchronisation story.

### 4. Payment Reversal — ✅ Well designed, under-verified
The strongest new piece. Soft reversal preserves the row with reason, actor and
timestamp; outstanding recomputes from the surviving payments inside the same
transaction; status is re-derived rather than assigned. The insight that **AP
aging needs no recalculation job because it is derived, not stored** is correct
and worth the explicit statement it got — it prevents someone later building a
batch job with nothing to recalculate. **Weakness:** the concurrency proof the
plan promised for reversals was not delivered (M-3).

### 5. State Machine — ✅ Excellent
Splitting `VENDOR_BILL_REVERSAL_EDGES` from the forward edge set is the right
answer to "reversal is the only backward move". Because no generic set-status
endpoint exists, the backward capability is confined by construction rather than
by convention, and the test suite proves the forward set *forbids* exactly what
reversal permits. This is the cleanest state-machine work in the project.

### 6. Ownership Boundaries — ✅ Excellent
`AP_ARCHITECTURE_DECISION.md` §4 assigns one writer per financial value, and the
implementation honours it: billed totals are derived and never stored, the
variance endpoint is read-only, and the tests assert non-interaction with
forbidden delegates plus that a payment write contains only `amountPaid` and
`status`. Live baselines confirmed AR, both jobs and the P&L byte-identical
across a full AP cycle. **Weakness:** that end-to-end proof exists only as a
manual run, not in CI (M-7).

### 7. Tax Engine Reuse — ✅ Correct
`computeVendorBillTotals` delegates to `priceInvoiceItem` / `computeInvoiceTotals`,
and a test asserts numeric parity with the invoice engine for identical lines —
so AP tax arithmetic *cannot* drift from AR. SST-as-cost (PO Decision 6) is
honoured by omission: there is no recoverable-tax field anywhere to misuse
later. **Weakness:** per-line tax re-derivation in the variance can disagree with
the stored bill `taxAmt` by rounding (M-8).

### 8. Database Design — ✅ Sound
Additive migration, correct FK semantics throughout (Restrict on counterparty
and cash records, Cascade only for component lines, SetNull for audit users),
indexes matching real access paths — `vendor_bill_items(jobId)` exists precisely
for the variance query. `vendorInvoiceNo NOT NULL` with the documented
NULL-distinctness rationale is exactly right. **Weakness:** the unique key
`(vendorId, vendorInvoiceNo)` has no status dimension, which is the mechanism
behind H-1.

### 9. Transaction Safety — ✅ Good
Approve, pay, reverse and void each run in one transaction with the bill row
`SELECT … FOR UPDATE`, and the tests assert the lock is actually in the SQL
rather than trusting the comment. Audit logging is deliberately outside the
transaction (consistent with the rest of the codebase) — acceptable, at the cost
that a crash between commit and log loses the audit line.

### 10. Concurrency — ⚠️ Correct by design, unproven by test
The locking is right. But Sprint 02 set the bar by *proving* the CN/DN race both
in a unit test and live (201 + 400), and plan §16 explicitly committed to the
same for AP payments and reversals. Neither was delivered (M-3), and the
duplicate-create race has an unmapped error path (M-4).

### 11. API Compatibility — ✅ Preserved
Ten new routes; zero existing endpoints changed, reshaped or removed. Literal
segments (`/aging`, `/payments/:id/reverse`) declared before `:id`. Filters live
on `ListPayablesDto`, correctly avoiding the 400-bug still open on
quotations/invoices/jobs. `GET /jobs/:id/cost-variance` is additive.

### 12. Permission Model — ✅ Good, one undocumented consequence
A separate `payables.*` scope — rather than reusing `invoices.*` — is the right
call and avoids repeating open finding M-5 from the first review. The typed
`PermissionCode` union keeps a typo a compile error. **Weakness:** the variance
endpoint is gated on `jobs.read`, so any role with job access (including
Operation) can read aggregate vendor spend per job without `payables.read`
(M-6). Defensible, but it was never stated as a decision.

### 13. Security — ✅ Good
Server-computed money, DTO whitelisting, guards on every route, audit on every
write including reversal with before/after state, no new attack surface (no
upload, no new dependency, no new external call). Void and reversal both require
explicit intent (reason mandatory on reversal). **Note:** one permission covers
create/approve/pay/reverse — the classic AP fraud shape — knowingly accepted per
PO Decision 8 and already tracked.

### 14. Performance — ✅ Adequate
Denormalized `amountPaid` avoids summing payments on read; the variance uses one
indexed query rather than per-row lookups; aging is a single query plus an
in-memory grouping. All fine at SME volume. Aging loading every open bill into
memory mirrors the AR pattern and shares its ceiling (L-5).

### 15. Scalability — ✅ Fine, one structural note
Nothing in AP blocks horizontal scaling; row locks are short and single-row.
The conceptual load is the same one flagged in the first review: each new
consumer of "what is owed" must go through `outstandingOfBill()`. AP got this
right from day one — the function exists and is the sole owner — which is more
than AR can currently say (M-10 there remains open).

### 16. Testing Strategy — ✅ Strong at the unit layer
66 new tests covering tax parity, outstanding across statuses, payment maths,
reversal recomputation, every state-machine edge and non-edge, and the service
guards. The ownership-boundary suite is the standout: it tests a *property*
("AP never writes these") rather than a value. **Weaknesses:** no concurrency
test (M-3), no HTTP/controller layer, and the two defects that actually shipped
were both invisible to unit tests because they stub `$queryRaw` — which is the
honest argument for the integration rung still missing since M-6/M9.

### 17. Regression Coverage — ⚠️ Excellent once, not repeatable
The live baseline → AP cycle → re-check → cleanup → re-check sequence is the
right test, and it passed cleanly. But it is a manual artifact: nothing re-runs
it. The invariant most likely to be broken by a *future* sprint has no automated
guard (M-7).

### 18. Future Compatibility — see Part C.

---

## Part B — Findings

### CRITICAL — none.

### HIGH

**H-1 — Voiding a bill permanently burns the vendor's invoice number, blocking the documented correction workflow**
- **Description:** `@@unique([vendorId, vendorInvoiceNo])` carries no status
  dimension, and `assertNoDuplicate()` in `create()` does not exclude VOID bills.
  So after voiding a mis-keyed bill, the same vendor invoice number can never be
  entered again — by the service *or* by the database. `SPRINT_03_PLAN.md` §12
  states the Sprint-03 correction path is exactly *"VOID + re-entry"*, and the
  ADR repeats it. That path cannot be executed. The user is told
  *"Invoice INV-001 has already been recorded for this vendor as BILL-2026-0001"*
  while pointing at a bill that is VOID — a misleading message on top of a
  blocked workflow. (Related: `approve()`'s `status: { not: 'VOID' }` exclusion
  is unreachable dead logic, since create and the DB constraint are both
  stricter — see L-3.)
- **Impact:** The most common real AP correction — "I typed the amount wrong,
  void it and re-enter" — dead-ends. The workaround is inventing a fake invoice
  number (destroying the duplicate control's value) or editing the database
  directly (destroying the audit trail). Neither is acceptable in a finance
  module. Not caught by live verification because the re-entry case was never
  exercised.
- **Recommendation:** Decide the intended semantics explicitly, then make the
  schema match. Preferred: scope uniqueness to live bills — a partial unique
  index `(vendorId, vendorInvoiceNo) WHERE status <> 'VOID'` — and align
  `assertNoDuplicate()` to exclude VOID (approve already does). Alternative: keep
  the hard constraint and make correction an explicit *amend* flow instead of
  void + re-entry, updating the plan/ADR text accordingly. Either way, add the
  regression test that was missing: void → re-enter the same number.

**H-2 — Job cost variance converts currency with the latest rate while telling the user it used the bill-date rate, and silently hides missing rates**
- **Description:** Two related problems in `jobCostVariance()`.
  (a) `FxService.converter()` builds a map of the *latest* rate per pair
  (`orderBy effectiveDate asc`, later entries overwrite) and `toBase(amount,
  currency)` takes no date. The variance therefore uses today's configured rate,
  yet the cost panel footer states: *"Foreign-currency bills are converted at
  their bill-date rate; no revaluation is applied."* The code does the opposite
  of the sentence — every rate change silently re-values every historical
  variance.
  (b) When no rate exists for a currency, `toBase` returns the amount **1:1** and
  records it in `missing`. `FxService.warning()` exists for exactly this, and
  `PnlService` surfaces it as `fxWarning`. `jobCostVariance()` ignores both, so a
  variance can add USD to MYR at 1:1 and present the result as a confident number.
- **Impact:** (a) makes variance non-reproducible over time and the UI statement
  false — in a screen whose entire purpose is detecting cost discrepancies.
  (b) can produce a wildly wrong variance with no visible caveat, in the one
  place a user is being invited to act on the number. Live verification passed
  only because a USD rate happened to be configured.
- **Recommendation:** Pick one and make code and copy agree. Cheapest correct
  option: keep latest-rate conversion and change the panel text to say so. Better
  and closer to the approved intent: resolve the rate effective on
  `bill.billDate` (the data already carries `effectiveDate`) and keep the
  existing sentence. **Independently and immediately:** propagate
  `fx.warning(fx)` into the variance response and render it, matching the P&L
  convention — silently substituting 1:1 in a financial comparison is the more
  dangerous half of this finding.

### MEDIUM

**M-1 — Unallocated vendor spend is invisible**
- **Description:** `AP_ARCHITECTURE_DECISION.md` §2.5 rule 6 promises unallocated
  lines are *"permitted and visible — never silently toward some default job"*.
  They are permitted, but nothing surfaces them: no "unallocated" figure, filter
  or report exists, and such bills appear in no job's variance.
- **Impact:** Overhead and unallocated freight spend accumulate with no view;
  the ADR's own commitment is unmet, and cost leakage can hide precisely where
  nobody is looking.
- **Recommendation:** Add an "Unallocated" total to the AP aging response and an
  `Unallocated` option to the payables `jobId` filter. Small, uses existing indexes.

**M-2 — The list `jobId` filter and the variance calculator disagree on what belongs to a job**
- **Description:** `list()` matches `{ jobId }` OR `items.some.jobId`; the
  variance matches lines explicitly on the job OR unallocated lines whose header
  points at it. A bill whose header is Job A but whose lines all explicitly name
  Job B appears under Job A's filter while contributing nothing to Job A's cost.
- **Impact:** "Show me this job's bills" and "what was billed to this job"
  return inconsistent pictures — the kind of discrepancy that erodes trust in
  both numbers.
- **Recommendation:** Extract one predicate (`linesAllocatedTo(jobId)`) and have
  both call sites use it; the filter should reflect effective allocation.

**M-3 — The concurrency proof promised in the plan was not delivered**
- **Description:** Plan §16 committed to tests for "two simultaneous payments,
  and two simultaneous reversals, against one bill — serialized by the row lock",
  and live concurrency verification. Neither exists; the shipped tests assert only
  that `FOR UPDATE` appears in the SQL string. Sprint 02 set the precedent by
  proving the CN/DN race both in a test and live.
- **Impact:** The locking is almost certainly correct, but the invariant most
  likely to break under real multi-user load is unproven — and a future refactor
  that drops the lock would pass the whole suite.
- **Recommendation:** Port the Sprint-02 mutex-serialized fake for both paths,
  and add a live parallel-payment check to the next verification run.

**M-4 — A duplicate-bill race returns 500 instead of 409**
- **Description:** `assertNoDuplicate()` is check-then-insert. The DB constraint
  protects integrity, but `AllExceptionsFilter` has no Prisma `P2002` mapping, so
  a genuine race surfaces as `500 Internal server error` (message suppressed in
  production).
- **Impact:** Rare, but the one case where two clerks enter the same carrier
  invoice simultaneously produces an opaque failure instead of the clear 409 the
  feature is built around.
- **Recommendation:** Map `PrismaClientKnownRequestError` `P2002` to 409 in the
  global filter (benefits every module with a unique constraint), or catch it
  locally in `create()`/`update()`.

**M-5 — The down-migration commitment was not fulfilled**
- **Description:** Plan §19 states *"a `down` path is written and tested locally
  … before the migration is applied to production."* No down migration exists;
  the rollback story is the documented manual drop order only.
- **Impact:** Rollback depends on hand-executed SQL under pressure. Mitigated by
  the soft-disable path (revoke permissions), which is the better first response
  anyway — but the written commitment is unmet.
- **Recommendation:** Either add and test the down SQL, or amend the plan's
  rollback section to state that soft-disable is the supported mechanism and a
  down migration is deliberately not maintained.

**M-6 — Vendor spend is readable with `jobs.read` alone**
- **Description:** `GET /jobs/:id/cost-variance` is gated on `jobs.read`, so the
  Operation and Sales roles can read aggregate vendor billing per job without
  `payables.read`.
- **Impact:** Probably intended (operations need cost visibility) but never
  stated as a decision, and it partially undoes the deliberate separation of the
  `payables.*` scope.
- **Recommendation:** Make it explicit: either document the exposure as intended,
  or require `payables.read` for the billed/variance fields and return the
  estimated/recorded pair to `jobs.read` callers.

**M-7 — The ownership-boundary regression exists only as a manual run**
- **Description:** The AR/jobs/P&L-unchanged proof was executed live against
  captured baselines. Unit tests assert non-interaction with Prisma delegates,
  which is strong but not the same as proving the *reported figures* are stable.
- **Impact:** The invariant this whole sprint was judged on has no automated
  guard against a future sprint.
- **Recommendation:** Add an integration test (the MinIO-style CI rung already
  recommended as M-6 in the Sprint-02 review) that runs a full AP cycle against a
  test database and asserts AR aging, job cost/profit and P&L totals are
  unchanged.

**M-8 — Job-allocated tax is re-derived per line and can disagree with the bill**
- **Description:** The variance computes `amount × taxPct` per line, while the
  bill stores `taxAmt = round2(taxableSubtotal × taxPct)`. For split bills the
  sum of per-job billed totals may differ from the bill total by rounding, and
  nothing reconciles AP ledger totals against job allocations.
- **Impact:** Sub-cent to a few cents per bill — immaterial alone, but there is
  no report that ties "total approved payables" to "allocated + unallocated",
  so drift is undetectable.
- **Recommendation:** Allocate the stored `taxAmt` proportionally instead of
  re-deriving it, and add an allocation reconciliation line to AP aging
  (total ≡ allocated + unallocated).

**M-9 — A bill's header job cannot be cleared once set**
- **Description:** `UpdateVendorBillDto.jobId` is `@IsOptional() @IsUUID()`, and
  the service maps `undefined → no change`. There is no representable value for
  "remove the job", and `null` fails validation.
- **Impact:** A mis-assigned header job on a DRAFT bill can only be fixed by
  deleting and re-entering — which H-1 then blocks.
- **Recommendation:** Accept an explicit clear (empty string or `null` via
  `@ValidateIf`), mapping it to `null`.

### LOW

**L-1 — Reversal reason collected with `window.prompt()`** — inconsistent with the app's modal/`confirm` patterns, unstylable, untestable, and blocked in some embedded contexts. Replace with a small modal.

**L-2 — Vendor-note readiness is overstated** — `SPRINT_03_REPORT.md` §11 and the ADR say netting will arrive "with no signature change", but `applyVendorPayment()` hard-codes `noteNet = 0` and `outstandingOfBill()` has no such parameter. Both will need signatures widened. Harmless, but correct the claim.

**L-3 — Dead logic in `approve()`** — the `status: { not: 'VOID' }` duplicate exclusion can never permit anything, because `create()` and the DB constraint are both stricter. Remove it or fix H-1 and make it meaningful.

**L-4 — `as never[]` / `as never` type escapes** in `list()` and the aging query — consistent with existing patterns but still bypassing the typed enums now available.

**L-5 — Aging loads every open bill into memory** — mirrors AR; fine at SME volume, revisit both together.

**L-6 — `billsMayBeOutstanding` is true for CANCELLED jobs** — the check is `status !== 'COMPLETED'`, so a cancelled job still warns that bills may arrive.

**L-7 — No AP document view** — deliberately dropped in planning; note that a payment voucher / remittance advice is the genuinely useful artifact if this returns.

**L-8 — One transient test failure was never root-caused** — a single early run reported 205/206 and never reproduced across four subsequent full runs including an in-band run. Honestly recorded in the report; still unexplained.

**L-9 — No sanity check between `lineCurrency` and `fxRate`** — a USD line in an MYR bill with `fxRate = 1` is silently accepted. Shared with the invoice module, so consistent rather than new.

---

## Part C — Future compatibility

| Target | Verdict | Basis |
|---|---|---|
| **Booking** (P0-4) | ✅ Ready | AP touches only Vendor/Job. A booking-linked bill needs one nullable `bookingId` — additive. Nothing in the lifecycle or allocation model constrains it. |
| **Customer Portal** (P1-2) | ✅ Unaffected | AP is internal; customers never see vendor bills. One caution: if the portal ever reuses job endpoints, `GET /jobs/:id/cost-variance` must not be exposed — it reveals supplier pricing (see M-6). |
| **Accounting Integration** (P1-1) | ⚠️ Ready with one decision owed | Clean sub-ledger: bills = payable postings, payments = cash postings, `billDate` = tax point, per-line `accNo` = the mapping hook, SST-as-cost keeps mapping single-sided. **Owed decision:** a soft reversal has no contra entry, so the integration must define how a reversal is represented in the target ledger (reversing journal vs. deleted line). Decide before the integration sprint, not during. |
| **Vendor Credit Notes** | ✅ Design settled, minor rework | ADR §6 Option A stands; the calc engine, state machine and sequence service are all reusable by import. Correct L-2: `applyVendorPayment()` and `outstandingOfBill()` will need a `noteNet` parameter. |
| **Attachments** | ✅ Non-blocking | Deferred by PO Decision 5. `attachments` (ADR §7) adds `VENDOR_BILL` to the enum with no AP schema change. Still gated on the R2 cutover, which remains open. |
| **Payment Batch** | ✅ Non-blocking | Batch header + nullable `batchId` on `vendor_payments`, purely additive. Correctly not stubbed now. One interaction to design: whether reversing a batched payment detaches it from its batch. |
| **Approval Workflow** | ✅ Non-blocking | Insert `PENDING_APPROVAL` between DRAFT and APPROVED — one enum value, one edge, one guard. The existing `approvals` module supplies the matrix. |
| **Multi-company** | ⚠️ Distance moderate, unchanged | AP adds three tables to the eventual `companyId` migration. It does not make the problem harder in kind, but the unique key would need to become `(companyId, vendorId, vendorInvoiceNo)` — worth noting alongside H-1's fix so the index is designed once. |
| **Multi-tenant** | ⚠️ Epic, unchanged | Blocker remains the app-wide absence of row-level tenancy, not AP. Same conclusion as the Sprint-02 review. |

---

## Part D — Recommended remediation order

| Priority | Items | Effort | Rationale |
|---|---|---|---|
| 1 | **H-1** — decide uniqueness semantics; partial unique index + aligned service check + void→re-enter test (fixes L-3, and settles the multi-company key shape) | S | A finance module whose documented correction path cannot be executed |
| 2 | **H-2(b)** — surface `fxWarning` in the variance response and UI | XS | Silent 1:1 currency substitution in a decision screen |
| 3 | **H-2(a)** — align FX basis with the UI copy (bill-date resolution, or correct the sentence) | S | The screen currently asserts something untrue about money |
| 4 | M-4 (map P2002 → 409), M-9 (clearable header job) | XS each | Small correctness fixes; M-4 benefits every module |
| 5 | M-2 (one allocation predicate), M-1 (unallocated visibility), M-8 (proportional tax + reconciliation) | S–M | Makes the allocation story internally consistent and auditable |
| 6 | M-3 (concurrency tests + live check), M-7 (CI ownership-boundary regression) | M | Locks in the two invariants that matter most |
| 7 | M-5 (down migration or amend the plan), M-6 (state the permission decision) | XS | Close written commitments |
| 8 | L-1, L-2, L-4, L-6 | XS each | Polish batch |

---

## Part E — What this sprint did notably well

Worth recording, because these are patterns the next sprints should copy:

1. **Testing a property, not a value.** The ownership-boundary suite asserts AP
   *never touches* the job/invoice/note write delegates. That survives refactors
   in a way a numeric assertion would not.
2. **Confining a dangerous capability by construction.** Backward status moves
   exist only in a separate edge set reachable from one method, in a system with
   no generic status endpoint.
3. **Naming what does *not* need building.** Explicitly stating that AP aging
   requires no recalculation job, and why, prevents a future engineer from
   building one.
4. **Live verification catching what unit tests structurally cannot.** Both
   shipped defects (the `::uuid` cast breaking all four locked operations, and
   void returning 400 instead of the required 409) were invisible to tests that
   stub `$queryRaw`. This is the strongest available argument for finally adding
   the integration rung (M-7, and M-6 from the Sprint-02 review).
5. **Honest reporting.** The report records the transient test failure it could
   not reproduce rather than quietly dropping it.

---

*No code was modified and no existing document was changed during this review.
Awaiting Product Owner approval.*
