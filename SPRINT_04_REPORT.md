# SPRINT 04 REPORT — Credit Limit Enforcement · Integration Test Layer · R2 Cutover

**Plan:** `SPRINT_04_PLAN.md` (approved, policy decisions D-1 … D-9)
**Status:** ✅ **Phase A COMPLETE** — implemented, tested, live-verified. **Phase B not started** (stretch).
**Date:** 2026-07-29
**Suite:** 19 backend unit suites **276/276** · **26/26 new integration tests** · frontend 12/12 · both typechecks and production builds clean · **zero database migrations**

---

## 1. Summary

Customer credit limits are now enforced. Issuing an invoice that would push a
customer past their effective limit — or issuing at all for a customer on credit
hold — is refused with a 409 naming every figure behind the decision.
Administrators and Managers can override with a mandatory reason; everyone else,
including users who can otherwise issue invoices, cannot. Nothing else in the
system is gated: quotations, jobs, customer maintenance and payment receipt are
untouched, exactly as approved.

Alongside it, the sprint delivered the integration test layer the last two
sprints argued for — and it **found a real concurrency defect in Accounts
Payable on its first full run** (§6).

## 2. Approved policy — as implemented

| # | Decision | Implementation |
|---|---|---|
| D-1 | Hard block, no warning-only mode | `evaluateCredit` returns only `ALLOW` or `BLOCK`; there is no WARN outcome and no toggle |
| D-2 | Invoice issue only | Enforced inside `InvoicesService.issue()`. Verified by test that DRAFT creation and payment receipt are **not** blocked |
| D-3 | Exposure = issued invoices − payments − issued CN + issued DN | Computed by `InvoicesService.customerExposures()`, built on the existing note-netting primitive — **no second implementation** |
| D-4 | Effective limit = MIN of the non-null limits | `effectiveLimit()`; NULL ignored; **both NULL ⇒ no limit, never zero** |
| D-5 | Credit hold is absolute | Checked before any arithmetic; blocks at zero balance and with no limit configured |
| D-6 | No overdue blocking | Not implemented — no ageing input exists anywhere in the credit path |
| D-7 | Override: Administrator + Manager, mandatory reason, audited | New `credit.override` permission seeded to those two roles only |
| D-8 | Base currency, existing FX engine | Exposure converts through `FxService`; unresolvable rate **fails closed** |
| D-9 | Per customer, no global limit | No settings key, no global toggle |

## 3. Database Changes

**None. Zero migrations.** `creditLimit`, `outstandingLimit` and `creditHold`
already existed; exposure is derived, never stored; the override is a reason
recorded in the existing audit log rather than a new entity. The only structural
addition is one permission code (`credit.override`) plus its role grants — seed
data, not schema.

## 4. Backend Changes

- **`InvoicesService`** — extracted `issuedNoteNetMap()` as the **single owner**
  of note netting, now consumed by AR aging, payment recording and credit
  exposure alike (**closes open finding M-10** rather than adding a third
  derivation); added `customerExposures()` / `customerExposure()` in base
  currency; added `creditCheckForInvoice()`; enforced credit in `issue()`.
- **`customers/credit.logic.ts`** (new) — pure engine: `effectiveLimit`,
  `evaluateCredit`, `assertCreditAllows`, `creditBlockMessage`. No I/O.
- **`customers/credit.service.ts`** (new) — combines exposure with limits;
  provides the **dry-run over-limit report**.
- **`common/permissions.service.ts`** (new) — single owner of "does this user
  hold this permission", now used by both the route guard and the in-service
  override check, so there is one implementation and one cache.
- **`common/permissions.ts`** — `credit.override` added to the typed union.
- **`payables.service.ts`** — concurrency fix found by the new test layer (§6).

## 5. Frontend Changes

- **Customer → Credit panel**: exposure, effective limit (and which field set
  it), headroom, credit-hold banner, FX warning, base-currency note.
- **Invoice → Issue** now opens a dialog that runs the credit check **before**
  the attempt, so a block is never a surprise; shows outstanding, this invoice,
  projected and limit; offers an override box only to users who hold the
  permission, with a required reason.
- Loading / empty / error states throughout; no changes to quotations, jobs,
  payables or notes screens.

## 6. A defect the integration layer found on its first run

The concurrency test fired two simultaneous reversals of the **same** vendor
payment. Both returned 201.

**Root cause:** `reversePayment()` read the payment — and checked
`reversedAt` — *before* acquiring the bill's `FOR UPDATE` lock. Two transactions
could therefore both observe `reversedAt = null`, both pass the idempotency
guard, and both proceed. With several payments on one bill, each transaction
recomputes `amountPaid` from a snapshot that excludes only its own reversal, so
**the last writer can leave `amountPaid` too high** — a money defect, not merely
a duplicated audit line.

**Fix:** locate the bill, take the row lock, then **re-read the payment inside
the lock**. Reversals on one bill now serialize.

**Why unit tests could not catch it:** they stub `$transaction` and
`$queryRaw`, so lock ordering does not exist in that world. This is the fourth
defect in three sprints of exactly this shape, and the first one caught before
release.

## 7. Integration Test Layer (T-6)

| Aspect | Delivered |
|---|---|
| Framework | `@nestjs/testing` + `supertest`, booting the real application over real HTTP (`@nestjs/testing` pinned to the project's NestJS 10 major) |
| Pipeline | Every test traverses JwtAuthGuard → PermissionsGuard → global ValidationPipe → controller → service → Prisma → Postgres, with the global exception filter mapping failures |
| Separation | `*.e2e-spec.ts` with its own `test/jest-e2e.json`; `npm test` stays the fast unit loop, `npm run test:e2e` runs integration |
| Database | Real Postgres. CI provisions its own instance and runs migrations + seed |
| Isolation | Tagged fixtures + exact cleanup. **Documented deviation from the plan:** transaction-rollback isolation cannot wrap flows that open their *own* `FOR UPDATE` transactions (invoice issue, note issue, bill approve/pay/reverse/void) — wrapping them would change the very behaviour under test. Recorded in `test/setup.ts` |
| CI | New **parallel** `backend-e2e` job beside the unit job, so the critical path is unchanged |
| Coverage | 26 tests: credit enforcement (16) and money paths (10) — row-locked operations, status-code contracts, real P2002 → 409, concurrency, and the ownership-boundary regression |
| Playwright | Not started — Phase B, as planned |

**Review findings closed by this layer:** **M-3** (concurrency asserted under
genuinely concurrent requests) and **M-7** (the AP ownership-boundary regression
is now automated, not manual).

## 8. Tests

| Milestone | Backend unit | Integration |
|---|---|---|
| Sprint 03A close | 242 | — |
| **Sprint 04** | **276** (+34) | **26** (new) |

Frontend 12/12 unchanged. New unit coverage: `effectiveLimit` (MIN, NULL
handling, explicit zero), `evaluateCredit` (boundary, hold precedence, unknown
exposure, no-WARN invariant), messaging, and enforcement/override at the service
level.

## 9. Live Verification

| Check | Result |
|---|---|
| Credit standing | CUST-0001: exposure **2,138.40**, limit 2,500, headroom **361.60** |
| Pre-check before issuing | 1,000 invoice ⇒ **BLOCK**, projected 3,138.40, shortfall 638.40 |
| **Hard block** | `POST /invoices/:id/issue` ⇒ **409** — *"Credit limit exceeded: outstanding MYR 2138.40 plus this invoice MYR 1000.00 is MYR 3138.40, over the MYR 2500.00 limit by MYR 638.40"* |
| **Override** | Same invoice with a reason ⇒ **201 ISSUED** |
| **Audit** | Both `CREDIT_BLOCK` and `CREDIT_OVERRIDE` recorded with reason, exposure 2138.4 and effectiveLimit 2500 |
| **Credit hold** | Blocked a 10.00 invoice against a 250,000 limit ⇒ *"This customer is on credit hold…"*; issued normally once lifted |
| **Dry-run report** | Ran clean, then correctly flagged the one at-risk customer (§10) |
| No-limit customer | Never blocked |

**Regression — unchanged after all credit activity and cleanup:**
AR outstanding **2,138.40** · JOB-2026-0001 **1585 / 395** · JOB-2026-0005
**180 / 36** · P&L **3157.2 / 2521 / 636.2** · AP payable **0** · notes **0** —
all identical to the pre-sprint baseline. All test data removed; customer credit
fields restored; invoice sequence reset.

## 10. A finding in your live data

The dry-run report initially returned **zero** affected customers, which looked
reassuring — but investigating a puzzling reading showed **CUST-0003 (FORWARD
LOGISTICS SDN BHD) carries `creditLimit = 0`**.

Under the approved hard-block policy a zero limit is a *real* ceiling, so that
customer would have been refused on **every** invoice — yet the report did not
flag them, because an exposure of 0 is not *over* a limit of 0.

The report now flags this case explicitly with a `ZERO_LIMIT` reason, since its
purpose (per plan Risk R-1) is to answer *"who would enforcement stop"*, not
merely *"who is over their limit"*. Verified live: the customer now appears with
`reason: ZERO_LIMIT, wouldBlock: true`.

**This customer's limit was left exactly as found (0).** Deciding whether 0 was
intended or should be cleared to "no limit" is a business call, not mine.

## 11. R2 Cutover (A7) — prepared, **requires your action**

The code path has been production-ready since Sprint 02 and the startup gate
since Sprint 02A. What remains cannot be done from here, because it requires
your Cloudflare account and Render dashboard:

1. Create a Cloudflare R2 bucket (e.g. `erp-documents`).
2. Create a bucket-scoped **Object Read & Write** API token.
3. In Render, set `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_BUCKET`,
   `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (`STORAGE.md` §3).
4. Deploy, then verify `/health` reports `storageDriver: "s3"` and that an
   uploaded document survives a redeploy.

Until this is done, production documents remain ephemeral. **This is the single
highest-value action available and needs no development work.**

## 12. Known Limitations

1. **`Customer.blacklist` is not enforced** — no approved decision covers it (plan §6.1 C-1, still open).
2. **Fail-closed on unresolvable FX** was implemented as planned (C-2) but not confirmed by decision; a customer holding an invoice in an unrated currency cannot be evaluated and is refused with a distinct message.
3. **Phase B not started** — no exposure column on the customer list, no Playwright smoke test, no AR-aging cross-link.
4. **No overdue enforcement** (D-6) — deferred to P0-8.
5. **One `payables.write` still covers create/approve/pay/reverse**; likewise `credit.override` is not further split.
6. Integration coverage is a first wave, not exhaustive — quotations, jobs and documents have no e2e coverage yet.

## 13. Deployment Notes

- **No migration.** Run the **seed** (or insert manually): the
  `credit.override` permission and its Administrator/Manager grants are required
  for the override path to work.
- **Enforcement is live for any customer with a limit** — there is no global
  switch (D-9). Run `GET /api/customers/credit/over-limit` **before** deploying
  to see exactly who would be blocked.
- **Rollback:** clear the customer's `creditLimit`/`outstandingLimit` (NULL = no
  limit) for instant, per-customer relief with no deployment; or revert the
  commit — no schema or data change has to be undone.
