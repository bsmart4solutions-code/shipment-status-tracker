# 系统完整性审查报告

**日期：** 2026-08-03（Sprint 06 / MVP GA 之后）
**范围：** 全部后端模块、全部前端页面、所有实体的可填字段、接口覆盖、测试覆盖
**方法：** 脚本化交叉比对（Prisma schema ↔ DTO ↔ 前端表单 ↔ 后端路由 ↔ 前端调用），逐条人工验证

---

## 0. 总体评价

**结构上没有大窟窿。** 交叉比对下来：

- 118 个后端路由，前端从未调用的只有 8 个，**且全部合理**（健康检查 4 个用于监控、`/auth/me`、2 个导入接口通过动态 endpoint 调用、报表导出走模板字符串）
- 字段级：客户 66 个字段、供应商 43 个、报价 38 个 —— **全部可填、全部有 DTO 校验**
- 被标记"客户端不能设置"的字段（编号、税额、总额、已付金额、毛利、审批人）**全部是正确的设计**：服务端计算或系统生成，本来就不该让前端传。这是防篡改，不是缺陷

问题集中在**少数几个"后端做了、前端没接"的地方**，其中一个有真实业务风险。

---

## 修复进度

| # | 项目 | 状态 |
|---|---|---|
| 1 | 汇率管理界面 | ✅ **已修复**（2026-08-03） |
| 2 | AR 收款冲销 | ⬜ 未开始 |
| 3 | 客户/供应商文件上传 | ⬜ 未开始 |
| 4 | 应付账款导出 | ✅ **已修复**（2026-08-03） |
| 5 | 订舱单/对账单 PDF | ⬜ 未开始 |
| 6 | 常用配置项专用表单 | ⬜ 未开始 |
| 7 | 报价单业务员选择器 | ✅ **已修复**（2026-08-03） |
| — | 11 个模块缺单元测试 | ⬜ 未开始 |

---

## 🔴 必须修（有业务风险）

### 1. ✅ 汇率只能看，不能加 —— 界面叫用户做一件界面不让他做的事

> **已于 2026-08-03 修复。** 设置页新增「Exchange Rates」区块：列出全部汇率（显示为「1 USD = 4.45 MYR」并标注生效日期）、新增、删除，接的是本来就存在的 `POST /fx` 和 `DELETE /fx/:id`。
>
> 另加了两处防呆：新增了 `GET /fx/base-currency` 让界面知道本位币；如果用户输入的两个币种**都不是本位币**（这种汇率 `toBase()` 永远用不到），列表里标「Never used」，表单里也会当场提示。
>
> **实测验证**（完整走了一遍死锁与解锁）：
> 1. 通过新界面加入 THB→MYR 汇率 → 泰铢发票信用检查 **ALLOW**
> 2. 删掉该汇率 → 信用检查 **BLOCK**，开票返回 **409**「add the rate…」← 复现了审查发现的死锁
> 3. 重新加回汇率 → 信用检查 **ALLOW**，发票 **201 开出**
>
> 死锁已打通。以下原始记录保留备查。

**这是本次审查最严重的发现。**

后端 `FxController` 有完整的增删接口：

```
GET    /api/fx        settings.read
POST   /api/fx        settings.write   ← 前端从未调用
DELETE /api/fx/:id    settings.write   ← 前端从未调用
```

前端**唯一**用到 `/fx` 的地方是报价页读取汇率做显示（`quotations/page.tsx:299`）。**全系统没有任何一个页面可以新增或修改汇率。**

而与此同时，界面上有 **4 处**在提示用户"汇率缺失，请添加汇率"：

| 位置 | 提示文字 |
|---|---|
| `invoices/credit-issue-dialog.tsx:100` | 「Credit cannot be evaluated: an exchange rate is missing. **Add the rate and try again.**」 |
| `customers/credit-panel.tsx:48` | 「Exchange rate missing… 信用无法评估，发票开立会被拒绝」 |
| `customers/statement-panel.tsx:52` | 「Exchange rate missing」 |
| `jobs/cost-panel.tsx:46` | 「成本差异因汇率缺失无法计算」 |

**业务后果**：Sprint 04 的信用管控是**fail-closed（缺汇率就拒绝开票）**设计。一旦客户有一张外币发票而系统里没有该币种汇率：

1. 该客户**所有发票都开不出来**
2. 界面告诉用户「加上汇率再试」
3. **但用户在系统里找不到任何地方加汇率**
4. 唯一出路是直接写数据库或用 API 工具

目前库里有 5 条汇率（USD/SGD/EUR/CNY→MYR, MYR→USD）。**只要接到一单用了这 5 种之外的币种，就会卡死。**

**修法**：在设置页加一个「Exchange Rates」区块（列表 + 新增 + 删除），接现成的 `POST /fx` 和 `DELETE /fx/:id`。后端不用动。**工作量：S（半天）**。

---

### 2. AR 收款不能冲销（AP 可以）

`payables.service.ts` 有 `reversePayment()`，带行锁、幂等保护、审计。
`invoices.service.ts` **没有对应实现**。

`invoices.service.cancel()` 遇到已收款的发票只会说「reverse the payments first」，**但系统没有提供任何冲销收款的接口**。

**业务后果**：收错款、录错金额、客户退款时，唯一办法是作废发票重开 —— 破坏发票号连续性，SST 申报的凭证链断掉。

这条 `TODO.md`「Sprint 03 follow-ups」里已经记录（*"AR payment reversal — AP now has it; AR still tells users to reverse the payments first with no endpoint to do so"*），但一直没排期。

**修法**：把 AP 的 `reversePayment` 模式移植到 AR —— 行锁、`reversedAt` 幂等、强制填原因、审计、状态回退走独立的 reversal 边（`assertVendorBillReversal` 的对应物）。**工作量：M**。

---

## 🟠 应该补（功能不完整，但有替代路径）

### 3. 客户/供应商文档只能贴链接，不能上传文件

| | 能上传文件 | OCR | 存储 |
|---|---|---|---|
| Job 文档 | ✅ | ✅ | 对象存储（R2/本地），有 mimeType / sizeBytes |
| 客户文档 | ❌ 只有 `link` 字段 | ❌ | 无 |
| 供应商文档 | ❌ 只有 `link` 字段 | ❌ | 无 |

`CustomerDocument` / `VendorDocument` 模型只有 `name / category / link / notes`。营业执照、税务登记证、信用申请表这些客户资料，只能贴一个外部链接（Google Drive 之类），**文件本身不在系统里**。

Job 文档那套上传+存储+OCR 的基础设施已经写好了，扩展到客户/供应商是复用，不是新建。**工作量：M**。

### 4. ✅ 五个列表页没有导出（应付账款已补）

> **应付账款已于 2026-08-03 补上导出。** 导出列特意包含**供应商自己的发票号**和**未付余额**，因为财务是拿供应商对账单来核的，光有我们内部的 BILL 号对不上。
> 剩余 4 个（订舱、贷记单、借记单、运价）仍未做。

| 有导出 | 没有导出 |
|---|---|
| 报价、工单、发票、客户、供应商 | **应付账款、订舱、贷记单、借记单、供应商运价** |

应付账款没有导出比较要命 —— 财务对账时最需要导出的就是这个。**工作量：S**（`exportToXlsx` 是现成工具函数，每页加十几行）。

### 5. 三类单据没有打印/PDF

有打印页的：报价、发票、贷记单、借记单
**没有的：订舱单（Booking）、工单（Job）、对账单（SOA）**

- **订舱单**要发给承运人确认，现在只能截图或口头
- **对账单**是 Sprint 05 刚做的，只能在网页看和发邮件，客户要 PDF 存档的话给不了

**工作量：M**（打印页模板是现成的，套用即可）。

### 6. 系统配置只能编辑原始 JSON

设置页的「System Configuration」是一个 key/value 表格，编辑时弹出一个 **textarea 让用户手写 JSON**。

后端实际会读取的 9 个配置项：
```
alerts.highCostAmount        alerts.lowMarginPct
alerts.quotationExpiryDays   alerts.rateExpiryDays
approval.quotation.thresholdBase
quotation.defaults           rating.customer.weights
rating.vendor.weights        recommendation.weights
```

功能上能改（JSON 格式错误会拦），但要求用户知道每个 key 的 JSON 结构。**报价审批阈值**（`approval.quotation.thresholdBase`）这种业务上常调的参数，藏在原始 JSON 里不合适。

**修法**：给这几个高频项做专门的表单控件，其余保留 JSON 编辑作为兜底。**工作量：S–M**。

### 7. ✅ 报价单不能指派给别的业务员

> **已于 2026-08-03 修复。** 报价表单加了业务员选择器，留空 = 自己（保持原有默认行为不变），可选任意在职用户。只有持有 `users.read` 的人才看得到这个字段；没有该权限时字段隐藏，服务端「默认当前用户」的行为原样生效。编辑已有报价也能改派——服务端 `update` 本来就是 `dto.salesPersonId ?? existing.salesPersonId`，已确认。

**先说清楚：这不是 bug。** `quotations.service.create` 里是 `salesPersonId: dto.salesPersonId ?? userId ?? null` —— 不传就默认是当前登录用户，库里 6/6 张报价都有业务员，仪表盘的「按业务员统计收入」也是正常的。

缺的只是：**表单上没有业务员选择器**，所以无法「以他人名义建单」或「离职后转派」。经理替业务员建单、或人员变动时重新归属，现在做不到（只能改数据库）。

**工作量：S**（表单加一个 SearchableSelect，DTO 已经接受这个字段）。

---

## 🟡 工程质量：11 个模块的 service 没有单元测试

| 有测试 | **无测试** |
|---|---|
| bookings, credit-debit-notes, customers, documents, health, imports, invoices, payables, quotations | **auth, dashboard, jobs, notifications, pnl, rates, ratings, recycle-bin, roles, services-catalog, users, vendors** |

按风险排序，最该补的三个：

1. **`auth`** —— 全系统唯一的安全边界，负责登录、密码校验、账号锁定（`failedLoginAttempts` / `lockedUntil`）、JWT 签发。**零单元测试**。虽然集成测试会走登录路径，但锁定逻辑、失败计数、过期处理都没有被直接验证。
2. **`jobs`** —— Sprint 06 刚加了里程碑推进逻辑。里程碑状态机本身有测试（`state-machine.spec.ts`），但 `JobsService.advanceMilestone` 的服务层逻辑（取消的工单不能推进、事务里同时写 job 和 timeline）只有集成测试覆盖，没有单元测试。
3. **`pnl`** —— 涉及金额计算和汇率换算，而且 `TODO.md` 里记着它有「历史不稳定」的已知缺陷。没有测试就意味着修那个缺陷时没有安全网。

其余（roles/users/services-catalog/vendors/ratings/recycle-bin）多是薄 CRUD，优先级低。

---

## ✅ 检查下来确认没问题的

避免这份报告只有负面 —— 以下几项专门查过，是好的：

- **接口没有孤儿**：118 个路由，未被前端调用的 8 个全部合理（健康检查、监控、动态调用）
- **前端没有幽灵调用**：没有发现调用不存在接口的地方
- **金额字段防篡改**：`totalAmount` / `taxAmt` / `amountPaid` / `grossProfit` / `profit` 全部**不接受前端传值**，一律服务端计算。这是对的，很多系统在这里出漏洞
- **单据编号防篡改**：`invoiceNumber` / `quoteNumber` / `jobNumber` / `bookingNumber` / `noteNumber` / `billNumber` 全部由 `SequenceService` 加行锁生成，前端不能指定
- **审批字段防篡改**：`approvedById` / `approvedAt` / `approvalNote` 只能通过 approve 接口写入，不能在 update 里夹带
- **客户资料完整度高**：66 个字段（公司/联系人/地址/财务/销售/会计/物流/CRM/偏好/内部备注）全部可填且有校验，比多数商用 CRM 还细
- **权限模型干净**：`PERM` 常量 + 类型联合，写错权限码是编译错误而不是静默失效

---

## 建议修复顺序

| 优先级 | 项目 | 工作量 | 理由 |
|---|---|---|---|
| **1** | 汇率管理界面 | **S** | 唯一会导致「系统卡死且用户无法自救」的问题，半天就能修 |
| **2** | 应付账款导出 | **S** | 财务对账刚需，几十行代码 |
| **3** | 报价单业务员选择器 | **S** | 三个 S 一起做，一天能收掉 |
| **4** | `auth` 模块单元测试 | **S–M** | 唯一的安全边界，零测试不能接受 |
| **5** | AR 收款冲销 | **M** | 有业务风险但有替代路径（作废重开），且 AP 的实现可直接移植 |
| **6** | 订舱单 + 对账单 PDF | **M** | 对外交付物 |
| **7** | 客户/供应商文件上传 | **M** | 依赖 R2 存储切换先完成 |
| **8** | 常用配置项专用表单 | **S–M** | 体验问题，不影响功能 |

**前三项加起来大约一天**，能把「用户被卡住且无法自救」的风险清零。这是我建议的下一个动作。

---

## 附：审查方法

所有结论都来自可复现的比对，不是人工翻阅：

1. **路由覆盖**：解析所有 `@Controller` + `@Get/@Post/@Patch/@Put/@Delete` 装饰器得到 118 个路由，解析前端所有 `api()/downloadCsv()/uploadFile()` 调用得到 81 个端点，取差集
2. **字段覆盖**：解析 `schema.prisma` 提取 11 个模型的可填字段，分别在前端全部 `.tsx/.ts` 和后端全部 `.dto.ts` 里搜索，得出「界面填不了」和「API 不接受」两个清单，再逐条人工判断是缺陷还是有意设计
3. **人工验证**：每一条候选发现都回到源码确认（例如业务员那条，一开始判为缺陷，查到 `?? userId` 兜底后降级为「无法指派他人」）
