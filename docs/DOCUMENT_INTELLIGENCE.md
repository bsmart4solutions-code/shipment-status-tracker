# Document Intelligence — Design Proposal

> Status: **design / not yet built.** File upload persistence is intentionally
> deferred (see Phase D decision), so this document defines the architecture
> and a staged rollout rather than shipping code. It is the blueprint to
> implement once a storage backend (local volume or S3/MinIO) is chosen.

## Goal

Let a user upload a **PDF** (Bill of Lading, arrival notice, debit note…) or an
**Excel/CSV** rate sheet (ocean FCL/LCL, trucking, haulage, vendor costing) and
have the system **extract the structured fields and pre-fill the relevant form**
— a quotation line, a vendor rate card, a job's shipment details — instead of the
user retyping everything. The user always **reviews and confirms** before anything
is saved; extraction proposes, it never silently writes.

## Why this is two different problems

The word "upload a document" hides two very different extraction problems that
need different engines. Treating them as one is the main design trap.

| | **Structured** (Excel / CSV rate sheets) | **Semi-structured** (PDF: B/L, invoices) |
|---|---|---|
| Shape | Rows and columns, a header row | Free layout, labels near values |
| Example | Ocean FCL rate list, trucking tariff | Bill of Lading, arrival notice |
| Engine | Deterministic parse + column mapping | Layout/OCR + field extraction (LLM or template) |
| Confidence | High — it's already tabular | Variable — needs a review step |
| Build cost | Low | Medium/High |

**Recommendation: ship the structured path first.** It covers the bulk of the
day-to-day pain (rate sheets from carriers/hauliers arrive as Excel), is
deterministic, testable, and needs no OCR/LLM. The PDF path layers on top later.

## Architecture — the shared pipeline

Both paths flow through the same four stages so the UI and audit trail are
uniform:

```
 upload → PARSE → MAP → PREVIEW (user confirms/edits) → COMMIT
           │        │        │                             │
     raw rows/  candidate  editable diff vs.          real records
     text       records    existing data            (rates/quote/job)
```

1. **Parse** — turn the file into candidate rows/fields. Deterministic for
   Excel/CSV; OCR+extraction for PDF.
2. **Map** — align source columns/fields to our schema (e.g. spreadsheet column
   "20'GP" → `rateType=PER_CONTAINER, container=20FT`). A saved **mapping
   template** per vendor/document type makes repeat uploads one-click.
3. **Preview** — show every proposed record as an editable table with per-row
   validation and a "new vs. updates existing" flag. **Nothing is written yet.**
4. **Commit** — on confirm, create/update inside a transaction, each write
   audit-logged with `source: 'import'` and the original filename.

The first three stages are **stateless** — the parsed result lives in the
browser (or a short-lived server cache), so we do **not** need durable file
storage to build the structured path. That's why this can start before the
file-storage decision is made.

## Path A — Structured rate sheets (build first)

### Ingestion
- Accept `.csv` now (no dependency), `.xlsx` via the `xlsx` (SheetJS) library.
- Backend endpoint `POST /imports/rates/parse` (multipart, parsed in-memory,
  file **not** persisted) → returns `{ columns, rows, suggestedMapping }`.

### Column mapping
- A `RateImportTemplate` record per vendor + sheet type stores the column→field
  map so "MaerskOceanFCL.xlsx" maps itself next time.
- Target model is the existing `VendorServiceRate` (origin, destination,
  rateType, currency, cost, minimumCharge, effectiveDate, expiryDate). The rate
  types the user named map cleanly:
  - Ocean **FCL** → `rateType = PER_CONTAINER` (+ container size as a field/remark)
  - Ocean **LCL** → `rateType = PER_CBM` (or PER_TON, whichever is greater — a
    business rule to confirm)
  - **Trucking / haulage** → `rateType = PER_TRIP` or `PER_CONTAINER`
  - **Vendor costing** lines → quotation items via the costing engine

### Preview & commit
- `POST /imports/rates/commit` takes the confirmed rows + mapping, validates each
  (vendor exists, currency has an FX rate, dates sane), and bulk-creates rates in
  a transaction, returning a per-row result (`created` / `skipped: reason`).
- Reuses the Phase D **CSV bulk-import** validation+error-report machinery — the
  rate importer is that same engine pointed at the rate model.

### Why start here
No OCR, no LLM, fully unit-testable, and it's the highest-frequency task. This
also directly extends the CSV bulk-import feature being built now.

## Path B — Semi-structured PDF (B/L, arrival notice) — layer on later

### Ingestion
- Requires durable storage (the file must be kept for the audit trail and
  re-processing), so this waits on the storage decision.
- `POST /documents` stores the binary (local volume or S3) + a `JobDocument`
  row, then queues extraction.

### Extraction — two options, pick per document type
1. **Template/rule-based** (cheap, deterministic) for high-volume fixed layouts
   from a known carrier: anchor on labels ("B/L No.", "Vessel", "POL", "POD",
   "Container No.") and read the value to their right/below. Good for the
   3–4 carriers a forwarder uses daily.
2. **LLM extraction** (flexible, handles unseen layouts): send the OCR'd text +
   a JSON schema ("extract blNumber, vessel, voyage, pol, pod, containers[],
   grossWeight…") to a model and get structured JSON back. Best for the long
   tail of one-off document formats. Cost/latency per document; needs a
   confidence threshold that routes low-confidence fields to manual review.
   - Scanned PDFs first go through OCR (Tesseract locally, or a cloud OCR).

### Target fields (Bill of Lading)
`blNumber, shipper, consignee, notifyParty, vessel, voyage, portOfLoading,
portOfDischarge, containers[{number, sealNumber, size, type}], grossWeightKg,
volumeCbm, freightTerms, issueDate` → pre-fills a **Job** (origin/destination,
tracking number, shipment date) and/or attaches as a parsed document.

### Preview & commit
- Same review-before-write rule. Extracted fields land in an editable form with
  each field showing a confidence badge; the user corrects and confirms.

## Data model additions (when built)

```prisma
model ImportBatch {          // one upload session, for audit + undo
  id          String   @id @default(uuid())
  kind        String   // 'rates' | 'customers' | 'bl' ...
  fileName    String
  status      String   // PARSED | COMMITTED | DISCARDED
  rowCount    Int
  createdById String?
  createdAt   DateTime @default(now())
}

model RateImportTemplate {   // remembered column mapping per vendor/sheet
  id         String @id @default(uuid())
  vendorId   String?
  name       String
  mapping    Json   // { "20'GP": {rateType:"PER_CONTAINER",...}, ... }
}
```

The PDF path additionally needs the `JobDocument` model to gain real binary
storage (currently it stores only a URL string) plus an `extractedData Json?`
column.

## Staged rollout

1. **Stage 1 (no storage needed):** Excel/CSV rate-sheet import → `VendorServiceRate`,
   with saved mapping templates. Builds directly on the CSV bulk-import engine.
2. **Stage 2:** extend the same importer to vendor-costing → quotation lines.
3. **Stage 3 (needs storage decision):** PDF B/L template extraction for the
   top carriers → pre-fill Job.
4. **Stage 4:** LLM fallback extraction for arbitrary PDF layouts, with a
   confidence-gated review step.

## Open decisions (need product input)

- **Storage backend** for Path B (local volume vs S3/MinIO) — blocks Stage 3+.
- **LCL rate basis**: charge per CBM, per ton, or max(CBM, ton)? Affects mapping.
- **LLM provider & data-residency**: sending B/L text to a hosted model may be a
  compliance question for some customers; a local template path avoids it for
  the common carriers.
- **Overwrite policy** on rate re-import: supersede the old rate (new
  effectiveDate) or update in place? Recommend supersede, to keep rate history.
