# SPRINT 01 REPORT — Credit & Debit Notes

**Sprint goal:** P0-1 (Credit Note) + P0-2 (Debit Note) — SST-compliant billing adjustments applied to AR.
**Plan:** `SPRINT_01_PLAN.md` (approved 2026-07-20, all 8 business defaults accepted)
**Status:** ✅ COMPLETE — implemented, tested, live-verified end-to-end
**Date:** 2026-07-20

---

## 1. Summary

Credit Notes and Debit Notes are now first-class billing documents. A credit note
must reference an issued invoice and reduces its AR balance; a debit note can be
raised against an invoice or standalone against a customer, and increases AR.
Both share the invoice tax engine (SST / SVE-exempt lines), the document
numbering service (CN-YYYY-#### / DN-YYYY-####), a DRAFT → ISSUED → CANCELLED
lifecycle, and a print document on the company letterhead. The AR aging report
nets issued notes into invoice balances.

## 2. Business features completed

| # | Feature | Result |
|---|---|---|
| 1 | Create credit note against an issued invoice (prefill lines from invoice) | ✅ |
| 2 | Create debit note against an invoice **or** standalone against a customer | ✅ |
| 3 | SST tax parity with invoices — SVE (tax-exempt) lines excluded from tax base | ✅ |
| 4 | Over-credit guard — a CN cannot exceed invoice total − already-issued credits | ✅ |
| 5 | Lifecycle DRAFT → ISSUED → CANCELLED (edit only in DRAFT; issue is the posting event) | ✅ |
| 6 | AR aging nets issued CN (−) / DN (+) into invoice balances; fully-credited invoices drop off | ✅ |
| 7 | Separate CN / DN pages, list + search + status filter, print document on letterhead | ✅ |
| 8 | `+CN` / `+DN` shortcuts on the invoice list (invoice preselected, currency/tax adopted) | ✅ |

**Approved business rules implemented:** notes adjust the specific linked invoice;
credit-on-account only (no cash refund flow); CREDIT requires an invoice, DEBIT may
be standalone; separate CN/DN number sequences; no approval workflow (direct issue);
no note against a CANCELLED invoice.

## 3. Database changes

Migration: `backend/prisma/migrations/20260720112511_credit_debit_notes/`

- **Enums:** `CreditDebitType` (CREDIT | DEBIT), `AdjustmentStatus` (DRAFT | ISSUED | CANCELLED)
- **`credit_debit_notes`** — noteNumber (unique), type, invoiceId? (FK, `onDelete: Restrict` — an invoice with notes cannot be deleted), customerId (FK), currency, subtotal, taxPct, taxAmt, totalAmount, status, reason, issueDate, notes, createdById/updatedById audit
- **`credit_debit_note_items`** — mirrors invoice items: description, unitPrice, unit, quantity, lineCurrency, fxRate, amount, taxExempt, taxCode, taxAmt, accNo, sortOrder
- **Sequences seeded:** `creditNote` (CN, year-scoped, pad 4), `debitNote` (DN, year-scoped, pad 4)
- No changes to existing tables beyond back-relations (Invoice, Customer, User).

## 4. API changes (all new, under `/api/credit-debit-notes`)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/` | invoices.read | paginated; filters: `type`, `status`, `search` |
| GET | `/:id` | invoices.read | note + items + invoice + customer |
| GET | `/from-invoice/:invoiceId` | invoices.write | prefill payload from invoice lines |
| POST | `/` | invoices.write | validation: CREDIT⇒invoiceId, standalone DEBIT⇒customerId, ≥1 line, reason required; over-credit guard |
| PATCH | `/:id` | invoices.write | DRAFT only; transactional item replace |
| POST | `/:id/issue` | invoices.write | state-machine check + over-credit re-check (excluding self) |
| POST | `/:id/cancel` | invoices.write | DRAFT or ISSUED → CANCELLED |

Modified (read-only extension): `GET /api/invoices/aging` now nets ISSUED notes
into balances via a single `groupBy` — no schema or write-path changes.

## 5. Frontend changes

- **`/credit-notes`**, **`/debit-notes`** — list pages (search, status filter, pagination, Edit/Issue/Cancel/Print actions) with loading / empty / error states
- **`/credit-notes/[id]/print`**, **`/debit-notes/[id]/print`** — A4 print document: company letterhead, CREDIT NOTE / DEBIT NOTE title, AGAINST INVOICE + REASON rows, SVE-aware line table, amount-in-words, bank block, FMFF footer
- **Note builder modal** — invoice picker (adopts currency / SST% / customer), "Load lines" prefill, SST-exempt checkbox per line, live SVE-aware totals
- **Invoice list** — `+CN` / `+DN` buttons on ISSUED / PARTIALLY_PAID / PAID rows
- **Sidebar** — Credit Notes / Debit Notes entries (visible with `invoices.read`)

Shared implementation in `frontend/src/app/adjustments/` (`note-form.tsx`,
`note-list.tsx`, `note-print.tsx`) — the CN and DN routes are thin wrappers.

## 6. Files modified

**New (backend):** `modules/credit-debit-notes/` — `credit-debit-note.calc.ts`, `credit-debit-notes.dto.ts`, `credit-debit-notes.service.ts`, `credit-debit-notes.controller.ts`, `credit-debit-notes.module.ts`, `credit-debit-note.calc.spec.ts`
**New (frontend):** `app/adjustments/note-form.tsx`, `note-list.tsx`, `note-print.tsx`; `app/credit-notes/page.tsx`, `app/credit-notes/[id]/print/page.tsx`; `app/debit-notes/page.tsx`, `app/debit-notes/[id]/print/page.tsx`
**Modified:** `prisma/schema.prisma`, `prisma/seed.ts`, `src/app.module.ts`, `src/common/state-machine.ts`, `src/modules/invoices/invoices.service.ts` (aging only), `frontend/src/components/shell.tsx`, `frontend/src/app/invoices/page.tsx`

## 7. Tests

`credit-debit-note.calc.spec.ts` — 8 new tests:
tax parity with the invoice engine (2935 / 885 / 53.10 / 2988.10), SVE exclusion,
per-line FX conversion, standalone DN totals, over-credit guard (within / exact
balance incl. float tolerance / beyond / fully-credited).

**Suite result: 8 suites, 86/86 tests passing.** Typecheck (backend `tsc --noEmit`,
frontend `next build`) clean.

## 8. Live verification (2026-07-20, local)

API: CN against a 1060.00 invoice → aging 1060 → issue 212.00 CN → aging 848;
over-credit CN (1000) rejected; CN without invoice rejected; standalone DN created.
UI: `+CN` on INV-2026-0007 (2138.40) → modal preselected invoice, adopted MYR/8% →
"Load lines" pulled both invoice lines → partial credit 230.00 + 18.40 SST = 248.40 →
saved as CN-2026-0001 DRAFT → issued → aging balance 1890.00 → print document
rendered on Golden Freight Logistics letterhead. All verification data deleted and
sequences reset afterward.

## 9. Known limitations

1. **No PDF/email of notes** — print via browser only (invoice email exists; notes deferred).
2. **No refund flow** — credit-on-account only, per approved default.
3. **No approval workflow** — any `invoices.write` user can issue.
4. **Note ↔ payment interplay:** a CN can bring an over-paid invoice's balance below zero; negative balances are simply not shown in aging (no credit-balance ledger yet — belongs with AP/statement work, P0-3/P0-8).
5. **Pre-existing bug discovered (NOT fixed — out of sprint scope):** list-filter query params (`status`, `customerId`, …) on **quotations / invoices / jobs** endpoints are rejected with 400 by the global `forbidNonWhitelisted` ValidationPipe because they are declared as extra `@Query()` params instead of DTO fields. The notes module uses a whitelisted `ListNotesDto` and is unaffected. Logged in `TODO.md`.

## 10. Migration notes

- Run `npx prisma migrate deploy` (applies `20260720112511_credit_debit_notes`).
- Run the seed **or** insert the two sequence rows (`creditNote`, `debitNote`) — the seed is idempotent (upsert).
- No changes to existing data; no downtime; rollback = drop the two new tables + enums (no existing table was altered destructively).
