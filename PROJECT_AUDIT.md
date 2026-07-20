# PROJECT AUDIT — Shipment Status Tracker (Logistics ERP & CRM)

**Reviewer:** Software Architect (read-only review — no code changed)
**Date:** 2026-07-20
**Repository:** `bsmart4solutions-code/shipment-status-tracker` (branch `main`)
**Scale:** ~5,940 LOC backend · ~5,534 LOC frontend · 13 Prisma migrations · 11 test files (95 tests)

---

## 1. Project Structure

A clean two-tier monorepo: a NestJS REST API and a Next.js web client in sibling folders, plus infrastructure and docs.

```
shipment-tracker/
├── backend/            NestJS 10 + Prisma + PostgreSQL API
│   ├── prisma/         schema.prisma + 13 migrations + seed.ts
│   └── src/
│       ├── modules/    22 domain modules (see §3)
│       ├── common/     cross-cutting: guards, filters, decorators,
│       │               logger, prisma, audit, fx, sequence, state-machine
│       └── config/     env validation
├── frontend/           Next.js 14 (App Router) + React 18 + Tailwind
│   └── src/
│       ├── app/        18 route folders + api proxy + layout/providers
│       ├── components/ shell, ui kit, dialogs, column-picker
│       └── lib/        api client, company profile, utils, xlsx export
├── docs/               API.md, ARCHITECTURE.md, DEPLOYMENT.md, ERD.md
├── legacy/             index.html (original HTML prototype — orphaned)
├── docker-compose.yml  full local stack (db + api + web)
├── render.yaml         one-click cloud blueprint
└── .github/workflows/  ci.yml (typecheck + build + test, both tiers)
```

**Verdict:** Textbook layered structure. Domain-per-module on the backend, route-per-domain on the frontend, cross-cutting concerns isolated in `common/`. Easy to navigate and onboard.

---

## 2. Technology Stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| API framework | NestJS | 10.4 | Modular, DI, decorators |
| ORM / DB | Prisma / PostgreSQL | 5.22 / 16 | Migrations, typed client |
| Validation | class-validator / class-transformer | — | DTO-level, server-authoritative |
| Auth | JWT (passport-jwt) | — | 8h expiry, account lockout |
| Security mw | helmet, @nestjs/throttler | — | Headers + rate limiting |
| Logging | winston / nest-winston | — | Structured JSON, file rotation |
| Docs intel | tesseract.js, pdf-parse, multer | — | OCR + BL extraction |
| Mail | nodemailer | 9 | Simulated when SMTP unset |
| Web framework | Next.js (App Router) | 14.2 | React 18, standalone output |
| Data fetching | TanStack Query | 5 | Cache + invalidation |
| Forms | react-hook-form + zod / controlled state | — | Mixed (see §6) |
| UI | Tailwind CSS, lucide-react, recharts | — | Hand-rolled component kit |
| Spreadsheet | xlsx (SheetJS) | 0.18 | ⚠️ security (see §7) |
| Tests | Jest (backend) / Vitest (frontend) | — | 78 + 17 = 95 unit tests |
| CI/CD | GitHub Actions | — | PG service, migrate, typecheck, build, test |
| Deploy | Docker Compose, Render blueprint | — | — |

**Verdict:** A modern, mainstream, well-matched stack. No exotic or abandoned dependencies. Strong TypeScript discipline (`strict: true` on both tiers).

---

## 3. Folder Architecture

**Backend — 22 modules**, each following the NestJS `module / controller / service / dto` convention:

`auth · users · roles · customers · vendors · services-catalog · rates · quotations · costing · jobs · invoices · payments(within invoices) · documents · imports · reports · dashboard · pnl · ratings · notifications · recycle-bin · fx · health · settings`

Cross-cutting `common/`: `guards/` (JWT, permissions, rate-limit), `filters/` (global exception), `decorators/` (CurrentUser, RequirePermission), `logger/` (winston), `middleware/` (request logger), plus reusable services (`audit`, `fx`, `sequence`, `settings`, `prisma`) and pure utilities (`state-machine`, `costing`, `csv`).

**Frontend — App Router pages** mirror the domains: `dashboard, quotations (+[id], +[id]/print), jobs, invoices (+[id]/print), customers, vendors, services, rates, compare, pnl, reports, recycle-bin, settings, login`. Shared UI in `components/` and a thin typed API client in `lib/api.ts`.

**Strengths:**
- Pure, unit-tested business logic isolated from I/O (`costing.engine.ts`, `invoice.calc.ts`, `state-machine.ts`).
- Central state machines enforce legal status transitions for quotations / jobs / invoices.
- Server-authoritative money math — the client can never post an arbitrary total.
- Audit logging, soft-delete + recycle bin, and RBAC applied consistently.

**Weaknesses:**
- The frontend mixes two form paradigms (react-hook-form+zod for simple modals; controlled state for the big builders). Consistent, but worth standardizing.
- Some cross-cutting settings (company profile) live in a controller declared inside `settings.module.ts` rather than its own controller file — minor inconsistency.

---

## 4. Missing Modules

The customer & vendor masters were deliberately built to feed downstream modules that **do not yet exist**. Confirmed absent (`modules/` has no order/delivery/statement/payable/purchase/credit folder):

| Missing capability | Impact | Priority |
|---|---|---|
| **Sales Orders / Delivery Orders** | Master data references them; no transactional flow | High (roadmap) |
| **Accounts Payable / Vendor Bills** | Vendor master has `apAccount`; no AP posting or vendor invoice capture | High |
| **Purchase Orders to vendors** | No procurement document despite rate/vendor data | Medium |
| **Customer Statements / SOA** | `receiveStatementsByEmail` flag exists; no statement generation | Medium |
| **Credit Control enforcement** | `creditLimit`, `outstandingLimit`, `creditHold` stored but not enforced at quote/order time | Medium |
| **Persistent document storage** | Uploaded BL/PDF/OCR files use local disk → lost on Render restart (see §7) | High |
| **Audit-log viewer UI** | Actions are logged to DB but not surfaced anywhere in the app | Low |
| **Integration / E2E tests** | Only unit tests exist; no controller/HTTP-level or Playwright tests | Medium |
| **ESLint / lint gate** | No `.eslintrc`, no `lint` script (see §8) | Medium |
| **i18n** | UI is English-only despite Chinese-speaking operators | Low |
| **Email queue / templates** | nodemailer is synchronous inline HTML; no retry/queue | Low |

---

## 5. Duplicate Modules

The codebase is largely DRY. The genuine duplication is on the **frontend master-form helpers**:

- **`customers/customer-form.tsx` and `vendors/vendor-form.tsx`** each redefine the same presentational primitives — `Section`, `Grid`, `Field`, `ChildList`, and the `s()` / `n()` / `stripBlank()` helpers (~80 near-identical lines). These should be extracted to a shared module (e.g. `components/master-form.tsx`) and imported by both.
- The two forms also duplicate the **nested-child add/remove/hydrate pattern** (contacts / addresses / documents / bank accounts). The backend correctly normalizes these into parallel tables; the frontend logic is copy-pasted.

**Not duplicates (verified):**
- `common/csv.util.ts` (RFC-4180 **builder** for exports, with formula-injection escaping) vs `common/csv-parse.util.ts` (import **parser**) — distinct, correctly separated.
- Shared `AddressType` enum reused by customer & vendor addresses — good normalization, not duplication.

---

## 6. Dead Code

Exceptionally clean for a rapidly-built project:

- **0** `TODO` / `FIXME` / `HACK` markers in source.
- **0** stray `console.log` in application code (logging goes through winston).
- **1** `any` in the entire frontend; `strict: true` on both tiers.

Items to prune / revisit:
- **`legacy/index.html`** — the original standalone HTML prototype, not imported by any code. Orphaned; move to a separate archive or delete.
- **Speculative master-data fields** — customer fields such as `defaultWarehouse`, `priceLevel`, `discountGroup`, `commissionGroup` (and vendor `minOrderValue`) are stored but have **no consuming module yet**. Not dead (future-facing by design), but currently write-only; document them as roadmap placeholders so they aren't mistaken for wired features.
- **Mixed form paradigm** — react-hook-form + zod is still imported where the newer controlled-state builders replaced it in some pages; confirm no orphaned schema objects remain per page.

---

## 7. Security Risks

| # | Risk | Severity | Status / Recommendation |
|---|---|---|---|
| 1 | **`xlsx` (SheetJS) — prototype pollution + ReDoS, no upstream fix** | **High** | Used in `rate-import-dialog.tsx` (parses user-uploaded Excel, client-side) and exports. Blast radius limited to an authenticated internal user in their own browser, but there is **no patch**. Migrate to `exceljs`, or parse server-side with size/complexity limits. |
| 2 | **Next.js 14.2.x advisories** (SSRF via WS upgrade, cache poisoning, image DoS, middleware bypass) | **High/Med** | Fixes land in Next 15/16 (major). Most CVEs require features this app doesn't use (`next/image`, middleware, i18n), so real exposure is low — but plan a Next 15 → 16 upgrade. |
| 3 | **`@nestjs/core` injection advisory** | Moderate (×2) | Requires NestJS 11 major upgrade; schedule as a fast-follow with full regression. |
| 4 | **Ephemeral document storage on Render free tier** | **High (data-loss, not breach)** | `file-storage.service.ts` writes BL/PDF/OCR binaries to local disk (`UPLOAD_DIR`). Render's free tier has no persistent disk → files vanish on every restart/redeploy. Move to S3 / Cloudflare R2 before relying on document upload in production. |
| 5 | **Public repo + demo admin credentials** | Medium | Repo is public and `Admin@123` lives in git history / dev seed. **Already mitigated**: `seed.ts` refuses to run in production without `SEED_ADMIN_PASSWORD`, and Render generates a random one. Keep it that way; never remove the guard. |
| 6 | **No token revocation / refresh rotation** | Low | JWT is stateless with an 8h expiry; a leaked token is valid until expiry. Acceptable for an internal SMB tool; consider short-lived access + refresh tokens if a customer portal is added. |
| 7 | **Company logo / profile as base64 in DB** | Low (accepted) | Bounded and auto-optimized (≤~512px). Fine at this scale. |

**Positive controls already in place:** helmet security headers · explicit CORS origin from env with credentials off · global rate limiting + stricter auth throttle + account-level lockout · CSV/formula-injection escaping on exports · HTML escaping in emails · server-side money computation · `JWT_SECRET` has **no** fallback (boot fails if unset) · RBAC with 30 permission codes enforced per route · audit logging with IP/user-agent · 5 MB request-body cap.

---

## 8. Build Problems

**CI is solid** — `.github/workflows/ci.yml` spins up a real Postgres service, runs `prisma migrate deploy`, `tsc --noEmit`, production build, and unit tests for **both** tiers on Node 22. That is above-average discipline for a project this size.

Gaps and operational hazards:

| Issue | Severity | Recommendation |
|---|---|---|
| **No ESLint / no `lint` script** | Medium | Add ESLint (nestjs + next presets) and gate it in CI. TypeScript strict catches types, not style/anti-patterns. |
| **No `engines.node` pin** | Low | CI uses Node 22, local dev uses Node 24 — pin `engines.node` in both `package.json` to prevent version drift. |
| **No test-coverage gate** | Low | 95 unit tests exist but no coverage threshold; add `--coverage` with a floor on the pure-logic modules. |
| **Dev-server vs build `.next` collision** | Operational | Running `npm run build` clobbers the running dev server's `.next`, blanking the app until a restart. Not a defect in shipped code, but document "don't build against a live dev server," or use a separate `distDir` for CI/prod builds. |
| **Dependency freshness** | Medium | See §7 — xlsx / Next / NestJS majors are pending. Establish a quarterly upgrade cadence. |

No compile errors, no Prisma drift (13 migrations apply cleanly), and the production build succeeds (18 routes generated).

---

## 9. Overall Score

### **8.0 / 10** — Strong core, clear and honest gaps

**What earns the score:**
- Clean modular architecture with genuine separation of concerns and pure, unit-tested business logic.
- Financial correctness done properly: server-authoritative math, SST-aware tax base (ocean-freight exemption), state machines guarding status transitions, and `revenue − cost = profit` invariants that were actually audited.
- Real security posture: RBAC, helmet, throttling + lockout, no secret fallbacks, formula-injection escaping, audit trail.
- Professional delivery hygiene: strict TS, CI on both tiers with a live DB, migrations, near-zero dead code, documentation folder, Docker + Render blueprints.

**What holds it back:**
- Dependency debt in three libraries with real (if low-exposure) advisories — `xlsx` (no fix), Next.js, NestJS.
- **Ephemeral file storage** is the most important architectural risk for production document handling.
- Master data (customer/vendor) is richer than the transactional modules that should consume it — Sales Orders, Delivery Orders, AP, and Statements are the missing half of the ERP.
- Frontend form-helper duplication and a missing lint gate.

**Scoring by dimension:**

| Dimension | Score | |
|---|---|---|
| Architecture & structure | 9/10 | Clean, layered, conventional |
| Code quality & type safety | 9/10 | Strict TS, minimal dead code |
| Security | 7/10 | Good controls; dependency + storage gaps |
| Testing | 7/10 | Solid unit tests; no E2E/integration/coverage gate |
| Build & CI/CD | 8/10 | Strong CI; no lint, no engines pin |
| Feature completeness (as an ERP) | 6/10 | Quote→Job→Invoice solid; SO/DO/AP/statements missing |
| Documentation | 8/10 | docs/ present and current |

### Top 5 recommendations (priority order)
1. **Move document storage to S3 / R2** before production document upload is relied upon.
2. **Replace `xlsx`** with `exceljs` (or server-side parsing) — the only dependency with no available patch.
3. **Add the transactional layer** the masters were designed for — Sales/Delivery Orders and Accounts Payable — plus credit-limit enforcement at quote/order time.
4. **Extract the shared master-form helpers** and add an **ESLint gate** in CI.
5. **Plan the Next.js / NestJS major upgrades** on a scheduled cadence with full regression against the 95-test suite.
