# MVP SCOPE — Commercial Go-Live

**Owner:** Product Owner
**Sources:** `PRODUCT_BACKLOG.md`, `BUSINESS_AUDIT.md`, `PROJECT_AUDIT.md`
**Date:** 2026-07-20

---

## 1. MVP Definition

> **The MVP is the minimum feature set that lets a small freight forwarder run its commercial front-office — quote, book, operate a shipment file at milestone level, bill compliantly (incl. credit/debit notes), track receivables and payables, and collect — with durable data and no unpatched security dependency.**

**Target customer:** Small forwarder / NVOCC (1–20 users) with in-house sales, operations and finance coordinators; operations executed largely through agents/carriers (not self-run customs/warehouse).

**Explicitly NOT the MVP target:** mid-market forwarders needing self-operated ocean/air ops, customs brokerage, EDI, GL accounting, or a warehouse.

**Why this line:** The system already scores well on Quotation (75%), CRM (70%), Invoice (70%), Permission (75%), Dashboard (65%) and AR (55%). The MVP closes the **compliance, payables, booking-to-milestone, credit-control, collections and data-durability** gaps that block charging a customer money for the product.

---

## 2. In-Scope (Must-Have for Go-Live)

### A. Compliance & billing integrity
- **Credit Note** — issue against an invoice, reverse tax, apply to AR *(P0-1)*.
- **Debit Note** — post-invoice additional charge with tax + AR posting *(P0-2)*.
- **Rationale:** Without CN/DN, every correction breaks the SST/tax and audit trail — a hard compliance blocker in Malaysia.

### B. Payables & credit control
- **Accounts Payable** — capture vendor bills, match to job cost, AP aging *(P0-3)*.
- **Credit-limit enforcement** — warn/block quote or booking when over limit or on credit-hold *(P0-7)*.
- **Rationale:** A forwarder that can bill but can't see what it owes or control customer credit is not commercially safe.

### C. Operations backbone
- **Booking object** — created from a won quote; carrier/booking no., cut-off dates *(P0-4)*.
- **Shipment operational milestones** — Booked → Gated-in → Loaded → Departed → Arrived → Delivered, on the existing Job file *(P0-4)*.
- **Rationale:** The single missing core forwarding step; turns the generic Job into an operable shipment file.

### D. Receivables & collections
- **AR overdue automation** — auto OVERDUE status + reminder emails *(P0-8)*.
- **Customer Statement (SOA)** — generate + email per customer *(P0-8)*.
- **Rationale:** Collections is where the business gets paid; the data exists but the cycle is manual.

### E. Data durability & security (non-negotiable NFRs)
- **Persistent object storage (S3/R2)** for all uploaded/generated documents *(P0-5 / T-1)*.
- **Replace `xlsx`** with a maintained parser *(P0-6 / T-2)*.
- **Rationale:** Ephemeral storage = silent data loss on every redeploy; `xlsx` has no upstream patch. Both must ship before real customer data lands.

### MVP also carries forward (already built, no new work)
Quotation + costing + approval + PDF · Invoice (itemized, SST) + payments + AR aging · CRM masters · Dashboard · RBAC · Notifications · OCR/BL extraction · Reports/exports.

---

## 3. Out-of-Scope (Deferred — with rationale)

| Deferred | Why it can wait for the MVP target |
|---|---|
| **Customer Portal** (P1-2) | High value but large; internal ops function without it. First fast-follow after MVP. |
| **Accounting integration / GL** (P1-1 / P2-5) | AR + AP + CN/DN give a complete sub-ledger; books can be closed via export until integration lands. |
| **Shipping-doc generation, Task engine, structured parties, container entity, rate depth** (P1-3…P1-8) | Meaningful efficiency, but operators can proceed with milestones + documents attached. Next cycle. |
| **Mode-specific Ocean/Air Export-Import files** (P2-1/P2-2) | Only needed if the forwarder self-operates that lane; MVP target uses agents. |
| **Customs, EDI, Warehouse** (P2-4/6/7) | Segment-dependent; not part of the front-office MVP. |
| **Public API/Swagger/webhooks** (P1-12) | No integration partners at MVP stage. |
| **Full GL, FX revaluation, period close** | Replaced by AR/AP sub-ledgers + export at MVP scale. |

---

## 4. MVP Exit Criteria (Definition of Done)

A forwarder can, end-to-end and unaided:
1. Create a customer with a credit limit; a quote over the limit **is blocked/flagged**.
2. Win a quote → **create a Booking** → operate the shipment through **all milestones** to Delivered.
3. Attach documents to the shipment and have them **survive a redeploy** (persistent storage verified).
4. Issue an **invoice**, then a **credit note** and a **debit note** against it, with correct SST/tax and AR effect.
5. Capture a **vendor bill (AP)** against the job and see it in **AP aging**.
6. See the invoice go **OVERDUE**, receive an automated reminder, and generate/email a **customer statement**.
7. Import rates via the **replaced (non-`xlsx`)** path with no security dependency.
8. All flows pass **CI (typecheck + build + unit + new integration tests)**; no P0 open.

**Non-functional gates:** persistent storage live · `xlsx` removed · ESLint gate added · engines pinned · smoke E2E on the golden path green.

---

## 5. Assumptions & Risks

- **Team:** 1–2 full-stack developers; 2-week sprints (see `IMPLEMENTATION_ROADMAP.md`).
- **Reuse:** CN/DN share one document engine with Invoice; AP reuses the master/aging patterns from AR — reduces effort materially.
- **Risk — scope creep into ops:** Booking/milestones must stay lightweight (status + dates), *not* mode-specific files. Guard the line.
- **Risk — storage migration:** existing local files (if any real ones) must be migrated to S3/R2 as part of P0-5, not after.
- **Risk — tax rules:** CN/DN tax reversal must be validated with the customer's SST treatment before go-live.
- **Dependency spine:** Credit Note → Debit Note (shared model); AP → Accounting export; Booking → milestones → (later) Portal.
