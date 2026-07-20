# ARCHITECTURE REVIEW — Sprint 01 (Credit & Debit Notes)

**Reviewer role:** Enterprise ERP Solution Architect
**Scope:** Sprint 01 deliverable only (commit `2cdb380`) + its integration points with the existing invoice/payment engine
**Method:** Full source review of `backend/src/modules/credit-debit-notes/*`, schema + migration, `state-machine.ts`, `invoices.service.ts` (aging, cancel, recordPayment), `sequence.service.ts`, `invoice.calc.ts`, and `frontend/src/app/adjustments/*` + route wrappers
**Date:** 2026-07-20
**Code changes made during this review:** NONE

---

## Verdict

**Sprint 01 is architecturally sound and production-usable for the approved scope.**
The single-tax-engine reuse, centralized state machine, additive migration, and
read-only AR extension are exactly right. **No Critical findings.**

The real risks are not inside the notes module — they are at the **seams between
notes and the pre-existing payment/cancel logic**, which was written before notes
existed and does not know about them. Four High findings all stem from that seam.

**Finding count: 0 Critical · 4 High · 8 Medium · 6 Low.**

---

## Part A — Area-by-area assessment

### 1. Architecture — ✅ Good
The module follows the established NestJS vertical-slice pattern (dto → service →
controller → module) and registers cleanly in `app.module.ts`. The decision to make
the AR effect a **derived read** (aging recomputes from ISSUED notes) rather than a
stored mutation of `Invoice` is the correct event-sourcing-lite choice: cancelling a
note automatically reverses its AR effect with zero write-path risk.
**Weakness:** the derived-read model was applied to *aging only* — the payment
engine and invoice status derivation still read `totalAmount − amountPaid` directly
and are now the only consumers of an incomplete picture of AR (see H1/H2).

### 2. Database Design — ✅ Good, one strategic gap
Correct: `@unique` on noteNumber, `Restrict` on invoiceId (a billed invoice cannot
be hard-deleted), `Cascade` on items, `SetNull` on audit users, indexes on all four
query columns, `Decimal(14,2/4/6)` money types matching the invoice tables,
`@@map` snake_case naming consistent with the rest of the schema.
**Weaknesses:** `customerId` is required — the model is AR-only by construction
(see Future Compatibility, M7); `reason` is nullable in the DB although it is a
mandatory business field (L4); the note has **no job linkage**, so job-level
profitability cannot see credits (M8).

### 3. API Design — ✅ Good
7 endpoints, consistent with existing modules; `ListNotesDto extends PaginationDto`
is the *correct* whitelist pattern and is notably better than the pre-existing
quotations/invoices/jobs controllers (which have a documented 400-filter bug,
`TODO.md`). Typed guard errors (`OverCreditError`) mapped to proper HTTP codes;
`from-invoice` prefill endpoint is a clean server-owned way to keep prefill logic
out of the client.
**Weaknesses:** create blocks only `CANCELLED` invoices — a note can be raised
against a `DRAFT` invoice via the API (M1); `PATCH` accepts `items: []` (M4).

### 4. Frontend Design — ✅ Good
Loading / empty / error states present on the list; guard messages before save;
SVE-aware live totals; print page reuses the letterhead/company profile system.
**Weaknesses:** invoice picker fetches `pageSize=200` and searches client-side
(M2 pattern debt, consistent with existing pages); live totals are unrounded per
line so they can drift ±0.01 from the server's per-line-rounded result (L2);
Issue/Cancel fire without a confirmation dialog although Issue is an irreversible
posting event (M6).

### 5. Code Reusability — ✅ Excellent
The strongest part of the sprint. `computeNoteTotals` delegates 1:1 to
`priceInvoiceItem`/`computeInvoiceTotals` — tax math cannot diverge from invoices.
One shared `note-form` / `note-list` / `note-print` implementation serves both
document types through thin route wrappers; `SequenceService`, `AuditService`,
state-machine, `Modal`/`Table`/`SearchableSelect` all reused, nothing duplicated.

### 6. Folder Structure — ✅ Acceptable
Backend placement is canonical. Frontend shared components live in
`app/adjustments/` — a non-route folder inside the App Router tree. It works
(no `page.tsx` ⇒ not routable) but the project convention for shared UI is
`src/components/`; this is the first module to deviate (L3).

### 7. Naming Consistency — ✅ Good
`CreditDebitNote`/`credit_debit_notes`, CN-/DN- prefixes, `AdjustmentStatus`
naming all coherent. Minor: the enum is `AdjustmentStatus` while everything else
says "note" (`assertNoteStatusTransition`, `NoteItemDto`) — one concept, two
names (L5); `as never` casts in `list()` paper over typing instead of using the
DTO's narrowed union (L1).

### 8. Performance — ✅ Adequate for target segment
List queries are indexed and paginated; the aging netting is a **single**
`groupBy` (no N+1) — good. Aging still loads all open invoices into memory and
the note form loads 200 invoices/customers upfront; both are fine for an SME
forwarder and both match pre-existing patterns, but they set the ceiling (L6, M2).

### 9. Security — ✅ Good, one deliberate coarseness
JWT + permission guards on every route; server recomputes all money (client
totals never trusted); DTO whitelisting; audit log on every write; sequence
allocation under `FOR UPDATE`. Reusing `invoices.read/write` was an approved
default, but it means anyone who can bill can also *issue* credit — there is no
separate grant to segregate "create invoice" from "give money back", which is a
classic fraud-control separation in ERP (M5, ties into the deferred approval
workflow).

### 10. Business Logic — ⚠️ Correct in isolation, gaps at the seams
The eight approved rules are implemented faithfully and the over-credit guard is
right *for the data it looks at*. The gaps: the guard ignores `amountPaid` (H2);
payment recording ignores issued notes (H1); invoice cancel ignores issued notes
(H3); currency is not pinned to the linked invoice (H4); `issueDate` is not
re-stamped at issue time, so the SST tax-point date can be stale (M3).

### 11. Test Coverage — ⚠️ Thin beyond the calc layer
8 solid unit tests cover the money math and guard arithmetic; the full suite
(86/86) passes. But **zero automated tests** exercise the service layer: CREDIT-
requires-invoice, standalone-DEBIT-requires-customer, cancelled-invoice rejection,
DRAFT-only editing, the issue/cancel transitions, and the aging netting are all
verified only by the manual live test in `SPRINT_01_REPORT.md`. Any regression in
those paths will ship silently (M9).

### 12. Scalability — ✅ Fine for the segment, one structural note
Data volumes (notes ≪ invoices) are trivial. The scaling concern is *conceptual*:
AR truth is now computed in two places (payment engine: `total − paid`; aging:
`total − paid + notes`). Every future consumer (statements, dashboards, portal,
accounting export) must remember to include notes. A single
"invoice outstanding balance" function/view does not exist yet — each new module
re-derives it (M10 recommendation).

### 13. Future Compatibility — see Part C.

---

## Part B — Findings register

> No Critical findings. Highs are ranked by financial-integrity impact.

### HIGH

**H1 — Payment engine is blind to issued credit notes**
- **Where:** `invoices.service.ts` `recordPayment()` → `applyPayment(totalAmount, amountPaid, amount)`
- **Description:** The overpayment guard and PAID-status derivation use the *pre-credit* invoice total. An invoice of 2,138.40 with an issued CN of 248.40 (true receivable 1,890.00) will still accept payments up to 2,138.40 and only then flip to PAID.
- **Impact:** Over-collection from customers is possible; once the customer pays the netted amount (1,890.00) the invoice stays PARTIALLY_PAID forever, or if they pay in full the −248.40 credit vanishes from every report (aging filters balances ≤ 0). Unrecorded liability to the customer; collections chase invoices that are actually settled.
- **Recommendation:** Extend `applyPayment` (or wrap it) to take a `noteNet` parameter: remaining = `total − paid + noteNet`; derive PAID against the netted total. Single call-site change in `recordPayment` plus a `groupBy` identical to the one aging already uses — no schema change. Add unit tests for pay-after-credit and credit-after-partial-pay.

**H2 — Over-credit guard ignores payments already received**
- **Where:** `credit-debit-note.calc.ts` `assertWithinCreditable(noteTotal, invoiceTotal, alreadyCredited)`
- **Description:** The guard caps CN totals at `invoiceTotal − alreadyCredited` but never subtracts `amountPaid`. On an invoice of 1,000 with 600 already paid, an 800 CN passes the guard.
- **Impact:** Combined credit + cash can exceed the invoice value; the resulting negative balance is silently dropped from aging (filter `> 0.005`), so the over-credit is invisible. This is the mirror image of H1 — together they let AR go negative undetected.
- **Recommendation:** Pass `amountPaid` into the guard: available = `invoiceTotal − amountPaid − alreadyCredited` (or, if crediting paid amounts is a deliberate business choice for refund-on-account, surface the negative balance as a customer credit balance instead of filtering it out). Decide the business rule explicitly — do not leave it emergent.

**H3 — Invoice cancel does not consider issued notes**
- **Where:** `invoices.service.ts` `cancel()` — blocks on `amountPaid > 0` only
- **Description:** An invoice with an ISSUED credit/debit note against it can be cancelled. The note remains ISSUED, pointing at a CANCELLED invoice (a state the notes module itself refuses to *create*, per its own `ConflictException`).
- **Impact:** Dangling issued adjustment documents against void invoices; the CN stays in the ledger and in statutory document sequence while its base document is void — an auditor's red flag. Data model asymmetry: creation path forbids what the cancel path silently produces.
- **Recommendation:** In invoice `cancel()`, block when ISSUED notes exist (mirror the payments guard: "cancel the notes first"), or auto-cancel DRAFT notes and refuse if ISSUED ones exist. One query + one ConflictException.

**H4 — Note currency is not pinned to the linked invoice**
- **Where:** `create()` (`currency = dto.currency || invoice?.currency`), `update()` (free `currency` change), frontend allows changing currency after picking an invoice
- **Description:** A note against an MYR invoice can be saved in USD. The over-credit guard and the aging `noteNet` then compare/net raw numbers across currencies with no FX conversion.
- **Impact:** A USD 200 CN against an MYR 1,000 invoice reduces aging by "200" MYR-equivalent-by-accident; the guard's arithmetic is meaningless cross-currency. Financial reports silently wrong whenever the mismatch occurs.
- **Recommendation:** When `invoiceId` is set, force `currency = invoice.currency` server-side (reject or override the DTO value) and lock the currency selector in the UI for invoice-linked notes. Standalone debit notes may keep free currency choice.

### MEDIUM

**M1 — Notes can be raised against DRAFT invoices (API level)**
- **Description:** `create()` rejects only CANCELLED invoices. The UI shows +CN/+DN only on issued+ rows, but the API accepts a CN against a DRAFT invoice.
- **Impact:** An issued CN against a draft invoice has no AR effect (aging only reads ISSUED/PARTIALLY_PAID) and becomes a pre-loaded deduction that silently activates when the invoice is later issued — never a deliberate business action.
- **Recommendation:** Require invoice status ∈ {ISSUED, PARTIALLY_PAID, PAID} at note create *and* at note issue.

**M2 — Issue-time guard is not concurrency-safe (TOCTOU)**
- **Description:** `issue()` reads `issuedCreditTotal`, checks the guard, then updates status — three steps, no transaction or row lock. Two CNs issued concurrently against the same invoice can both pass the guard.
- **Impact:** The over-credit invariant can be violated under concurrent use; low probability at current team size, but this is exactly the class of bug that appears only in production.
- **Recommendation:** Wrap `issue()` in `$transaction` with `SELECT … FOR UPDATE` on the invoice row (the sequence service already demonstrates the pattern in this codebase).

**M3 — issueDate is not stamped at issue time**
- **Description:** `issueDate` defaults to creation time and `issue()` never updates it. A draft created on the 25th and issued on the 3rd of the next month carries the old date.
- **Impact:** The SST tax point of a credit/debit note is its issue date; a stale date can put the adjustment in the wrong tax period on the SST-02 return.
- **Recommendation:** On DRAFT→ISSUED, set `issueDate = now()` unless the user explicitly overrode it; or keep `issueDate` as the document date and add a `postedAt` timestamp — but make the tax-period source explicit.

**M4 — Update path weakens create-path invariants**
- **Description:** `UpdateNoteDto.items` has no `@ArrayMinSize(1)` — `PATCH { items: [] }` produces a zero-line, zero-total DRAFT. `reason` accepts an empty string on both create and update (`@IsString()` permits `''`; only the frontend blocks it).
- **Impact:** Invariants ("≥1 line", "mandatory reason") are enforceable-by-UI only; API consumers (future portal, integrations, scripts) can create degenerate documents.
- **Recommendation:** Add `@ArrayMinSize(1)` to `UpdateNoteDto.items` and `@IsNotEmpty()` to `reason` in both DTOs. (Two decorators; no logic change.)

**M5 — No segregation of duties on credit issuance**
- **Description:** Approved default: notes reuse `invoices.write` and have no approval workflow. Anyone who can bill can also issue credit, with no threshold.
- **Impact:** Classic ERP fraud-control gap — issuing credit is how billing fraud is usually hidden. Acceptable for an owner-operated forwarder today; not acceptable once non-owner staff can bill.
- **Recommendation:** Keep for MVP (as approved), but plan a dedicated `notes.issue` permission (cheap now — the permission system already exists) before onboarding non-admin billing users; the approval workflow can stay deferred.

**M6 — Issue/Cancel are single-click with no confirmation**
- **Description:** In `note-list.tsx`, Issue (irreversible posting) and Cancel fire immediately on click; the codebase's other destructive actions use confirmation dialogs.
- **Impact:** One mis-click posts a document into the statutory sequence or voids it; ISSUED→DRAFT does not exist, so recovery is cancel + re-key.
- **Recommendation:** Add the same confirm step used elsewhere in the app for Issue and for Cancel-of-ISSUED.

**M7 — Data model is AR-only; AP reuse is blocked by design**
- **Description:** `customerId` is required and there is no party-type discriminator; `credit_debit_notes` cannot represent a vendor (AP) credit note despite the generic table name.
- **Impact:** P0-3 (Accounts Payable) will need either a schema migration on this table (nullable customerId + vendorId + partyType + constraint) or a parallel vendor-notes model — decide before AP starts, not during.
- **Recommendation:** At AP design time, prefer a separate `vendor_credit_debit_notes` model reusing the same calc engine and state machine (mirrors the existing customer/vendor master split in this codebase) over widening this table; document the decision in the AP sprint plan.

**M8 — Notes are invisible to job P&L and standalone notes have no job link**
- **Description:** The note has no `jobId`. Invoice-linked notes could be attributed via note→invoice→job, but no report does so; standalone debit notes cannot be attributed at all.
- **Impact:** Job profitability and P&L overstate revenue after any credit note; extra charges billed via standalone DN never appear in the job's revenue.
- **Recommendation:** Short-term: net invoice-linked notes into P&L via the invoice→job join. Longer-term: add optional `jobId` to the note (additive migration) for standalone DN attribution.

**M9 — No service-level or API tests**
- **Description:** Automated coverage stops at the pure calc layer. All service invariants (CREDIT⇒invoice, standalone DEBIT⇒customer, cancelled-invoice rejection, DRAFT-only edit, transitions, aging netting) rely on one manual verification session.
- **Impact:** Regressions in the highest-risk layer (the one that touches money and state) will not be caught by CI.
- **Recommendation:** Add a service-level spec with a mocked/stubbed Prisma (the codebase already unit-tests services this way elsewhere) covering the six invariants above plus H1–H4 fixes when made.

**M10 — "Invoice outstanding balance" has no single owner**
- **Description:** After Sprint 01, the true receivable (`total − paid + noteNet`) is computed inside `agingReport()` only; `recordPayment` and the invoice list's Balance column compute `total − paid`.
- **Impact:** Every future consumer (SOA/P0-8, dashboard, portal, accounting export) will re-derive balance and some will forget the notes term — H1 is the first instance of this class.
- **Recommendation:** Extract one `outstandingBalance(invoiceId | invoice+noteNet)` helper (or SQL view) and make aging, payments, the invoice list, and all future modules consume it. This is the single highest-leverage refactor available.

### LOW

**L1 — `as never` casts in `list()`** — where-clause building casts filter strings instead of using the DTO's narrowed union types. Cosmetic type-safety debt; replace with the union types now carried by `ListNotesDto`.

**L2 — Client live totals may drift ±0.01 from server** — the form sums unrounded line amounts; the server rounds per line (`round2` in `priceInvoiceItem`). Saved values are always server-computed (correct), but the preview can differ by a cent on fx lines. Round per line in the form's `useMemo` to match.

**L3 — Shared components under `app/adjustments/`** — works (non-route folder) but deviates from the `src/components/` convention used by every other shared component. Move when convenient; zero runtime impact.

**L4 — `reason` nullable in DB** — mandatory business field enforced only at DTO layer. Backfill-and-constrain later, or accept DTO-level enforcement; be consistent with how the codebase treats other mandatory-by-DTO fields.

**L5 — Dual naming: `AdjustmentStatus` vs `Note*`** — one concept, two vocabularies across schema/state-machine/DTOs. Pick "note" or "adjustment" for future additions.

**L6 — Aging loads all open invoices into memory** — pre-existing pattern, unchanged by this sprint; fine below ~10k open invoices. Revisit with SQL-side aggregation when AP lands (which will double the report surface).

---

## Part C — Future compatibility

**Accounts Payable (P0-3): ⚠️ prepared in mechanics, blocked in model.**
Reusable as-is: calc engine, state machine, sequence service, audit, the whole
frontend adjustment pattern. Blocked: the AR-only schema (M7 — required
`customerId`, no party discriminator) and the permission scope (`invoices.*`
makes no sense for vendor bills). Decide the vendor-notes model shape in the AP
sprint plan before writing its migration.

**Booking (P0-4): ✅ no coupling, no conflict.**
Notes touch only Invoice/Customer. Booking sits upstream (quote → booking → job);
nothing in Sprint 01 constrains it.

**Shipment Workflow (P0-4): ✅ compatible, one report gap.**
Milestones don't interact with notes. The only intersection is job-level
profitability (M8): credits must eventually flow into job P&L via the
note→invoice→job join, and standalone DNs need the optional `jobId`.

**Customer Portal (P1-2): ⚠️ two prerequisites.**
(1) Row-level scoping — `list()`/`get()` have no customer-scoping parameter;
portal users must see only their own notes, so the service needs a
`customerId` constraint injected from the portal identity (design exists nowhere
yet; same gap applies to invoices). (2) Server-side PDF — the print page is a
client-rendered authenticated route; portal document download and note emailing
both need the server-side PDF path already listed in `TODO.md`. Neither requires
rework of Sprint 01, only additions.

---

## Part D — Recommended remediation order (for the next approval)

| Priority | Items | Effort | Rationale |
|---|---|---|---|
| 1 | H1 + H2 + M10 (one balance function, used by payments + guard + aging) | S–M | Single root cause; fixes both High money-integrity gaps structurally |
| 2 | H3, H4, M1 (seam guards: cancel-with-notes, currency pinning, invoice-status check) | S | Three small server-side checks |
| 3 | M2 (transactional issue), M3 (issue-date stamping), M4 (DTO tightening) | S | Correctness hardening, no design decisions needed |
| 4 | M9 (service-level tests incl. regression tests for all of the above) | M | Locks the fixes in |
| 5 | M6 (confirm dialogs), L1, L2 | S | Polish |
| 6 | M5, M7, M8 — decisions to record in the next sprint plans (AP model, notes.issue permission, jobId) | — | Planning, not code |

---

*No code was modified during this review. Awaiting approval before any remediation.*
