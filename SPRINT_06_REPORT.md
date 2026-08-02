# SPRINT 06 REPORT — Booking Object · Shipment Operational Milestones → **MVP GA**

**Plan:** commercial-launch plan agreed 2026-08-02 (Sprint 05 + Sprint 06); backlog item **P0-4**.
**Status:** ✅ **COMPLETE** — implemented, tested, live-verified.
**Date:** 2026-08-02
**Suite:** 21 backend unit suites **306/306** (+12) · **4/4 backend integration suites, 31/31 tests** (+4) · frontend unit **12/12** · Playwright golden-path (see §8) · both typechecks and production builds clean · **one database migration**

---

## 1. Summary

The last P0 blocker is closed. A won quotation is no longer converted straight
into a shipment file — it is **booked with a carrier first**, and confirming
that booking is what opens the Job. The shipment then advances through a fixed,
enforced sequence of operational milestones (Booked → Gated-in → Loaded →
Departed → Arrived → Delivered), visible on the job list, the dashboard, and the
existing tracking timeline.

With this, **all 8 P0 items in `PRODUCT_BACKLOG.md` are complete** and every
`MVP_SCOPE.md` §4 exit criterion passes (§9). This is the **MVP GA** gate.

## 2. Design decisions

- **Booking is a new top-level entity**, not fields on Quotation or Job. It has
  its own lifecycle (`DRAFT → CONFIRMED → CANCELLED`) distinct from both;
  folding it into either edge map in `state-machine.ts` would have overloaded an
  unrelated machine. Carrier, carrier booking reference and SI/VGM/CY cut-offs
  belong to neither the commercial document nor the operational file.
- **`BookingsService.confirm()` took over `QuotationsService.convertToJob()`
  wholesale** — the commercial copy (net-of-SST revenue), the largest-cost-share
  vendor rule, the WON transition and the P2002 race guard all moved across
  intact rather than being reimplemented. `convertToJob` and
  `POST /quotations/:id/convert` are gone; the flow is now
  `Quotation --(WON)--> Booking (DRAFT) --(confirm)--> Booking (CONFIRMED) + Job`.
- **Milestones reuse the existing `JobTrackingEvent` timeline** rather than
  adding a second history table — that table already existed for exactly this,
  it was simply unenforced free text. Sprint 06 adds the `MilestoneStatus` enum,
  a forward-only `assertMilestoneTransition()`, and a persisted
  `Job.milestone` so list and dashboard queries never replay history. Every
  advance still writes a `SYSTEM` tracking row, so the timeline remains the full
  record.
- **Milestones are strictly forward-only and single-step.** Cargo cannot
  un-depart, and skipping ahead would invent events that never happened.
  Correcting a mistake is a manual tracking note or cancelling the file — a
  business decision, not a status edit. Same reasoning that makes `PAID`
  terminal for invoices.
- **`addTrackingEvent` was left exactly as it was.** Free-text operational
  commentary and validated milestones are different things; collapsing them
  would have forced one of the two to compromise.

## 3. Database Changes

**One migration** (`20260801180000_sprint06_booking_milestones`): new `bookings`
table, `BookingStatus` and `MilestoneStatus` enums, `jobs.bookingId` (unique,
nullable, FK) and `jobs.milestone`. Additive only — existing jobs keep working
with `bookingId`/`milestone` null.

Generated via `prisma migrate diff` against a shadow database rather than
`migrate dev`, because the new unique index makes `migrate dev` prompt
interactively and this environment is non-interactive.

## 4. Backend Changes

- **`modules/bookings/`** (new) — controller / service / dto / module following
  the `payables` module shape, including the `ListBookingsDto extends
  PaginationDto` filter pattern. `createFromQuotation`, `confirm`, `cancel`,
  plus standalone `create` for spot business with no quotation behind it.
- **`common/state-machine.ts`** — `BOOKING_EDGES` / `assertBookingStatusTransition`
  and `MILESTONE_EDGES` / `assertMilestoneTransition` (+ exported
  `MILESTONE_SEQUENCE`), same `Record<Status, Set<Status>>` idiom as every other
  machine in the file.
- **`jobs.service.ts`** — `advanceMilestone()` (validated, transactional,
  writes the timeline row), `inTransit()` for the dashboard panel, and a static
  `nextMilestone()` helper.
- **`quotations.service.ts`** — `convertToJob()` removed; `get()` now includes
  `bookings` so the detail page knows the deal has moved on.
- **`permissions.ts` + `seed.ts`** — `bookings.read` / `bookings.write` added to
  the typed union and the permission groups, granted to Manager, Sales and
  Operation (read-only for Finance and Viewer). Plus the `booking` sequence
  (`BKG-2026-0001`).

### A permission note worth recording

Sales holds `bookings.write`. That is the *same* exposure they had before this
sprint — the old convert endpoint was gated on `quotations.write` and created a
Job directly, so a salesperson could already open a shipment file without
`jobs.write`. Sprint 06 renames that capability rather than widening it. If
segregation is wanted later, the split is `bookings.write` (raise) vs a new
`bookings.confirm` (commit with the carrier) — noted in `TODO.md`, not built,
because no approved decision covers it.

## 5. Frontend Changes

- **New `/bookings` page** (single-file, mirroring `jobs/page.tsx`): list with
  status/search filters, create/edit modal, **Confirm** (with an explicit
  "this cannot be undone" confirmation) and Cancel. Cut-off dates already past
  render in red — the whole point of the screen.
- **Jobs page**: new **Milestone** column and a milestone stepper modal showing
  the full six-step sequence with the next step highlighted; only the legal next
  step is offered, so an illegal jump is visibly unavailable rather than
  rejected after the fact.
- **Quotation detail**: "Convert to Job" → **"Create Booking"**, with the
  follow-on state ("Booked as BKG-… — confirm the booking to open the shipment
  file") shown in the same place.
- **Dashboard**: "Shipments In Transit" panel — each live shipment with its
  current milestone and the next one due.
- **Sidebar**: Bookings between Quotations and Jobs, permission-filtered like
  every other entry.

## 6. Tests

| Milestone | Backend unit | Integration |
|---|---|---|
| Sprint 05 close | 283 | 27 |
| **Sprint 06** | **306** (+23) | **31** (+4) |

New unit coverage: the two new state machines (booking lifecycle incl.
"never reopen a CONFIRMED booking"; the full milestone sequence, no-skip,
no-backwards, `null` start, `DELIVERED` terminal) and `BookingsService`
(commercial copy net of SST, milestone seeding, vendor selection precedence,
spot-business bookings, double-confirm and cancel guards).

New integration coverage (`booking-confirm.e2e-spec.ts`, real HTTP + real
Postgres): confirmation opens exactly one file at `BOOKED`; **two simultaneous
confirmations return 201/409 and create exactly one job**; milestone skip and
reversal are refused with the right messages and the timeline records each
advance; a booking with a live file cannot be cancelled.

The concurrency case is deliberately *not* unit-tested — stubs have no unique
index and no transactions, so a mock could only prove the mock. That is the
lesson Sprint 04's integration layer taught when it found a real AP race.

## 7. A pre-existing flake, closed

`rate-sheet.parser.spec.ts` had been failing roughly one run in five since
Sprint 03A (logged in `TODO.md`, diagnosed but not fixed). It failed once during
this sprint's verification and was fixed at the same time: the exceljs
round-trip takes ~1.5 s alone and intermittently blew Jest's 5 s default under
parallel load. Now `jest.setTimeout(30_000)` for that suite only. The flake was
slowness, never correctness.

## 8. Live Verification

Run against the rebuilt Docker stack (Postgres + the production API image +
the production Next.js image), not a dev server.

| Check | Result |
|---|---|
| Create booking | **BKG-2026-0006** DRAFT, carrier EVERGREEN, SI/VGM cut-offs recorded |
| Confirm booking | **201** → opened **JOB-2026-0010** at milestone **BOOKED**, booking flipped CONFIRMED |
| Illegal skip (BOOKED → DEPARTED) | **400** — *"milestones advance one step at a time and never go backwards"* |
| Full journey | GATED_IN → LOADED → DEPARTED → ARRIVED → **DELIVERED**, all 201 |
| Backwards (DELIVERED → ARRIVED) | **400**, refused |
| Timeline | `BOOKED > GATED_IN > LOADED > DEPARTED > ARRIVED > DELIVERED` — one SYSTEM row per advance |
| Cancel booking with live file | **409** — *"cancel the job first"* |
| Dashboard in-transit panel | Renders; shows the un-booked shipment with *next: BOOKED* |
| Bookings page | Renders; cut-off columns, shipment cross-link, Confirm/Cancel actions |
| Jobs page | New **Milestone** column; the stepper offers only the legal next step; a DELIVERED job offers no advance |

**A defect this verification found (§8a).**

**Regression — restored to the pre-sprint baseline after cleanup:**
AR outstanding **2,138.40** · JOB-2026-0001 **1585 / 395** · JOB-2026-0005
**180 / 36** · P&L **3157.2 / 2521 / 636.2** · AP payable **0** · issued notes
**0** — all identical to the Sprint 04/05 baseline. All verification data
removed; booking and job sequences reset so the first real records number
cleanly.

### 8a. A defect the live run found

The dashboard's in-transit panel returned **zero** shipments while an active,
un-booked job existed. Cause: the Prisma filter `milestone: { not: 'DELIVERED' }`
compiles to SQL `milestone != 'DELIVERED'`, which evaluates to **NULL — not
TRUE — for rows where milestone is NULL**, silently dropping every shipment not
yet booked. That is precisely the set operations most needs to see, and the UI
already rendered "Not booked / next: BOOKED" for it, so the intent was
unambiguous.

Fixed to `OR: [{ milestone: null }, { milestone: { not: 'DELIVERED' } }]`, and
locked in with two integration tests (a NULL-milestone job must appear; a
delivered one must not). Unit tests could not have caught it — a mocked Prisma
has no SQL three-valued logic. This is the same class of defect, and the same
argument for the integration layer, as the AP race Sprint 04 found.

## 9. MVP Exit Criteria (`MVP_SCOPE.md` §4)

| # | Criterion | Verdict |
|---|---|---|
| 1 | Customer with a credit limit; over-limit issue **blocked** | ✅ **409** — *"Credit limit exceeded: outstanding MYR 2138.40 plus this invoice MYR 999999.00…"* |
| 2 | Win a quote → **create a Booking** → operate **all milestones** to Delivered | ✅ §8 — full journey, with illegal moves refused |
| 3 | Attach documents that **survive a redeploy** | ⚠️ **Code path ready, not live.** `/health` reports `storageDriver: "local"`. The S3/R2 driver and its startup gate have shipped since Sprint 02; the production cutover needs the user's Cloudflare + Render accounts (§12) |
| 4 | Issue an **invoice**, then a **CN** and a **DN**, correct tax + AR effect | ✅ CN-2026-0001 (−100) and DN-2026-0001 (+40) against INV-2026-0007: AR moved **2138.40 → 2078.40**, statement running balance `2138.4 → 2038.4 → 2078.4` |
| 5 | Capture a **vendor bill (AP)** and see it in **AP aging** | ✅ AP aging returns buckets + per-vendor totals; the full bill lifecycle is asserted in `money-paths.e2e-spec.ts` |
| 6 | Invoice goes **OVERDUE**, automated reminder, **customer statement** | ✅ Sprint 05; overdue scan idempotent over real HTTP, statement generated and emailed (simulated — no SMTP locally) |
| 7 | Import rates via the **non-`xlsx`** path | ✅ `exceljs` since Sprint 02; `xlsx` absent from both `package.json` files |
| 8 | All flows pass CI (typecheck + build + unit + integration); **no P0 open** | ✅ 306 unit · 33 integration · 12 frontend · 7 Playwright · both typechecks and builds clean. **All 8 P0 items complete** |

**Verdict: MVP GA is met on code.** The single outstanding item is the R2
storage cutover (criterion 3), which is an account/configuration action the
developer cannot perform — see §12. Until it is done, uploaded documents do not
survive a redeploy, so **do not put real customer documents in production
first**.

## 9a. A note on where this leaves the product

`BUSINESS_AUDIT.md` scored the system ~34% against full forwarding platforms
(CargoWise/GoFreight/Magaya). Sprint 06 does not change that headline much —
booking and milestones lift the operations modules, but mode-specific ocean/air
files, containers, customs and EDI remain unbuilt **by design**. What MVP GA
means is narrower and more useful: **the small-forwarder segment
`MVP_SCOPE.md` targets can now run its whole commercial cycle in this system
without leaving it** — quote → book → operate → bill (incl. CN/DN) → chase →
collect. That is the line the sprint was aimed at, and it is met.

## 10. Known Limitations

1. **Milestones are shipment-level, not container-level.** An FCL booking with
   several containers gating in on different days shows one position. Container
   as a first-class entity is P1-6, deliberately deferred.
2. **No cut-off alerting.** The booking screen colours a passed cut-off red, but
   nothing pushes a notification. Wiring it into the existing
   `NotificationsService.scan()` is small and obvious; it is not in this
   sprint's approved scope.
3. **No booking-level carrier integration** (INTTRA/e-booking) — P2-8,
   segment-gated.
4. **One `bookings.write` covers raise / confirm / cancel** (see §4).
5. **Cancelling a confirmed booking requires cancelling the job first** — a
   deliberate guard, but it means an operator needs two actions where the
   business event is one.
6. **A COMPLETED job still offers milestone advancement.** Only CANCELLED is
   blocked. This is permissive rather than wrong — it lets an operator backfill
   the journey of a legacy job closed before milestones existed, and advancing
   one writes only a timeline row and the milestone field, never money or
   status. Tightening it to live jobs only is a one-line change if the Product
   Owner prefers; there is no approved decision either way, so the behaviour was
   left visible rather than silently narrowed.

## 11. Deployment Notes

- **One migration** — run `prisma migrate deploy` before deploy.
- **Run the seed** (or insert manually): `bookings.read` / `bookings.write`
  permissions with their role grants, and the `booking` sequence, are required
  for the module to work at all.
- **Behaviour change, not backward-compatible:** `POST /quotations/:id/convert`
  is gone. Any bookmark or script hitting it gets a 404; the replacement is
  `POST /bookings/from-quotation/:quotationId`. Acceptable because the system
  has no external API consumers yet (P1-12 is unbuilt).
- **Rollback:** revert the commit. The migration only adds a table, two enums
  and two nullable columns, all safe to leave in place.

## 12. The one thing still blocking a real go-live

**The Cloudflare R2 storage cutover** (`STORAGE.md` §3) — the only MVP exit
criterion not fully met, and the only one no amount of development can close,
because it needs the user's own Cloudflare and Render accounts:

1. Create an R2 bucket (e.g. `erp-documents`).
2. Create a bucket-scoped **Object Read & Write** API token.
3. In Render set `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_BUCKET`,
   `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
4. Deploy, then confirm `/health` reports `storageDriver: "s3"` and that an
   uploaded document survives a redeploy.

Until then production documents are ephemeral. The code path and its
fail-closed startup gate have been ready since Sprint 02/02A — this is
configuration, not development.
