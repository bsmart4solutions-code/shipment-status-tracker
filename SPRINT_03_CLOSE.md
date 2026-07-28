# SPRINT 03 — CLOSE-OUT REPORT

**Sprint:** 03 — Accounts Payable (P0-3), including remediation Sprint 03A
**Status:** ✅ **CLOSED**
**Date:** 2026-07-28
**Commits:** `fcb3324` (Sprint 03) · `e33b801` (architecture review) · `72128dc` (Sprint 03A)
**Sources:** `PROJECT_AUDIT.md` · `BUSINESS_AUDIT.md` · `MVP_SCOPE.md` · `IMPLEMENTATION_ROADMAP.md` · `PRODUCT_BACKLOG.md` · `TODO.md` · `CHANGELOG.md` · `AP_ARCHITECTURE_DECISION.md` · `ARCHITECTURE_REVIEW.md` · `ARCHITECTURE_REVIEW_SPRINT02.md` · `ARCHITECTURE_REVIEW_SPRINT03.md` · `SPRINT_03_PLAN.md` · `SPRINT_03_REPORT.md` · `SPRINT_03A_REPORT.md`

---

## 1. Sprint Summary

### Goal
Give the business a working payables ledger: capture what each vendor has
billed, control it through an approval lifecycle, pay it in full or in parts,
correct payment mistakes without destroying the audit trail, see what is owed
and when — and connect that spend to jobs as a read-only cost variance that
never overwrites an existing figure.

### Delivered

**Phase A — AP Core**
- Vendor Bill document: header + lines, SST-aware, multi-currency, server-computed totals
- Lifecycle DRAFT → APPROVED → PARTIALLY_PAID → PAID, plus VOID
- Line-level job allocation (one consolidated carrier invoice covering many shipments)
- Bills with no job at all (overheads, rent, monthly charges)
- Duplicate-bill control, scoped per vendor and released on void
- Vendor payments with overpayment prevention and derived status
- **Payment reversal** — soft reversal preserving the audit trail, with outstanding and aging recalculated
- AP Aging — due-date buckets, per-vendor totals, total payable
- Frontend: payables list, bill builder, payment dialog with reversal, AP aging modal, sidebar entry
- Dedicated `payables.read` / `payables.write` permission scope

**Phase B — AP Extended**
- Read-only `GET /jobs/:id/cost-variance`
- Job cost panel: Estimated · Recorded · Vendor Bill Total · Variance
- Honest labelling when the recorded cost is still the quotation estimate
- Variance context: bill count, latest bill date, outstanding-bills warning

**Sprint 03A — remediation**
- VOID releases the vendor invoice number (partial unique index)
- Bill-date FX with historical stability; no silent 1:1 conversion
- Prisma P2002 mapped to HTTP 409 with actionable messages (all modules)

### Deferred (by explicit Product Owner decision)
| Deferred | Decision | Design status |
|---|---|---|
| Vendor bill attachments | PO Decision 5 | Settled — ADR §7 (polymorphic `attachments`) |
| Vendor credit/debit notes | PO Decision 4 | Settled — ADR §6 (separate model) |
| Purchase Orders · Three-way matching | PO Decisions 9, 10 | Out of MVP |
| Payment batches · Journals · General Ledger | PO Decisions 11, 13, 14 | Out of MVP |
| FX revaluation | PO Decision 12 | Out of MVP |
| Approval matrix | PO Decision 8 | Approvals module exists; one enum value away |
| Job cost detail lines | ADR §5.6 | Designed; the structural fix for `Job.actualCost` |

---

## 2. Business Value Delivered

| Value | Mechanism |
|---|---|
| **The business can answer "what do we owe, to whom, and when"** — it previously could not | AP aging with due-date buckets and per-vendor totals |
| **Paying the same carrier invoice twice is now structurally prevented** | Unique `(vendorId, vendorInvoiceNo)` among live bills, enforced at both service and database layers |
| **Consolidated carrier invoices are handled natively** | Line-level job allocation — the normal case in forwarding, not an exception |
| **Clerical errors are correctable without damaging the audit trail** | Soft payment reversal with mandatory reason, actor and timestamp; VOID + re-entry now works end to end |
| **Margin leakage becomes visible** | Job cost variance: what was quoted vs recorded vs actually billed |
| **The AR/AP sub-ledger pair is complete** | Books can be closed by export until accounting integration (P1-1) lands — the substitution `MVP_SCOPE.md` §3 relies on |
| **AP module coverage moved from 5% to substantially complete** | `BUSINESS_AUDIT.md` §16 listed vendor bill capture, matching and aging as entirely absent |

---

## 3. Architecture Achievements

1. **One writer per financial value, enforced structurally.** `AP_ARCHITECTURE_DECISION.md` §4 assigns exactly one owner to each of 19 financial values. AP never writes `Job.actualCost`, `Job.profit`, `actualRevenue` or the P&L — and this is proven by tests asserting the job/invoice/note *write delegates are never called*, not by spot-checking numbers.
2. **Derived-not-stored discipline.** Job billed totals and AP outstanding are computed on read. No second cost figure needs synchronising, which is precisely the denormalization trap that produced Sprint 01A's H1.
3. **A dangerous capability confined by construction.** Payment reversal is the only backward state move; it lives in a separate edge set that only `reversePayment()` consults, and no generic set-status endpoint exists — so backward transitions are unreachable by any other path.
4. **Single tax engine preserved.** AP totals delegate to the invoice engine, with a test asserting numeric parity. AP tax arithmetic cannot drift from AR because there is only one implementation.
5. **One FX warning mechanism, not two.** Sprint 03A added a date-aware converter that deliberately shares `missing`/`baseCurrency` with the existing one, and `warning()` was re-typed to serve both.
6. **Additive-only schema evolution.** Two migrations, no existing table altered destructively, no column dropped, renamed or retyped, no existing endpoint changed or removed.

---

## 4. Technical Achievements

- **Transaction safety:** approve, pay, reverse and void each run in one transaction with the bill row `SELECT … FOR UPDATE`; tests assert the lock is actually present in the SQL rather than trusting a comment.
- **Correct FK semantics throughout:** `Restrict` on counterparty and cash records, `Cascade` only for component lines, `SetNull` for audit users.
- **Partial unique index** delivering duplicate protection for live bills while releasing voided numbers — with verified proof (`prisma migrate diff` → empty) that Prisma will not undo it.
- **Historically stable FX:** rates resolve by `effectiveDate ≤ document date`, proven live by changing a rate underneath an existing figure.
- **Global error-handling improvement:** Prisma `P2002` now yields 409 with plain-language field names and targeted guidance for named partial indexes — benefiting every module, not just AP.
- **Filters declared on DTOs**, avoiding the `forbidNonWhitelisted` 400 bug still open on quotations/invoices/jobs.

---

## 5. Architecture Review Summary

### Sprint 03 review (`ARCHITECTURE_REVIEW_SPRINT03.md`)
18 areas reviewed plus 9 future-compatibility targets.
**Result: 0 Critical · 2 High · 9 Medium · 9 Low.**

Both High findings were cases where shipped behaviour contradicted what the
system told the user — not data-integrity defects:
- **H-1** — the unique key carried no status dimension, so voiding a bill permanently burned its invoice number, making the *documented* "VOID + re-entry" correction path impossible.
- **H-2** — the job cost variance converted with the latest rate while the UI claimed bill-date rates, and silently dropped the missing-rate warning that every other money report surfaces.

### Sprint 03A remediation (`SPRINT_03A_REPORT.md`)
Scope deliberately limited to the two approved High findings plus one approved
improvement. **No Medium or Low finding was implemented.**

### Resolved findings

| Finding | Resolution | Live proof |
|---|---|---|
| **H-1** | Partial unique index `WHERE status <> 'VOID'` + service check aligned | Create `INV-777` → approve → duplicate blocked (409) → void → **re-enter the same number successfully** |
| **H-2 (a)** | `FxService.historicalConverter()`; variance converts at each bill's own date; UI copy corrected | Inserting USD→MYR 9.99 left a March bill at **445** while an August bill moved to **999** |
| **H-2 (b)** | `fxWarning` + `fxIncomplete` surfaced; variance suppressed when a rate is missing | Bill predating all rates → explicit warning, `variance: null` |
| **P2002** | Mapped to 409 with actionable messages | Duplicate `POST /api/fx` → **409**, previously 500 |

### Remaining findings (open, not authorized for Sprint 03)

**From the Sprint 03 review (`ARCHITECTURE_REVIEW_SPRINT03.md` Part D order):**
M-9 clearable header job · M-2 one allocation predicate for list filter and variance · M-1 unallocated spend visibility · M-8 proportional tax allocation + AP/job reconciliation · M-3 concurrency tests and live check · M-7 CI regression for the ownership boundary · M-5 down migration or amend the plan · M-6 state the `jobs.read` exposure decision · L-1 … L-9.

**From earlier reviews, still open:**
`ARCHITECTURE_REVIEW.md` — M1, M5, M8, M9, M10, L1–L6 (M7 now **decided** in the ADR).
`ARCHITECTURE_REVIEW_SPRINT02.md` — M-1 … M-6, L-1 … L-8 (M-7 now **decided** in the ADR).

**Newly logged during Sprint 03A:**
- **P&L is not historically stable** — `PnlService` uses latest-rate conversion, so past periods re-value when a rate is added. Demonstrated accidentally (see §6). `historicalConverter()` is the ready-made fix; the open question is which date each figure should use — a Product Owner decision.
- **Intermittent test flake diagnosed, not fixed** — one run in five, `rate-sheet.parser.spec.ts`; most likely the exceljs round-trip test exceeding Jest's 5 s default under parallel load.

---

## 6. Regression Summary

The invariant this sprint was judged on: **AP must never change AR, job or P&L figures.**

| Value | Baseline | With live AP activity | After cleanup |
|---|---|---|---|
| AR aging outstanding | 2,138.40 | **2,138.40** | 2,138.40 |
| JOB-2026-0001 cost / profit | 1585 / 395 | **identical** | identical |
| JOB-2026-0005 cost / profit | 180 / 36 | **identical** | identical |
| P&L revenue / cost / gross profit | 3157.2 / 2521 / 636.2 | **identical** | 3157.2 / 2521 / 636.2 |
| Invoices / credit-debit notes | 2 / 0 | 2 / 0 | 2 / 0 |

Verified across a full AP cycle — create → approve → pay ×2 → reverse ×2 → void —
and again in Sprint 03A.

**One reading required investigation and is recorded rather than smoothed over.**
During Sprint 03A the P&L showed 4353.84 / 3518.2 / 835.64. This was **not**
caused by AP: JOB-2026-0005 is denominated in USD and `PnlService` converts at
the *latest* rate, so the test rate inserted to prove H-2 (USD→MYR 4.45 → 9.99)
re-valued it. The delta was confirmed arithmetically to the cent —
`180 × (9.99 − 4.45)` for cost, `216 × (9.99 − 4.45)` for revenue — and the P&L
returned to the exact baseline when the test rate was deleted. The episode
surfaced a genuine finding about the P&L itself (§5, now in `TODO.md`).

---

## 7. Testing Summary

| Milestone | Backend tests | Note |
|---|---|---|
| `PROJECT_AUDIT.md` baseline | 78 | plus 17 frontend = 95 total |
| After Sprint 01 / 01A | 86 → 106 | credit/debit notes + High remediation |
| After Sprint 02 / 02A | 140 → 153 | storage drivers, parser, startup gate |
| After Sprint 03 | 219 | +66 for AP |
| **After Sprint 03A** | **242** | +23 for H-1, H-2, P2002 |

**Current totals: 242 backend (18 suites) + 12 frontend = 254.**
Frontend moved 17 → 12 because five golden rate-parser tests migrated to the
backend in Sprint 02 when parsing moved server-side — and gained a real
workbook round-trip test in the process.

**Coverage character:** strong at the pure-logic and service layer — tax parity,
payment maths, reversal recomputation, every state-machine edge and non-edge,
duplicate and void guards, FX date resolution, and a *property-based* ownership
test. **The gap is structural:** there is still no integration/controller/E2E
rung, and **both defects that shipped in Sprint 03 were invisible to unit tests
because they stub `$queryRaw`.** That is the single strongest argument in the
project for T-6 / M-7.

All quality gates green at close: backend typecheck, frontend typecheck,
242/242 backend tests, 12/12 frontend tests, both production builds.

---

## 8. Migration Summary

| Migration | Sprint | Content | Risk |
|---|---|---|---|
| `20260727212330_accounts_payable` | 03 | 3 tables (`vendor_bills`, `vendor_bill_items`, `vendor_payments`) + `VendorBillStatus` enum + indexes + unique key | Additive only |
| `20260728020000_vendor_bill_void_releases_invoice_no` | 03A | Replaces the unconditional unique with a partial unique index (`WHERE status <> 'VOID'`) | Safe on existing data — anything satisfying the stricter constraint satisfies the looser one |

**Total migrations in the project: 17.** No existing table was altered
destructively in either. Non-schema data changes: one `sequences` row
(`vendorBill` → `BILL-YYYY-####`) and the `payables` permission group granted to
Administrator, Manager and Finance.

**Deployment note:** the seed (or manual permission insert) is **required** —
the module is unusable without the permission grants.

**Rollback:** preferred response is the soft-disable — revoke `payables.*` from
all roles; the UI entry disappears, every route returns 403, data is preserved.
A database rollback is safe only before first production use. Re-creating the
old unconditional unique index will fail if a voided number has since been
re-used — which is exactly the behaviour Sprint 03A enabled, so prefer rolling
forward.

---

## 9. Documentation Produced

| Document | Purpose |
|---|---|
| `AP_ARCHITECTURE_DECISION.md` | 13-section ADR — the binding architectural authority for AP |
| `SPRINT_03_PLAN.md` | Execution plan (20 sections), Phase A / Phase B split |
| `SPRINT_03_REPORT.md` | Delivery record incl. live verification and the two defects found during it |
| `ARCHITECTURE_REVIEW_SPRINT03.md` | 18-area review, 9 compatibility targets, 20 findings |
| `SPRINT_03A_REPORT.md` | Remediation record with root cause, fix, live proof and risks |
| `SPRINT_03_CLOSE.md` | This close-out |
| Updated | `CHANGELOG.md`, `TODO.md`, `PRODUCT_BACKLOG.md`, `IMPLEMENTATION_ROADMAP.md` |

---

## 10. Lessons Learned

1. **Live verification catches what unit tests structurally cannot.** Both Sprint 03 defects — the `::uuid` cast breaking all four row-locked operations, and void returning 400 instead of the required 409 — were invisible to tests that stub `$queryRaw`. *Action: stop deferring the integration rung.*
2. **Test properties, not values.** The ownership-boundary suite asserts AP *never touches* forbidden write delegates. That survives refactors in a way numeric assertions do not, and it is now the template for defending any invariant.
3. **Documents can drift from code, and that is a real defect.** H-1 and H-2 were both "the system says X, the code does Y". Neither corrupted data; both would have misled a user about money. *Action: treat user-facing claims about financial figures as testable assertions.*
4. **Investigate anomalous readings; do not smooth them.** The P&L shift during Sprint 03A looked like a regression, was proven arithmetically to be a test artifact — and in the process surfaced a genuine finding about P&L stability that no one had asked about.
5. **A documented workflow that the schema forbids is a design defect, not a doc bug.** The plan said "VOID + re-entry"; the constraint made it impossible. Reviews should check that stated workflows are executable.
6. **Deciding *not* to build something, in writing, has value.** Explicitly recording that AP aging needs no recalculation job — and why — prevents a future engineer building one.
7. **Scope discipline held.** Sprint 03A implemented exactly two High findings plus one approved improvement, with nine Medium and nine Low findings left untouched and tracked.

---

## 11. Known Technical Debt

| Area | Debt | Source |
|---|---|---|
| **Testing** | No integration / controller / E2E rung; ownership-boundary regression is manual only; one diagnosed test flake | T-6, review M-7, M-3 |
| **Operational** | Production R2 credentials not yet set — documents remain ephemeral; a deploy with `STORAGE_DRIVER=s3` now fails by design | Sprint 02 follow-up |
| **FX** | P&L (and other latest-rate consumers) are not historically stable | Logged Sprint 03A |
| **AP consistency** | List filter and variance disagree on job membership; unallocated spend invisible; per-line tax may not sum to bill tax | Review M-2, M-1, M-8 |
| **AR parity** | AR still has no payment-reversal endpoint although its own error message demands one | Sprint 03 follow-up |
| **Segregation of duties** | One `payables.write` covers create, approve, pay and reverse | PO Decision 8, review M-4 |
| **Schema self-documentation** | The partial unique index is invisible in `schema.prisma` (comment only) | Sprint 03A risk 1 |
| **Frontend** | Customer/vendor master-form helper duplication; `prompt()` used for reversal reason | T-4, review L-1 |
| **Tooling** | No ESLint/lint gate; `engines.node` unpinned; Next.js 14→16 and NestJS 10→11 upgrades pending | T-3, T-5 |
| **Storage hardening** | R2 object versioning off; delete-ordering seam; no `ContentType` on put; no orphan sweep | Sprint 02 review M-4, M-3, M-5 |

---

## 12. Remaining P0 Items

**5 of 8 P0 items are complete. 3 remain — all MVP go-live blockers.**

| ID | Item | Complexity | Why it still blocks |
|---|---|---|---|
| **P0-4** | Booking object + shipment operational milestones | **L** | The missing core forwarding step; turns a generic Job into an operable shipment file (`BUSINESS_AUDIT.md` §4, §5) |
| **P0-7** | Credit-limit enforcement at quote/order time | **S** | `creditLimit`, `outstandingLimit` and `creditHold` are captured but never enforced — core credit control |
| **P0-8** | AR overdue automation + Customer Statement (SOA) | **M** | Collections is where the business gets paid; the data exists, the cycle is manual |

*(Non-code, but a go-live blocker in practice: the production R2 cutover.)*

---

## 13. Remaining P1 Items

All twelve remain open; none started.

| ID | Item |
|---|---|
| P1-1 | Accounting integration (Xero / QuickBooks / structured export) — now has both sub-ledgers to push |
| P1-2 | Customer Portal |
| P1-3 | Shipping-document generation (HBL / MBL / DO / arrival notice) |
| P1-4 | Task engine |
| P1-5 | Structured shipment parties + routing |
| P1-6 | Container as a first-class entity |
| P1-7 | Rate management depth (sell-side cards, surcharges, versioning) |
| P1-8 | Multi-level / multi-document approvals |
| P1-9 | Audit-log viewer UI |
| P1-10 | Email templates + PDF attachments + inbound capture |
| P1-11 | Operational dashboards |
| P1-12 | OpenAPI/Swagger + webhooks + API keys |

Technical: T-3 (lint gate), T-4 (form helpers), T-5 (framework majors), T-6 (integration/E2E), T-8 (JWT rotation, with Portal).

---

## 14. Remaining P2 Items

All eleven remain open and **correctly gated** — none should start until a
paying customer operates that lane in-house (`PRODUCT_BACKLOG.md` note).

P2-1 Ocean Export/Import files · P2-2 Air Export/Import · P2-3 LCL/CFS ·
P2-4 Customs · P2-5 Full GL · P2-6 EDI · P2-7 Warehouse/WMS ·
P2-8 Carrier/tracking integrations · P2-9 BPM workflow engine ·
P2-10 Multi-option/tiered quotes · P2-11 CRM activities/pipeline.

Technical: T-7 (retire `legacy/index.html`, document speculative master fields).

---

## 15. Project Health

| Dimension | Score | Assessment |
|---|---|---|
| **Architecture** | **9/10** | Ownership boundaries enforced structurally; single tax engine; state machines with a confined reversal path; pluggable storage; additive-only migrations. Deductions: the partial index is invisible in the schema; two allocation predicates disagree (M-2). |
| **Maintainability** | **8/10** | Consistent module shape, pure logic isolated from I/O, exceptional written record. Deductions: customer/vendor form-helper duplication (T-4), no lint gate (T-3), knowledge dependency on a migration for uniqueness. |
| **Testability** | **7/10** | 242 backend tests with genuine property-based invariant testing. Capped by the absent integration/E2E rung — *proven* insufficient, since both Sprint 03 defects escaped unit tests — plus one diagnosed flake. |
| **Scalability** | **8/10** | Stateless API on the S3 driver; short row-locked transactions; single-owner balance functions; indexed access paths; batch aggregation instead of N+1. Deductions: both aging reports load all open rows; no tenancy dimension. |
| **Business Readiness** | **7/10** | The commercial cycle quote → job → invoice → CN/DN → AP → pay is complete and compliant. Three P0 blockers remain (credit control, collections/SOA, booking/milestones). |
| **Operational Readiness** | **6/10** | Weakest dimension. Strong: CI on both tiers with a live database, health endpoint reporting the storage driver, documented rollback and soft-disable. Weak: **production R2 credentials still unset** (documents ephemeral and `STORAGE_DRIVER=s3` deploys now fail by design), no lint gate, console error messages swallowed by the winston formatter, no integration tests in CI, no backup drill. |
| **Security** | **8/10** | Up from 7 at baseline audit: the only no-patch dependency (`xlsx`) removed, separate `payables` scope, P2002 no longer leaking as 500, production storage fail-fast, server-authoritative money, audit on every write. Remaining: framework major upgrades pending, no segregation of duties in AP, no refresh-token rotation. |
| **Documentation** | **9/10** | ADR, three architecture reviews, six sprint reports, `STORAGE.md`, planning set. Deduction: the roadmap had drifted until this close-out, and the schema does not self-document the partial index. |

**Overall: 7.8 / 10** — architecturally strong and financially disciplined;
held back by operational readiness and the missing test rung rather than by
design quality.

---

## 16. Go-Live Readiness

### Can a small freight forwarder already use the system?

**Yes for the commercial back-office. No for full operations.**

**Usable today, end to end:**
create customers and vendors → quote (with freight-professional fields and
approval) → convert to job → invoice with correct SST → correct with credit and
debit notes → record customer payments → capture vendor bills (including
consolidated invoices across jobs) → approve, pay, and reverse mistaken payments
→ read AR aging and AP aging → see job cost variance → export, print and email
documents.

**Two caveats a forwarder would feel immediately:**
1. **Documents are ephemeral until the R2 cutover** — uploads are lost on each deploy. This is configuration, not development.
2. **No operational shipment file** — jobs cannot be tracked through booking and milestones, so operations still run outside the system.

### What business functions remain before MVP?

| # | Function | Backlog | Effort |
|---|---|---|---|
| 1 | **Credit-limit enforcement** — block or warn at quote/booking time | P0-7 | S |
| 2 | **AR overdue automation + Customer Statement (SOA)** | P0-8 | M |
| 3 | **Booking + shipment milestones** | P0-4 | L |
| 4 | *(operational)* Production R2 cutover | Sprint 02 follow-up | Config |

`MVP_SCOPE.md` §4 exit criteria: **5 of 8 satisfied.** Outstanding are criteria
1 (credit limit blocks a quote), 2 (booking → milestones → delivered), 6 (overdue
+ reminder + statement), and criterion 3 (documents survive a redeploy) pending
the R2 cutover.

---

## 17. Recommended Sprint Order

| Sprint | Content | Effort | Rationale |
|---|---|---|---|
| **04** | **P0-7 credit-limit enforcement** + **T-6 integration-test rung** (carve-out) + **R2 cutover** (config) | ~2.5–3 dw | Smallest remaining P0 with data already captured, so it leaves room to finally add the test rung that two escaped defects have now justified. The R2 cutover is configuration and should not wait for its own sprint. |
| **05** | **P0-8 AR overdue automation + Statement of Account** | ~3–4 dw | Pairs naturally with the new AP side and completes the collections cycle; also the natural home for the deferred customer credit-balance ledger. |
| **06** | **P0-4 Booking + shipment milestones** → **MVP GA** | ~4–5 dw | The last MVP blocker and the pivot that unlocks shipping documents, structured parties, containers and the Customer Portal. |
| **07+** | Fast-follow: P1-1 accounting integration, P1-3 shipping documents, P1-2 Customer Portal | — | Unchanged from the roadmap; sequence after MVP GA. |

**Two standing recommendations:**
- **Fold the integration rung into Sprint 04 rather than deferring again.** It is the only remaining defence against the class of defect that unit tests structurally cannot catch, and both Sprint 03 defects were of that class.
- **Decide the P&L FX date question** before accounting integration — the converter now exists; only the business rule is missing.

---

## 18. Definition of Done — Confirmation

| Criterion | Status | Evidence |
|---|---|---|
| **Approved Plan** (`SPRINT_03_PLAN.md`) | ✅ Satisfied | All Phase A deliverables A1–A10 and all Phase B deliverables B1–B4 shipped. All 19 acceptance criteria met, including AC-12 (AR/job/P&L unchanged) and AC-18 (test data removed). Excluded scope §5 honoured in full — no PO, matching, batches, journals, GL, FX revaluation, attachments or vendor notes were built. |
| **Approved ADR** (`AP_ARCHITECTURE_DECISION.md`) | ✅ Satisfied | All 15 ratified PO decisions implemented as specified: separate vendor-note model (deferred), attachments deferred, bills never touch `Job.actualCost`, multi-job bills, per-vendor invoice uniqueness, SST as cost, jobless bills, no approval matrix, no PO/matching/batch/revaluation/journal/GL, Sprint 01–02 architecture preserved. |
| **Architecture Review** (`ARCHITECTURE_REVIEW_SPRINT03.md`) | ✅ Performed and approved | 18 areas plus 9 compatibility targets reviewed; 0 Critical, 2 High, 9 Medium, 9 Low; both High findings evidenced against source, not inferred. |
| **Sprint 03A Remediation** (`SPRINT_03A_REPORT.md`) | ✅ Complete | H-1 and H-2 fixed and live-verified; approved P2002 → 409 improvement delivered; no unapproved Medium or Low finding implemented; 242/242 tests, both builds clean, regression confirmed, all test data and the test FX rate removed. |

**Sprint 03 is confirmed CLOSED.**

---

## Executive Summary

**Sprint 03 delivered Accounts Payable — the single largest capability gap in the
system — and is now closed.**

**What the business gained.** Before this sprint the company could invoice
customers but had no record of what it owed its carriers and hauliers; that
information lived in a spreadsheet. It can now capture each vendor's invoice,
approve it, pay it in full or in instalments, reverse payment mistakes without
losing the audit trail, and see at a glance what is owed, to whom, and when.
Paying the same carrier invoice twice — the most expensive routine error in
payables — is now structurally impossible. A new job cost view shows what was
quoted, what was recorded, and what suppliers actually billed, making margin
leakage visible for the first time.

**Quality and control.** The work was governed by an approved architecture
decision record, delivered against an approved plan, independently reviewed, and
then remediated in a tightly-scoped follow-up sprint. The review found no
critical defects. Two high-priority issues were found and fixed: voiding a bill
had permanently blocked re-entering its invoice number, and currency conversion
in the cost view used today's exchange rate while telling the user it used the
rate from the bill's own date. Both were corrected and verified on a running
system. Throughout, an explicit safeguard held: accounts payable never alters
customer receivables, job profitability or the profit-and-loss report — verified
figure by figure.

**Where the project stands.** Five of eight go-live blockers are complete. The
system is already usable for the full commercial back-office — quoting,
invoicing, credit and debit notes, receivables and now payables. Three business
functions remain before MVP: credit-limit enforcement, automated collections
with customer statements, and the booking-to-milestone shipment file. Overall
project health is **7.8/10**, with architecture (9/10) and documentation (9/10)
strong and operational readiness (6/10) the clear weak point.

**Two things need management attention.**
1. **Cloud storage credentials are still not configured in production.** Until they are, uploaded documents are deleted on every deployment. This is a configuration task, not development work, and it is the fastest risk reduction available.
2. **Automated end-to-end testing remains absent.** Both defects that reached the review were of a type unit tests structurally cannot catch. The recommendation is to add this in the next sprint rather than defer it again.

**Recommended next steps:** Sprint 04 — credit-limit enforcement, the
integration-test rung, and the storage cutover; Sprint 05 — collections and
customer statements; Sprint 06 — booking and shipment milestones, reaching MVP
general availability.

*Awaiting Product Owner approval before any Sprint 04 planning.*
