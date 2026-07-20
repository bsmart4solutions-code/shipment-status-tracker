# SPRINT 01 PLAN — Credit Note & Debit Note

**Sprint:** 1 (per `IMPLEMENTATION_ROADMAP.md`, Phase 1)
**Roles:** Lead Solution Architect · Senior Product Owner · Principal Engineer
**Source of truth:** `MVP_SCOPE.md` §2A · `PRODUCT_BACKLOG.md` P0-1 / P0-2 · `BUSINESS_AUDIT.md` §18 / §19
**Status:** ⏸ **AWAITING APPROVAL — no code to be written until approved and the open questions in §10 are answered.**

> ⚠️ **Prerequisite note:** The roadmap places **Sprint 0 (persistent storage + replace `xlsx`)** before this sprint. Sprint 0 is *not* a dependency of CN/DN logic, so this sprint can proceed independently, but CN/DN PDFs will use the same storage path — if Sprint 0 is skipped, generated PDFs remain view/print-only (browser "Save as PDF"), which is already how invoices/quotations work today. **No blocker.**

---

## 1. Sprint Goal

Deliver **compliant post-invoice adjustments**: the ability to issue a **Credit Note** (reduce/reverse an issued invoice) and a **Debit Note** (add a charge after invoicing), each with correct SST tax treatment, correct effect on Accounts Receivable, a professional printable document, and a full audit trail — without altering existing invoice, quotation, or job behaviour.

---

## 2. Business Objective

A freight forwarder cannot legally "edit" or silently cancel an issued tax invoice to fix an over-charge, a returned service, or a missed charge. Malaysian SST practice (and every benchmark ERP — GoFreight/CargoWise/Magaya) requires **credit notes** (to reverse) and **debit notes** (to add) as separate, sequentially-numbered documents that adjust the customer's receivable and the tax reported.

Closing this gap:
- Removes the current **cancel-and-reissue** workaround that breaks the invoice/tax/audit trail (`BUSINESS_AUDIT.md` §18/§19 — both at 0%).
- Is a **P0 go-live blocker** for the MVP (`MVP_SCOPE.md` §2A).

---

## 3. Database Changes

**Why:** Credit/Debit Notes are distinct legal documents with their own numbering, status, tax totals, line items, and a link to the originating invoice. They cannot be modelled as invoice edits.

**Design (proposed):** One shared shape, two document types, mirroring the existing `Invoice` + `InvoiceItem` structure so the costing/tax engine and print layout are reused.

New enum:
```
enum CreditDebitType { CREDIT  DEBIT }
enum AdjustmentStatus { DRAFT  ISSUED  CANCELLED }
```

New model `CreditDebitNote` (table `credit_debit_notes`):
| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| noteNumber | string @unique | auto: `CN-2026-0001` / `DN-2026-0001` |
| type | CreditDebitType | CREDIT or DEBIT |
| invoiceId | string? | FK → Invoice (**required for CREDIT**, optional for DEBIT — see §10 Q3) `onDelete: Restrict` |
| customerId | string | FK → Customer (denormalized for standalone DN) |
| currency | string | inherits invoice currency |
| subtotal | Decimal(14,2) | from lines |
| taxPct | Decimal(7,4) | |
| taxAmt | Decimal(14,2) | SVE-aware (mirror invoice engine) |
| totalAmount | Decimal(14,2) | |
| status | AdjustmentStatus | DRAFT → ISSUED → CANCELLED |
| reason | string? | mandatory business reason (validation) |
| issueDate | DateTime | |
| notes | string? | |
| createdById / updatedById | string? | audit FKs |
| createdAt / updatedAt | DateTime | |

New model `CreditDebitNoteItem` (table `credit_debit_note_items`): same fields as `InvoiceItem` (`description, unitPrice, unit, quantity, lineCurrency, fxRate, amount, taxExempt, accNo, sortOrder`).

Back-relations added to `Invoice` (`creditDebitNotes CreditDebitNote[]`), `Customer`, and `User`.

**Impact:**
- Additive only — **no existing column changed or dropped**. Existing invoice/AR queries untouched.
- AR aging (§4) will need to read note effects (a query change, not a schema change to invoices).
- New sequences `creditNote` and `debitNote` seeded in the `Sequence` table.

**Migration plan:** see §9.

---

## 4. Backend Changes

New module `modules/credit-debit-notes/` following the existing NestJS convention:
- `credit-debit-notes.module.ts`
- `credit-debit-notes.controller.ts` — endpoints in §6, guarded by `@RequirePermission('invoices.write' / '.read')` (reuse invoice permissions — see §10 Q7).
- `credit-debit-notes.service.ts` — create/get/list/issue/cancel; nested item writes in a transaction (same pattern as `InvoicesService`).
- `credit-debit-notes.dto.ts` — `CreateNoteDto`, `UpdateNoteDto`, nested `NoteItemDto`.
- `credit-debit-note.calc.ts` — **reuses** `invoice.calc.ts` (`priceInvoiceItem`, `computeInvoiceTotals`) so SST/SVE math is identical and shared. No duplicate tax logic.

**Reused, not rebuilt:** `SequenceService` (new keys), `AuditService`, `state-machine.ts` (add `assertNoteStatusTransition`), `PrismaService`, permission guards, `rethrowPrisma`.

**AR effect (§10 Q1 — proposed default):** AR aging and a customer's outstanding balance = `Σ issued invoices − Σ issued credit notes + Σ issued debit notes − Σ payments`, applied **per linked invoice** (CN/DN adjust the specific invoice's outstanding). The aging report query in `invoices.service.ts` will be extended read-only to net issued notes into the linked invoice's balance. **No write-path change to invoices.**

---

## 5. Frontend Changes

- New route **`/credit-notes`** and **`/debit-notes`** list pages (or one combined **`/adjustments`** page with a type filter — see §10 Q8), following the invoices page pattern (search, status filter, pagination, permissions).
- New **note builder modal** reusing the invoice line-item builder UI (description / unit price / UOM / qty / SST-exempt / acc no) and the SVE-aware live totals card. "Create from invoice" prefills lines from the source invoice.
- New **print page** `/credit-notes/[id]/print` (and debit) — reuse the invoice print layout (`useCompany()` letterhead, bank block, amount-in-words) with the title swapped to **CREDIT NOTE** / **DEBIT NOTE** and an "Against Invoice: INV-####" reference line.
- Invoice detail/list gains a **"Create Credit Note / Debit Note"** action for issued invoices, and shows linked notes.

Every new page implements the four required states: **loading** (skeleton/"Loading…"), **empty** ("No credit notes yet"), **error** (`ErrorText`), **responsive** (existing Tailwind grid + `Modal size="xl"`).

---

## 6. API Design

All under `/api`, JWT-guarded, permission-gated, validated via DTO, errors via the global exception filter.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/credit-debit-notes?type=&status=&search=&page=` | `invoices.read` | Paginated list |
| GET | `/credit-debit-notes/:id` | `invoices.read` | Detail incl. items + invoice ref |
| POST | `/credit-debit-notes` | `invoices.write` | Create DRAFT (type, invoiceId, items, reason) |
| POST | `/credit-debit-notes/from-invoice/:invoiceId?type=` | `invoices.write` | Prefill from an invoice's lines |
| PATCH | `/credit-debit-notes/:id` | `invoices.write` | Edit DRAFT only |
| POST | `/credit-debit-notes/:id/issue` | `invoices.write` | DRAFT → ISSUED (locks doc, applies to AR) |
| POST | `/credit-debit-notes/:id/cancel` | `invoices.write` | → CANCELLED (only if not applied/settled) |

**Validation (per rules):** `type` in enum; `reason` required; CREDIT requires `invoiceId`; items ≥ 1; `quantity` positive, `unitPrice ≥ 0`; a **CREDIT total cannot exceed the linked invoice's net (subtotal+tax) minus already-issued credit notes** (over-credit guard); no note against a CANCELLED/DRAFT invoice; edits only in DRAFT.

**Authorization:** reuse `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermission`.
**Error handling:** `NotFoundException` / `BadRequestException` / `ConflictException` mapped by the existing global filter; Prisma errors via `rethrowPrisma`.

---

## 7. UI Changes

- Sidebar (`components/shell.tsx`): add **Credit Notes** and **Debit Notes** nav links (gated by `invoices.read`).
- Invoice list & detail: **Create Credit/Debit Note** action on ISSUED/PARTIALLY_PAID/PAID invoices; "Linked adjustments" section.
- Consistent status badges (`StatusBadge` extended with DRAFT/ISSUED/CANCELLED already covered).
- Print pages match the existing Solid-Xpress invoice look for visual consistency.

---

## 8. Files Expected To Change

**New (backend):**
- `backend/prisma/migrations/<ts>_credit_debit_notes/migration.sql`
- `backend/src/modules/credit-debit-notes/{module,controller,service,dto}.ts`
- `backend/src/modules/credit-debit-notes/credit-debit-note.calc.spec.ts`

**Modified (backend, minimal & justified):**
- `backend/prisma/schema.prisma` — new models/enums + back-relations (additive).
- `backend/src/app.module.ts` — register the new module (one line).
- `backend/src/common/state-machine.ts` — add `assertNoteStatusTransition` (new export; existing untouched).
- `backend/src/modules/invoices/invoices.service.ts` — **read-only** extension of AR aging to net issued notes (no write-path change).
- `backend/prisma/seed.ts` — seed `creditNote`/`debitNote` sequences.

**New (frontend):**
- `frontend/src/app/credit-notes/page.tsx`, `frontend/src/app/credit-notes/[id]/print/page.tsx`
- `frontend/src/app/debit-notes/page.tsx`, `frontend/src/app/debit-notes/[id]/print/page.tsx`
- `frontend/src/app/adjustments/note-form.tsx` (shared builder modal)

**Modified (frontend, minimal):**
- `frontend/src/components/shell.tsx` — nav links.
- `frontend/src/app/invoices/page.tsx` — "Create Credit/Debit Note" action + linked-notes display.

**Explicitly NOT touched:** quotations, jobs, customers, vendors, rates, dashboard, pnl, costing, reports, auth. Any deviation will be justified before editing.

---

## 9. Migration Plan

1. Add models/enums + back-relations to `schema.prisma` (additive).
2. `prisma migrate dev --name credit_debit_notes` → new tables + FKs + indexes (`invoiceId`, `customerId`, `status`).
3. `prisma generate`; seed adds `creditNote`/`debitNote` sequence rows (idempotent upsert).
4. **Backward compatibility:** zero changes to existing tables → existing data and all current queries unaffected; migration is forward-only and safe to `migrate deploy` in CI/prod.
5. **Rollback:** the migration only creates new objects; a down-migration drops the two tables + enums with no impact on invoices.

---

## 10. Risks & Open Questions (must be answered before coding — "never guess business logic")

**Proposed defaults are marked ▶; please confirm or correct.**

1. **AR application model** — ▶ *Credit/Debit Notes adjust the **specific linked invoice's** outstanding balance* (vs. crediting the customer's account as unallocated funds). Confirm?
2. **Refunds** — if an invoice is already fully PAID and a CN is issued, ▶ *record credit-on-account only (no cash-refund/bank-out in this sprint; refunds deferred to AP/payments later)*. Confirm?
3. **Debit Note independence** — ▶ *DEBIT notes may be standalone (no invoiceId) for brand-new charges; CREDIT notes must reference an invoice.* Confirm?
4. **SST treatment on CN/DN** — ▶ *Reverse/apply output tax at the same rate as the original lines; SST-exempt (SVE, e.g. ocean freight) lines stay 0-tax — identical to the invoice engine.* Confirm?
5. **Numbering series** — ▶ *Separate sequences `CN-YYYY-####` and `DN-YYYY-####`.* Does this match your SST filing / accountant's expectation, or do you need a shared series or a company-specific prefix?
6. **Over-credit guard** — ▶ *A CREDIT note's total cannot exceed the linked invoice's net minus already-issued credit notes.* Confirm (or allow over-credit with approval)?
7. **Approval** — ▶ *No approval workflow for CN/DN in this sprint (not in MVP scope); flagged as P1.* Confirm, or is a threshold approval required now?
8. **UI shape** — ▶ *Two separate pages `/credit-notes` and `/debit-notes`* (vs one combined `/adjustments` page). Preference?

**Other risks:**
- **Tax-rule correctness** is the highest risk — validate Q4/Q5 with the accountant before go-live.
- **Effort:** ~4 dev-weeks (roadmap Sprint 1). Reusing the invoice engine/print keeps it contained; the main new surface is the AR-netting query and the over-credit validation.
- **Scope creep:** must NOT drift into AP, statements, or accounting integration (later sprints).

---

## 11. Test Plan

**Backend unit (Jest) — new `credit-debit-note.calc.spec.ts`:**
- SVE-aware totals identical to invoice engine (regression parity).
- Over-credit guard rejects CN total > invoice net.
- Tax reversal math on mixed SVE/SV lines.
- Standalone DN (no invoice) computes correctly.

**Service/logic tests:**
- Create DRAFT → issue → status transitions enforced (illegal transitions throw).
- Cancel only allowed pre-application.
- AR aging nets issued CN/DN against the linked invoice (assert new outstanding).

**API-level (validation) checks:**
- Missing `reason` → 400; CREDIT without `invoiceId` → 400; note on CANCELLED invoice → 409; edit of ISSUED note → 400.

**Constraint:** all **95 existing tests must remain green**; coverage must not drop. New business logic (calc + AR netting + guards) requires tests before the sprint is "done".

---

## 12. Acceptance Criteria

1. Issue a **Credit Note** against an ISSUED invoice → invoice's outstanding on the AR aging report **decreases** by the CN net; both documents linked; CN prints as a professional "CREDIT NOTE".
2. Issue a **Debit Note** (linked or standalone) → customer AR **increases** by the DN net; DN prints as "DEBIT NOTE".
3. SST/SVE tax on CN/DN mirrors the invoice engine exactly (ocean-freight line = SVE 0%).
4. Over-credit is **blocked**; CN/DN against a CANCELLED invoice is **blocked**; ISSUED notes are **immutable**.
5. Every endpoint has validation + authorization + error handling; new logic has tests; **all existing tests pass**.
6. New pages support loading / empty / error / responsive states.
7. `CHANGELOG.md`, `PRODUCT_BACKLOG.md` (P0-1/P0-2 → Done), and `TODO.md` updated at sprint close.
8. No files outside §8 modified; no existing functionality regressed.

---

### ⏸ Awaiting: (a) approval of this plan, and (b) answers to §10 Q1–Q8. Implementation will not begin until both are received.
