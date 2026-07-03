# Architecture — Logistics ERP & CRM

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) · TypeScript · TailwindCSS · shadcn-style components · React Query · React Hook Form · Zod · Recharts |
| Backend | NestJS 10 · REST · Prisma ORM · class-validator DTOs · Passport-JWT |
| Database | PostgreSQL 16 (normalized, see [ERD.md](./ERD.md)) |
| Auth | JWT + configurable RBAC (roles → permission codes) |
| Packaging | Docker (multi-stage) + docker-compose |

## Backend layering (Clean Architecture)

```
Controller (HTTP, DTO validation, permission guard)
   └── Service (business logic, transactions, audit)
         ├── Costing Engine (pure functions — src/modules/costing/costing.engine.ts)
         ├── PrismaService (repository/data access)
         ├── SequenceService (configurable auto-numbering, row-locked)
         └── SettingsService (JSON config store with code fallbacks)
```

- **Controllers** never touch Prisma directly; they validate input (`ValidationPipe` + class-validator) and declare a required permission via `@RequirePermission('module.action')`.
- **Services** own business rules and wrap multi-step writes in `$transaction`.
- **Costing engine** is a pure module with zero I/O — the same math is mirrored client-side for the live quotation preview, and covered by unit tests (`costing.engine.spec.ts`).
- **Cross-cutting**: `PermissionsGuard` (role permission cache), `AuditLog` writes on critical actions (login, quotation create/update/status/convert/delete).

## Key design decisions

1. **Configurable, not hardcoded** — numbering formats (`sequences`), rating weights, alert thresholds, quotation defaults, and recommendation weights (`settings`) are all data, editable from the UI.
2. **Snapshot pricing** — quotation items copy cost/sell at quote time and keep a reference to the source rate; historical quotes never drift when rates change.
3. **Calculated on read** — customer revenue/profit and vendor/customer scores are aggregated live; only quotation totals are persisted (recomputed by the engine on each write) for fast lists.
4. **One origin in the browser** — Next.js rewrites `/api/*` to the NestJS service, avoiding CORS in production and keeping the JWT handling in one fetch wrapper.
5. **Automation lives server-side** — auto codes, quote→job conversion (with primary-vendor detection), GP/margin math, rankings, vendor recommendation and notification scanning are all API features; the UI is a thin consumer.

## Module map

| Domain | Backend module | Frontend route |
|---|---|---|
| Auth / session | `modules/auth` | `/login` |
| Users, roles, permissions | `modules/users`, `modules/roles` | `/settings` |
| Customers (+ratings, ranking) | `modules/customers`, `modules/ratings` | `/customers` |
| Vendors (+ratings, ranking) | `modules/vendors`, `modules/ratings` | `/vendors` |
| Service catalog | `modules/services-catalog` | `/services` |
| Vendor rates + comparison | `modules/rates` | `/rates`, `/compare` |
| Quotations + costing | `modules/quotations`, `modules/costing` | `/quotations`, `/quotations/[id]` |
| Jobs / shipments | `modules/jobs` | `/jobs` |
| Dashboard | `modules/dashboard` | `/dashboard` |
| P&L | `modules/pnl` | `/pnl` |
| Reports (CSV) | `modules/reports` | `/reports` |
| Notifications | `modules/notifications` | bell in shell |
| FX / settings | `modules/fx`, `modules/settings` | `/settings` |

## Future expansion (no schema redesign required)

- **Invoices / Purchase Orders** — new tables FK-ing `quotations` / `jobs` / `customers` / `vendors`; billing numbers via a new `sequences` row.
- **Accounting** — journal table keyed by (`entityType`, `entityId`), the same polymorphic pattern `audit_logs` and `notifications` already use.
- **Customer / Vendor portals** — same API with new roles whose permissions are already configurable; add row-level scoping by `customerId` claim in the JWT.
- **Shipment tracking integrations / mobile app** — REST API is UI-agnostic; add webhook ingestion endpoints per carrier.
- **AI-assisted quotation suggestions** — the vendor comparison endpoint already returns a weighted recommendation; an ML ranker can replace the scoring function behind the same contract.
