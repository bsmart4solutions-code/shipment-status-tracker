# QI-Net Sea Freight & Forwarding System 🚢

A complete freight forwarder management system in a **single HTML file** — no backend, no build step, no install. Open `index.html` in any modern browser and start working. Data is stored locally in the browser (sql.js SQLite + localStorage).

一个完整的货代管理系统，只有**一个 HTML 文件**——无需后端、无需构建、无需安装。用浏览器打开 `index.html` 即可使用。数据保存在浏览器本地（sql.js SQLite + localStorage）。

> Tip: open **Settings → Load Sample Data** to explore the system with demo records.
> 提示：打开 **Settings → Load Sample Data** 可载入演示数据快速体验。

## Modules 功能模块

| Module | Highlights |
|---|---|
| **Dashboard** | Job stats, status/shipment-type/volume/top-customer charts, upcoming ETAs, activity feed |
| **Job Sheets** 工作单 | Sea Export & Sea Import job sheets; 7 shipment types (FCL / LCL / Consolidation / Air / Conventional / Tanker / Tug-Barge); parties (shipper, consignee, notify, agent, forwarding agent, co-loader, haulier, transporter); MBL/HBL/DO auto-numbering; SI/CY/VGM cutoffs; job lock/unlock; attachments; status timeline |
| **Document Checklist** 单证 | Auto-generated per job type — Export: Booking Confirmation, B/L, COO, IED, Shipping Note, Container Request, Container/Attach List, SI (Master & House), R.O.T, D/O, Pre-Alert, Freight/Cargo Manifest, Consolidated List · Import: Arrival Notice, D/O, IID, Container/Attach List, Correction Manifest, R.O.T, Cargo Manifest. All printable with/without letterhead; Arrival Notice with/without charges |
| **Job Costing** 成本核算 | Billing & cost charge lines per job, per-job P&L, printable Job Costing Sheet and P&L Analysis Report |
| **Quotations** 报价 | Quote → one-click convert to job, win-rate tracking, printable quotation |
| **Traders** 往来单位 | 16 categories (Actual Shipper, Agent, Shipping Line, Vendor, Haulier, Warehouse…), multi-contact, multi-address, billing currency, document attachments |
| **Billing System** 账务 | Tax Invoice / Debit Note / Credit Note; 6 independent running-number sets; charge templates; GST/SST tax; amount in words; two printing formats (detailed / simple); export CSV for SQL Accounting / AutoCount |
| **Payment System** 付款 | Payment / Payable / Incentive / Refund vouchers; cheque printing with amount in words |
| **Letter Generator** 信函 | L.O.A (Authorization) & L.O.I (Indemnity) templates auto-filled from job data, plus custom letters |
| **Track a Shipment** 追踪 | Lookup by job no, MBL/HBL or container no with status timeline |
| **Reports** 报表 | 30+ monthly & 10 yearly reports — volume by type, B/L, carrier, salesman, coordinator, haulage, transporter, agent, consignee, co-loader, billing/payment analysis, tax, rebate, job P&L (by job / transaction date / project code), customer analysis, top customers, unbilled jobs, daily bookings… all exportable to Excel (CSV) and printable |
| **Users & Access** 用户权限 | Roles (Admin/Manager/Operator/Viewer) with per-menu access authority; user switcher in header |
| **Settings** 设置 | Company profile & logo, tax label/rate, billing number sets, charge templates, S.O.P editor (printable), full backup/restore |

## Data & Storage 数据存储

- All data lives in your browser's localStorage as a serialized SQLite database — nothing is sent to any server.
- **Export a backup regularly** (Settings → Export Full Backup); restoring a backup merges settings and replaces data.
- Attachments are stored inline (max 1 MB per file) — keep them small to stay within browser storage limits.

所有数据以 SQLite 数据库形式存放在浏览器 localStorage 中，不会上传到任何服务器。请定期在 Settings 中导出备份以防数据丢失。

## Tech 技术

Single-file app: Tailwind CSS (CDN) + [sql.js](https://github.com/sql-js/sql.js) (SQLite in WebAssembly) + Chart.js + Font Awesome. Requires internet access on first load for the CDN assets.
