# PRODUCT BACKLOG — Shipment Status Tracker (Freight ERP)

**Owner:** Product Owner
**Sources:** `BUSINESS_AUDIT.md` (module coverage, ~34% weighted) · `PROJECT_AUDIT.md` (technical/NFR, 8.0/10)
**Target segment for prioritization:** Small freight forwarder / NVOCC — commercial front-office (quote → job → invoice → collect) with in-house operators.
**Date:** 2026-07-20

### Priority definitions
- **P0** — Go-live blocker for the target segment, or a critical risk (data loss / compliance / unsupported dependency).
- **P1** — High commercial value; needed within the first release cycle after go-live.
- **P2** — Segment-dependent or strategic; deferrable without blocking the target segment.

### Complexity scale
**S** ≤ 1 dev-week · **M** 1–2 dev-weeks · **L** 3–5 dev-weeks · **XL** 6+ dev-weeks.

### Value scale
**★★★** direct revenue/compliance/blocker · **★★** strong efficiency/competitive · **★** incremental.

---

## P0 — Go-Live Blockers

| ID | Item | Business Value | Complexity | Depends on | Audit ref |
|---|---|---|---|---|---|
| P0-1 | ✅ **DONE (Sprint 01, 2026-07-20)** — **Credit Note** (issue against invoice, tax reversal, apply to AR) | ★★★ SST compliance for corrections/returns | M | Invoice, AR | BA §18 |
| P0-2 | ✅ **DONE (Sprint 01, 2026-07-20)** — **Debit Note** (post-invoice extra charge, tax, AR posting) | ★★★ compliant billing of late charges | S–M | P0-1 shares model | BA §19 |
| P0-3 | **Accounts Payable — vendor bill capture + AP aging** | ★★★ know payables to carriers/hauliers; cost control | L | Vendor master, Jobs | BA §16 |
| P0-4 | **Booking object + shipment operational milestones** (Booked→Gated-in→Loaded→Departed→Arrived→Delivered) | ★★★ the missing core forwarding step | L | Quotation→Job | BA §4, §5 |
| P0-5 | **Persistent document storage (S3 / Cloudflare R2)** replacing ephemeral local disk | ★★★ prevents loss of BL/PDF/OCR files on redeploy | M | Documents module | PA §7-4, BA §21 |
| P0-6 | **Replace `xlsx` (SheetJS)** with `exceljs` / server-side parse | ★★ removes the only no-patch security dependency | M | Rate import, exports | PA §7-1 |
| P0-7 | **Credit-limit enforcement at quote/order time** (block/warn on limit or credit-hold) | ★★★ core credit control; data already captured | S | Customer master, AR | BA §1, §15 |
| P0-8 | **AR overdue automation + Customer Statement (SOA)** | ★★★ collections + `receiveStatementsByEmail` fulfilled | M | Invoice, AR, Email | BA §15 |

**P0 subtotal effort:** ~14–20 dev-weeks.

---

## P1 — High Value, First Cycle After Go-Live

| ID | Item | Business Value | Complexity | Depends on | Audit ref |
|---|---|---|---|---|---|
| P1-1 | **Accounting integration** (Xero / QuickBooks / SQL export) — pragmatic substitute for full GL | ★★★ removes need to build a GL | L | AR, AP, Invoice, CN/DN | BA §14, §33 |
| P1-2 | **Customer Portal** (track shipments, view/accept quotes, download docs & invoices) | ★★★ competitive parity w/ GoFreight/Magaya | XL | Booking, Shipment, Invoice, Auth | BA §20 |
| P1-3 | **Shipping-document generation** (HBL / MBL / DO / arrival notice / manifest templates) | ★★ ops efficiency; fewer external tools | L | Shipment file, Documents | BA §6, §7, §21 |
| P1-4 | **Task engine** (per-shipment tasks, assignment, due/priority, escalation) | ★★ operations coordination | M | Shipment, Users, Notification | BA §23 |
| P1-5 | **Structured shipment parties + routing** (shipper/consignee/notify as records; multi-leg) | ★★ real ops file vs generic job | M | Shipment, CRM | BA §5 |
| P1-6 | **Container as first-class entity** (no./seal/size-type, events, D&D) | ★★ FCL/container operators | M | Shipment (FCL) | BA §11, §12 |
| P1-7 | **Rate Management depth** (sell-side cards, surcharge tables, contract/tariff, versioning) | ★★ faster/accurate quoting | L | Rate Mgmt, Quotation | BA §3 |
| P1-8 | **Multi-level / multi-document approvals** (PO, AP, invoice, discount; approval matrix) | ★★ governance beyond quotes | M | Approval, AP, Invoice | BA §25 |
| P1-9 | **Audit-log viewer UI + before/after diffs** | ★★ compliance visibility (data exists) | S | Audit service | BA §31, PA |
| P1-10 | **Email templates + PDF attachments + inbound capture/log** | ★★ professional comms, CRM history | M | Email, CRM, Documents | BA §26 |
| P1-11 | **Operational dashboards** (in-transit, cut-off alerts, overdue tasks, per-shipment profit) | ★★ ops visibility | M | Shipment, Task, Invoice | BA §28, §29 |
| P1-12 | **OpenAPI/Swagger + webhooks + API keys** | ★★ enables integrations/partners | M | API | BA §32 |

**P1 subtotal effort:** ~28–36 dev-weeks.

---

## P2 — Segment-Dependent / Strategic (Deferrable)

| ID | Item | Business Value | Complexity | Depends on | Audit ref |
|---|---|---|---|---|---|
| P2-1 | **Mode-specific Ocean Export/Import files** (SI, VGM, telex, arrival/DO release, free-time countdown) | ★★★ *if* self-operated ocean ops | XL | Shipment, Container, Customs | BA §6, §7 |
| P2-2 | **Mode-specific Air Export/Import** (HAWB/MAWB, IATA rating, chargeable weight, ULD, screening) | ★★★ *if* air forwarder | XL | Shipment | BA §8, §9 |
| P2-3 | **LCL consolidation / CFS** (co-load, master-consol↔house, revenue-ton) | ★★ *if* consolidator | L | Shipment, Container | BA §10 |
| P2-4 | **Customs module** (declaration, HS master, duty/tax, single-window e.g. uCustoms) | ★★★ *if* brokerage | XL | Shipment | BA §35 |
| P2-5 | **Full GL accounting** (chart of accounts, journals, TB, P&L/BS, FX revaluation, period close) | ★★ if not integrating (P1-1) | XL | AR, AP, CN/DN | BA §14 |
| P2-6 | **EDI** (IFTMIN/IFTSTA/CUSCAR mapping, partner onboarding, status→milestone) | ★★ mid-market connectivity | XL | Shipment, Integration | BA §34 |
| P2-7 | **Warehouse / CFS WMS** (receipt, inventory, locations, pick/pack) | ★★ *if* warehousing offered | XL | — | BA §13 |
| P2-8 | **Carrier / tracking integrations** (INTTRA e-booking, P44/carrier APIs, port community) | ★★ automation at scale | XL | Booking, Integration | BA §33 |
| P2-9 | **Configurable workflow / BPM engine** (SOP templates, conditional routing per branch) | ★★ scale/standardization | L | Workflow, Task | BA §24 |
| P2-10 | **Multi-option / tiered quotes** (per carrier/routing), quote templates, online acceptance | ★★ sales conversion | M | Quotation, Portal | BA §2 |
| P2-11 | **CRM activities / opportunity pipeline + email-to-CRM** | ★★ sales management | M | CRM, Email | BA §1 |

---

## Technical / Non-Functional Backlog (from PROJECT_AUDIT)

| ID | Item | Value | Complexity | Priority |
|---|---|---|---|---|
| T-1 | Persistent object storage (same as P0-5) | ★★★ | M | P0 |
| T-2 | Replace `xlsx` (same as P0-6) | ★★ | M | P0 |
| T-3 | Add **ESLint + lint gate in CI**; pin `engines.node` | ★★ | S | P1 |
| T-4 | Extract shared **master-form helpers** (customer/vendor form dedup) | ★ | S | P1 |
| T-5 | Plan **Next.js 14→16** and **NestJS 10→11** major upgrades (regression vs 95 tests) | ★★ | L | P1 |
| T-6 | Add **integration/E2E tests** (controller HTTP + Playwright happy paths) + coverage gate | ★★ | M | P1 |
| T-7 | Retire/archive orphaned `legacy/index.html`; document speculative master fields | ★ | S | P2 |
| T-8 | JWT refresh-token rotation / revocation (if portal added) | ★★ | M | P1 (with Portal) |

---

## Backlog Notes
- **Shared invoice model** for Credit/Debit Notes (P0-1/P0-2): one document engine, two document types — build once.
- **P0-3 (AP)** and **P1-1 (Accounting integration)** together deliver "know what we owe + push to books" — sequence AP first.
- **Booking (P0-4)** is the pivot that unlocks real shipment ops (P1-3, P1-5, P1-6) and the Portal (P1-2); treat as a foundation epic.
- Everything in **P2** is explicitly gated on the forwarder's *own* operating model — do not build ocean/air/customs/EDI/warehouse until a paying customer operates that lane in-house.
