# IMPLEMENTATION ROADMAP

**Owner:** Product Owner
**Sources:** `MVP_SCOPE.md`, `PRODUCT_BACKLOG.md`, `PROJECT_AUDIT.md`, `BUSINESS_AUDIT.md`
**Date:** 2026-07-20 · **Last reconciled:** 2026-07-28 (Sprint 03 close-out)

---

## Delivery status — what actually shipped

The original plan below was written before delivery began. Two things changed in
execution, both approved: **Phase 0 hardening was deferred and became Sprint 02**
(see `SPRINT_02_PLAN.md` §0 for the reasoning), and **each feature sprint was
followed by a scoped remediation sprint** after independent architecture review.
Actual sequence:

| Sprint | Content | Backlog | Status |
|---|---|---|---|
| **01** | Credit & Debit Notes | P0-1, P0-2 | ✅ Closed |
| **01A** | Remediation — 4 High findings (AR payment/credit seams) | — | ✅ Closed |
| **02** | Persistent storage + `xlsx` removal + review items M2/M3/M4/M6 | P0-5, P0-6 | ✅ Closed |
| **02A** | Remediation — production storage configuration gate | — | ✅ Closed |
| **03** | Accounts Payable (Phase A core + Phase B cost variance) | P0-3 | ✅ Closed |
| **03A** | Remediation — VOID/invoice-number release, bill-date FX, P2002 → 409 | — | ✅ Closed |
| **04** | Credit-limit enforcement + integration-test rung + R2 cutover | P0-7, T-6 | ⬜ Not started |
| **05** | AR overdue automation + Customer Statement (SOA) | P0-8 | ⬜ Not started |
| **06** | Booking + shipment milestones → **MVP GA** | P0-4 | ⬜ Not started |

**5 of 8 P0 items complete.** MVP GA now falls after **Sprint 06** — one sprint
later than originally drawn, the cost of inserting the deferred hardening work.
The sprint bodies below are retained as written; read the table above for the
authoritative sequence and the numbering.

---

## Planning Assumptions
- **Team:** 1–2 full-stack developers (NestJS + Next.js + Prisma).
- **Sprint length:** 2 weeks. Effort quoted as **dev-weeks (dw)** assuming ~1.5 effective devs.
- **Cadence:** each sprint ends with CI green (typecheck + build + unit + new tests), a demo, and a migration applied cleanly.
- **Release gates:** **MVP GA** after **Sprint 06**; **Fast-follow R1** after **Sprint 10** (renumbered — see the delivery-status table above).
- **Standing rule:** every sprint keeps the existing test suite green and adds tests for new logic. (Baseline was 95 tests; **254 as at Sprint 03 close** — 242 backend + 12 frontend.)

---

## Phase 0 — Hardening & Foundations

### Sprint 0 — "Make it safe to hold real data" — ✅ **delivered as Sprint 02** (2 wks, ~3 dw)
**Goal:** Remove the two data-integrity/security blockers and set up delivery discipline before any customer data lands.
**Scope:** P0-5 persistent storage (S3/R2) · P0-6 replace `xlsx` · T-3 ESLint + `engines.node` pin · T-6 smoke E2E harness (golden path).
**Acceptance criteria:**
- Uploading a document, redeploying, and re-fetching it **succeeds** (no data loss).
- Rate import + all exports run through the non-`xlsx` path; `xlsx` removed from `package.json`.
- CI fails on lint errors; Node version pinned in both `package.json`.
- One Playwright smoke test (login → quote → invoice) runs in CI.

---

## Phase 1 — MVP Core (Compliance + Payables + Credit)

### Sprint 1 — Credit & Debit Notes — ✅ **delivered as Sprint 01** (2 wks, ~4 dw)
**Goal:** Compliant corrections and post-invoice charges.
**Scope:** P0-1 Credit Note · P0-2 Debit Note (shared document engine with Invoice).
**Acceptance criteria:**
- Issue a CN against an issued invoice → tax reversed, AR reduced, both docs linked, PDF prints.
- Issue a DN → tax applied, AR increased, appears on the customer's balance.
- Cannot CN/DN more than the invoice's outstanding/settled basis; audit-logged.

### Sprint 2 — Accounts Payable — ✅ **delivered as Sprint 03** (2 wks, ~4 dw actual)
**Goal:** Know and age what the company owes vendors.
**Scope:** P0-3 vendor-bill capture + match to job actual cost + AP aging report.
**Acceptance criteria** *(as delivered — amended during planning: the system has **no job cost lines**, `Job.actualCost` is a single manually-maintained value, so "matching" was delivered as a read-only variance view per `AP_ARCHITECTURE_DECISION.md` §5)*:
- Record a vendor bill against one job, several jobs, or none; a job shows Estimated / Recorded / Billed / Variance.
- AP aging report buckets payables by due date; per-vendor totals correct.
- Bill status lifecycle (Draft → Approved → Paid) enforced; audit-logged.

### Sprint 3 — Credit Control + Collections — ⬜ **now Sprints 04–05** (2 wks, ~4 dw)
**Goal:** Control customer credit and get paid.
**Scope:** P0-7 credit-limit enforcement (quote/booking) · P0-8 AR overdue automation + Customer Statement (SOA).
**Acceptance criteria:**
- A quote/booking for a customer over `creditLimit` or on `creditHold` is **blocked or flagged** with an override path.
- Issued invoices flip to **OVERDUE** past due date; a reminder email is sent (or simulated when SMTP unset).
- Generate + email a customer SOA showing invoices, CN/DN, payments, running balance.

---

## Phase 2 — Operations Backbone

### Sprint 4 — Booking — ⬜ **now Sprint 06** (2 wks, ~4–5 dw)
**Goal:** Introduce the missing core forwarding step.
**Scope:** P0-4a Booking object created from a won quote (carrier/booking no., cut-off dates, booking status lifecycle).
**Acceptance criteria:**
- Won quote → create Booking → Booking links quote ↔ job.
- Booking carries carrier, booking no., SI/VGM cut-off dates; status Draft → Confirmed → Cancelled enforced.
- Converting a booking creates/links the shipment Job (no double-entry of parties).

### Sprint 5 — Shipment Milestones → **MVP GA** — ⬜ **now Sprint 06** (2 wks, ~4 dw)
**Goal:** Operate a shipment file at milestone level; ship MVP.
**Scope:** P0-4b operational milestones (Booked→Gated-in→Loaded→Departed→Arrived→Delivered) on the Job file + milestone timeline on Dashboard.
**Acceptance criteria:**
- Operators advance a shipment through all milestones with timestamps and remarks; illegal jumps blocked.
- Dashboard shows in-transit shipments and next milestone/cut-off.
- **MVP exit criteria (MVP_SCOPE §4) all pass; no P0 open → tag MVP GA.**

**🎯 Release gate: MVP GA** — a small forwarder can quote → book → operate → bill (incl. CN/DN) → track AR/AP → collect, on durable storage.

---

## Phase 3 — Fast-Follow (Competitive Parity)

*Sprints 6–9 below are renumbered **07–10** in the delivery sequence.*

### Sprint 6 — Accounting Integration (2 wks, ~4–5 dw)
**Goal:** Push the sub-ledgers to real books without building a GL.
**Scope:** P1-1 Xero/QuickBooks (or structured SQL/CSV) sync for invoices, CN/DN, AP.
**Acceptance criteria:** an issued invoice/CN/DN/vendor bill appears in the target accounting system (or a validated export) with correct tax mapping; reconciled once end-to-end.

### Sprint 7 — Shipping Documents + Task Engine (2 wks, ~4–5 dw)
**Goal:** Generate operational documents; coordinate work.
**Scope:** P1-3 HBL/MBL/DO/arrival-notice templates from the shipment file · P1-4 per-shipment tasks (assign/due/escalate).
**Acceptance criteria:** generate a HBL/DO PDF from a shipment; assign a task with due date that raises a notification on breach.

### Sprint 8 — Structured Parties + Container + Rate Depth (2 wks, ~5 dw)
**Goal:** Turn the generic file into a real ops file; sharpen quoting.
**Scope:** P1-5 shipper/consignee/notify records + routing · P1-6 container entity (no./seal/size, D&D) · P1-7 sell-side rate cards + surcharge tables.
**Acceptance criteria:** shipment shows structured parties + containers; a quote auto-populates from a lane rate card incl. surcharges.

### Sprint 9 — Customer Portal (2 wks, ~5–6 dw; may span two sprints) → **R1**
**Goal:** External self-service parity with GoFreight/Magaya.
**Scope:** P1-2 portal (shipment tracking, quote view/accept, document + invoice download) · T-8 JWT refresh/rotation.
**Acceptance criteria:** an external customer logs in, tracks a shipment by milestone, downloads its invoice/documents, and accepts a quote online (recorded on the quote).

**🎯 Release gate: R1 (Competitive)** — internal ops + customer-facing portal + books integration.

---

## Phase 4 — Strategic / Segment-Gated (Backlog, not scheduled)
Scheduled **only when a paying customer operates the lane in-house**:
P2-1 Ocean Export/Import files · P2-2 Air Export/Import · P2-3 LCL/CFS · P2-4 Customs (uCustoms) · P2-5 full GL · P2-6 EDI · P2-7 Warehouse · P2-8 carrier/tracking integrations · P2-9 BPM workflow · P2-10 tiered quotes · P2-11 CRM pipeline.
Each is **XL** and warrants its own mini-roadmap when triggered.

---

## Effort & Timeline Summary

| Phase | Sprints | Elapsed | Effort | Outcome |
|---|---|---|---|---|
| 0 — Hardening | S0 | 2 wks | ~3 dw | Safe to hold real data |
| 1 — Compliance/Payables/Credit | S1–S3 | 6 wks | ~12–13 dw | Compliant billing + AP + collections |
| 2 — Ops backbone | S4–S5 | 4 wks | ~8–9 dw | **MVP GA** |
| 3 — Fast-follow | S6–S9 | 8 wks | ~18–21 dw | **R1 Competitive** |
| **To MVP GA** | **S0–S5** (delivered as 01–06) | **~14 weeks** incl. remediation sprints | **~23–25 dw** | Go-live for small forwarder |
| **To R1** | **S0–S9** | **~20 weeks (5 months)** | **~41–46 dw** | Portal + integration parity |

*(Timelines assume ~1.5 effective devs; a 3-dev team roughly compresses elapsed time by ~40%.)*

---

## Dependency Spine (build order rationale)
```
Sprint 0 (storage, xlsx)  ─ foundation, unblocks everything
      │
Credit Note ─► Debit Note        (shared doc engine)
      │
Accounts Payable ─► Accounting Integration
      │
Credit Control + Collections (AR)
      │
Booking ─► Shipment Milestones ─► Shipping Docs / Parties / Container ─► Customer Portal
```
- CN/DN before AP (billing integrity first).
- Booking before any ops-file feature and before the Portal (portal needs something to show).
- Accounting integration after AP (both sub-ledgers exist to push).

## Governance
- **Definition of Ready:** acceptance criteria written, dependencies met, migration plan noted.
- **Definition of Done:** feature behind permission, audit-logged, unit + integration tested, CI green, demoed, docs updated.
- **Do-not-cross line:** no Phase-4 (ocean/air/customs/EDI/warehouse) work starts before a paying customer requires that lane — protects the MVP timeline.
