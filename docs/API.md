# API Reference — Logistics ERP

Base URL: `/api` · Auth: `Authorization: Bearer <JWT>` (from `/auth/login`) · All requests/responses JSON unless noted.
Every route enforces a permission code (`module.read` / `module.write`); Administrator bypasses all checks.

## Auth
| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | `{email, password}` → `{accessToken, user{permissions[]}}` |
| GET | `/auth/me` | Current user from token |

## Users & Roles (`users.*`)
| Method | Path | Description |
|---|---|---|
| GET/POST | `/users` | List / create users |
| PATCH | `/users/:id` | Update name, role, active flag, password |
| GET | `/roles` | Roles with permissions and user counts |
| GET | `/roles/permissions` | All permission codes |
| POST | `/roles` | Create custom role |
| PUT | `/roles/:id/permissions` | Replace a role's permission set (configurable RBAC) |

## Customers (`customers.*`)
| Method | Path | Description |
|---|---|---|
| GET | `/customers?search&status&page&pageSize` | Paged list with **calculated** totalRevenue / totalProfit / lastQuotation / rating |
| GET | `/customers/ranking` | Automatic ranking (revenue 40 + profit 40 + rating 20) |
| GET | `/customers/:id` | Detail + rating history + stats |
| POST/PATCH/DELETE | `/customers[/:id]` | CRUD (code auto-generated: CUST-0001) |

## Vendors (`vendors.*`) — same shape as customers
`GET /vendors`, `GET /vendors/ranking` (rating 50 + spend 30 + preferred 20), `GET /vendors/:id`, `POST/PATCH/DELETE`.

## Services (`services.*`)
`GET/POST /services`, `PATCH/DELETE /services/:id` — unlimited service catalog.

## Vendor Rates (`rates.*`)
| Method | Path | Description |
|---|---|---|
| GET | `/rates?vendorId&serviceId&search&page` | Paged rate list |
| GET | `/rates/compare?serviceId&origin&destination&country&sort&includeExpired&date` | **Vendor comparison**: cost, rating, preferred, weighted score + recommendation. `sort` = cost / rating / preferred (default: best score). `includeExpired=true` = historical comparison. |
| POST/PATCH/DELETE | `/rates[/:id]` | CRUD. Rate types: FIXED, PER_KG, PER_CBM, PER_TON, PER_TRIP, PER_CONTAINER, PER_SHIPMENT, PER_HOUR, PER_DAY |

## Quotations (`quotations.*`)
| Method | Path | Description |
|---|---|---|
| GET | `/quotations?status&customerId&salesPersonId&from&to&search` | Paged list |
| GET | `/quotations/:id` | Header + items + linked jobs |
| POST | `/quotations` | Create — runs the **costing engine** (fx conversion, min charge, markup or direct sell, discount %/amt, service charge %, misc, tax) and persists all totals. Number auto: QT-YYYY-0001 |
| PUT | `/quotations/:id` | Replace items and re-cost (blocked once WON/LOST/CANCELLED) |
| PATCH | `/quotations/:id/status` | DRAFT / SENT / WON / LOST / CANCELLED |
| POST | `/quotations/:id/convert` | **Quotation → Job**: creates JOB-YYYY-0001, copies commercials, detects primary vendor, marks quote WON |
| DELETE | `/quotations/:id` | Delete |

## Jobs (`jobs.*`)
`GET /jobs?status&customerId&vendorId&origin&destination&search`, `GET /jobs/:id`, `POST/PATCH/DELETE`, plus
`POST /jobs/:id/documents` and `DELETE /jobs/documents/:docId`. Profit auto-recalculated from actuals.

## Ratings (`ratings.*`)
| Method | Path | Description |
|---|---|---|
| POST | `/ratings/vendor` | 6 KPI scores (price, serviceQuality, communication, deliveryPerformance, reliability, responseSpeed) → weighted overallScore |
| POST | `/ratings/customer` | 6 KPI scores (paymentSpeed, profitability, repeatBusiness, communication, complaintHistory, businessPotential) |
| GET | `/ratings/vendor/:vendorId` · `/ratings/customer/:customerId` | Rating history |

Weights configurable via settings keys `rating.vendor.weights` / `rating.customer.weights`.

## Analytics
| Method | Path | Description |
|---|---|---|
| GET | `/dashboard/summary` (`dashboard.read`) | Revenue, GP, margin, win rate, counts, 12-month trend, top customers/vendors, revenue by service & sales person |
| GET | `/pnl?groupBy=month\|quarter\|year\|customer\|vendor\|salesperson\|service&from&to&source=quotes\|jobs&customerId&vendorId&salesPersonId&serviceId` (`reports.read`) | P&L rows + totals |

## Reports (`reports.read`) — CSV export
`GET /reports/:type/export` where type ∈ `quotations, vendors, customers, pnl, vendor-comparison, customer-profitability, sales, revenue, gross-profit`. Filter params pass through (e.g. `?groupBy=month&from=&to=`, vendor-comparison requires `serviceId`).

## Notifications (`notifications.read`)
`GET /notifications?unread=true`, `POST /notifications/scan` (generates deduped alerts: quotation expiry, vendor rate expiry, job delay, low margin, high cost, payment due), `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`.
Thresholds configurable: `alerts.quotationExpiryDays`, `alerts.rateExpiryDays`, `alerts.lowMarginPct`, `alerts.highCostAmount`.

## FX & Settings (`settings.*`)
`GET/POST/DELETE /fx` — currency pairs with effective dates (used by the costing engine).
`GET /settings`, `PUT /settings/:key` — JSON config store (rating weights, alert thresholds, `quotation.defaults`, `recommendation.weights`, company profile).
