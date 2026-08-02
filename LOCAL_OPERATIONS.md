# 本地运营手册

**适用场景：** 在这台 Windows 电脑上，用这套系统跑真实的货代业务。
**最后更新：** 2026-08-03

---

## 1. 每天怎么开工

**双击 `start-app.bat`** —— 检查数据库 → 启动前后端 → 自动打开浏览器。冷启动约 **18 秒**。

登录：`admin@erp.local` / `Admin@123`（或你自己的账号 `mbtbrandon@gmail.com`）

收工：**双击 `stop-app.bat`**，或直接关掉那两个日志窗口。

> **数据库不用管。** PostgreSQL 17 是 Windows 服务，开机自启、常驻后台，闲置几乎不占资源。关电脑前不需要做任何事。

### 系统由三部分组成

| 组件 | 怎么跑的 | 端口 |
|---|---|---|
| PostgreSQL 17 | Windows 服务 `postgresql-17`（开机自启） | **5433** |
| 后端 NestJS | `start-app.bat` 启动，热重载 | 4000 |
| 前端 Next.js | `start-app.bat` 启动，热重载 | 3000 |

> **为什么是 5433 不是 5432？** 你的 WSL 里跑着一个 Postgres（Supabase 本地开发栈）占用了 5432。两边完全独立，互不干扰。

---

## 2. 备份 —— 最重要的一节

真实业务数据只存在这台电脑上。**硬盘坏了 = 全没了**，除非有备份。

### 已经帮你配好的

- **每天中午 12:30 自动备份**（Windows 计划任务 `ShipmentTracker-DailyBackup`）
- 备份保留最近 **30 份**，旧的自动删除
- 存放位置：`Brandon Coding Project\db-backup\`
  —— 这个目录在 **OneDrive 同步范围内**，所以备份会自动上云。**这是有意的**：本地硬盘挂了还能从 OneDrive 恢复。

### 手动备份（重要操作前建议先跑一次）

双击 **`backup-db.bat`**，或命令行 `node scripts/backup-db.js`。

### 恢复

```bash
node scripts/restore-db.js
```
先列出所有可用备份，然后：
```bash
node scripts/restore-db.js logistics_erp-20260803013045.sql --yes
```

> **恢复会清空当前数据库再导入**，所以它做了两道保险：不加 `--yes` 绝不执行；执行前**先自动备份当前状态**，万一恢复错了文件还能回来。

### 检查备份是否正常

```bash
node scripts/restore-db.js
```
看最上面一条的日期。**如果不是今天或昨天，说明计划任务没跑，要去查**（任务计划程序 → `ShipmentTracker-DailyBackup`）。

---

## 3. 让邮件真的发出去

**现在是模拟模式** —— 报价单、发票、对账单、催款邮件都只是"composed and logged"，**并没有真的发给客户**。界面上会诚实地告诉你这一点。

要真发，在 `backend\.env` 里加上：

```
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="你的邮箱@gmail.com"
SMTP_PASS="应用专用密码"
SMTP_FROM="Golden Freight Logistics <你的邮箱@gmail.com>"
```

改完**重启后端**（关掉 Backend 窗口，重跑 `start-app.bat`）。

> **Gmail 注意**：不能用登录密码，要去 Google 账号 → 安全性 → 两步验证 → **应用专用密码** 生成一个 16 位密码。
> 用公司自己的邮箱服务器的话，把 host/port 换成服务商给的值即可。

`.env` 不会被提交到 git（已在 `.gitignore` 里），密码不会外泄。

---

## 4. 上传的文件存在哪

`backend\uploads\`（工单文档、提单扫描件等）。

这个目录**在 OneDrive 同步范围内**，等于自动有了一份云端副本 —— 对本地运营来说是好事。

> **注意**：如果以后文件量很大（几个 GB），OneDrive 同步可能变慢。到那时可以把 `backend\.env` 里的 `UPLOAD_DIR` 改成一个不同步的路径（例如 `D:\erp-uploads`），但记得**那样就要自己另外备份这个目录**。

### 关于 Cloudflare R2

之前的文档一直把「R2 存储切换」列为上线前必做项。**本地运营不需要做这件事。**

R2 是为了解决 **Render 云端部署**的问题：那边的磁盘是临时的，每次重新部署上传的文件都会丢。本地磁盘没有这个问题，文件会一直在。

`STORAGE_DRIVER` 保持默认（local）即可。哪天真要部署到云上再说。

---

## 5. 清掉演示数据，开始录真实数据

系统里现在还混着种子演示数据（Sunrise Electronics、Golden Harvest 等）。

**先看会删什么（只读，安全）：**
```bash
node scripts/clear-demo-data.js
```

**确认无误后执行：**
```bash
node scripts/clear-demo-data.js --yes
```

这个脚本会：
- 删除演示客户及其全部报价/工单/发票/收付款记录
- **保留你自己录的数据**（目前是 CUST-0003 FORWARD LOGISTICS）
- **自动保留被你的记录引用的演示供应商** —— 例如 VEN-0002 BlueOcean 正被你的报价单 QT-2026-0015 引用，脚本会保留它并告诉你原因，而不是删掉后弄坏你的单子
- 不动：用户、角色权限、服务目录、汇率、系统设置、公司资料、单据编号序列
- **执行前自动完整备份**

> 演示用户 `sales@erp.local`（Sarah Sales）脚本不会删。要停用的话去 **设置 → Users → Disable**，不建议删除（历史单据上还挂着她的名字）。

---

## 6. 汇率 —— 不配好会卡住开票

**设置 → Exchange Rates**

信用管控是「算不出来就拒绝」的设计。客户只要有一张外币发票而系统里没有对应汇率，**这个客户所有发票都开不出来**。

所以：**接到新币种的单子，先去设置里把汇率加上。**

一条汇率的含义是「1 [左边] = [数值] [右边]」，而且**必须有一边是本位币 MYR**，否则系统用不上（列表里会标 `Never used` 提醒你）。

---

## 7. 出问题时

| 症状 | 怎么办 |
|---|---|
| 登录页打不开 | 看 `start-app.bat` 是否跑过；两个日志窗口是否还开着 |
| 提示数据库连不上 | 管理员终端跑 `net start postgresql-17` |
| 端口被占 | 跑 `stop-app.bat` 清干净，再 `start-app.bat` |
| 开票被拒说汇率缺失 | 设置 → Exchange Rates 加上该币种 |
| 邮件没发出去 | 正常 —— 未配 SMTP 时是模拟模式，见第 3 节 |
| 想回到某天的数据 | `node scripts/restore-db.js` 看备份列表 |

### 查日志

后端日志在那个「Backend - Shipment Tracker」窗口里，也写在 `backend\logs\`（`error.log` / `combined.log`）。

---

## 8. 定期该做的事

| 频率 | 事项 |
|---|---|
| 每天 | 正常用就行，备份自动跑 |
| 每周 | 跑一次 `node scripts/restore-db.js` 看看最新备份日期对不对 |
| 每月 | 确认 OneDrive 真的把 `db-backup` 同步上去了（网页版 OneDrive 里看一眼） |
| 换电脑时 | 见 `README.md` 的「Setting up on a new machine」，把最新备份恢复过去 |

---

## 9. 目前的已知限制

这些不影响日常使用，但你应该知道：

- **AR 收款不能冲销** —— 收错款目前只能作废发票重开。（AP 应付那边可以冲销。）
- **客户/供应商文档只能贴链接**，不能上传文件（工单文档可以上传）。
- **订舱单和对账单没有 PDF**（报价单、发票、贷记单、借记单有）。
- **订舱、贷记单、借记单、运价列表没有 Excel 导出**（其余列表都有）。

完整清单和优先级见 `SYSTEM_COMPLETENESS_AUDIT.md`。
