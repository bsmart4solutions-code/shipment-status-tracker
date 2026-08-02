# Logistics ERP & CRM Management System

A cloud-based Logistics ERP that replaces spreadsheets and manual quotation processes: vendors, customers, services, vendor pricing, quotations with a full costing engine, jobs/shipments, KPI-based ratings, vendor comparison, P&L, executive dashboard and exportable reports — with JWT auth and configurable role-based access control.

一套云端物流 ERP/CRM 系统，取代 Excel 与手工报价流程：供应商、客户、服务、供应商价格、报价成本引擎、运单/Job、KPI 评分、供应商比价、损益分析、高管仪表盘与可导出报表，内置 JWT 认证与可配置的角色权限。

## Quick Start

```bash
docker compose up -d --build
docker compose exec api npx prisma db seed
# open http://localhost:3000 — login: admin@erp.local / Admin@123
```

Full guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Repository Layout

| Path | Description |
|---|---|
| `backend/` | NestJS 10 REST API · Prisma ORM · PostgreSQL 16 · JWT + RBAC · costing engine (unit-tested) |
| `frontend/` | Next.js 14 · TypeScript · TailwindCSS · React Query · RHF + Zod · Recharts · dark mode · Ctrl+K global search |
| `docs/` | [ERD](docs/ERD.md) · [API reference](docs/API.md) · [Architecture](docs/ARCHITECTURE.md) · [Deployment](docs/DEPLOYMENT.md) |
| `docker-compose.yml` | Postgres + API + Web, one command up |
| `legacy/index.html` | Legacy single-file freight job tracker (Qi-Net style) kept for reference |

## Feature Highlights

- **Vendor Comparison** — pick a service + lane, instantly see every vendor's cost, rating, preferred flag and a weighted recommendation score; sort by cost / rating / preferred; historical rate comparison included
- **Quotation Costing Engine** — multi-item quotes with vendor costs, minimum charges, markup or direct sell price, discount, service charge, misc charges, tax and multi-currency conversion; totals, GP and GP% computed automatically (mirrored live in the builder UI)
- **Quotation → Job conversion** — one click creates the job with auto number, copies commercials, detects the primary vendor and marks the quote WON
- **KPI Ratings** — 6 weighted criteria each for vendors and customers (weights configurable); automatic vendor & customer rankings
- **P&L** — by month / quarter / year / customer / vendor / sales person / service, from won quotations or job actuals
- **Executive Dashboard** — revenue, GP, margin, win rate, pipeline, trends, top customers, vendor spending, revenue by service & sales person; interactive charts, auto-refresh
- **Notifications** — quotation expiry, vendor rate expiry, job delays, low margin, high cost, payment due (thresholds configurable, alerts deduplicated)
- **Reports** — quotation / vendor / customer / P&L / vendor comparison / customer profitability / sales / revenue / gross profit, exportable to CSV (Excel-ready)
- **RBAC** — Administrator, Manager, Sales, Operation, Finance, Viewer; per-role permission matrix editable in the UI
- **Automation** — auto customer/vendor/service codes and quote/job numbers (configurable prefixes, per-year reset), automatic GP/margin calculation, vendor recommendation, rankings and dashboard refresh

## Default Roles & Demo Login

Seeded users: `admin@erp.local` (Administrator), `sales@erp.local` (Sales) — both `Admin@123`. Change these in production.

## Development

Local development runs **without Docker**. Three parts, all on this machine:

| Part | What runs it | Port |
|---|---|---|
| PostgreSQL 17 | Windows service `postgresql-17` (auto-starts with Windows) | **5433** |
| Backend (NestJS) | `npm run start:dev` — hot reload | 4000 |
| Frontend (Next.js) | `npm run dev` — hot reload | 3000 |

> **Why 5433 and not the usual 5432?** Port 5432 on this machine is already
> held by a Postgres running inside WSL (a Supabase local stack). The two are
> completely independent; this project uses 5433 so neither disturbs the other.

### Everyday use

Double-click **`start-app.bat`** in the project root. It checks the database
service, starts backend and frontend in their own windows, and opens the
browser. **`stop-app.bat`** stops the two dev servers (it leaves the database
service running on purpose — it is idle-cheap and starts with Windows).

Log in with `admin@erp.local` / `Admin@123`.

After a reboot nothing needs restarting by hand: PostgreSQL comes up on its
own, and `start-app.bat` handles the rest.

### Or start the pieces manually

```bash
cd backend  && npm run start:dev   # http://localhost:4000
cd frontend && npm run dev         # http://localhost:3000
```

### Tests

```bash
cd backend  && npm test            # unit tests
cd backend  && npm run test:e2e    # integration tests (needs the database)
cd frontend && npm test            # frontend unit tests
cd frontend && npx playwright test # browser smoke tests (needs both servers up)
```

### Setting up on a new machine

Install **Node.js 20+** and **PostgreSQL 17**, then:

```bash
git clone <your repo url>
cd shipment-tracker
cd backend && npm install && npx prisma migrate deploy && npx prisma db seed
cd ../frontend && npm install
```

Point `backend/.env`'s `DATABASE_URL` at your PostgreSQL instance (user, password
and port), then run the two dev servers as above.

### Docker

`docker-compose.yml` is **kept for CI and for reproducing the full stack from
scratch** — it is no longer used for day-to-day development. If you do use it,
start only the database (`docker compose up -d db`); bringing up `api` and `web`
too would occupy ports 4000 and 3000 and collide with the locally-run servers.

