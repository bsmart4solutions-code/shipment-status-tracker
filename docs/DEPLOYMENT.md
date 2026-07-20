# Deployment Guide — Logistics ERP

## 1. Quick start with Docker (recommended)

Prerequisites: Docker + Docker Compose.

```bash
# from the repository root
export JWT_SECRET="$(openssl rand -hex 32)"   # strong secret for production
export DB_PASSWORD="a-strong-db-password"

docker compose up -d --build

# first run: seed roles, permissions, admin user, service catalog + demo data
docker compose exec api npx prisma db seed
```

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| REST API | http://localhost:4000/api |
| PostgreSQL | localhost:5432 (`erp` / `$DB_PASSWORD` / db `logistics_erp`) |

Default login after seeding: **admin@erp.local / Admin@123** — change it immediately (Settings → Users).

### Environment variables

| Variable | Service | Default | Notes |
|---|---|---|---|
| `DB_PASSWORD` | db, api | `erp_dev_pw` | Postgres password |
| `JWT_SECRET` | api | `change-me-in-production` | **Must** be overridden in production |
| `JWT_EXPIRES_IN` | api | `8h` | Token lifetime |
| `BASE_CURRENCY` | api | `MYR` | Dashboard/P&L aggregation currency |
| `WEB_ORIGIN` | api | `http://localhost:3000` | CORS allow-list (comma-separated) |
| `API_URL` | web | `http://api:4000` | Where Next.js proxies `/api/*` |

## 2. Local development (no Docker)

```bash
# PostgreSQL 16 running locally, then:
cd backend
cp .env.example .env               # adjust DATABASE_URL
npm install
npx prisma migrate dev             # creates schema
npx prisma db seed                 # roles, admin, demo data
npm run start:dev                  # API on :4000

cd ../frontend
npm install
npm run dev                        # web on :3000 (proxies /api to :4000)
```

Run backend tests: `cd backend && npm test` (costing engine unit tests).

## 3. Production checklist

- [ ] Set a unique `JWT_SECRET` and strong `DB_PASSWORD`
- [ ] Put the stack behind HTTPS (reverse proxy: Caddy / nginx / Traefik)
- [ ] Restrict `WEB_ORIGIN` to your real domain
- [ ] Schedule `POST /api/notifications/scan` (cron or scheduler container) every 15–60 min so expiry/delay/margin alerts stay fresh
- [ ] Back up the `pgdata` volume (e.g. `pg_dump` nightly)
- [ ] Change the seeded admin password; create per-person accounts with least-privilege roles
- [ ] Review `settings` keys (tax defaults, rating weights, alert thresholds) for your business

## 4. Database migrations

Migrations live in `backend/prisma/migrations` and are applied automatically on API container start (`prisma migrate deploy`). To create a new migration during development:

```bash
cd backend
npx prisma migrate dev --name describe_your_change
```

## 5. Scaling notes

- The API is stateless — run multiple replicas behind a load balancer; sequences use row-level locks so auto-numbering stays unique.
- Heavy report queries can move to a read replica by pointing a second `DATABASE_URL` at it (introduce a `PrismaReadService`).
- The Next.js app is a standalone Node server; static assets can be pushed to a CDN.

## 6. Document storage (Sprint 02)

Uploaded binaries go through a pluggable storage driver — see `STORAGE.md` for
the full design. In production set `STORAGE_DRIVER=s3` plus `S3_ENDPOINT`,
`S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (Cloudflare R2 values;
`STORAGE.md` §3 has the step-by-step). Without them the app falls back to the
local driver — on Render's ephemeral disk that means uploads are lost on every
deploy, so treat the R2 variables as required in production. To move existing
local files into the bucket run `npx ts-node scripts/migrate-uploads-to-s3.ts --apply`.
