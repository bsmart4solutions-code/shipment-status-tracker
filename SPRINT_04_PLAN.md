# SPRINT 04 PLAN — Credit Limit Enforcement · Integration Test Layer · R2 Cutover

**Status:** PROPOSED — planning only. **No code written, no migration created, no ADR created.**
**Date:** 2026-07-28
**Aligned with:** `PROJECT_AUDIT.md` · `BUSINESS_AUDIT.md` §1, §15 · `MVP_SCOPE.md` §2B · `IMPLEMENTATION_ROADMAP.md` (reconciled) · `PRODUCT_BACKLOG.md` (P0-7, T-6) · `TODO.md` · `ARCHITECTURE_REVIEW.md` · `ARCHITECTURE_REVIEW_SPRINT02.md` · `ARCHITECTURE_REVIEW_SPRINT03.md` · `AP_ARCHITECTURE_DECISION.md` · `SPRINT_03_CLOSE.md` §17
**Backlog:** **P0-7** (Credit-limit enforcement) · **T-6** (Integration/E2E tests) · Sprint 02 operational follow-up (R2 cutover)

---

## 1. Sprint Goal

> Stop the company extending credit it did not intend to extend — enforce customer
> credit limits and credit holds at the moment commercial commitment is made —
> and close the two gaps that Sprint 03 proved are costing us: no automated test
> layer that can catch database-level defects, and production documents still
> sitting on ephemeral storage.

---

## 2. Business Objectives

1. **Turn captured credit data into an actual control.** `Customer.creditLimit`,
   `outstandingLimit`, `creditHold` and `blacklist` have been stored since the
   customer-master sprint and enforced nowhere (`PROJECT_AUDIT.md` §4,
   `BUSINESS_AUDIT.md` §1/§15). Today a customer already over their limit can be
   quoted and invoiced without anyone noticing.
2. **Make credit exposure visible before it becomes a bad debt.** Show what a
   customer currently owes, against what they are allowed to owe, at the point of
   decision — not in a month-end report.
3. **Close the testing gap Sprint 03 exposed.** Both defects that shipped in
   Sprint 03 (the `::uuid` cast breaking four row-locked operations, and void
   returning 400 instead of the required 409) were **structurally invisible to
   unit tests** because those stub `$queryRaw`. An integration layer is now
   evidence-backed necessity, not hygiene.
4. **Stop losing documents on every deploy.** Production still runs without R2
   credentials, so uploads are destroyed on each release. Configuration work with
   the highest risk-reduction per hour available anywhere in the project.
5. **Prepare P0-8.** Collections and Statements of Account need exactly the same
   per-customer exposure figure this sprint introduces. Building it once, with a
   single owner, is what makes Sprint 05 small.

---

## 3. Business Value

| Value | Mechanism | Who feels it |
|---|---|---|
| **Bad-debt prevention** | A customer over their limit, on credit hold, or blacklisted is stopped (or flagged) before commercial commitment | Owner / Finance |
| **Credit decisions become explicit and auditable** | Any override is a recorded, attributed act rather than an unnoticed omission | Owner / auditor |
| **Sales sees exposure at the point of sale** | Limit, current exposure and headroom shown on the customer and on the quote | Sales |
| **Defect classes that reached production are now catchable** | Controller-level tests running against a real database in CI | Whole team |
| **Uploaded documents survive deployment** | R2 cutover | Operations |
| **Sprint 05 gets cheaper** | The same exposure function drives AR automation and the SOA | Product |

---

## 4. Scope

### Phase A — Mandatory

**A1 · Credit exposure calculation (the foundation)**
A single owner for "what does this customer currently owe us", reusing the
existing AR balance formula rather than adding a third derivation of it.

**A2 · Credit evaluation engine (pure, unit-testable)**
Given exposure, limits, hold/blacklist flags and the value of the new
commitment, decide the outcome: allowed / warn / block — mirroring the shape of
the existing, proven `approval.logic.ts` (pure function + explicit assertion).

**A3 · Enforcement at the commercial commitment points**
Applied where commitment actually happens; the exact points and the strictness
are Product Owner decisions (§6), not assumptions.

**A4 · Credit exposure API + UI surfacing**
Exposure endpoint; credit panel on the customer; inline indicator at the point
of decision.

**A5 · Override path with audit**
Whatever strictness is chosen, an authorised user must be able to proceed
deliberately, and that act must be attributable. (Mechanism = PO decision.)

**A6 · Integration / E2E test layer (T-6)** — design in §16; **framework, DB
strategy and CI wiring delivered this sprint**, with a first meaningful set of
controller tests covering the money paths that unit tests cannot reach.

**A7 · Production Cloudflare R2 cutover** — deployment configuration only,
reusing the Sprint 02 storage architecture unchanged (§ below and `STORAGE.md` §3).

### Phase B — Stretch (only if Phase A completes early)

| # | Item | Why it is stretch, not core |
|---|---|---|
| B1 | **Credit exposure column on the customer list** + filter for "over limit" / "on hold" | Reporting convenience; the control works without it |
| B2 | **Playwright smoke test** (login → quote → invoice golden path) | The controller layer delivers most of T-6's value; browser automation is the expensive half |
| B3 | **Credit block reason surfaced on the AR aging screen** | Nice cross-link, zero new logic |

**Phase gate:** Phase B is additive reporting on Phase A data. If Phase A runs
long, Phase B moves to Sprint 04B with nothing left half-built.

---

## 5. Explicitly Out of Scope

| Excluded | Reason |
|---|---|
| **AR overdue automation, reminder emails, Statement of Account** | P0-8 — Sprint 05. This sprint builds the exposure figure they will consume, nothing more |
| **Customer credit-balance ledger** (refund-on-account, over-payment credit) | Deferred since Sprint 01A; belongs with P0-8 |
| **Vendor-side credit control** (what vendors extend to us) | `Vendor.creditLimit` exists but is a different business question |
| **Booking-time enforcement** | The Booking object does not exist until Sprint 06 (P0-4) |
| **Multi-level credit approval matrix / delegation hierarchy** | Same decision already deferred for quotations and AP; would be its own epic |
| **Credit scoring, ageing-weighted risk, insurance integration** | Far beyond MVP |
| **Any change to the tax engine, FX engine, AP module, or storage architecture** | Architecture constraints below |
| **Dunning levels / interest on overdue** | Not in `MVP_SCOPE.md` |
| **Storage redesign of any kind** | R2 work is configuration only |

---

## 6. Architecture Decisions Required

These are **genuine unresolved business decisions**. Each changes what gets
built. None can be inferred from existing documents — the credit fields were
captured without a stated enforcement policy.

### D-1 · Enforcement strictness — soft warning vs hard block
| Option | Effect |
|---|---|
| **Soft warning** | Show a prominent warning; the user may proceed. Nothing is ever blocked |
| **Hard block** | The action is refused (409/400) until the limit is raised, the balance is paid, or an override is applied |
| **Mixed by threshold** | Warn approaching the limit (e.g. ≥90%), block at/over it |
**Note:** the codebase has a strong precedent to respect — `approval.logic.ts`
states *"an ERP must never silently block commercial flow because nobody
configured a setting."* Whatever is chosen, **an unset `creditLimit` must mean
"no limit", never "zero limit"**.

### D-2 · Which events are enforcement points
Candidates, in increasing commitment order: quotation **SENT** · quotation
**WON / convert to job** · **job creation** · **invoice issue**.
Enforcing at invoice issue only is late; enforcing at SENT may block routine
quoting. *Which of these gate, and with what strictness each?*

### D-3 · What counts as "exposure"
| Component | Include? |
|---|---|
| Issued + partially-paid invoices (net of issued credit/debit notes) | Almost certainly yes |
| DRAFT invoices | ? |
| Won quotations / open jobs not yet invoiced (committed but unbilled) | ? — this is the difference between *balance* control and *exposure* control |
| `Customer.openingBalance` (migrated legacy balance) | ? — it is captured and currently unused |
**This is the single highest-impact decision in the sprint:** it determines
whether the control catches over-commitment before or only after invoicing.

### D-4 · `creditLimit` vs `outstandingLimit`
Both fields exist. Their intended distinction has never been written down.
*Are they two separate ceilings (e.g. total exposure vs unpaid AR), is one
authoritative, or should one be retired?*

### D-5 · Credit Hold semantics
`creditHold` is commented "block new orders when true". *Does hold block
everything (including quoting), or only conversion/invoicing? Is it always a
hard block regardless of D-1? Does `blacklist` behave identically or more
strictly?*

### D-6 · Overdue-based enforcement
*Should an overdue invoice trigger a hold independently of the limit* (e.g. any
invoice >60 days overdue blocks new work even when the customer is under
limit)? If yes, the ageing threshold is a configurable setting.

### D-7 · Manual override — who and how
| Option | Effect |
|---|---|
| No override | Only raising the limit or paying down unblocks |
| Permission-gated override | A new `credit.override` permission; the actor is recorded |
| Reason-required override | As above plus a mandatory justification (the pattern used for payment reversal) |
| Approval-flow override | Request → approve, reusing the `approvals` module |
*If an override exists: is it per-transaction or does it lift the block until revoked?*

### D-8 · Currency of the limit
`Customer.currency` and `creditLimit` are stored per customer; invoices may be
in other currencies. *Is the limit denominated in the customer's currency or in
base currency, and — given H-2's precedent — at which date is exposure converted?*

### D-9 · Settings vs per-customer configuration
*Are the warning threshold (D-1) and overdue rule (D-6) global settings
(`SettingKV`, like the quotation approval threshold), per-customer, or both with
per-customer overriding global?*

> **No implementation may begin until D-1 … D-9 are answered.** Proposed defaults
> can be supplied on request, but this plan deliberately does not assume them —
> credit policy is business logic, and the standing rule is not to guess it.

---

## 7. Database Changes

**Expected: none, or one minimal additive migration — determined by §6.**

- **No new columns are needed for enforcement itself.** `creditLimit`,
  `outstandingLimit`, `creditHold`, `blacklist`, `currency` and `openingBalance`
  already exist on `Customer`; exposure is **derived, never stored** (the
  Sprint-03 discipline).
- **Only if D-7 selects a recorded override:** a small `credit_overrides` table
  (customerId, entityType, entityId, reason, approvedById, createdAt) — additive,
  no existing table altered. If D-7 selects "no override" or a purely
  permission-gated one with audit-log-only recording, **zero migrations**.
- **Only if D-9 selects per-customer thresholds:** one nullable column on
  `Customer`. Global-settings-only requires no schema change (`SettingKV` exists).
- The integration test layer and the R2 cutover require **no schema change whatsoever**.

---

## 8. Backend Design

**Architecture constraints are binding.** In particular: *no third
implementation of the AR balance formula.*

### A1 · Exposure — one owner, reusing what exists
Open finding **M-10** records that the AR balance formula
(`totalAmount − amountPaid + noteNet`, ISSUED notes only) currently has one
definition but two call sites (`agingReport`, and `recordPayment` via
`issuedNoteNet`). Credit exposure must **not** become the third.

Design: extract a single `customerExposure(customerId)` (or batch
`customerExposures(ids[])`) owned by the invoices/AR module, built from the
existing `issuedNoteNet` primitive, and consumed by the credit engine. Where the
existing call sites can adopt it without behavioural change, they should —
closing M-10 as a side effect rather than adding to it.

### A2 · Credit engine — pure, mirroring the proven pattern
A new `credit.logic.ts` in the customers (or a small `credit`) module,
deliberately shaped like `quotations/approval.logic.ts`:
- `evaluateCredit({ exposure, limit, outstandingLimit, hold, blacklist, newCommitment, thresholds }) → { outcome: 'ALLOW' | 'WARN' | 'BLOCK', reason, headroom }` — **pure, no I/O, fully unit-testable**
- `assertCreditAllows(action, decision, override?)` — explicit assertion throwing a typed error
- Null/unset limit ⇒ `ALLOW` (never a zero limit), matching the approval-threshold precedent.

### A3 · Enforcement
Invoked at the points selected in D-2, inside the existing transactional write
paths, as an explicit assertion — never as a silent side effect. All monetary
comparison happens server-side; the client never supplies exposure or headroom.

### Reuse, not duplication
`FxService` for any currency conversion (D-8) — **no new FX logic**;
`SettingsService` for thresholds (same mechanism as
`approval.quotation.thresholdBase`); `AuditService` for overrides and blocks;
existing state machines untouched — credit gating is a **precondition on an
existing transition**, not a new state.

---

## 9. Frontend Design

| Surface | Content |
|---|---|
| **Customer credit panel** (customer form / detail) | Limit · current exposure · headroom · hold/blacklist status · currency basis |
| **Point-of-decision indicator** (quotation, and wherever D-2 selects) | Inline badge: within limit / approaching / over / on hold, with the figure behind it |
| **Block or warning presentation** | Warning banner or blocking dialog per D-1, always naming the number and the reason |
| **Override control** (if D-7 selects one) | Permission-gated, reason captured where required, following the existing confirm-dialog conventions |
| **Phase B** | Exposure column + "over limit / on hold" filter on the customer list |

All new views carry **loading / empty / error states** and are responsive, per
the standing rule. No changes to AP, invoices or notes screens.

---

## 10. API Design

Shape only; exact set depends on §6.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/customers/:id/credit` | `customers.read` | Exposure, limit(s), headroom, hold/blacklist, currency basis, computed outcome |
| GET | `/customers/credit-summary` *(Phase B)* | `customers.read` | Batch exposure for the customer list — **one aggregate query, never N+1** |
| POST | `/customers/:id/credit-override` *(only if D-7 selects a recorded override)* | `credit.override` (new) | Record a deliberate override with reason |

**Changed behaviour, unchanged contracts:** the enforcement points selected in
D-2 (e.g. `POST /quotations/:id/status`, job creation, `POST /invoices/:id/issue`)
gain a precondition. They return a typed **409 Conflict** (or a warning payload
under a soft policy) — **no request or response shape is otherwise altered, and
no endpoint is removed.** List filters, if added, are declared on a
`ListXDto extends PaginationDto` (never extra `@Query()` params — the bug still
open on quotations/invoices/jobs).

---

## 11. Security

| Area | Control |
|---|---|
| **Authorization** | Exposure readable with `customers.read`. Override, if it exists, requires its own permission — never bundled into `customers.write`, so viewing credit ≠ granting credit (the segregation lesson from `notes.issue` / `payables.*`) |
| **Server-authoritative decisions** | Exposure, headroom and outcome computed server-side only; a client cannot assert it is within limit |
| **Audit** | Every block and every override audit-logged with user, IP, user-agent, the figures involved and the reason |
| **Information exposure** | Credit standing is commercially sensitive; it must not leak to roles without `customers.read`, and must never appear in an unauthenticated or portal-facing payload |
| **Integration tests** | Run against a disposable CI database with CI-only secrets; no production data, no real credentials, ever |
| **R2 cutover** | Bucket-scoped API token, object read/write only, private bucket, credentials only in Render's environment store — never committed (`STORAGE.md` §9) |

---

## 12. Validation Rules

- `creditLimit` / `outstandingLimit`: optional; when present must be **≥ 0**; **null ⇒ no limit** (never zero).
- `creditHold`, `blacklist`: booleans, default false.
- Override (if any): reason **required and non-empty** where D-7 selects reason-required, mirroring payment reversal.
- Thresholds from settings: numeric, `0`/unset ⇒ feature disabled — the existing approval-threshold semantics.
- Exposure inputs: only statuses agreed in D-3 are counted; DRAFT/CANCELLED/VOID documents never contribute silently.
- Currency: exposure and limit must be compared in one currency (D-8); **a mismatch with no resolvable rate must warn and refuse to decide — never convert 1:1** (the H-2 rule, reused).
- All amounts server-computed; the client supplies no monetary input to the decision.

---

## 13. Permission Model

| Permission | Status | Grants |
|---|---|---|
| `customers.read` | existing | View credit panel and exposure |
| `customers.write` | existing | Edit limits and hold flags (already the case today) |
| `credit.override` | **new — only if D-7 selects an override** | Proceed past a block; deliberately separate so that seeing credit standing, changing a limit and overriding a block are three distinct rights |

Role matrix additions (seed, additive) would follow the established pattern:
Administrator and Manager; Finance by Product Owner choice; Sales explicitly not,
unless D-7 says otherwise.

---

## 14. Performance

| Concern | Design |
|---|---|
| Exposure on a single decision | One indexed aggregate over that customer's live invoices plus one grouped note query — the same shape AP aging already uses |
| **Customer list (Phase B)** | **One batch aggregate for all visible customers — never one query per row.** This is the explicit N+1 guard; the Sprint 03 variance work set the precedent |
| Enforcement inside write paths | Adds one bounded read to an existing transaction; no additional locks |
| Caching | None initially — exposure must be current at the moment of decision; stale credit data is worse than a slightly slower quote |
| Integration tests | Expected to add minutes, not seconds, to CI — hence a **separate CI job** running in parallel with the existing unit job (§16) |

---

## 15. Risks

### HIGH

**R-1 · Enforcement can halt commercial operations on day one.**
Turning on a hard block against real data may instantly block customers who are
legitimately over an unmaintained limit — limits captured during data entry were
never load-bearing. *Mitigation:* ship with the feature **disabled by default**
(threshold/settings-driven, as approvals are), require an explicit switch-on, and
run a **dry-run report** showing who *would* be blocked before enforcement is enabled.
This risk is why D-1 and D-2 must be answered by the business, not by engineering.

**R-2 · Exposure could become a third definition of "what is owed".**
AR balance already has one formula with two call sites (M-10). A careless
implementation adds a third, and they will drift — the exact failure mode of
Sprint 01A's H1/H2. *Mitigation:* single-owner function, mandated in §8; treat
closing M-10 as part of the definition of done for A1.

### MEDIUM

**R-3 · The integration layer could balloon the sprint.** A full E2E suite is
its own project. *Mitigation:* Phase A delivers the *harness plus the money
paths that unit tests structurally cannot reach*; Playwright is Phase B.

**R-4 · Test-database strategy can make CI slow or flaky.** *Mitigation:*
transaction-rollback isolation and a single migrated schema per run (§16); a
separate parallel CI job so it never lengthens the critical path.

**R-5 · The R2 cutover depends on an external account and human action.**
It is configuration, but it is not *our* configuration. *Mitigation:* treat as a
checklist item with a named owner and a verification step; it does not block A1–A6.

**R-6 · `creditLimit` vs `outstandingLimit` ambiguity (D-4).** Building against
a guess produces a control nobody trusts. *Mitigation:* blocking decision.

**R-7 · Currency mismatch (D-8).** A limit in MYR compared against USD exposure
is meaningless without conversion. *Mitigation:* reuse `FxService`; refuse to
decide when unresolvable, per §12.

### LOW

**R-8 · Override becomes routine**, turning the control into theatre. Mitigate by making overrides visible in the audit log and, later, reportable.
**R-9 · Sales friction / adoption resistance** if warnings are noisy. Mitigate with clear numbers and a defensible threshold.
**R-10 · Known flake** in `rate-sheet.parser.spec.ts` may surface in the new CI job; diagnosed in `TODO.md`, fix is a per-test timeout.

---

## 16. Testing Strategy

### Unit
- `credit.logic.ts`: within limit · at limit exactly · over limit · **null limit ⇒ allow, never zero** · hold · blacklist · warning threshold boundary · zero/negative new commitment · disabled-by-settings.
- Exposure arithmetic: invoice + credit-note + debit-note combinations; excluded statuses; the boundary cases already proven for AR.
- Currency: conversion path and the **refuse-to-decide** path when no rate resolves.

### Integration (T-6 — the new layer, designed here, delivered this sprint)

| Aspect | Design |
|---|---|
| **Framework** | `@nestjs/testing` + `supertest`, driving the real Nest application through HTTP. Chosen because it exercises guards, the global `ValidationPipe`, the exception filter and Prisma together — precisely the layers that produced both Sprint 03 defects. Both packages are new dev dependencies |
| **Separation** | New suffix `*.e2e-spec.ts` with its own Jest config, so `npm test` stays the fast unit loop and integration runs as `npm run test:e2e`. (Current `testRegex` is `.*\.spec\.ts$` — the new pattern must not collide) |
| **Database strategy** | A **real Postgres**, not mocks — the entire point. CI already provisions `postgres:16-alpine` and runs `prisma migrate deploy`; the e2e job reuses that setup with a dedicated database name. Locally it targets the existing Docker instance |
| **Isolation / transaction rollback** | Each test runs inside a transaction that is **rolled back afterwards**, so tests neither see nor leave each other's data and the suite is order-independent. Where a code path opens its own transaction (approve/pay/reverse do), those tests fall back to targeted cleanup of the rows they created — documented explicitly so the exception is deliberate, not accidental |
| **Seed** | A minimal fixture builder (one customer, one vendor, one job) rather than the demo seed, so tests state their own preconditions |
| **First coverage** (highest value, chosen because unit tests cannot reach it) | ① the `::uuid`-class defect: every row-locked path — invoice issue/pay, note issue, **bill approve/pay/reverse/void** — executed against a real database; ② status codes end-to-end: void-with-payments ⇒ **409**, overpayment ⇒ 400, duplicate vendor invoice ⇒ 409, P2002 ⇒ 409; ③ **the ownership-boundary regression as an automated test** (closing review M-7): a full AP cycle leaves AR aging, job cost, job profit and P&L numerically unchanged; ④ the new credit enforcement decisions |
| **Playwright** | **Phase B only**, and deliberately narrow: one golden-path smoke test (login → quote → invoice) as `IMPLEMENTATION_ROADMAP.md` Sprint 0 originally specified. Browser automation is not where this sprint's value is |
| **CI integration** | A **new parallel job** `backend-e2e` alongside the existing `backend` job, with its own Postgres service, running migrations then `npm run test:e2e`. Parallel so it does not lengthen the critical path; required for merge once green and stable |

### Live Verification
Credit: a customer under limit proceeds; at/over limit produces the agreed
outcome; hold and blacklist behave per D-5; override (if any) works and is
audit-logged; an unset limit never blocks. R2: upload → **redeploy** → download
byte-identical, and `/health` reports `storageDriver: "s3"`.

### Regression
AR, AP, jobs, P&L and quotations verified **numerically unchanged** by credit
enforcement when no limit is breached — the same baseline-capture method used in
Sprints 03 and 03A. All test data removed afterwards; sequences reset.

---

## 17. Acceptance Criteria

**Credit (A1–A5)**
1. A customer's credit panel shows limit, current exposure, headroom and hold/blacklist status, with the currency basis stated.
2. Exposure is computed by **one** function, shared with AR — verified by test, and no third implementation of the balance formula exists in the codebase.
3. A customer **without** a limit is never blocked or warned (null ≠ zero).
4. At the enforcement points chosen in D-2, a customer over the limit produces exactly the outcome chosen in D-1, naming the figures.
5. Credit hold and blacklist behave per D-5.
6. Override (if D-7 selects one) is permission-gated, captures a reason where required, and is audit-logged with the figures.
7. Every block and override appears in the audit log with user, IP and user-agent.
8. Enforcement is **off by default** and switched on explicitly (R-1).
9. Currency mismatch with no resolvable rate warns and refuses to decide — never converts 1:1.

**Integration layer (A6)**
10. `npm run test:e2e` runs the real application over HTTP against a real Postgres, isolated per test, green locally and in CI.
11. A **new parallel CI job** runs it on every push and pull request.
12. Coverage includes all row-locked money paths, the four status-code contracts named in §16, and the automated ownership-boundary regression (closing review M-7).
13. The unit suite remains fast and unchanged in invocation (`npm test`).

**R2 cutover (A7)**
14. Production runs `STORAGE_DRIVER=s3` with the four credentials set; `/health` reports `storageDriver: "s3"`.
15. Upload → redeploy → download returns a byte-identical file in production.
16. No storage code changed — the Sprint 02 architecture is reused verbatim.

**Sprint-wide**
17. Full suite green (unit + new e2e), both typechecks, both production builds.
18. Live verification performed and **all test data removed**.
19. Regression confirms AR, AP, jobs and P&L unchanged.
20. `SPRINT_04_REPORT.md`, `CHANGELOG.md`, `TODO.md`, `PRODUCT_BACKLOG.md` (P0-7, T-6) updated.

---

## 18. Estimated Development Time

2-week sprint, ~1.5 effective devs (dev-weeks = dw), per roadmap assumptions.

### Phase A

| Work | dw |
|---|---|
| A1 Exposure single-owner function (incl. adopting existing call sites / closing M-10) | 0.4 |
| A2 Credit engine (pure logic + settings wiring) | 0.3 |
| A3 Enforcement at the agreed points + override path | 0.5 |
| A4 API + customer credit panel + point-of-decision indicator | 0.6 |
| A5 Unit tests for credit logic and exposure | 0.3 |
| **A6 Integration test layer** — harness, DB/rollback strategy, CI job, first coverage set | **1.0** |
| A7 R2 cutover (configuration + verification) | 0.1 |
| Live verification, cleanup, docs, report | 0.3 |
| **Phase A subtotal** | **≈ 3.5 dw** |

### Phase B

| Work | dw |
|---|---|
| B1 Exposure column + filters on the customer list | 0.3 |
| B2 Playwright golden-path smoke test | 0.4 |
| B3 Credit status cross-link on AR aging | 0.1 |
| **Phase B subtotal** | **≈ 0.8 dw** |

**Total ≈ 4.3 dw.** Phase A alone (~3.5 dw) fits a two-week sprint comfortably;
**Phase A is the commitment, Phase B the stretch.** The estimate assumes D-1 …
D-9 are answered before implementation starts — an unanswered decision converts
directly into rework.

---

## 19. Rollback Strategy

**Credit enforcement**
- **Primary: feature switch.** Enforcement is settings-driven and off by default
  (R-1), so the first response to any problem is to turn it off — instant, no
  deployment, no data change.
- **Secondary: permission revocation** if an override permission exists.
- **Code rollback:** revert the sprint commit. If a `credit_overrides` table was
  created (D-7), it is additive and may be dropped; no existing table is altered,
  so no existing data is at risk.

**Integration test layer** — additive: new files, new scripts, a new CI job.
Rollback is removing the job; nothing in the application depends on it.

**R2 cutover** — reversible by configuration: setting `STORAGE_DRIVER=local`
restores the previous behaviour immediately. **Caveat:** documents uploaded to
R2 while it was live remain in the bucket and would not be served by the local
driver — so reverting is a deliberate, data-aware choice, not a casual one.
Objects are never deleted by the switch.

**Migrations** — zero or one small additive migration; the down path is written
and tested locally before production (closing the gap review M-5 flagged when it
was skipped in Sprint 03).

---

## 20. Expected Files

**Backend — new**
`src/modules/customers/credit.logic.ts` (pure engine) ·
`credit.logic.spec.ts` ·
`src/modules/customers/credit.service.ts` (or extension of the customers service) ·
`test/` e2e harness: `jest-e2e.json`, `test/setup.ts`, fixture builders ·
`test/*.e2e-spec.ts` (payables money paths, status-code contracts, ownership-boundary regression, credit enforcement) ·
*(conditional on D-7)* `prisma/migrations/<ts>_credit_overrides/`

**Backend — modified**
`src/modules/invoices/invoices.service.ts` (**exposure single-owner extraction — read paths only**) ·
the enforcement points selected in D-2 (likely `quotations.service.ts`, possibly `jobs.service.ts` / `invoices.service.ts` issue path) ·
`src/common/permissions.ts` *(conditional on D-7)* · `prisma/seed.ts` *(conditional — role matrix)* ·
`package.json` (`+@nestjs/testing`, `+supertest`, `test:e2e` script)

**Frontend — new**
`src/app/customers/credit-panel.tsx` · point-of-decision indicator component

**Frontend — modified**
`src/app/customers/page.tsx` / customer form (credit panel mount) ·
the quotation screen (indicator) · *(Phase B)* customer list columns/filters

**Infrastructure**
`.github/workflows/ci.yml` (new parallel `backend-e2e` job) ·
Render environment variables (R2 — **dashboard only, nothing committed**)

**Docs (at completion)**
`SPRINT_04_REPORT.md` · `CHANGELOG.md` · `TODO.md` · `PRODUCT_BACKLOG.md`

**Explicitly NOT touched:** the tax engine · the FX engine (used, never modified) ·
the AP module · the storage driver layer · credit/debit notes · the state machines.

---

## Architecture Constraints — compliance statement

| Constraint | How this plan preserves it |
|---|---|
| **Single source of truth** | Exposure gets **one** owner shared with AR; the plan treats closing M-10 as part of A1 rather than adding a third derivation |
| **Ownership boundaries** | Credit enforcement **reads** AR and customer data and writes only its own audit/override records. It never writes invoices, jobs, notes or AP |
| **No duplicate business logic** | The credit engine mirrors the *shape* of `approval.logic.ts` but implements a distinct rule; no rule is copied |
| **No duplicated tax engine** | Not touched — credit deals in totals already computed by it |
| **No duplicated FX engine** | `FxService` is used as-is for D-8; refusal-to-decide reuses the H-2 rule |
| **No direct writes into unrelated modules** | Enforcement is a precondition on existing transitions, not a mutation of another module's state |
| **All monetary calculations server-side** | Exposure, headroom and outcome are computed server-side; the client supplies no monetary input |
| **All state transitions explicit** | No new states and no new transitions — credit gating is a guard on existing ones, in the same way approval gating already is |

---

*No code has been written, no migration created, no ADR created, and no existing
document modified. **Awaiting Product Owner review — including answers to
decisions D-1 … D-9 in §6**, without which implementation cannot begin.*
