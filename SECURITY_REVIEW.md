# 安全评审 — 依赖漏洞适用性判定 + 网络暴露面

**日期：** 2026-08-08
**触发：** `SOLUTION_PLAN.md` §2.3 第 1 条 —— "逐条确认系统是否命中触发条件，别让它只是挂在 audit 报告里没人看"
**结论摘要：** 依赖漏洞**绝大多数不适用**于本系统的实际用法；但核查过程中发现了一个**真实且已被利用条件齐备**的问题：**API 和前端监听在所有网卡上，在公共 WiFi 下同网段任何设备都能访问这套 ERP**。已修复并实测验证。

---

## 0. 本次评审最重要的发现（不是 CVE）

### 🔴 已修复：ERP 在局域网上是公开可访问的

核查 CVE 时必须先回答一个前置问题：**"攻击者够得着这个应用吗？"** 查下来答案是**够得着**。

**实测证据（修复前）：**

```
后端监听地址        ::            ← 所有网卡，不是仅本机
Wi-Fi 网卡地址      192.168.1.21  （Maxis_HomeWIFI_7391_5Ghz）
网络类别            Public
Node.js 防火墙规则   Allow / Public + Private / TCP+UDP / 所有端口

http://192.168.1.21:4000/api/health/live   → HTTP 200
http://192.168.1.21:4000/api/auth/login    → 接口可达并正常处理请求
```

**根因：** `backend/src/main.ts` 里是 `app.listen(port)`，没有指定绑定地址。Express 默认绑定所有网卡。前端 `next dev` 同理。

**为什么这件事严重：**

1. 这台笔记本会连**公共 WiFi**（咖啡厅、机场、酒店）。当前家里的 WiFi 已经被 Windows 归类为 `Public`，而 Node.js 的防火墙规则**恰恰放行了 Public**，等于把最后一道防线也让开了。
2. 暴露的不只是页面，是**整套 API**，包含 `/api/auth/login`。
3. **CORS 在这里完全帮不上忙**——CORS 是浏览器的约定，不是网络访问控制。任何非浏览器客户端（curl、Postman、脚本）直接无视它。
4. 系统里存的是**真实客户资料、报价、发票、信用额度**。

**修复：**

| 位置 | 改动 |
|---|---|
| `backend/src/main.ts` | `app.listen(port)` → `app.listen(port, host)`，`host = process.env.HOST \|\| '0.0.0.0'` |
| `backend/.env` | 新增 `HOST="127.0.0.1"` |
| `frontend/package.json` | `dev` 脚本加 `-H 127.0.0.1` |

**默认值保持 `0.0.0.0` 是刻意的**：Docker 容器和 Render 这类 PaaS 必须绑定所有网卡才能接到转发进来的流量，改默认值会让部署直接挂掉。**单机安装通过 `.env` 显式收窄**，这样两种场景都对。

`frontend` 的 `start` 脚本**没有**改（容器和云端跑的就是它，需要绑所有网卡）。

**修复后实测：**

```
监听地址      127.0.0.1:3000  /  127.0.0.1:4000
http://192.168.1.21:3000/  → 已阻断
http://192.168.1.21:4000/  → 已阻断
http://localhost:3000/login      → HTTP 200
http://localhost:4000/api/health/live → HTTP 200
```

> **实施中踩到的坑（记录备查）：** 第一版把脚本写成 `-H ${HOST:-127.0.0.1}`。这是 bash 语法，而 Windows 上 npm 脚本走 `cmd.exe`，字符串被**原样**传给 Next.js，于是它拿 `${HOST:-127.0.0.1}` 去做 DNS 解析并崩溃（`ENOTFOUND`）。改用字面量解决。`start` 脚本里原本就存在的 `${PORT:-3000}` 之所以一直没出事，是因为它只在 Linux 容器里执行，从没在 Windows 上跑过。

---

## 1. Next.js 漏洞逐条判定

`npm audit` 汇总只显示"2 高"，展开后实际有 **21 条**公告。当前版本 **14.2.20**，落在几乎全部公告的影响范围内。

**本应用的关键特征**（判定依据）：

| 特征 | 事实 |
|---|---|
| 路由模式 | 纯 App Router，**无** `src/pages`（无 Pages Router） |
| Server Actions | **完全未使用**（全仓库无 `'use server'`） |
| `next/image` | **完全未使用**，且 `next.config.mjs` **未配置** `images` / `remotePatterns` |
| middleware | **不存在** |
| rewrites | **未配置**（API 代理改用 route handler，`next.config.mjs` 有注释说明） |
| i18n | 未配置 |
| CSP nonce | 未使用 |
| `beforeInteractive` 脚本 | 未使用 |
| WebSocket 升级 | 未使用 |
| 渲染方式 | 43 个文件带 `'use client'`，25 个 page/layout —— 压倒性客户端渲染 |

**判定结果：**

| 公告 | 严重度 | 判定 | 依据 |
|---|---|---|---|
| Image Optimizer remotePatterns DoS | 中 | ❌ **不适用** | 未使用 `next/image`，未配置 `images` |
| next/image 磁盘缓存无限增长 | 中 | ❌ **不适用** | 同上 |
| Image Optimization API DoS | 中 | ❌ **不适用** | 同上 |
| RSC HTTP 请求反序列化 DoS | 高 | ⚠️ **理论适用** | App Router 即使不用 Server Actions 仍会响应 RSC 导航负载 |
| Server Components DoS（2 条） | 高 | ⚠️ **理论适用** | 同上 |
| App Router Server Actions DoS | 高 | ❌ **不适用** | 无 Server Actions |
| Server Actions SSRF（自定义服务器） | 高 | ❌ **不适用** | 无 Server Actions |
| Edge runtime Server Action 负载无上限 | 中 | ❌ **不适用** | 无 Server Actions，未用 Edge runtime |
| Server Function 端点未授权泄露 | 中 | ❌ **不适用** | 无 Server Functions |
| rewrites 请求走私 | 中 | ❌ **不适用** | 未配置 rewrites |
| rewrites SSRF（攻击者控制目标主机名） | 高 | ❌ **不适用** | 未配置 rewrites |
| Pages Router + i18n 中间件绕过 | 高 | ❌ **不适用** | 无 Pages Router，无 i18n |
| Middleware/Proxy 重定向缓存投毒 | 低 | ❌ **不适用** | 无 middleware |
| CSP nonce XSS | 中 | ❌ **不适用** | 未使用 CSP nonce |
| `beforeInteractive` 脚本 XSS | 中 | ❌ **不适用** | 未使用 |
| WebSocket 升级 SSRF | 高 | ❌ **不适用** | 未使用 WebSocket |
| RSC 响应缓存投毒（2 条） | 中/低 | ⚠️ **理论适用** | 需要中间缓存层；本地单机部署无 CDN/反代 |
| 请求体缓存混淆（2 条） | 中 | ⚠️ **理论适用** | 同上，需要缓存层 |

**小结：** 21 条里 **14 条明确不适用**，7 条理论适用但全部是 **DoS 或缓存投毒**类，且：

- **无远程攻击者**——修复后服务只监听 `127.0.0.1`
- **无缓存层**——本地单机运行，没有 CDN 或反向代理，缓存投毒类需要的前置条件不存在
- **DoS 的后果是"你自己的服务卡住"**，重启即可，不涉及数据泄露或篡改

**结论：** 在**当前本地单机 + 仅监听回环**的部署形态下，Next.js 这批漏洞**不构成实际风险**。

> ⚠️ **但这个结论是有条件的。** 一旦把这套系统部署到公网（Render、VPS、或给客户用的 Portal），上面 7 条"理论适用"立刻变成真实风险，**必须先升级 Next.js 再上线**。修复版本是 **15.5.21**（多数）/ 16.x。这是一个跨两个大版本的升级，需要单独排期和回归测试（`PRODUCT_BACKLOG.md` T-5）。

---

## 2. PostCSS 判定

| 公告 | 严重度 | 判定 |
|---|---|---|
| `</style>` 未转义导致 XSS | 中 | ❌ **不适用** |
| sourceMappingURL 任意文件读取 | 高 | ❌ **不适用** |
| sourceMappingURL 路径穿越读取 .map | 高 | ❌ **不适用** |
| sourceMappingURL 不完整修复 | 中 | ❌ **不适用** |

**依据：** PostCSS 在本项目里只做一件事——**构建期**跑 Tailwind + autoprefixer，处理的是**项目自己的 CSS 源文件**。四条公告的共同前提都是"处理攻击者可控的 CSS"，而本系统**任何时候都不接受用户提供的 CSS**。运行时不存在 PostCSS。

（版本记录：项目自身 devDependency `postcss@8.5.16`，Next.js 内嵌另一份 `8.4.31`。两者都在影响范围内，但如上所述前提不成立。）

---

## 3. 后端依赖判定

| 包 | 公告 | 严重度 | 判定 |
|---|---|---|---|
| `@nestjs/core` | 特殊字符未中和（注入类） | 中 | ⚠️ **待跟进** —— 影响范围 `<=11.1.17`，**当前 11.x 最新版也未修复**，无版本可升。已是 10.x 系列最新（10.4.22） |
| `brace-expansion` | ReDoS / 内存耗尽（4 条） | 高 | ❌ **不适用** |
| `uuid` (经 `exceljs`) | v3/v5/v6 buffer 越界检查缺失 | 中 | ❌ **不适用** |

**`brace-expansion` 依据：**

> **更正 `SOLUTION_PLAN.md` 的一处说法。** 那份文档说它来自"开发工具链"，**这是错的**。实际依赖路径是运行时的：
> ```
> exceljs@4.4.0 → archiver@5.3.2 → glob@7.2.3 → minimatch@3.1.5 → brace-expansion@1.1.15
> ```
> 但判定结果不变——**不适用**：这条链上的 glob 模式由 `archiver` 打包 xlsx 时内部生成，**不接受用户输入**。触发 ReDoS 需要攻击者能控制 glob 模式字符串，本系统没有这个入口。

**`uuid` 依据：** 越界检查缺失只在**调用方自行传入 `buf` 参数**时才可能触发。`exceljs` 内部调用不传 `buf`。

**`@nestjs/core` 依据：** 这是唯一一条**没有可用修复版本**的。影响范围写的是 `<=11.1.17`，而 NestJS 最新就是 11.1.28——说明公告发布时尚无修复版本，或影响范围标注偏宽。**处置：留在跟踪清单里，等上游发布修复版本后升级**，不因它单独启动大版本迁移。

---

## 4. 处置清单

| 项目 | 状态 |
|---|---|
| 服务收回回环地址（后端 + 前端 dev） | ✅ **已修复并实测验证** |
| Next.js 21 条公告逐条判定 | ✅ 完成 —— 当前形态不构成实际风险 |
| PostCSS 4 条判定 | ✅ 完成 —— 不适用（仅构建期，不处理不可信 CSS） |
| 后端 3 类判定 | ✅ 完成 —— 2 类不适用，1 类无修复版本待跟进 |
| `@nestjs/core` 注入类公告 | ⬜ **跟踪中** —— 等上游修复版本 |
| Next.js 升级至 15.5.21+ | ⬜ **公网部署前必做**，本地运行不阻塞 |

---

## 5. 一句话总结

**依赖扫描报出来的 30 条漏洞，逐条核对下来绝大多数不适用于本系统的实际用法**——不用 `next/image`、不用 Server Actions、不用 middleware、不处理外来 CSS、不接受外来 glob 模式。**但核查过程中发现的真问题不在扫描报告里**：这套装着真实客户财务数据的 ERP，此前在公共 WiFi 下对同网段所有设备开放，包括登录接口。这一条已修复。

**给未来的自己一句提醒**：上面那句"不构成实际风险"的前提是**只监听回环**。哪天要部署到公网，先回来读第 1 节的黄框。
