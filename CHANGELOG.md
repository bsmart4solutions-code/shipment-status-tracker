# Changelog

All notable changes to the Shipment Status Tracker (Freight ERP) are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); sprint-based versioning.

## [Sprint 03] — 2026-07-28 — Accounts Payable (P0-3)

### Added
- **Vendor Bills** — capture what a vendor invoiced us: header + lines, SST-aware (SST is a cost, no input-tax credit), multi-currency, server-computed totals, lifecycle DRAFT → APPROVED → PARTIALLY_PAID → PAID plus **VOID**.
- **Multi-job allocation** — line-level job override, so one consolidated carrier invoice can cover several shipments; bills may also carry no job at all.
- **Duplicate-bill control** — unique `(vendorId, vendorInvoiceNo)`: the same invoice number is blocked for one vendor and allowed for another.
- **Vendor payments** — partial payments with overpayment prevention and derived status.
- **Payment reversal** — soft reversal that preserves the row (reason, who, when), recomputes outstanding in the same transaction and re-derives status through a reversal-only edge set; AP aging needs no recalculation job because it is derived, not stored.
- **AP Aging** — due-date buckets, per-vendor totals, total payable.
- **Job cost variance (Phase B)** — read-only `GET /jobs/:id/cost-variance` and a job Cost panel showing four independent values: Estimated · Recorded · Vendor Bill Total · Variance, with honest labelling when the recorded cost is still the quotation estimate, and "no bills yet" instead of a 0.00 variance.
- New `payables.read` / `payables.write` permission scope (Administrator, Manager, Finance) — deliberately separate from `invoices.*`.

### Ownership boundary
- Vendor bills **never** write `Job.actualCost`, `Job.profit`, `Job.actualRevenue` or the P&L. Verified live (a full create → approve → pay → reverse → void cycle left every AR, job and P&L figure numerically identical) and enforced by a structural test.

### Tests
- +66 tests (suite 219/219). One additive migration; no existing table altered; no existing endpoint changed.

See `SPRINT_03_REPORT.md`; architecture in `AP_ARCHITECTURE_DECISION.md`.

---

## [Sprint 02A] — 2026-07-27 — Production storage configuration gate (H-1)

### Fixed
- **H-1 — production can no longer silently fall back to ephemeral local storage.** With `NODE_ENV=production` and `STORAGE_DRIVER=s3`, the four `S3_*` variables are now required: a missing or blank value aborts startup (exit 1) with a message naming the variable, so a misconfigured deploy fails loudly instead of writing documents to a disk the next deploy erases. `FileStorageService` throws in the same situation as defence in depth.
- **Development is unchanged** — an incomplete S3 configuration still falls back to the local driver and boots.

### Added
- `GET /api/health` reports the active storage driver at `checks.storageDriver` (`"local"` in production is now alertable). Additive field only; `/health/live`, `/health/ready`, `/health/metrics` unchanged.

### Tests
- +13 regression tests (suite 153/153): production startup validation, development fallback, health driver reporting.

### Operational note
- **Enter the Cloudflare R2 credentials in Render before the next production deploy** (`STORAGE.md` §3) — a production deploy with `STORAGE_DRIVER=s3` and missing credentials now fails by design.

---

## [Sprint 02] — 2026-07-21 — Data Durability, Security Dependency & Hardening

### Added
- **Persistent object storage (P0-5):** pluggable Storage Driver layer — `local` (default, unchanged dev behaviour) and `s3` (Cloudflare R2 in production; any S3 API). Documents now survive redeploys; keys unchanged in the DB (zero migrations). Idempotent local→bucket migration script. Full design in `STORAGE.md`.
- **Server-side Excel parsing:** `POST /api/imports/rates/parse` (5 MB / 10k-row / 50-col limits, typed errors, audit-logged) — untrusted workbooks never touch the browser.

### Changed
- **`xlsx` (SheetJS) completely removed (P0-6)** from both tiers — the only no-patch security dependency is gone. Rate-sheet parsing runs server-side on `exceljs`; Excel exports regenerated on `exceljs` (dynamic import). Note: legacy `.xls` files must be re-saved as `.xlsx`.
- **M2:** note issuing is transactional with an invoice row lock — concurrent issues can no longer jointly over-credit (live race test: 201 + 400).
- **M3:** DRAFT→ISSUED stamps the posting date as the SST tax point unless a document date was explicitly chosen.
- **M4:** note update API rejects empty line sets and blank reasons.
- **M6:** confirmation dialogs on note Issue and Cancel-of-ISSUED.

### Tests
- +34 backend tests (suite 140/140): storage drivers/facade, parser golden + exceljs round-trip, M2 concurrency, M3 stamping, M4 validation.

---

## [Sprint 01A] — 2026-07-20 — Remediation of ARCHITECTURE_REVIEW High findings

### Fixed
- **H1** — Payments now collect against the *netted* invoice total (face value − issued credit notes + issued debit notes): overpayment guard and PAID status both use it. A credited invoice can no longer be over-collected.
- **H2** — The over-credit guard now subtracts payments already received: a credit note is limited to the invoice's *unpaid remainder* (credit + cash can never exceed the invoice value). Consequence: a fully-PAID invoice can no longer receive a CN; the `+CN` shortcut is hidden on PAID rows.
- **H3** — An invoice with live (DRAFT/ISSUED) credit/debit notes can no longer be cancelled — cancel the notes first (mirrors the existing payments guard).
- **H4** — An invoice-linked note is pinned to the invoice currency server-side (create + update); the currency selector locks in the UI once an invoice is picked. Standalone debit notes keep free currency choice.

### Tests
- +20 regression tests (suite now 106): payment netting, unpaid-remainder guard, cancel blocking, currency pinning. No schema changes, no breaking API changes.

See `SPRINT_01A_REPORT.md` for root causes, live verification, and risks.

---

## [Sprint 01] — 2026-07-20 — Credit & Debit Notes

### Added
- **Credit Notes** (P0-1): issue against an ISSUED/PARTIALLY_PAID/PAID invoice, SST-compliant tax reversal (SVE lines excluded from the tax base), over-credit guard, AR netting.
- **Debit Notes** (P0-2): against an invoice or standalone against a customer; posts additional charges into AR.
- Shared note lifecycle: DRAFT → ISSUED → CANCELLED (edit only in DRAFT).
- Document numbering: `CN-YYYY-####` / `DN-YYYY-####` (separate year-scoped sequences).
- `credit_debit_notes` + `credit_debit_note_items` tables (migration `20260720112511_credit_debit_notes`).
- API `/api/credit-debit-notes` (7 endpoints, `invoices.read`/`invoices.write` permissions).
- UI: `/credit-notes` and `/debit-notes` list pages, note builder with invoice prefill ("Load lines"), A4 print documents on the company letterhead, `+CN`/`+DN` shortcuts on the invoice list, sidebar entries.
- 8 unit tests for the note tax engine and over-credit guard (suite now 86 tests).

### Changed
- AR aging report (`GET /api/invoices/aging`) now nets ISSUED credit notes (−) and debit notes (+) into invoice balances; fully-credited invoices drop off the report. Read-only change.

### Known issues
- Pre-existing (not introduced this sprint): `status`/`customerId` list filters on quotations/invoices/jobs endpoints return 400 due to the global whitelist ValidationPipe. See `TODO.md`.

---

## [Pre-sprint baseline] — 2026-07 (before sprint cadence)

Quote → Job → Invoice flow; item-based invoices with SST/SVE tax engine and print
documents; editable quotations with freight-professional fields (POL/POD, mode,
service type, carrier, transit/free time, validity, exclusions); quotation status
control + Convert-to-Job on WON; company profile settings with logo; redesigned
tabbed Customer and Vendor masters with child tables; vendor rates and comparison;
P&L and reports; recycle bin; RBAC; audits (`PROJECT_AUDIT.md`, `BUSINESS_AUDIT.md`)
and product planning (`PRODUCT_BACKLOG.md`, `MVP_SCOPE.md`, `IMPLEMENTATION_ROADMAP.md`).
