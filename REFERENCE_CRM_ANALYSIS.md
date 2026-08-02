# 参考库分析 — CRM (QI-NET / Cloudflare Workers) → shipment-tracker

**日期：** 2026-08-02（Sprint 06 / MVP GA 之后）
**参考库位置：** `C:\Users\mbtbr\OneDrive\Documents\Brandon Coding Project\CRM`
**参考库形态：** Hono + Cloudflare Workers + D1 (SQLite)，54 个迁移，23 个路由模块
**本文目的：** 找出哪些可以直接用、可以补充、可以修改，来让 shipment-tracker 更完整

---

## 0. 一个必须先说清楚的发现：价值流向已经反了

参考库里有一份 `implementation_plan——QI-NET 核心功能升级提案 (参考参考库)`，开头写着：

> 「经过对您提供的 `shipment-status-tracker` 源码库进行深度拆解……我提炼了 5 个最具商业价值、且可以无缝融入我们当前系统的高级功能」

它提的 5 项是：报价→工单一键转换、供应商智能比价、KPI 评分、通知中心、高管仪表盘 P&L。

**这 5 项 shipment-tracker 现在全部已经有了**，而且做得更深（比价还带汇率换算和历史汇率、通知有去重键和定时扫描、P&L 有客户/供应商/期间三个维度）。

也就是说：**那份文档是 CRM 想抄 shipment-tracker，不是反过来。** 在「商业前台」这条线上，shipment-tracker 已经反超。

所以本次分析的正确问题不是「CRM 有什么好东西」，而是 **「CRM 在哪些 shipment-tracker 还没做的领域已经趟过路了」** —— 答案集中在**操作后台**和**会计总账**。

---

## 1. 两边现在的强弱对比

| 领域 | shipment-tracker | CRM 参考库 | 谁领先 |
|---|---|---|---|
| 报价 + 成本引擎 + 审批 | 深（含 SST 免税、汇率、审批阈值） | 有 | **本项目** |
| 发票 / CN / DN | 完整，税务合规 | 有 billing | **本项目** |
| AP 应付 | 完整（含并发锁、冲销） | 有 | **本项目** |
| 信用管控 | 硬阻断 + 授权覆盖 + 审计 | 只有 credit_terms 字段 | **本项目** |
| 对账单 / 逾期自动化 | 有 | 无 | **本项目** |
| 订舱 + 里程碑 | 有（Sprint 06） | 有 | 平 |
| 工程质量 | 306 单元 + 33 集成 + 7 浏览器测试 | 3 个 spec 文件 | **本项目** |
| **集装箱管理** | **无** | **完整**（铅封链、D&D 日期、特殊指令） | **参考库** |
| **提单 HBL / MBL** | **无** | **完整**（法定当事人、放单方式、修订快照） | **参考库** |
| **舱单 + 海关/EDI** | **无** | **完整**（报关状态、EDI 提交、回调） | **参考库** |
| **总账会计 GL** | **无**（只有 AR/AP 子账） | **完整双分录** | **参考库** |
| **Shipment 实体** | 无（Job 兼任） | 有（介于 Booking 和 Job 之间） | **参考库** |
| **组织架构分权** | 无 | 有（company/branch/department/team） | **参考库** |

---

## 2. 可以直接拿来用的（按性价比排序）

### 🥇 第一优先：汇率快照 + 财务事件幂等（**极小改动，解决已知缺陷**）

这是**投入产出比最高的一项**，而且它修的是 `TODO.md` 里已经记了很久的一个真实缺陷：

> 「**P&L is not historically stable.** `PnlService` 用 `FxService.converter()`（最新汇率）换算，所以补录一个汇率会让过去的报表数字发生变化。」

参考库的解法（`0051_accounting.sql`）：

```sql
CREATE TABLE exchange_rate_snapshots (
    id, base_currency, target_currency, exchange_rate,
    snapshot_datetime, source
);
-- 然后 journal_entries.exchange_rate_snapshot_id 引用它
```

**关键思想**：单据在**过账那一刻**把当时用的汇率**快照下来并引用**，之后无论汇率表怎么补录，历史数字都不会再变。

本项目已经有现成的 `FxService.historicalConverter()`，缺的正是「把用过的汇率钉在单据上」这一步。

**另一个值得抄的**：`financial_events` 表带 `event_hash UNIQUE` —— 从 BILLING/PAYMENT 往会计推送时，同一笔事件重复推送会被唯一索引挡掉，天然幂等。这个模式即使不做 GL，用在**发票→报表**、**付款→对账**上也有价值。

**工作量**：小（1 个迁移 + 改 PnlService）。**建议**：不管做不做 GL，这个都应该先做。

---

### 🥈 第二优先：集装箱 (Container) 成为一等实体

对应 `BUSINESS_AUDIT.md` §12（5%）、`PRODUCT_BACKLOG.md` **P1-6**。

参考库 `0046_container.sql` 的设计**明显是懂行的人写的**，值得整个搬过来：

- **铅封链**：`seal_no` / `seal_applied_by` / `seal_applied_at` / `seal_verified` / `seal_verified_by` / `seal_verified_at` —— 施封和验封分开记录，这是货损纠纷时唯一能自证清白的东西
- **7 个日期字段做滞港/滞箱 (D&D)**：`pickup / gate_in / loaded / gate_out / port_in / port_out / returned` —— 有这 7 个点才能算免箱期和滞箱费
- **箱属**：`container_owner`（SOC / COC / SHIPPER_LEASE / CARRIER_LEASE）—— 直接决定滞箱费找谁收
- **特殊指令独立成表**：危险品 / 冷藏 / 超限 / 易碎 / 高价值 / 食品级，用 JSON 存各自不同的参数
- **重量三件套**：`gross / tare / net` + `volume_cbm`

**要改的地方**：参考库用 `REAL` 存重量和体积。本项目应该用 `Decimal`，理由和金额一样——浮点数累加会漂移。

**工作量**：中。**价值**：做 FCL 的话这是刚需，没有它连滞箱费都算不了。

---

### 🥉 第三优先：提单 HBL / MBL

对应 `BUSINESS_AUDIT.md` §6（10%）、**P1-3**。

参考库 `0047_house_bl.sql` / `0048_master_bl.sql` 里几个**本项目现在完全没有**的概念：

1. **法定当事人是独立字段，不是自由文本**
   `shipper / consignee / notify_party / also_notify_party / forwarding_agent / exporter / importer / broker` —— 全部是 ID 外键。
   本项目现在 `shipper` / `consignee` 只是发票抬头上的一行字符串，无法复用、无法统计、改一次要改 N 个地方。这也正是 **P1-5「结构化当事人」** 要解决的问题。

2. **放单方式 (release_type)**：`ORIGINAL / EXPRESS_RELEASE / TELEX_RELEASE`
   配合 `original_bl_issued` / `original_bl_surrendered` 两个计数器 —— **正本签发几份、收回几份**。这是提单业务的核心风控点：正本没收齐就放货 = 无单放货，是货代最大的法律风险之一。本项目完全没有这个概念。

3. **修订留痕**：`house_bl_revisions` 表存 `reason` + `snapshot`（整张单的 JSON 快照）+ 审批人
   本项目的报价有 `QuotationRevision`，但提单这种法律文件更需要。

4. **打印日志**：`house_bl_print_logs` 记录每次打印的类型（草稿/正本/电放）和打印人 —— 正本提单打了几张、谁打的，必须可查。

5. **MBL ↔ HBL 多对多**（`master_bl_house_bls`）—— 拼箱 (LCL) 一票主单挂多票分单，就是靠这张表。对应 **P2-3 LCL 拼箱**。

**工作量**：大。**价值**：做海运出口的话这是核心单证，绕不过去。

---

### 第四：Shipment 实体（介于 Booking 和 Job 之间）

参考库的链路是 `Quotation → Booking → **Shipment** → Job`，本项目 Sprint 06 做的是 `Quotation → Booking → Job`。

参考库 `shipments` 表里，**本项目 Job 上没有但确实需要**的字段：

- **`atd` / `ata`（实际开航 / 实际到港）** —— 本项目只有 `etd` / `eta`（预计）。**没有实际时间就无法统计准班率**，而准班率是供应商 KPI 评分最重要的一项。这个字段现在就该加，不用等做 Shipment 实体。
- **`chargeable_weight`（计费重）** —— 空运计费重 = max(实重, 体积重)，本项目完全没有。对应 `BUSINESS_AUDIT.md` §8 空运（5%）。
- `transport_mode` / `shipment_mode` / `movement_type` / `incoterms` —— 结构化的运输方式，本项目现在散落在报价的自由文本里

**建议**：**不要**急着引入 Shipment 这一层。本项目的 Job 已经承担了这个角色，再插一层会让 `Quotation → Booking → Shipment → Job` 四级跳，操作人员会困惑。**先把上面 3 个字段加到 Job 上**，等真的要做多式联运（一票货拆成海运段+陆运段）时再考虑拆实体。

**工作量**：加字段=小，拆实体=大。**建议只做前者。**

---

### 第五：组织架构分权 (company / branch / department / team)

参考库在**每一张主表**上都加了这 4 个字段（`0043_enterprise_rbac.sql`），配合 `authorization_logs` 记录每次鉴权决策。

对应 `BUSINESS_AUDIT.md` §30 里点名的缺口：「Missing Feature: 字段/记录级安全、branch/company 分权、数据归属规则」。

**什么时候需要**：现在**不需要**。你是单公司单点运营，加了只是每张表多 4 个永远是 'DEFAULT' 的字段。
**什么时候必须有**：开第二个分公司，或者要让 A 分公司看不到 B 分公司的单子时。

**建议**：记在 backlog，别现在做。但**新建表时可以顺手预留**，比事后给 40 张表加字段便宜得多。

---

### 第六：舱单 + 海关 / EDI

对应 §35 海关（0%）、§34 EDI（0%），都是 **P2 段（分市场决定）**。

参考库 `0049_manifest.sql` 的 EDI 部分设计得不错：`submission_channel`（MANUAL / EDI / API / SINGLE_WINDOW）、`edi_transaction_id` / `edi_response_code` / `edi_response_message`、以及 webhook 回调三件套。

**但**：`PRODUCT_BACKLOG.md` 已经明确写了「P2 全部 gated on 客户自己是否操作这条线」。你现在通过代理报关，就**不该做**。这条留着，等真有客户要自己报关再看。

---

## 3. 值得偷的设计模式（不做那个模块也能用）

这几个是**跨模块的通用做法**，比具体功能更有价值：

1. **`approval_status` + `lock_status` + `version` + `revision_reason` 四件套**
   参考库在每个主要实体上都有。本项目的状态机更严谨（有合法转移校验），但**缺 `lock_status` 这个概念** —— 「已审批但还能改」和「锁死不许动」是两回事。提单、舱单这类对外单证尤其需要。

2. **金额用整数分做校验**
   参考库 `accounting.ts` 里 `Math.round(x * 100)` 做借贷平衡校验 —— 避免浮点误差导致「差一分钱不平」。本项目用 Decimal 更好，但**这个校验思路**在做 GL 时要照抄。

3. **控制账户保护**
   「AR / AP 是控制账户，只能由系统从子账过账，不许人工直接做分录」—— 参考库在 `accounting.ts` 里显式拦截了。这是防止手工分录把 AR 总额改得和发票明细对不上的关键。

4. **`journal_hash` 防篡改**
   分录内容算哈希存唯一索引，事后改数据哈希对不上。审计需要。

5. **timeline 表模式**
   参考库给每个实体都配了 `xxx_timeline`（`old_value` / `new_value` / `recorded_by`）。本项目只有 `JobTrackingEvent`。做提单/集装箱时应该沿用这个模式。

---

## 4. 明确**不要**拿的

| 不要 | 原因 |
|---|---|
| **`REAL` 存金额和重量** | 参考库因为 D1/SQLite 只能这样。本项目用 `Decimal(14,2)` 是对的，**千万别退化**。浮点存钱是真实的 bug 来源。 |
| **日期存 `TEXT`** | 同上，本项目用 `DateTime` 正确。 |
| **Cloudflare Workers / Hono 架构** | 和 NestJS 是两套世界，没有迁移价值。 |
| **那 100+ 份 `*_AUDIT.md`** | 参考库根目录有 143 个条目，其中 100+ 是各种审计/检查清单文档。本项目的 `SPRINT_0N_REPORT.md` 体系已经更清晰，别学这个。 |
| **`temp_app.js` / `temp_test1.mjs` / `scratch/`** | 参考库根目录堆了不少临时文件，属于要清理的技术债，不是要学的东西。 |

---

## 5. 建议的下一步顺序

结合 `PRODUCT_BACKLOG.md` 现有的 P1 排序，我的建议：

| 顺序 | 做什么 | 来源 | 工作量 | 为什么排这里 |
|---|---|---|---|---|
| **0** | **汇率快照钉在单据上** + Job 加 `atd`/`ata`/`chargeableWeight` | 参考库 §2.1 / §2.4 | **S** | 修已知缺陷 + 解锁准班率统计，几乎零风险 |
| **1** | **P1-1 会计集成**（Xero/QuickBooks 或结构化导出） | 本项目 backlog | L | 比自建 GL 便宜十倍，先看能不能用集成解决 |
| **2** | **P1-5 结构化当事人** | 参考库 HBL 的当事人设计 | M | 是提单、舱单、报关的共同地基，先做它后面都省事 |
| **3** | **P1-6 集装箱实体** | 参考库 `0046` 几乎可直接移植 | M | 做 FCL 的刚需 |
| **4** | **P1-3 提单 HBL/MBL** | 参考库 `0047`/`0048` | L | 依赖上面两步 |
| **5** | P2-5 自建 GL | 参考库 `0051` | XL | **只有在第 1 步的集成方案走不通时才做** |

**关于 GL 的判断**：参考库确实做了一套能跑的双分录总账，设计也正经（控制账户保护、期间关闭、试算平衡快照）。但 `MVP_SCOPE.md` 已经写明「AR + AP + CN/DN 构成完整子账，账可以导出给会计师做账」。**自建 GL 是 XL 工作量，而接一个 Xero/QuickBooks 是 L**。除非你确定要做一套自己的账务系统，否则先走集成。参考库的 GL 代码留着，将来真要做时是很好的蓝本。

---

## 6. 一句话总结

参考库在**商业前台已经落后**于本项目（它自己的文档就是想抄本项目），但在**操作后台**——集装箱、提单、舱单、总账——**趟过了本项目还没走的路**。

最该马上拿的不是某个大模块，而是**汇率快照**这个小设计：它用极小的改动，修掉本项目 `TODO.md` 里挂了很久的「P&L 会被补录汇率改写历史」这个真实缺陷。

其余的（集装箱、提单）都是**真材实料、可以直接移植设计**的，但要按 backlog 的依赖顺序来，并且**把数据类型从 SQLite 的 `REAL`/`TEXT` 换成本项目的 `Decimal`/`DateTime`**。
