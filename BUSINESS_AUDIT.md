# BUSINESS AUDIT — Commercial Readiness Review

**Perspective:** Freight ERP Product Manager + Solution Architect (15+ yrs)
**Benchmarks:** CargoWise · GoFreight · Magaya · CargoSoft · BluJay
**Scope:** Commercial go-live readiness — *no code reviewed for bugs, no technical optimization; this is a product/coverage assessment only.*
**Date:** 2026-07-20

---

## Executive Verdict

This system is a **strong SMB "Quote → Job → Invoice" platform with an excellent CRM master-data layer**. Its commercial strengths — quotation costing, SST-correct billing, approval workflow, CRM — are genuinely competitive at the small-forwarder tier.

Measured against **full forwarding operating systems (CargoWise / GoFreight / Magaya)**, it covers roughly the *commercial front-office* but **not the operational back-office**. The forwarding "operations engine" — Booking, mode-specific Ocean/Air Export/Import files, Container management, Customs, AP, GL accounting, EDI, and a Customer Portal — is largely absent.

**Overall business completion (weighted): ~34%.**

- ✅ **Go-live ready** for: a small forwarder / NVOCC using it as a **quotation + invoicing + CRM + basic job-tracking** tool with manual operations.
- ❌ **Not ready** to replace CargoWise/GoFreight for a forwarder that needs end-to-end shipment operations, customs, EDI/carrier integration, or double-entry accounting.

---

## Legend
**Priority:** 🔴 Critical (blocks go-live for target segment) · 🟠 High · 🟡 Medium · 🟢 Nice-to-have
**Completion %** = business capability vs. an industry-standard module in the benchmark systems.

---

## 1. CRM — **70%** 🟢
- **Business Flow:** Lead → Account (customer/vendor) master → contacts/addresses → activities/opportunities → conversion → retention.
- **Current Capability:** Full customer & vendor master (company, multiple contacts, multiple typed addresses, financial/credit terms, documents, bank accounts, CRM lifecycle dates, lead status, KPI rating + automatic ranking, VIP/blacklist flags).
- **Missing Feature:** Activities/interaction log, opportunity/deal pipeline, email-to-CRM capture, contact-level communication history.
- **Missing Business Logic:** Lead scoring, duplicate-account merge, sales-target tracking.
- **Missing Status:** Lead stages beyond a single free-text field; account onboarding workflow.
- **Missing Validation:** Registration/Tax-ID uniqueness enforcement, address-per-type constraints.
- **Missing Automation:** Follow-up reminders from `nextFollowUp`, birthday/anniversary triggers, inactivity alerts.
- **Commercial Risk:** Low — this is the strongest area.
- **Priority:** 🟢

## 2. Quotation — **75%** 🟢
- **Business Flow:** Enquiry → rate build-up → margin → approval → send → win/lost → convert to job.
- **Current Capability:** Costing-engine builder, per-line buy/sell + markup, SST-exempt handling, full freight header (POL/POD/mode/service type/carrier/transit/free time/cargo/Incoterm/validity/exclusions), threshold approval workflow, revisions/versioning, professional PDF, email, status machine, one-click convert to Job.
- **Missing Feature:** Multi-option/tiered quotes (per carrier/routing), quote templates per lane, customer-accepted-online capture.
- **Missing Business Logic:** Auto rate pull for *all* charge lines (only best-vendor recommendation today), currency-mix margin roll-up to base on the quote face.
- **Missing Status:** "EXPIRED" auto-status (expiry only notifies), "REVISED".
- **Missing Validation:** Validity-vs-rate-expiry cross-check, mandatory Incoterm/POD by mode.
- **Missing Automation:** Auto-expire, follow-up on SENT-not-won, rate-change re-quote.
- **Commercial Risk:** Low.
- **Priority:** 🟢

## 3. Rate Management — **40%** 🟠
- **Business Flow:** Carrier/vendor tariff → buy rates by lane/equipment/validity → sell/margin rules → rate cards → quote auto-population.
- **Current Capability:** Vendor service rates (origin/dest/country/container type/currency/cost/min charge/effective+expiry), rate comparison + recommendation, Excel rate import, expiry notifications.
- **Missing Feature:** Contract/tariff management, sell-side rate cards, FAK/commodity rates, carrier-specific tariffs, surcharge tables (BAF/CAF/PSS/GRI as structured rates, not free lines).
- **Missing Business Logic:** Rate versioning, lane-based auto-quote, buy/sell margin matrices, spot-vs-contract.
- **Missing Status:** Draft/approved/published tariff states.
- **Missing Validation:** Overlapping-validity guard per lane, currency-vs-lane rules.
- **Missing Automation:** Auto rate refresh, expiring-rate re-negotiation workflow.
- **Commercial Risk:** Medium — quoting depends on manual rate entry.
- **Priority:** 🟠

## 4. Booking — **0%** 🔴
- **Business Flow:** Won quote → carrier/co-loader booking → booking confirmation → SI/VGM cut-off tracking → equipment release.
- **Current Capability:** **None.** Quotes convert directly to a Job; there is no booking object.
- **Missing Feature:** Booking request/confirmation, carrier booking no., cut-off dates, equipment/space allocation, co-loader booking.
- **Missing Business Logic / Status / Validation / Automation:** Entire domain absent (booking status lifecycle, SI/VGM deadlines, rollover handling, e-booking to carrier).
- **Commercial Risk:** **High** — a core forwarding step every benchmark platform has; absence forces external booking + manual re-entry.
- **Priority:** 🔴

## 5. Shipment (Job/File) — **45%** 🟠
- **Business Flow:** Booking → shipment file → milestones → documents → costing actuals → close.
- **Current Capability:** Job file with status (OPEN/IN_PROGRESS/ON_HOLD/COMPLETED/CANCELLED), tracking-event timeline (system + manual), documents, origin/dest/ETD/ETA/vendor, actual cost/revenue/profit, link to source quotation & invoice.
- **Missing Feature:** Mode-specific file structure, multi-leg routing, parties (shipper/consignee/notify) as structured records, milestone templates, container/package sub-records.
- **Missing Business Logic:** Estimated-vs-actual variance workflow, profit-share/branch costing, consol/co-load linkage.
- **Missing Status:** Operational milestones (Booked → Gated-in → Loaded → Departed → Arrived → Delivered) — currently generic.
- **Missing Validation:** Mandatory docs/fields by mode before close.
- **Missing Automation:** Milestone auto-updates from carrier tracking/EDI.
- **Commercial Risk:** Medium-High — usable as a tracker, not as an operations file.
- **Priority:** 🟠

## 6. Ocean Export — **10%** 🔴
- **Business Flow:** Booking → SI → HBL/MBL → VGM → loading → departure → docs to consignee.
- **Current Capability:** Only generic Job + free-text POL/POD/vessel/HBL/OBL fields on the *invoice* header. No dedicated ocean-export operational file.
- **Missing:** SI management, HBL/MBL issuance & templates, VGM submission, manifest, shipping advice, telex/original B/L handling, container/seal capture.
- **Missing Status:** Export operational milestones.
- **Commercial Risk:** **High** — cannot run ocean export operations end-to-end.
- **Priority:** 🔴

## 7. Ocean Import — **10%** 🔴
- **Business Flow:** Arrival notice → DO release → customs → delivery.
- **Current Capability:** Generic Job only.
- **Missing:** Arrival notice, cargo/DO release workflow, customs linkage, delivery order, demurrage/detention tracking against free time.
- **Missing Status / Validation / Automation:** All import-specific states, free-time countdown, DO-release gating.
- **Commercial Risk:** **High.**
- **Priority:** 🔴

## 8. Air Export — **5%** 🔴
- **Business Flow:** Booking → AWB (HAWB/MAWB) → security/screening → uplift → tracking.
- **Current Capability:** "Air Freight" exists only as a service/charge type. No air file.
- **Missing:** HAWB/MAWB management, IATA rating, weight-break/chargeable-weight logic, ULD, screening/security status.
- **Commercial Risk:** **High** for any air forwarder.
- **Priority:** 🔴

## 9. Air Import — **5%** 🔴
- **Business Flow:** Pre-alert → AWB → customs → delivery.
- **Current Capability:** None mode-specific.
- **Missing:** Pre-alert, AWB import handling, customs, delivery, charges-collect handling.
- **Commercial Risk:** **High** for air.
- **Priority:** 🔴

## 10. LCL — **10%** 🟠
- **Business Flow:** Consolidation → CFS → co-load → deconsolidation.
- **Current Capability:** "LCL" as a free-text service type; per-CBM charge lines.
- **Missing:** Consolidation/co-load management, CFS operations, volume/weight ratio & revenue-ton logic, master-consol to house linkage.
- **Commercial Risk:** Medium-High for LCL consolidators.
- **Priority:** 🟠

## 11. FCL — **20%** 🟠
- **Business Flow:** Equipment booking → stuffing → gate-in → load → discharge → return.
- **Current Capability:** Container type on rates (20/40/40HC), FCL as service type, container info as free-text on invoice.
- **Missing:** Structured container records, haulage/equipment scheduling, gate-in/out, empty return, detention.
- **Commercial Risk:** Medium.
- **Priority:** 🟠

## 12. Container — **5%** 🔴
- **Business Flow:** Equipment master → per-shipment container → seal → movement → return.
- **Current Capability:** `containerInfo` free-text field on invoice header only.
- **Missing Feature:** Container as a first-class entity, container no./seal/size-type, container events, D&D tracking.
- **Commercial Risk:** **High** for FCL/container operators.
- **Priority:** 🔴

## 13. Warehouse — **0%** 🟡
- **Business Flow:** Receipt → put-away → inventory → pick/pack → release.
- **Current Capability:** **None.**
- **Missing:** Entire WMS/CFS domain (inventory, locations, stock moves, cargo receipts).
- **Commercial Risk:** High *if* warehousing is offered; N/A for pure forwarding.
- **Priority:** 🟡 (segment-dependent)

## 14. Accounting (GL) — **15%** 🔴
- **Business Flow:** Sub-ledgers (AR/AP) → GL journals → chart of accounts → trial balance → financial statements.
- **Current Capability:** AR sub-ledger only (invoices + payments + aging). Opening balances captured on masters.
- **Missing Feature:** Chart of accounts, double-entry journals, GL, trial balance, P&L/BS statements, multi-currency revaluation, period close.
- **Missing Business Logic:** Accrual, cost-provision vs actual, inter-company.
- **Commercial Risk:** **High** — no book of accounts; needs external accounting software.
- **Priority:** 🔴 (or accept integration to Xero/QuickBooks — see §33)

## 15. AR (Accounts Receivable) — **55%** 🟠
- **Business Flow:** Invoice → outstanding → receipts → aging → collection → statement.
- **Current Capability:** Invoices, payment recording (overpayment-guarded, auto PARTIALLY_PAID/PAID), AR aging report (5 buckets), due-date derivation from terms.
- **Missing Feature:** Customer statement / SOA, receipt allocation across multiple invoices, collection workflow, dunning letters, write-offs.
- **Missing Business Logic:** Credit-limit enforcement (limit stored, not blocked), unallocated-receipt handling.
- **Missing Status:** OVERDUE auto-status, ON-HOLD.
- **Missing Automation:** Auto-reminders on overdue, statement email cycle.
- **Commercial Risk:** Medium — core AR works; collection tooling thin.
- **Priority:** 🟠

## 16. AP (Accounts Payable) — **5%** 🔴
- **Business Flow:** Vendor bill capture → match to job cost → approve → pay → aging.
- **Current Capability:** Vendor master has `apAccount`; jobs hold actual cost. **No vendor-bill/AP document or payable ledger.**
- **Missing:** Vendor invoice capture, cost accrual vs actual matching, AP aging, payment run, 3-way match.
- **Commercial Risk:** **High** — cannot track what the company owes carriers/hauliers.
- **Priority:** 🔴

## 17. Invoice — **70%** 🟢
- **Business Flow:** Draft → issue → deliver → collect.
- **Current Capability:** Itemized invoices (SST-aware, exempt lines, account codes), generate-from-job (copies quote lines + freight header), issue with auto due-date, payments, cancel guard, professional PDF (letterhead/bank/amount-in-words), email.
- **Missing Feature:** Multi-currency invoice with FX gain/loss, consolidated/batch invoicing, proforma invoice, recurring invoices.
- **Missing Business Logic:** FX realization, partial-billing/progress billing.
- **Missing Status:** OVERDUE, PROFORMA.
- **Missing Validation:** Duplicate-charge detection across invoices for a job.
- **Missing Automation:** Auto-issue on job completion, scheduled billing.
- **Commercial Risk:** Low.
- **Priority:** 🟢

## 18. Credit Note — **0%** 🟠
- **Business Flow:** Invoice correction/return → credit note → apply/refund.
- **Current Capability:** **None** (invoice cancel exists, but no credit-note instrument).
- **Missing:** Credit-note document, linkage to original invoice, partial credit, tax reversal, apply-to-AR.
- **Commercial Risk:** **High** — corrections force cancel/re-issue, breaking the audit/tax trail. SST compliance often *requires* credit notes.
- **Priority:** 🟠 (compliance-driven)

## 19. Debit Note — **0%** 🟠
- **Business Flow:** Additional charge → debit note → add to AR.
- **Current Capability:** **None.**
- **Missing:** Debit-note document, tax handling, AR posting.
- **Commercial Risk:** Medium-High — no clean instrument for post-invoice charges (common in freight).
- **Priority:** 🟠

## 20. Customer Portal — **0%** 🟠
- **Business Flow:** Customer self-service: track shipments, view/accept quotes, download docs/invoices, submit bookings.
- **Current Capability:** **None** (internal app only).
- **Missing:** External authenticated portal, shipment visibility, quote acceptance, document/invoice download, booking submission.
- **Commercial Risk:** Medium-High — a key differentiator in GoFreight/Magaya; its absence limits competitiveness but not internal operation.
- **Priority:** 🟠

## 21. Document — **45%** 🟠
- **Business Flow:** Generate/upload → classify → attach to shipment → share → archive.
- **Current Capability:** Job documents (upload + OCR extraction), customer/vendor document records (metadata/link), professional quote/invoice PDF generation.
- **Missing Feature:** Document template library (HBL/MBL/AWB/DO/manifest), e-signature, versioning, controlled sharing, **persistent storage** (local disk is ephemeral on cloud free tier — data-loss risk).
- **Missing Automation:** Auto-generate shipping docs from the file, doc checklists by mode.
- **Commercial Risk:** Medium-High (storage durability + missing shipping-doc generation).
- **Priority:** 🟠

## 22. OCR — **50%** 🟡
- **Business Flow:** Scan/PDF → extract → validate → post to shipment.
- **Current Capability:** tesseract.js OCR, Bill-of-Lading fixed-template extraction, Excel rate import (document intelligence).
- **Missing Feature:** General document classification, invoice/PO OCR, confidence review UI, learning templates, multi-language.
- **Missing Validation:** Human-in-the-loop verification workflow.
- **Commercial Risk:** Low — a value-add already ahead of many SMB tools.
- **Priority:** 🟡

## 23. Task — **5%** 🟠
- **Business Flow:** Work items → assignment → due dates → completion → escalation.
- **Current Capability:** Follow-up date fields on masters; **no task engine**.
- **Missing:** Task objects, assignment, due/priority, per-shipment task lists, checklists, escalation.
- **Commercial Risk:** Medium — operations coordination relies on external tools.
- **Priority:** 🟠

## 24. Workflow — **20%** 🟠
- **Business Flow:** Configurable operational workflows/SOPs per shipment type.
- **Current Capability:** Hard-coded state machines (quote/job/invoice) enforce legal transitions.
- **Missing:** Configurable/BPM workflow, SOP templates, conditional routing, per-branch process.
- **Commercial Risk:** Medium.
- **Priority:** 🟠

## 25. Approval — **35%** 🟡
- **Business Flow:** Threshold-based approvals across documents.
- **Current Capability:** Quotation approval (base-currency threshold, PENDING/APPROVED/REJECTED, approver notification).
- **Missing Feature:** Approvals for PO/AP/invoice/credit note/discount; multi-level and delegation.
- **Missing Business Logic:** Approval matrices by amount/role/customer.
- **Commercial Risk:** Medium.
- **Priority:** 🟡

## 26. Email — **40%** 🟡
- **Business Flow:** Send documents, log correspondence, receive updates.
- **Current Capability:** nodemailer send of quote/invoice HTML summaries; safe simulated mode when SMTP unset.
- **Missing Feature:** Template management, attachments (send the actual PDF), inbound email capture, per-account correspondence log, queue/retry.
- **Missing Automation:** Scheduled/triggered emails (arrival notice, statement, reminder).
- **Commercial Risk:** Medium.
- **Priority:** 🟡

## 27. Notification — **55%** 🟡
- **Business Flow:** System detects events → alerts users → action.
- **Current Capability:** Notification module + scan job (quote expiry, rate expiry, payment due, job delay, high cost, low margin), in-app bell, read/unread.
- **Missing Feature:** Email/SMS/push channels, user-configurable subscriptions, real-time push.
- **Commercial Risk:** Low.
- **Priority:** 🟢

## 28. Dashboard — **65%** 🟢
- **Business Flow:** Role-based KPIs and operational visibility.
- **Current Capability:** Executive dashboard (revenue, GP, margin, win rate, pipeline, charts by service/customer/vendor/salesperson).
- **Missing Feature:** Operational dashboards (shipments in transit, overdue tasks, cut-off alerts), role-specific views, drill-down, configurable widgets.
- **Commercial Risk:** Low.
- **Priority:** 🟢

## 29. Report — **40%** 🟡
- **Business Flow:** Standard + ad-hoc reporting and export.
- **Current Capability:** CSV/Excel exports (quotations, customers…), P&L by customer/vendor/period, AR aging, customer/vendor ranking.
- **Missing Feature:** Custom/ad-hoc report builder, scheduled reports, operational reports (shipment status, productivity), profit-per-shipment/branch, saved report layouts.
- **Missing Automation:** Scheduled report delivery.
- **Commercial Risk:** Medium.
- **Priority:** 🟡

## 30. Permission — **75%** 🟢
- **Business Flow:** RBAC across all functions.
- **Current Capability:** 6 roles, 30 permission codes, per-route enforcement, configurable role→permission matrix in Settings.
- **Missing Feature:** Field/record-level security, branch/company scoping, data-ownership rules, per-user overrides.
- **Commercial Risk:** Low.
- **Priority:** 🟢

## 31. Audit Log — **50%** 🟡
- **Business Flow:** Immutable trail of who-did-what.
- **Current Capability:** Audit service logs login/CRUD/status/payment with IP + user-agent and JSON detail.
- **Missing Feature:** **Audit-log viewer UI** (logged but not surfaced), before/after diffs on all entities, tamper-evident export, retention policy.
- **Commercial Risk:** Medium — compliance visibility is data-only.
- **Priority:** 🟡

## 32. API — **35%** 🟡
- **Business Flow:** Programmatic access for partners/integrations.
- **Current Capability:** Internal REST API (NestJS), consumed by the web client.
- **Missing Feature:** Public/partner API, API keys/OAuth clients, **OpenAPI/Swagger docs**, webhooks, versioning, rate-limited public tier.
- **Commercial Risk:** Medium — blocks partner/integration deals.
- **Priority:** 🟡

## 33. Integration — **5%** 🔴
- **Business Flow:** Sync with carriers, accounting, tracking, port systems.
- **Current Capability:** None beyond Excel/CSV import and OCR.
- **Missing Feature:** Accounting sync (Xero/QuickBooks/SQL), carrier/co-loader booking (INTTRA/e-booking), tracking feeds (P44/carrier APIs), port community systems.
- **Commercial Risk:** **High** — modern forwarders expect connectivity; also the pragmatic answer to the missing GL (§14).
- **Priority:** 🔴 (at least accounting sync)

## 34. EDI — **0%** 🟠
- **Business Flow:** EDI messaging with carriers/customs/partners (IFTMIN, IFTSTA, CUSCAR, 300-series, etc.).
- **Current Capability:** **None.**
- **Missing:** EDI mapping/translation, message queue, partner onboarding, status EDI (IFTSTA) inbound to milestones.
- **Commercial Risk:** Medium-High for mid-market; low for micro-SMB.
- **Priority:** 🟠 (segment-dependent)

## 35. Customs — **0%** 🔴
- **Business Flow:** Declaration → HS classification → duty/tax → status → release.
- **Current Capability:** "Custom Clearance" exists only as a service/charge line.
- **Missing:** Customs declaration, HS code master, duty/tax calculation, customs status tracking, national single-window integration (e.g. Malaysia uCustoms).
- **Commercial Risk:** **High** for forwarders offering brokerage.
- **Priority:** 🔴 (segment-dependent)

---

## Module Completion Summary

| # | Module | % | Priority |
|---|---|---|---|
| 1 | CRM | 70% | 🟢 |
| 2 | Quotation | 75% | 🟢 |
| 3 | Rate Management | 40% | 🟠 |
| 4 | Booking | 0% | 🔴 |
| 5 | Shipment (Job) | 45% | 🟠 |
| 6 | Ocean Export | 10% | 🔴 |
| 7 | Ocean Import | 10% | 🔴 |
| 8 | Air Export | 5% | 🔴 |
| 9 | Air Import | 5% | 🔴 |
| 10 | LCL | 10% | 🟠 |
| 11 | FCL | 20% | 🟠 |
| 12 | Container | 5% | 🔴 |
| 13 | Warehouse | 0% | 🟡 |
| 14 | Accounting (GL) | 15% | 🔴 |
| 15 | AR | 55% | 🟠 |
| 16 | AP | 5% | 🔴 |
| 17 | Invoice | 70% | 🟢 |
| 18 | Credit Note | 0% | 🟠 |
| 19 | Debit Note | 0% | 🟠 |
| 20 | Customer Portal | 0% | 🟠 |
| 21 | Document | 45% | 🟠 |
| 22 | OCR | 50% | 🟡 |
| 23 | Task | 5% | 🟠 |
| 24 | Workflow | 20% | 🟠 |
| 25 | Approval | 35% | 🟡 |
| 26 | Email | 40% | 🟡 |
| 27 | Notification | 55% | 🟢 |
| 28 | Dashboard | 65% | 🟢 |
| 29 | Report | 40% | 🟡 |
| 30 | Permission | 75% | 🟢 |
| 31 | Audit Log | 50% | 🟡 |
| 32 | API | 35% | 🟡 |
| 33 | Integration | 5% | 🔴 |
| 34 | EDI | 0% | 🟠 |
| 35 | Customs | 0% | 🔴 |

**Weighted business completion: ~34%.**

---

## Go-Live Recommendation by Segment

| Target customer | Verdict | Rationale |
|---|---|---|
| **Micro forwarder / freelance NVOCC** (quoting + billing + CRM, manual ops) | ✅ **Go-live capable now** | Strong quote, invoice, CRM, dashboard. |
| **Small forwarder with in-house ops** | 🟠 **Pilot with gaps** | Needs Booking, shipment milestones, AP, credit/debit notes, statements. |
| **Mid-market forwarder / brokerage** | ❌ **Not ready** | Missing operations, customs, container, EDI, portal, GL. |

## Minimum "Commercial Go-Live" Backlog (front-office SMB tier)
1. 🔴 **Credit Note / Debit Note** — SST/tax compliance for corrections & extra charges.
2. 🔴 **AP / vendor-bill capture + AP aging** — know what you owe carriers.
3. 🔴 **Booking object + shipment operational milestones** — the missing core forwarding step.
4. 🟠 **Customer Statement (SOA)** + credit-limit enforcement + overdue automation.
5. 🟠 **Accounting integration** (Xero/QuickBooks) — pragmatic substitute for a full GL.
6. 🟠 **Persistent document storage** (S3/R2) + shipping-document generation (HBL/DO).
7. 🟠 **Customer Portal** (track + documents + quote acceptance) — competitive parity.

## Deferrable (segment-dependent)
Mode-specific Ocean/Air Export-Import files, Container management, Customs declarations, EDI, Warehouse — required only if the forwarder runs those operations in-house rather than via agents/brokers.
