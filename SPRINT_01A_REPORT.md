# SPRINT 01A REPORT — Remediation of ARCHITECTURE_REVIEW High findings

**Scope:** H1, H2, H3, H4 only (per approval). No new features, no schema changes, API compatibility preserved.
**Status:** ✅ COMPLETE — all four fixed, regression-tested, live-verified
**Date:** 2026-07-20
**Test suite:** 10 suites, **106/106 passing** (86 before + 20 new regression tests). Backend `tsc --noEmit` and frontend `tsc` + production build clean.

---

## H1 — Payment engine was blind to issued credit/debit notes

**Root Cause.** `applyPayment()` (and therefore `recordPayment`) computed the
remaining balance as `totalAmount − amountPaid`, using the invoice's pre-credit
face value. It predates the notes module and was never taught about it, so a
credited invoice could still be collected in full, and PAID status was derived
against the wrong total.

**Fix.** `applyPayment()` now takes an optional 4th parameter `noteNet` (signed
sum of ISSUED notes: credit −, debit +). Collectible total = `totalAmount +
noteNet`; the overpayment guard and PAID derivation both use it.
`recordPayment()` computes `noteNet` via a new private helper
`issuedNoteNet(invoiceId)` — a single `groupBy` with the *same semantics* as the
aging report's batch netting, so payments and aging now agree on what an
invoice is worth. Default `noteNet = 0` preserves the signature for all
existing callers and tests.

**Live proof.** Invoice 1,060.00, paid 600, CN 400 issued → collectible 660,
remaining 60. Payment of 100 rejected ("exceeds remaining balance of 60");
payment of 60 accepted → status PAID at amountPaid 660 (not 1,060).

## H2 — Over-credit guard ignored payments already received

**Root Cause.** `assertWithinCreditable()` capped a CN at
`invoiceTotal − alreadyCredited` and never looked at `amountPaid`, so credit +
cash together could exceed the invoice value, producing a hidden negative
balance that aging silently filtered out.

**Fix.** The guard now takes an optional 4th parameter `amountPaid`:
available = `invoiceTotal − amountPaid − alreadyCredited`. Both call-sites
(`create()` early check and `issue()` final check) fetch and pass the invoice's
`amountPaid`. Default `0` preserves backward compatibility.

**Business rule made explicit (per the approved review recommendation):** a CN
is limited to the invoice's **unpaid remainder**. Crediting amounts the customer
has already paid would create a customer credit balance, which this system does
not ledger yet — that flow is deferred to the SOA/credit-ledger work (P0-8,
tracked in `TODO.md`). Consequence: a fully-PAID invoice can no longer receive a
CN, so the `+CN` shortcut is now hidden on PAID rows (`+DN` remains).

**Live proof.** Invoice 1,060.00 with 600 paid → CN of 700 rejected
("exceeds the invoice's creditable balance of 460"); CN of 400 accepted and issued.

## H3 — Invoice cancel ignored issued notes

**Root Cause.** `InvoicesService.cancel()` guarded against recorded payments but
not against notes — it predates the notes module. Cancelling produced an ISSUED
note pointing at a CANCELLED invoice, a state the notes module itself refuses to
create.

**Fix.** `cancel()` now counts live notes (`status IN (DRAFT, ISSUED)`) against
the invoice and throws `409 Conflict` ("cancel the notes first") if any exist —
the exact mirror of the payments guard and of the notes module's own
cannot-note-a-cancelled-invoice rule. CANCELLED notes don't block.

**Live proof.** Invoice with an issued CN → cancel blocked with the 409 message;
after cancelling the note, the invoice cancel succeeded.

## H4 — Note currency was not pinned to the linked invoice

**Root Cause.** `create()` used `dto.currency || invoice.currency` (client value
wins) and `update()` accepted any currency change. The over-credit guard and the
aging netting subtract raw amounts, so an FX-mismatched note silently corrupted
both.

**Fix.** Server-side pinning: `create()` uses `invoice.currency` whenever an
invoice is linked (DTO value ignored — override, not reject, so existing API
clients keep working); `update()` ignores `currency` for invoice-linked notes.
Standalone debit notes keep free currency choice. Frontend: the currency
selector is disabled with an explanatory tooltip once an invoice is picked.

**Live proof.** CN posted with `"currency": "USD"` against an MYR invoice →
stored and returned as MYR.

---

## Files Modified

**Backend**
- `src/modules/invoices/invoice.calc.ts` — `applyPayment(…, noteNet = 0)` (H1)
- `src/modules/invoices/invoices.service.ts` — `issuedNoteNet()` helper + wired into `recordPayment` (H1); live-notes guard in `cancel()` (H3)
- `src/modules/credit-debit-notes/credit-debit-note.calc.ts` — `assertWithinCreditable(…, amountPaid = 0)` (H2)
- `src/modules/credit-debit-notes/credit-debit-notes.service.ts` — pass `amountPaid` at both guard call-sites (H2); currency pinning in `create()`/`update()` (H4)

**Frontend**
- `src/app/adjustments/note-form.tsx` — currency selector locked when invoice-linked (H4)
- `src/app/invoices/page.tsx` — `+CN` hidden on PAID rows (H2 consequence); `+DN` unchanged

**Tests (new)**
- `src/modules/invoices/invoice.calc.spec.ts` — +5 tests (H1)
- `src/modules/credit-debit-notes/credit-debit-note.calc.spec.ts` — +5 tests (H2)
- `src/modules/credit-debit-notes/credit-debit-notes.service.spec.ts` — NEW, 6 tests (H4 create/update pinning, H2 service path)
- `src/modules/invoices/invoices.service.spec.ts` — NEW, 4 tests (H3 block/allow/ordering)

**No schema changes. No new endpoints. No breaking API changes** (both calc
signatures extended with optional defaulted parameters; `create` now overrides
rather than rejects a mismatched currency).

## Regression Tests

| Fix | Tests |
|---|---|
| H1 | face-value payment rejected after CN; PAID at netted total; PARTIALLY_PAID below it; DN raises collectible; no-noteNet backward compat |
| H2 | credit exactly the unpaid remainder; reject beyond it; reject any CN on fully-paid; payments+credits combined; no-amountPaid backward compat |
| H3 | cancel blocked with live note; count filtered to DRAFT/ISSUED; normal cancel with none; payments guard still checked first |
| H4 | DTO currency overridden to invoice currency on create; standalone DN keeps chosen currency; update ignores currency when linked; update allows it when standalone |

## Risks

1. **Behaviour change (intended): CN on a PAID invoice is now rejected.** If the
   business later needs post-payment credits (refund-on-account), that requires
   the customer credit-balance ledger (P0-8) — logged in `TODO.md`.
2. **Pre-existing data:** any invoice already over-collected or over-credited
   before this fix keeps its stored `amountPaid`/notes; the new guards only
   prevent *new* violations. (Local and production data predating Sprint 01
   have no notes, so exposure is nil in practice.)
3. **M2 (TOCTOU on concurrent issue) remains open** — the issue-time guard is
   still not transactional. It is a Medium finding, out of Sprint 01A's approved
   scope; unchanged in `TODO.md`/review.
4. **DN on a PAID invoice re-opens collectible balance but not invoice status** —
   the invoice stays PAID while `issuedNoteNet` makes the remainder positive;
   payments against it are accepted (H1 math handles this) but aging excludes
   PAID invoices, so the DN remainder is not visible in aging. Pre-existing
   aging-scope behaviour, documented for the SOA work (P0-8).

## Verification Summary

- 106/106 backend tests pass (`npx jest`), backend + frontend typecheck clean, frontend production build clean.
- All four fixes verified against the live local stack via API (outputs quoted per fix above).
- All Sprint 01A test data deleted afterwards; CN/DN/invoice sequences restored (verified: 0 notes remaining, invoice numbering continues at 0008).
