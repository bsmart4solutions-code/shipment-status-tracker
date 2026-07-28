# SPRINT 04 PLAN — Credit Limit Enforcement · Integration Test Layer · R2 Cutover

**Status:** PROPOSED — **business policy approved (D-1 … D-9)**, awaiting final Product Owner approval to implement. **No code written, no migration created, no ADR created.**
**Date:** 2026-07-28 · **Revised:** 2026-07-28 to reflect the approved policy decisions
**Aligned with:** `PROJECT_AUDIT.md` · `BUSINESS_AUDIT.md` §1, §15 · `MVP_SCOPE.md` §2B · `IMPLEMENTATION_ROADMAP.md` (reconciled) · `PRODUCT_BACKLOG.md` (P0-7, T-6) · `TODO.md` · `ARCHITECTURE_REVIEW.md` · `ARCHITECTURE_REVIEW_SPRINT02.md` · `ARCHITECTURE_REVIEW_SPRINT03.md` · `AP_ARCHITECTURE_DECISION.md` · `SPRINT_03_CLOSE.md` §17
**Backlog:** **P0-7** (Credit-limit enforcement) · **T-6** (Integration/E2E tests) · Sprint 02 operational follow-up (R2 cutover)

> **What changed in this revision.** All nine policy decisions are now approved,
> and they **narrow the sprint substantially**: enforcement applies at exactly
> one point (invoice issue), exposure is exactly the existing AR balance, and the
> override is a reason + audit record rather than a new entity. The net effect is
> **zero database changes for the entire sprint** and a materially smaller
> surface than the original draft. Two small operational consequences of the
> approved policy are flagged for confirmation in §6.1 — neither blocks planning.

---

## 1. Sprint Goal

> Prevent the company from extending credit it did not intend to extend — by
> hard-blocking invoice issue when a customer's effective credit limit would be
> exceeded or they are on credit hold — and close the two gaps Sprint 03 proved
> are costing us: no automated test layer that can catch database-level defects,
> and production documents still sitting on ephemeral storage.

---

## 2. Business Objectives

1. **Turn captured credit data into an enforced control.** `creditLimit`,
   `outstandingLimit` and `creditHold` have been stored since the customer-master
   sprint and enforced nowhere (`PROJECT_AUDIT.md` §4, `BUSINESS_AUDIT.md` §1/§15).
2. **Block exposure at the moment it is actually created.** Per D-2, only an
   **issued invoice** creates financial exposure — so that is the single point
   where the control belongs.
3. **Make credit decisions explicit, attributable and reversible.** A block is a
   recorded event; an override is a deliberate, reasoned act by an authorised role.
4. **Close the testing gap Sprint 03 exposed.** Both defects that shipped in
   Sprint 03 — the `::uuid` cast breaking four row-locked operations, and void
   returning 400 instead of the required 409 — were **structurally invisible to
   unit tests**, which stub `$queryRaw`. Evidence-backed necessity, not hygiene.
5. **Stop losing documents on every deploy.** Production still runs without R2
   credentials; uploads are destroyed on each release.
6. **Prepare P0-8.** The Statement of Account and overdue automation in Sprint 05
   consume exactly the exposure figure this sprint centralises.

---

## 3. Business Value

| Value | Mechanism | Who feels it |
|---|---|---|
| **Bad-debt prevention at the point of commitment** | Invoice issue is refused when the effective limit would be exceeded, or the customer is on hold | Owner / Finance |
| **Credit decisions become auditable** | Every block and every override is recorded with figures, actor and reason | Owner / auditor |
| **Exposure visible before it becomes a problem** | Credit panel on the customer; live indicator on the invoice screen | Finance / Sales |
| **A defect class that reached production becomes catchable** | Controller-level tests over real HTTP against a real database in CI | Whole team |
| **Uploaded documents survive deployment** | R2 cutover | Operations |
| **Sprint 05 gets cheaper** | One exposure function already built and proven | Product |

---

## 4. Scope

### Phase A — Mandatory (committed)

| # | Deliverable |
|---|---|
| **A1** | **Customer exposure — single owner.** Outstanding AR per customer, computed from the existing balance logic, in base currency |
| **A2** | **Credit evaluation engine** — pure, unit-testable: effective limit, hold, headroom, ALLOW/BLOCK outcome |
| **A3** | **Hard block at invoice issue** — the only enforcement point (D-2) |
| **A4** | **Credit exposure API + UI** — customer credit panel; live credit state on the invoice screen before issuing |
| **A5** | **Manual override** — Administrator and Manager only, mandatory reason, audit-logged (D-7) |
| **A6** | **Integration test layer (T-6)** — harness, real-HTTP controller tests, CI job, first coverage wave (§16) |
| **A7** | **Production Cloudflare R2 cutover** — deployment configuration only, Sprint 02 architecture reused verbatim |

### Phase B — Stretch (only if Phase A completes early)

| # | Item | Why stretch |
|---|---|---|
| B1 | Exposure column + "over limit / on hold" filter on the customer list | Reporting convenience; the control works without it |
| B2 | Playwright golden-path smoke test (login → quote → invoice) | The controller layer delivers most of T-6's value; browser automation is the expensive half |
| B3 | Credit status cross-link on the AR aging screen | Cross-link only, zero new logic |

**Phase gate:** Phase B is additive reporting over Phase A data. If Phase A runs
long, Phase B moves to Sprint 04B with nothing left half-built.

---

## 5. Explicitly Out of Scope

| Excluded | Authority |
|---|---|
| **Blocking quotations, jobs, customer maintenance or payment receipt** | **D-2** — only issued AR creates exposure |
| **Overdue-triggered blocking / automatic credit hold from ageing** | **D-6** — belongs to the Statement of Account module (P0-8) |
| **Warning-only mode / soft-warning configuration** | **D-1** — hard block, no warning-only mode |
| **Global credit limits or global credit settings** | **D-9** — per customer only |
| **Customer-specific credit currencies** | **D-8** — base currency only |
| **Including quotations, jobs, draft invoices or future estimates in exposure** | **D-3** |
| **AR overdue automation, reminder emails, Statement of Account** | P0-8 — Sprint 05 |
| **Customer credit-balance ledger** (refund-on-account) | Deferred since Sprint 01A; belongs with P0-8 |
| **Vendor-side credit control** | Different business question |
| **Multi-level credit approval matrix / delegation** | Same deferral as quotations and AP |
| **Credit scoring, risk weighting, credit insurance** | Beyond MVP |
| **Any change to the tax engine, FX engine, AP module or storage architecture** | Architecture constraints |
| **Storage redesign of any kind** | R2 work is configuration only |

---

## 6. Architecture Decisions — APPROVED

All nine decisions are approved and are treated as binding. Recorded here as the
implementation contract.

| # | Decision | Approved policy |
|---|---|---|
| **D-1** | Enforcement strictness | **Hard block.** Invoice issue is prevented when the effective credit limit would be exceeded. **No warning-only mode.** |
| **D-2** | Enforcement point | **Invoice issue only.** Quotations, jobs, customer maintenance and payment receipt are never blocked — only issued AR creates financial exposure. |
| **D-3** | Exposure definition | **Outstanding AR** = issued invoices − received payments − issued credit notes + issued debit notes. Excludes quotations, jobs, draft invoices and future estimates. **Reuse the existing AR balance logic; introduce no second calculation.** |
| **D-4** | Limit fields | `creditLimit` = contractual ceiling; `outstandingLimit` = temporary operational ceiling. **Effective limit = MIN(creditLimit, outstandingLimit)**; a NULL `outstandingLimit` is ignored. |
| **D-5** | Credit hold | **Absolute stop.** `creditHold = true` ⇒ invoice issue always fails, regardless of balance. |
| **D-6** | Overdue policy | Overdue customers do **not** become credit-held automatically. No overdue blocking in Sprint 04. |
| **D-7** | Manual override | **Administrator and Manager only.** Mandatory reason, audit-logged, explicit. **Sales may never override.** |
| **D-8** | Currency | **Company base currency** for all exposure and limits. No customer-specific credit currencies. Reuse the existing FX engine. |
| **D-9** | Policy scope | **Per customer.** No global credit limit or global policy setting. |

### 6.1 Two operational consequences requiring confirmation

Neither blocks planning or estimation; both are consequences of the approved
policy that no decision explicitly covers. Flagged rather than assumed.

**C-1 · `Customer.blacklist` is not enforced in Sprint 04.**
D-5 approves `creditHold` as the absolute stop. The schema also carries a
separate `blacklist` flag (added with the customer master, likewise unused). No
approved decision covers it, so this plan enforces **`creditHold` only** and
leaves `blacklist` untouched. *Confirm, or state whether `blacklist` should
behave identically to `creditHold`.*

**C-2 · Behaviour when exposure cannot be computed (missing FX rate).**
D-8 requires base-currency exposure via the existing FX engine, and the Sprint 03A
rule (H-2) forbids silently converting at 1:1. If a customer holds an invoice in
a currency with no configured rate, exposure is **not computable**. Under a
hard-block policy there are only two coherent options, and this plan assumes the
first: **fail closed** — refuse to issue with a *distinct* error naming the
missing rate (never a misleading "over limit"), remediable by adding the rate or
by an authorised override. The alternative — allowing issue when credit cannot be
evaluated — would silently bypass the control. *Confirm the fail-closed default.*

**Removed by the approved decisions:** the original draft proposed a global
feature switch so enforcement could ship disabled. **D-9 (per customer, no global
policy) removes that option** — there is no global toggle to ship. The practical
consequence is carried in §15 R-1 and §19.

---

## 7. Database Changes

### **None. Zero migrations for this entire sprint.**

- **Enforcement** needs no new columns: `creditLimit`, `outstandingLimit` and
  `creditHold` already exist on `Customer`.
- **Exposure** is **derived, never stored** — the Sprint 03 discipline.
- **The override** (D-7) requires **no table**: it is a reason supplied on the
  issue request and recorded in the existing **audit log**, which already carries
  user, IP, user-agent and a JSON detail payload. A dedicated `credit_overrides`
  entity would duplicate what `AuditService` already stores.
- **D-9 (per customer, no global settings)** removes the `SettingKV` threshold row
  the original draft anticipated.
- The integration test layer and the R2 cutover require no schema change.

The only structural addition anywhere is one **permission code** (`credit.override`)
plus its role-matrix grants — seed data, not schema.

---

## 8. Backend Design

Architecture constraints are binding; in particular **no second implementation of
the AR balance formula**.

### A1 · Exposure — one owner (the critical design point)
Open finding **M-10** records that the AR balance formula
(`totalAmount − amountPaid + noteNet`, ISSUED notes only) has one definition but
two call sites (`agingReport`, and `recordPayment` via `issuedNoteNet`). D-3
mandates reuse, so credit exposure must **not** become the third.

Design: a single `customerExposure(customerId)` — and a batch
`customerExposures(ids[])` for list views — owned by the invoices/AR module and
built on the existing `issuedNoteNet` primitive. It returns outstanding AR in
**base currency** (D-8), converting through `FxService`. Where the existing call
sites can adopt the shared helper without behavioural change, they should —
**closing M-10 as a side effect rather than adding to it.**

### A2 · Credit engine — pure, mirroring the proven pattern
A new `credit.logic.ts`, deliberately shaped like the working
`quotations/approval.logic.ts` (pure function + explicit assertion):

- `effectiveLimit(creditLimit, outstandingLimit)` — **MIN of the non-null values;
  NULL `outstandingLimit` ignored; both NULL ⇒ no limit** (D-4).
- `evaluateCredit({ exposureBase, effectiveLimit, creditHold, newInvoiceBase })
  → { outcome: 'ALLOW' | 'BLOCK', reason, exposureBase, effectiveLimit, headroom, projected }`
  - `creditHold === true` ⇒ **BLOCK**, always, regardless of balance (D-5)
  - no effective limit ⇒ **ALLOW** (an unset limit means *no* limit, never zero)
  - `projected = exposureBase + newInvoiceBase`; **BLOCK when `projected > effectiveLimit`**
  - **No WARN outcome** — D-1 admits no warning-only mode. (A display-only
    utilisation percentage may be derived for the UI; it never changes the outcome.)
- `assertCreditAllows(decision, override?)` — throws a typed conflict unless a
  valid override is present.

Pure, no I/O, fully unit-testable — money comparison happens server-side only.

### A3 · Enforcement — exactly one point
Inside `InvoicesService.issue()`, within its existing transaction: load the
customer's credit fields, compute exposure, evaluate, and assert. Issue is the
**only** gated action (D-2); `create`, `update`, `recordPayment`, `cancel`,
quotations and jobs are untouched.

### A5 · Override
`issue()` accepts an optional `creditOverrideReason`. When the decision is BLOCK:
- no reason ⇒ **409** with the figures;
- reason present and the caller holds `credit.override` ⇒ proceed, and audit-log
  the override with exposure, effective limit, projected total, invoice and reason;
- reason present without the permission ⇒ **403**.

Blocks are audit-logged too, so a refused issue is as traceable as an allowed one.

### Reuse, not duplication
`FxService` for base-currency conversion (**no new FX logic**); `AuditService` for
blocks and overrides; existing state machines untouched — **credit gating is a
precondition on the existing DRAFT → ISSUED transition, not a new state.**

---

## 9. Frontend Design

| Surface | Content |
|---|---|
| **Customer credit panel** (customer detail/form) | Effective limit (and which field set it) · current exposure · headroom · credit-hold status · base-currency basis |
| **Invoice screen — credit state before issuing** | For a DRAFT invoice: customer exposure, effective limit, and the projected total after this invoice, with a clear indicator of whether Issue will be refused |
| **Blocked issue** | Blocking dialog naming exposure, effective limit, projected total and the shortfall — never a generic failure |
| **Override control** | Visible only to Administrator/Manager; requires a typed reason before it can be submitted (the pattern used for payment reversal) |
| **Phase B** | Exposure column + "over limit / on hold" filter on the customer list; credit cross-link on AR aging |

All new views carry **loading / empty / error states** and are responsive.
**No changes to quotation, job, AP or notes screens** (D-2).

---

## 10. API Design

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/customers/:id/credit` | `customers.read` | Effective limit, exposure, headroom, credit-hold, base currency, outcome for a hypothetical amount |
| GET | `/customers/credit-summary` *(Phase B)* | `customers.read` | Batch exposure for the customer list — **one aggregate query, never N+1** |

**Changed behaviour, unchanged contract:**
`POST /invoices/:id/issue` gains an **optional** body field
`creditOverrideReason`. Existing callers that send no body continue to work
unchanged; the endpoint now returns **409 Conflict** when credit blocks. **No
request or response shape is otherwise altered, no endpoint is removed, and no
other endpoint changes behaviour.**

Any new list filters are declared on a `ListXDto extends PaginationDto` — never
extra `@Query()` params (the bug still open on quotations/invoices/jobs).

---

## 11. Security

| Area | Control |
|---|---|
| **Authorization** | Credit standing readable with `customers.read`. Override requires the new `credit.override` permission — never bundled into `customers.write`, so *viewing* credit, *changing* a limit and *overriding* a block remain three distinct rights |
| **Sales may never override** (D-7) | Enforced by the role matrix, not by UI hiding alone — the server rejects it with 403 |
| **Server-authoritative decisions** | Exposure, effective limit and outcome are computed server-side; a client cannot assert it is within limit or supply its own exposure |
| **Audit** | Both blocks and overrides logged with user, IP, user-agent, exposure, effective limit, projected total, invoice id and (for overrides) the reason |
| **Information exposure** | Credit standing is commercially sensitive: never returned to a caller without `customers.read`, and never placed in an unauthenticated or portal-facing payload |
| **Integration tests** | Run against a disposable CI database with CI-only secrets; never production data or real credentials |
| **R2 cutover** | Bucket-scoped API token, object read/write only, private bucket, credentials only in Render's environment store — never committed (`STORAGE.md` §9) |

---

## 12. Validation Rules

- `creditLimit` / `outstandingLimit`: optional; when present must be **≥ 0**.
  **NULL ⇒ no ceiling from that field** (never zero).
- **Effective limit** = MIN of the non-null values; both NULL ⇒ **no limit ⇒ ALLOW** (D-4).
- `creditHold = true` ⇒ **BLOCK unconditionally**, evaluated before any arithmetic (D-5).
- Exposure counts **only** issued invoices, received payments and **ISSUED**
  credit/debit notes (D-3). DRAFT and CANCELLED invoices, DRAFT/CANCELLED notes,
  quotations and jobs never contribute.
- All amounts converted to **base currency** via `FxService` (D-8); an
  unresolvable rate **fails closed with a distinct error** and never converts 1:1
  (H-2 rule, pending confirmation C-2).
- `creditOverrideReason`: when supplied, **required non-empty**; only honoured for
  callers holding `credit.override`.
- The client supplies no monetary input to the decision.

---

## 13. Permission Model

| Permission | Status | Grants |
|---|---|---|
| `customers.read` | existing | View credit panel, exposure and invoice-screen credit state |
| `customers.write` | existing | Edit `creditLimit`, `outstandingLimit`, `creditHold` (already the case today) |
| `invoices.write` | existing | Issue invoices (unchanged) |
| **`credit.override`** | **new** | Proceed past a credit block with a reason |

Role matrix (seed, additive), per D-7:

| Role | `credit.override` |
|---|---|
| Administrator | ✅ |
| Manager | ✅ |
| Finance | ❌ |
| Sales | ❌ **never** |
| Operation / Viewer | ❌ |

Added to the typed `PermissionCode` union so a typo is a compile error.

---

## 14. Performance

| Concern | Design |
|---|---|
| Exposure at issue time | One indexed aggregate over that customer's live invoices plus one grouped note query — the shape AR and AP aging already use. Adds one bounded read inside an existing transaction |
| **Customer list (Phase B)** | **One batch aggregate for all visible customers — never one query per row.** The explicit N+1 guard, following the Sprint 03 variance precedent |
| Invoice screen indicator | One call to the credit endpoint per opened invoice; not polled |
| Caching | None — credit state must be current at the moment of decision; stale credit data is worse than a marginally slower issue |
| FX | Existing `FxService` converter; no per-row rate lookups |
| Integration tests | Expected to add minutes to CI, hence a **separate parallel job** so the critical path is unchanged |

---

## 15. Risks

### HIGH

**R-1 · Hard block can halt invoicing on day one, and there is no global switch.**
Limits captured during data entry were never load-bearing; enabling a hard block
against real data may instantly refuse invoices for customers who are legitimately
over an unmaintained limit. **The approved policy removes the mitigation the
original draft proposed** — D-9 (per customer, no global policy) means there is
no feature flag to ship disabled, and D-1 admits no warning-only mode.
*Mitigation, now mandatory rather than advisory:*
1. **Dry-run report before go-live** — list every customer whose current exposure
   already exceeds their effective limit, so limits can be corrected first. This
   is a read-only report and is included in Phase A.
2. The **override path (D-7)** is the operational escape valve; Administrator and
   Manager coverage must exist on day one.
3. **Data hygiene pass** — because a NULL limit means "no limit", customers who
   should be unrestricted simply carry no value; those that must be enforced get a
   deliberate one.

**R-2 · Exposure could become a third definition of "what is owed".**
AR balance already has one formula with two call sites (M-10); a careless
implementation adds a third and they drift — the exact failure mode of Sprint 01A's
H1/H2. *Mitigation:* single-owner function mandated in §8; treat closing M-10 as
part of A1's definition of done, verified by test.

### MEDIUM

**R-3 · The integration layer could balloon the sprint.** A full E2E suite is its
own project. *Mitigation:* Phase A delivers the harness plus the money paths unit
tests structurally cannot reach; Playwright is Phase B.

**R-4 · Test-database strategy can make CI slow or flaky.** *Mitigation:*
transaction-rollback isolation, one migrated schema per run, a separate parallel
job (§16).

**R-5 · The R2 cutover depends on an external account and human action.**
Configuration, but not *our* configuration. *Mitigation:* checklist with a named
owner and a verification step; it does not block A1–A6.

**R-6 · Fail-closed on missing FX rates could refuse legitimate invoices** (C-2).
A customer holding an invoice in an unconfigured currency cannot be evaluated.
*Mitigation:* distinct, actionable error naming the missing rate; override
available; the dry-run report (R-1) surfaces affected customers in advance.

**R-7 · Override becomes routine**, turning the control into theatre.
*Mitigation:* overrides are audit-logged with figures and reason and should be
reviewed periodically; restricting to Administrator/Manager (D-7) is the primary
guard.

### LOW

**R-8 · Sales friction** at month-end when limits bite. Mitigated by showing the
credit state on the invoice screen *before* Issue is attempted, so it is never a surprise.
**R-9 · Known flake** in `rate-sheet.parser.spec.ts` may surface in the new CI job; diagnosed in `TODO.md`, fix is a per-test timeout.
**R-10 · `blacklist` remains unenforced** (C-1) — a user may expect it to block. Mitigated by confirming C-1 before implementation.

---

## 16. Testing Strategy

### Unit
- `effectiveLimit`: both set (MIN) · only `creditLimit` · only `outstandingLimit` · **both NULL ⇒ no limit** · zero limit is a real limit, distinct from NULL.
- `evaluateCredit`: under limit · **exactly at the limit** (boundary) · over limit · **credit hold overrides everything, including a zero balance** · no limit ⇒ always ALLOW · zero-value invoice.
- Exposure arithmetic: invoice + payment + issued CN + issued DN combinations; DRAFT/CANCELLED excluded; multi-currency conversion to base; **refuse-to-decide when no rate resolves**.
- Override: reason required; permission required.

### Integration — **the first implementation wave (T-6)**

Purpose: **detect the defect classes unit tests structurally cannot.** Sprint 03
shipped two such defects because unit tests stub `$queryRaw`.

| Aspect | Design |
|---|---|
| **Framework** | `@nestjs/testing` + `supertest`, booting the real Nest application and driving it over **real HTTP**. Chosen precisely because it exercises the full request pipeline rather than a service in isolation. Both are new dev dependencies |
| **Pipeline coverage — explicit** | Every test traverses **guards** (`JwtAuthGuard`, `PermissionsGuard`), the **global `ValidationPipe`** (`whitelist` + `forbidNonWhitelisted`), the **global exception filter**, **Prisma**, and the database. A test that bypasses any of these is not an integration test |
| **Separation** | New suffix `*.e2e-spec.ts` with its own Jest config; `npm test` remains the fast unit loop, `npm run test:e2e` runs integration. The current `testRegex` (`.*\.spec\.ts$`) must not collide |
| **Database strategy** | A **real Postgres**, never mocks. CI already provisions `postgres:16-alpine` and runs `prisma migrate deploy`; the e2e job reuses that with a dedicated database name. Locally it targets the existing Docker instance |
| **Transaction rollback** | Each test runs inside a transaction that is **rolled back afterwards**, so tests neither see nor leave each other's data and the suite is order-independent. **Documented exception:** paths that open their own transaction (invoice issue, note issue, bill approve/pay/reverse/void) cannot be wrapped, so those tests perform targeted cleanup of the rows they create — a deliberate, recorded exception, not an oversight |
| **Row locking** | Concurrency tests fire genuinely parallel requests at the row-locked paths (`FOR UPDATE`) — invoice payment, note issue, bill approve/pay/reverse — asserting exactly one succeeds and the loser receives a correct typed error rather than a corrupted total. This closes review **M-3**, which unit tests can only simulate |
| **P2002 handling** | Force real unique-constraint violations (duplicate FX rate; duplicate vendor invoice under race) and assert **409 with an actionable message**, not 500 — verifying the Sprint 03A filter against a real Prisma error rather than a synthetic one |
| **First coverage wave** | ① every row-locked money path executed against a real database (the `::uuid`-class defect); ② status-code contracts end-to-end: void-with-payments ⇒ **409**, overpayment ⇒ 400, duplicate vendor invoice ⇒ 409, P2002 ⇒ 409, **credit block ⇒ 409**, override without permission ⇒ **403**; ③ **the ownership-boundary regression automated** (closing review **M-7**): a full AP cycle leaves AR aging, job cost, job profit and P&L numerically unchanged; ④ credit enforcement: block, allow, hold, override, and unset-limit-never-blocks |
| **Fixtures** | A minimal builder (one customer, one vendor, one job) rather than the demo seed, so each test states its own preconditions |
| **CI integration** | A **new parallel job** `backend-e2e` beside the existing `backend` job, with its own Postgres service, running migrations then `npm run test:e2e`. Parallel so the critical path is unchanged; required for merge once green and stable |
| **Playwright** | **Phase B only**, deliberately narrow: one golden-path smoke test (login → quote → invoice), as `IMPLEMENTATION_ROADMAP.md` Sprint 0 originally specified |

### Live Verification
Credit: customer under limit issues normally · at/over limit is refused with the
figures · **credit hold blocks even at zero balance** · unset limit never blocks ·
override succeeds for Manager with a reason and is audit-logged · override is
refused (403) for Sales · block and override both appear in the audit log.
R2: upload → **redeploy** → download byte-identical, and `/health` reports
`storageDriver: "s3"`.

### Regression
AR, AP, jobs, quotations and P&L verified **numerically unchanged** by credit
enforcement when no limit is breached — same baseline-capture method as Sprints 03
and 03A. All test data removed afterwards; sequences reset.

---

## 17. Acceptance Criteria

**Credit — exposure and evaluation**
1. Customer exposure equals **issued invoices − received payments − issued credit notes + issued debit notes**, in base currency (D-3, D-8).
2. Exposure is produced by **one** function shared with AR; **no third implementation of the balance formula exists in the codebase** (verified by test and review).
3. Quotations, jobs, draft invoices and future estimates contribute **nothing** to exposure (D-3).
4. **Effective limit = MIN(creditLimit, outstandingLimit)**; a NULL `outstandingLimit` is ignored; **both NULL ⇒ no limit ⇒ never blocked** (D-4).

**Credit — enforcement**
5. Issuing an invoice that would take exposure **above** the effective limit is **refused with 409**, naming exposure, effective limit, projected total and shortfall (D-1).
6. Issuing at or below the effective limit succeeds unchanged.
7. **`creditHold = true` refuses invoice issue unconditionally**, including at zero balance (D-5).
8. **No warning-only mode exists** anywhere in the delivered behaviour (D-1).
9. **Quotations, jobs, customer maintenance and payment receipt are never blocked** by credit (D-2) — asserted by regression test.
10. No overdue-based blocking exists (D-6).
11. Exposure that cannot be computed for want of an exchange rate **fails closed with a distinct error naming the missing rate** — never a silent 1:1 conversion and never a misleading "over limit" (D-8; C-2 pending confirmation).

**Credit — override and audit**
12. An Administrator or Manager may override a block by supplying a **mandatory non-empty reason**; the invoice then issues (D-7).
13. A **Sales** user attempting an override receives **403** — enforced server-side, not by hiding the control (D-7).
14. Overrides and blocks are both **audit-logged** with user, IP, user-agent, exposure, effective limit, projected total, invoice id and reason.

**Credit — visibility**
15. The customer credit panel shows effective limit, exposure, headroom and credit-hold status with the base-currency basis stated.
16. The invoice screen shows the credit state **before** Issue is attempted, so a block is never a surprise.
17. A **dry-run report** lists every customer already over their effective limit, available before enforcement goes live (R-1).

**Integration test layer**
18. `npm run test:e2e` boots the real application and drives it over **real HTTP** against a **real Postgres**, isolated per test, green locally and in CI.
19. Tests traverse **guards, the global ValidationPipe, the exception filter and Prisma** — not services in isolation.
20. **Row-locking** behaviour is asserted under genuinely concurrent requests (closing review M-3).
21. **P2002** produces **409 with an actionable message** against a real constraint violation.
22. The **ownership-boundary regression is automated** (closing review M-7): a full AP cycle leaves AR aging, job cost, job profit and P&L numerically unchanged.
23. A **new parallel CI job** runs the suite on every push and pull request; `npm test` remains the fast unit loop.

**R2 cutover**
24. Production runs `STORAGE_DRIVER=s3` with the four credentials set; `/health` reports `storageDriver: "s3"`.
25. Upload → redeploy → download returns a **byte-identical** file in production.
26. **No storage code changed** — the Sprint 02 architecture is reused verbatim.

**Sprint-wide**
27. **Zero database migrations** in the diff.
28. Full suite green (unit + new e2e), both typechecks, both production builds.
29. Live verification performed and **all test data removed**.
30. `SPRINT_04_REPORT.md`, `CHANGELOG.md`, `TODO.md`, `PRODUCT_BACKLOG.md` (P0-7, T-6) updated.

---

## 18. Estimated Development Time

Retained unchanged from the reviewed plan, as instructed.

### Phase A — committed ≈ **3.5**

| Work | Estimate |
|---|---|
| A1 Exposure single-owner function (incl. adopting existing call sites / closing M-10) | 0.4 |
| A2 Credit engine — effective limit, hold, evaluation (pure) | 0.3 |
| A3 Enforcement at invoice issue + A5 override path + audit | 0.5 |
| A4 Credit API + customer panel + invoice-screen state + dry-run report | 0.6 |
| Unit tests for credit logic and exposure | 0.3 |
| **A6 Integration test layer** — harness, DB/rollback strategy, CI job, first coverage wave | **1.0** |
| A7 R2 cutover (configuration + verification) | 0.1 |
| Live verification, cleanup, docs, report | 0.3 |
| **Phase A subtotal** | **≈ 3.5** |

### Phase B — stretch ≈ **0.8**

| Work | Estimate |
|---|---|
| B1 Exposure column + filters on the customer list | 0.3 |
| B2 Playwright golden-path smoke test | 0.4 |
| B3 Credit status cross-link on AR aging | 0.1 |
| **Phase B subtotal** | **≈ 0.8** |

**Phase A is the commitment; Phase B is the stretch.**

> **Unit note.** These figures are carried forward unchanged from the reviewed
> plan, where they were expressed in **dev-weeks** at ~1.5 effective developers
> (the unit used throughout `IMPLEMENTATION_ROADMAP.md`). The approval note
> labelled them "developer days". The **numbers are unchanged either way**; the
> label is flagged so the Product Owner can correct it if days were intended —
> 3.5 developer-days would not accommodate the 1.0-unit integration test layer.

---

## 19. Rollback Strategy

**Credit enforcement.** The approved policy (D-1 hard block, D-9 per customer)
means **there is no global feature switch to disable**. Rollback options, in order
of preference:

1. **Data-level, immediate:** clear `creditLimit` / `outstandingLimit` (or clear
   `creditHold`) for affected customers — a NULL limit means *no* limit, so
   enforcement stops for that customer instantly, with no deployment.
2. **Operational:** use the D-7 override to unblock individual invoices while the
   underlying data is corrected.
3. **Permission-level:** widen `credit.override` temporarily if a broader group
   needs to unblock during an incident.
4. **Code rollback:** revert the sprint commit. Because there are **no
   migrations**, no schema or data change has to be undone and no existing data
   is at risk.

**Integration test layer.** Purely additive — new files, a new script, a new CI
job. Rollback is removing the job; nothing in the application depends on it.

**R2 cutover.** Reversible by configuration: `STORAGE_DRIVER=local` restores the
previous behaviour immediately. **Caveat:** documents uploaded to R2 while it was
live remain in the bucket and would not be served by the local driver, so
reverting is a deliberate, data-aware choice. Objects are never deleted by the switch.

**Migrations.** None — so the down-path gap review M-5 flagged in Sprint 03 does
not arise this sprint.

---

## 20. Expected Files

**Backend — new**
`src/modules/customers/credit.logic.ts` (pure engine) · `credit.logic.spec.ts` ·
`src/modules/customers/credit.service.ts` (exposure + evaluation orchestration) ·
`credit.service.spec.ts` ·
e2e harness: `test/jest-e2e.json`, `test/setup.ts`, fixture builders ·
`test/*.e2e-spec.ts` (credit enforcement, payables money paths, status-code contracts, row locking, P2002, ownership-boundary regression)

**Backend — modified**
`src/modules/invoices/invoices.service.ts` — **exposure single-owner extraction (read paths)** and the credit precondition inside `issue()` ·
`src/modules/invoices/invoices.dto.ts` — optional `creditOverrideReason` ·
`src/modules/customers/customers.controller.ts` — credit endpoints ·
`src/common/permissions.ts` — `credit.override` ·
`prisma/seed.ts` — permission + role matrix (**seed data only, no schema change**) ·
`package.json` — `+@nestjs/testing`, `+supertest`, `test:e2e` script

**Frontend — new**
`src/app/customers/credit-panel.tsx` · credit-state indicator + override dialog for the invoice screen

**Frontend — modified**
`src/app/customers/page.tsx` (panel mount) · `src/app/invoices/page.tsx` (credit state, block dialog, override) ·
*(Phase B)* customer list columns/filters, AR aging cross-link

**Infrastructure**
`.github/workflows/ci.yml` — new parallel `backend-e2e` job ·
Render environment variables for R2 — **dashboard only, nothing committed**

**Docs (at completion)**
`SPRINT_04_REPORT.md` · `CHANGELOG.md` · `TODO.md` · `PRODUCT_BACKLOG.md`

**Explicitly NOT touched:** `prisma/schema.prisma` (**no migration**) · the tax
engine · the FX engine (used, never modified) · the AP module · the storage driver
layer · credit/debit notes · quotations · jobs · the state machines.

---

## Architecture Constraints — compliance statement

| Constraint | How this plan preserves it |
|---|---|
| **Single source of truth** | Exposure has **one** owner shared with AR (D-3); closing M-10 is part of A1 rather than adding a third derivation |
| **Ownership boundaries** | Credit **reads** AR and customer data and writes only audit records. It never writes invoices, jobs, notes or AP |
| **No duplicate business logic** | The credit engine mirrors the *shape* of `approval.logic.ts` but implements a distinct rule; nothing is copied |
| **No duplicated tax engine** | Not touched — credit consumes totals it already produced |
| **No duplicated FX engine** | `FxService` used as-is for base-currency conversion (D-8); refusal-to-decide reuses the H-2 rule |
| **No direct writes into unrelated modules** | Enforcement is a precondition on an existing transition, not a mutation of another module's state |
| **All monetary calculations server-side** | Exposure, effective limit, projected total and outcome are computed server-side; the client supplies no monetary input |
| **All state transitions explicit** | No new states, no new transitions — credit gating guards the existing DRAFT → ISSUED transition, exactly as approval gating already guards quotation transitions |

---

*No code has been written, no migration created, no ADR created, and no other
document modified. **Awaiting final Product Owner approval to implement** —
including the two operational confirmations in §6.1 (C-1 `blacklist` scope,
C-2 fail-closed on missing FX rates).*
