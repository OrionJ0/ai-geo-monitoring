---
title: 市场总览渠道对比与真实数据修复技术方案
date: 2026-08-05
status: active
source: docs/active-2026-08-05-001-market-overview-channel-comparison/prd.md
scope: deep
---

# 市场总览渠道对比与真实数据修复技术方案

> 实施状态（2026-08-05）：Issue 001–004 已完成；首页已使用区间来源比较合同，旧固定趋势路由和专属包装已删除。第 3 节保留为实施前基线，正式发布与生产验收仍以 Issue 005 为门禁。

## 1. 背景与目标

市场总览已经使用正式入口 `/geo/market-overview`，现有全链路表格应继续保留。本方案修复首页广告汇总和百度推广访问趋势不一致的问题，并把百度统计区间数据扩展为全部渠道同图对比、渠道占比和周期变化。

本需求涉及前端页面、前端运行时合同、百度统计区间服务、来源趋势缓存、第三方来源筛选及正式入口验收，按 Deep 规格处理。方案必须保持百度推广、百度统计、官网和销售系统的现有数据边界，不新增第二套首页数据链，不修改数据库 schema。

## 2. 范围与非目标

### 范围

- 修复广告稀疏日趋势导致首页周期汇总为空；
- 验证并修复百度推广在百度统计趋势接口中的唯一来源筛选；
- 在百度统计区间接口中向后兼容地增加全部渠道趋势对比合同；
- 首页从旧固定快照趋势链硬切到区间快照链；
- 在新链路通过入口验收后退役旧固定趋势公开路由及其专属 service 包装；
- 支持全部渠道同图、图例筛选、渠道占比、周期变化和表格联动；
- 收敛首页来源错误展示，不新增市场负责人异常中心；
- 补齐单元、接口、浏览器、构建和正式入口证据。

### 非目标

- 不改变全链路表格业务结构；
- 不接入 53KF、线索或订单系统；
- 不新增数据库表、字段或迁移；
- 不创建跨系统归因事实；
- 不保留旧首页流量 hook 作为 fallback；
- 不改变网站流量页现有默认响应和行为；
- 不修改百度推广四报表原子刷新合同。

### 延后事项

- 保存视图、导出、渠道排序；
- 53KF 和销售系统接入；
- 有可信归因后的渠道效率排名。

## 3. 实施前系统基线（历史）

### 3.1 正式入口与页面

- 正式首页：`nextjs-frontend/src/app/geo/market-overview/page.tsx`；
- 样式：`nextjs-frontend/src/app/geo/market-overview/market-overview.module.css`；
- `/geo` 已重定向到 `/geo/market-overview`，旧 `/geo/marketing` 只保留单向重定向；
- 当前首页默认趋势来源是 `BAIDU_PAID`，“官网全站（百度统计）”使用 UI 私有值 `BAIDU_TONGJI_ALL`；
- 当前非付费趋势还暴露 UV 和 PV，与本 PRD 确认的首页“访问”对比范围不一致。

### 3.2 广告数据链

- 首页通过 `nextjs-frontend/src/lib/marketing/useMarketOverview.ts` 读取 `/api/marketing/projects/:projectId/dashboard`；
- Dashboard 响应经过 `assertMarketingDashboardResponse` 校验，`trend` 与 `summary` 必须精确相等；
- 广告趋势允许只返回有事实的日期，因此零投放日可以不存在于 `trend`；
- 首页当前使用 `hasCompletePeriod` 要求逐日行数等于全部自然日，导致稀疏但完整的广告事实被误判为缺失；
- 广告表现页使用同一 Dashboard 事实，因而可出现广告表现页有值、首页为 `—` 的矛盾。

### 3.3 百度统计数据链

- 固定快照接口：`GET /api/marketing/projects/:projectId/tongji-trend`；
- 固定来源接口：`GET /api/marketing/projects/:projectId/tongji-source-trends`；
- 区间接口：`GET /api/marketing/projects/:projectId/website-traffic-overview`；
- 当前首页同时调用固定快照接口和区间接口，表格取区间汇总、趋势取固定快照，形成两条可不一致的数据链；
- `BaiduTongjiService.readProjectWebsiteTraffic` 已支持指定日期、设备、来源、指标及上一等长周期；
- `baidu_tongji_range_snapshots` 保存区间快照，`baidu_tongji_source_trend_snapshots` 保存来源逐日趋势，现有表结构能够支持本需求；
- `BaiduMarketingClient` 当前把 `BAIDU_PAID` 映射为 `searchBaiduProFc`，而正式百度统计页面已观察到 `searchBaiduPro`。这只是根因线索，正式实现前必须通过真实只读请求与脱敏响应确认；不得同时保留两个值做静默 fallback。

### 3.4 现有前端合同

- `nextjs-frontend/src/lib/marketing/websiteTrafficTypes.ts` 定义并校验 `WebsiteTrafficOverview`；
- `nextjs-frontend/src/lib/marketing/useWebsiteTraffic.ts` 负责区间请求、竞态丢弃和错误读取；
- 当前区间响应已包含全部访问趋势、上一周期趋势、七渠道汇总和当前渠道占比，但不包含七渠道逐日序列；
- 当前首页表格已经用区间响应的 `sourceQuality.rows` 展示渠道访问，官网咨询继续由独立 `/api/website-data` hook 读取。

### 3.5 现有测试

- 后端 provider 合同：`backend/tests/marketing/BaiduMarketingClient.test.js`；
- 百度统计服务和缓存：`backend/tests/marketing/BaiduTongjiService.test.js`；
- 路由合同：`backend/tests/marketing/MarketingTongjiSourceApi.test.js`、`backend/tests/marketing/MarketingModule.test.js`；
- 首页纯逻辑：`nextjs-frontend/tests/marketing/market-overview-presentation.test.cjs`；
- 首页源码合同：`nextjs-frontend/tests/marketing/market-overview.test.cjs`；
- 首页真实浏览器 fixture：`nextjs-frontend/tests/marketing/browser/market-overview.spec.ts`；
- 现有 fixture 总是给百度推广提供正常逐日趋势，没有覆盖“汇总有值但逐日为空”或广告零投放日缺行，因此未捕获生产矛盾。

## 4. 需求、约束与规则

- REQ-001：首页广告周期汇总必须使用已验证 Dashboard 事实，不因零投放日缺行而整体为空。
- REQ-002：首页渠道表、全部渠道图和单渠道图必须使用同一设备、日期和百度统计区间口径。
- REQ-003：全部模式返回七个稳定来源的当前逐日访问、当前/上一周期汇总、占比和变化率。
- REQ-004：单渠道模式保留当前周期与上一等长周期趋势。
- REQ-005：表格中可精确对齐百度统计的七个渠道可联动趋势；UTM、UNKNOWN 等仅官网表单来源不得伪造访问趋势。
- REQ-006：来源汇总与逐日加总不一致时，不得返回正常空趋势或缓存错误结果。
- REQ-007：单个渠道趋势不可用时，其他渠道和全部访问仍可展示。
- REQ-008：首页不展示系统异常行动列表；来源不可用只影响对应数据位置。
- CON-001：广告点击不能代替百度统计访问。
- CON-002：第三方响应必须在 adapter/service 边界严格校验，内部只消费规范化字符串指标。
- CON-003：所有计数和金额继续使用十进制定点字符串及 `BigInt` 运算，不能把公共合同改成浮点数。
- CON-004：现有接口变更必须 additive；默认调用网站流量页时不能增加七渠道趋势读取成本。
- CON-005：正式切换后删除旧 `tongji-trend` 和 `tongji-source-trends` 路由及其专属 service 包装；不得保留隐藏开关或 fallback。若部署访问日志证明仍有外部消费者，必须记录消费者、迁移期限和移除条件，并保持需求未完成。
- CON-006：不修改已应用迁移，不主动清除生产 Token 或缓存表。
- PAT-001：沿用 `WebsiteTrafficOverview` 的日期、设备、来源、指标、错误和缓存语义。
- PAT-002：沿用七渠道稳定目录和 `sourceKey`，前端不再维护另一套带 `BAIDU_TONGJI_` 前缀的映射。
- PAT-003：独立来源允许局部不可用，不阻断其他已验证来源。

## 5. 接口与数据契约

### 5.1 选择的接口方案

对现有区间接口做可选、向后兼容的扩展：

```text
GET /api/marketing/projects/:projectId/website-traffic-overview
  ?device=all|pc|mobile
  &from=YYYY-MM-DD
  &to=YYYY-MM-DD
  &source=ALL
  &metric=visits
  &includeSourceComparison=true
```

`includeSourceComparison` 缺省为 `false`。只有 `source=ALL` 且 `metric=visits` 时允许设为 `true`；其他组合返回 HTTP 400：

```json
{
  "error": {
    "code": "TONGJI_SOURCE_COMPARISON_QUERY_INVALID",
    "message": "渠道趋势对比参数无效"
  }
}
```

认证、项目所有权、日期范围、设备、缓存头和既有错误合同保持不变。

### 5.2 可选响应扩展

既有字段全部保留。仅在 `includeSourceComparison=true` 时增加：

```json
{
  "sourceComparison": {
    "metric": "visits",
    "state": "COMPLETE",
    "rows": [
      {
        "sourceKey": "BAIDU_PAID",
        "sourceLabel": "百度推广",
        "summaryState": "DATA",
        "trendState": "DATA",
        "summary": {
          "current": "12",
          "previous": "8",
          "changePercent": "50.0",
          "trafficShare": "14.5"
        },
        "trend": [
          { "date": "2026-08-04", "visits": "2" }
        ]
      }
    ]
  }
}
```

合同规则：

- `sourceComparison.state` 为 `COMPLETE|PARTIAL`；只要任一行 `trendState=UNAVAILABLE` 就是 `PARTIAL`；
- `rows` 始终按七渠道目录稳定排序，不按访问量改变响应顺序；
- `summaryState` 为 `DATA|NO_DATA`，取自已验证区间快照；真实字符串 `"0"` 属于 `DATA`；
- `trendState` 为 `DATA|NO_DATA|UNAVAILABLE`；
- `summary.current`、`summary.previous`、`changePercent` 和 `trafficShare` 允许为 `null`；
- `trend` 只返回当前周期，按日期升序；上一周期只用于汇总和变化率，不返回第二套逐日序列；
- `UNAVAILABLE` 行保留可信汇总，`trend=[]`，不暴露 provider 原始错误信息；服务端记录结构化诊断；
- 基础区间快照、鉴权或查询合同失败仍使用现有请求级错误，不降级成 `PARTIAL`；
- 旧客户端未请求该字段时，响应形状和读取成本保持原样。

### 5.3 前端输入合同

`WebsiteTrafficQuery` 增加可选布尔值 `includeSourceComparison?: boolean`。运行时断言遵守：

- 请求未启用比较时，`sourceComparison` 可以不存在；
- 请求启用比较时，`sourceComparison` 必须存在、含七个唯一合法 `sourceKey`，且日期、状态和十进制字符串全部有效；
- 任一非法第三方或后端字段使该请求进入 `WEBSITE_TRAFFIC_RESPONSE_INVALID`，不把未校验对象送入图表。

### 5.4 首页查询模型

首页流量最多保留两类区间请求：

1. 常驻全部渠道请求：`source=ALL&metric=visits&includeSourceComparison=true`，用于全链路表格、全部访问趋势、七渠道趋势、占比和渠道周期变化；
2. 按需单渠道请求：只在选中具体百度统计渠道时请求同一接口，`source=<sourceKey>&metric=visits`，用于该渠道当前/上一周期逐日对比。

百度推广的广告投入和展现继续来自 Dashboard；百度推广访问属于第二类百度统计请求。浏览器不得并发发起七个单渠道请求。

## 6. 数据流与状态

### 6.1 全部渠道比较

```text
MarketOverviewPage
  -> useWebsiteTrafficOverview(ALL, visits, includeSourceComparison=true)
  -> marketingDashboardRoutes
  -> BaiduTongjiService.readProjectWebsiteTraffic
       -> current/previous range snapshots
       -> current snapshot seven source summaries
       -> current source trend cache/read (bounded concurrency)
       -> reconciliation
  <- total trend + sourceComparison
  -> table visits + total line + channel lines + share/change legend
```

### 6.2 单渠道访问

```text
table row / source select
  -> selected WebsiteSourceKey
  -> useWebsiteTrafficOverview(selected source, visits)
  <- current and previous trend
  -> single-channel current solid line + previous dashed line
```

### 6.3 广告投入与展现

```text
dashboard atomic snapshot
  -> strict dashboard assertion
  -> selected current/previous period
  -> fill only omitted dates inside verified snapshot coverage with exact zero
  -> sum/display CPC and ad trend
```

已有日期行中的 `null`、响应失败或超出快照覆盖范围不能补零。只有 Dashboard 已通过原子快照与 `trend == summary` 合同校验，并且日期位于其 coverage 内时，缺失日期才代表该日没有广告事实。

## 7. 关键技术决策

- KTD-001：扩展 `website-traffic-overview`，不新增第二个渠道比较 endpoint。理由：现有接口已经拥有区间、上一周期、来源汇总和缓存语义；可选字段能保持旧消费者和网站流量页不变。
- KTD-002：不采用前端七请求 fan-out。理由：会扩大请求竞态、错误组合、缓存穿透和第三方限流风险。
- KTD-003：不扩展旧固定快照 `tongji-source-trends` 作为首页正式链路；新链路通过后退役 `tongji-trend`、`tongji-source-trends` 公开路由和未再使用的 `readProjectTrend`、`readProjectSourceTrends`。理由：它们没有任意日期范围和上一周期合同，保留会继续提供第二套可被误用的现役路径。
- KTD-004：全部模式只返回当前渠道逐日序列，上一周期只返回汇总变化。理由：满足决策需求，同时避免十四条以上曲线和双倍来源趋势读取。
- KTD-005：来源趋势读取使用服务端有界并发，复用 `baidu_tongji_source_trend_snapshots` 和 refresh 去重。理由：限制百度统计瞬时请求数，同时避免前端多请求。
- KTD-006：新增来源逐日与来源汇总的 `visits` 精确对账。理由：防止“汇总有值、趋势为零或空”被缓存并作为正常数据展示。
- KTD-007：单来源失败按行返回 `UNAVAILABLE`，基础快照失败仍请求级失败。理由：渠道趋势彼此可局部降级，但不能把鉴权、范围或整体来源失败伪装成部分成功。
- KTD-008：百度推广来源选择器只能有一个经真实证据验证的现役值。理由：双值尝试或静默 fallback 会隐藏上游合同变化并违反正式硬切要求。
- KTD-009：首页内部来源状态统一使用 `WebsiteSourceKey`，移除 `BAIDU_TONGJI_*` UI 映射。理由：减少接口键、表格键和图表键之间的翻译错误。
- KTD-010：全部模式使用共享全局最大值计算图形坐标，Tooltip 和摘要保留精确字符串。理由：保持渠道间可比较比例，同时避免把大整数公共合同降为浮点数。
- KTD-011：使用自定义可访问图例按钮维护隐藏渠道集合。理由：保证键盘、`aria-pressed` 和稳定渠道颜色，不依赖图表库默认图例的可访问性。
- KTD-012：不新增 feature flag。完成入口级验证后，首页删除旧固定趋势请求和旧标签；出现问题优先修复新链路，确需回滚时只回滚整个发布版本。

## 8. 后端实现设计

### 8.1 百度推广来源筛选验证

在修改 `TONGJI_SOURCE_FILTERS.BAIDU_PAID` 前执行一次只读合同验证：

- 使用正式绑定站点、相同设备和日期范围；
- 对照来源汇总中的百度推广访问；
- 验证候选筛选返回完整日期序列且逐日 visits 加总等于汇总；
- 保存脱敏请求参数、响应结构、日期和加总证据，不记录 Token；
- 确认现役值后更新 adapter 和测试，删除旧值，不保留运行时双试。

### 8.2 来源趋势一致性门禁

`BaiduTongjiService` 在以下位置校验选中来源的逐日 visits 加总与基础快照同来源 summary.visits：

- provider 刷新结果写入缓存前；
- fresh cache 作为 HIT 返回前；
- stale cache 作为 FALLBACK 返回前。

两边都有可信值但不相等时抛出稳定内部错误 `TONGJI_SOURCE_TREND_MISMATCH`，不写入、不返回错误缓存。全量比较调用把该行转成 `trendState=UNAVAILABLE`；单渠道调用保持请求级 502。真实 `0 == 0` 通过，任一侧为 `null` 时不伪造一致性。

### 8.3 全量来源比较构建

在 `readProjectWebsiteTraffic` 的可选分支中：

1. 沿用已读取的 current/previous range snapshots；
2. 从快照取七渠道 current/previous summary、流量占比和稳定标签；
3. 用最大并发 3 读取当前周期七个来源趋势；
4. 对每个 fulfilled 结果执行一致性门禁；
5. 对来源级失败记录结构化日志并产出 `UNAVAILABLE` 行；
6. 组装 `sourceComparison`；
7. 不修改既有 `summary`、`trend`、`sourceQuality` 或 `cache` 字段。

结构化日志至少包含 projectId、device、coverage、sourceKey、稳定错误码和 cache state；不得记录 access token、官网凭据或原始联系人数据。

### 8.4 路由参数

`marketingDashboardRoutes` 只负责透传原始 `includeSourceComparison`；布尔值、组合条件和日期范围继续在 service 边界统一验证。错误响应继续走现有 `sendError` 结构。

## 9. 前端实现设计

### 9.1 数据 hook 硬切

重写 `useMarketOverview.ts`，只保留 Dashboard 广告 slot、刷新和错误语义；删除下列首页请求与返回字段：

- `/tongji-trend`；
- `/tongji-source-trends` 无 source 请求；
- `/tongji-source-trends?source=BAIDU_PAID`；
- `/tongji-source-trends?source=<selected>`；
- `traffic`、`trafficSources`、`paidTraffic`、`trafficTrend`。

首页流量统一由 `useWebsiteTrafficOverview` 的区间合同提供。该 hook 新增可选比较参数，但网站流量页不传该参数，行为不变。

### 9.2 广告稀疏日期

在 `marketOverviewPresentation.cjs` 增加一个只面向已验证可加总广告指标的日期归一函数：

- 输入：广告趋势、snapshot coverage、目标 current/previous 范围；
- 输出：范围内按日期升序的行；
- coverage 内缺失日期补 `costAmountScaled/impressions/clicks = "0"`；
- coverage 外日期不生成；
- 重复日期、非法日期或已有行缺失精确指标时失败，不补零；
- 使用该结果替换首页对广告字段的 `hasCompletePeriod` 误判；
- 其他数据源不得复用此补零规则。

### 9.3 来源状态

- `trendSource` 改为 `WebsiteSourceKey`，默认 `ALL`；
- `TREND_SOURCES` 直接使用 `ALL` 和七个正式 sourceKey；
- `ALL` 标签固定为“全部”；
- 删除 `TONGJI_ALL_SOURCE` 和 `TONGJI_SOURCE_KEYS` 翻译表；
- `ALL` 与非付费来源只提供 visits；
- `BAIDU_PAID` 提供广告投入、展现和访问；
- 从 `BAIDU_PAID` 切换到其他来源或 ALL 时，将不适用指标原子重置为 visits。

### 9.4 图表数据模型

全部模式构造统一图表行：

```text
date, sourceKey, sourceLabel, exactValue, coordinate, isTotal
```

- 全部访问从区间响应既有 `trend[].current` 读取；
- 渠道访问从 `sourceComparison.rows[].trend` 读取；
- 所有系列共享同一个全局最大值计算 coordinate；
- 总线使用更粗线宽和固定中性色/主色；
- 渠道颜色按 sourceKey 固定，不能随排序变化；
- 自定义图例显示渠道名、占比和周期变化，按钮切换 hidden set；
- Tooltip 按 BigInt visits 从高到低排序，先显示全部访问；
- `UNAVAILABLE` 渠道不造零线，图例/摘要显示 `—`；
- `NO_DATA` 且趋势是可信全零时绘制零线或显示 0 状态。

单渠道模式沿用现有当前实线、上一周期虚线语义；百度推广投入和展现使用广告趋势，访问及其他来源使用按需区间响应。

### 9.5 表格联动和链接

只允许七个可对齐百度统计的渠道行切换趋势：

- `<tr>` 保留原生表格行语义，增加焦点、Enter/Space 处理和 `aria-selected`；
- 点击行内非交互区域切换来源；
- 原有 `<Link>` 点击必须停止行联动并继续导航到下钻页；
- UTM_CAMPAIGN、UNKNOWN 等官网表单专属行不增加趋势交互；
- 选中行只增加轻量背景/描边，不改变表格布局。

### 9.6 状态展示收敛

- 默认项目或权限失败仍作为页面级阻断状态；
- 广告、百度统计或官网咨询的独立读取失败不再堆成首页异常行动列表；
- 表格单元格、趋势区域和指标卡分别显示简短缺失/暂不可用状态；
- 技术错误码和缓存诊断保留在日志、测试证据或管理侧，不面向市场负责人展示；
- 真实 stale 快照可继续展示最后可信值，但不伪装成实时数据，来源说明中保留可访问口径。

### 9.7 文案硬切

- 首页可见“官网表单咨询”改为“官网咨询”；
- 相关 Tooltip 明确“当前仅包含官网成功表单记录，不包含 53KF 在线客服咨询”；
- “官网全站（百度统计）”改为“全部”；
- 测试和当前运行说明同步更新，不保留把旧标签写成现役入口的文档。

## 10. 实现切片

### U1. 百度推广访问趋势合同修复

**目标：** 用真实只读证据确定百度推广唯一来源筛选，并阻止汇总与逐日不一致的趋势进入缓存或响应。

**依赖：** 无。

**涉及文件：**

- `backend/modules/marketing/adapters/BaiduMarketingClient.js`
- `backend/modules/marketing/services/BaiduTongjiService.js`
- `backend/tests/marketing/BaiduMarketingClient.test.js`
- `backend/tests/marketing/BaiduTongjiService.test.js`

**方案：** 核验现役 selector；更新唯一映射；增加 source trend visits 对账；对 HIT、REFRESHED、FALLBACK 统一执行门禁；删除旧 selector 引用。

**测试场景：** 正常付费趋势、真实零值、汇总非零但趋势为零、缓存不一致、stale fallback 不一致、第三方日期不完整。

**验收方式：** 同一真实日期范围内，百度推广逐日 visits 加总与来源汇总一致；错误缓存不再被返回。

### U2. 全部渠道区间比较 API

**目标：** 一次区间请求返回全部访问、七渠道当前趋势、渠道占比和周期变化，同时保持旧消费者兼容。

**依赖：** U1。

**涉及文件：**

- `backend/modules/marketing/routes/marketingDashboardRoutes.js`
- `backend/modules/marketing/services/BaiduTongjiService.js`
- `backend/tests/marketing/MarketingTongjiSourceApi.test.js`
- `backend/tests/marketing/BaiduTongjiService.test.js`
- `backend/tests/marketing/MarketingModule.test.js`

**方案：** 增加可选 query 和 additive response；有界并发读取七来源当前趋势；单来源失败返回 PARTIAL；基础失败沿用请求级错误；复用现有缓存表和 refresh 去重。

**测试场景：** 默认不扩展响应、合法比较请求、非法参数组合、七来源完整、单来源失败、基础快照失败、稳定排序、并发去重、无新迁移。

**验收方式：** 一个比较请求返回合法七渠道合同；网站流量页旧请求不触发来源趋势 fan-out，响应保持兼容。

### U3. 首页数据链硬切与广告汇总修复

**目标：** 首页只使用 Dashboard 广告事实和百度统计区间流量事实，删除旧固定趋势读取。

**依赖：** U2。

**涉及文件：**

- `nextjs-frontend/src/lib/marketing/useMarketOverview.ts`
- `nextjs-frontend/src/lib/marketing/useWebsiteTraffic.ts`
- `nextjs-frontend/src/lib/marketing/websiteTrafficTypes.ts`
- `nextjs-frontend/src/utils/marketOverviewPresentation.cjs`
- `nextjs-frontend/src/app/geo/market-overview/page.tsx`
- `nextjs-frontend/tests/marketing/market-overview-presentation.test.cjs`
- `nextjs-frontend/tests/marketing/market-overview.test.cjs`
- `nextjs-frontend/tests/marketing/website-traffic-page.test.cjs`

**方案：** 扩展前端运行时合同；删除旧流量 slots；使用区间比较响应构建表格和趋势；只在广告快照 coverage 内补稀疏零日；统一正式 sourceKey。

**测试场景：** 广告缺少零投放日、已有行字段无效、上一周期超出 coverage、比较响应非法、请求竞态、ALL 与单渠道切换、不适用指标重置。

**验收方式：** 源码和网络请求均不存在首页对旧固定趋势 API 的调用；相同范围广告汇总与广告表现页一致。

### U4. 多渠道图、表格联动与可访问性

**目标：** 交付用户确认的 A+B 首页交互，同时保持现有全链路表格。

**依赖：** U3。

**涉及文件：**

- `nextjs-frontend/src/app/geo/market-overview/page.tsx`
- `nextjs-frontend/src/app/geo/market-overview/market-overview.module.css`
- `nextjs-frontend/tests/marketing/browser/market-overview.spec.ts`
- `nextjs-frontend/tests/marketing/marketing-accessibility.test.cjs`

**方案：** 默认 ALL；绘制总线与七渠道线；实现自定义可访问图例、渠道占比/变化和行联动；保留原链接；收敛系统错误展示；完成文案硬切。

**测试场景：** 桌面、移动、键盘、图例切换、Tooltip 排序、单渠道上期、PARTIAL、真实零、缺失、链接点击、表单专属行不可联动、无页面横向溢出。

**验收方式：** 浏览器可从全部渠道切到单渠道并恢复；表格结构未变；axe、键盘和移动端截图通过。

### U5. 正式切换、文档和生产验收

**目标：** 证明新链路已成为唯一正式首页路径，并清理旧运行描述。

**依赖：** U1–U4。

**涉及文件：**

- `README.md`
- `CONTEXT.md`
- `docs/README.md`
- `docs/API.md`
- `docs/visual-design-spec.md`（仅在全局标签或交互规则确需同步时更新）
- `docs/active-2026-08-05-001-market-overview-channel-comparison/`
- `backend/modules/marketing/routes/marketingDashboardRoutes.js`
- `backend/modules/marketing/services/BaiduTongjiService.js`
- `backend/tests/marketing/MarketingTongjiSourceApi.test.js`
- `backend/tests/marketing/MarketingModule.test.js`
- 与旧首页流量链相关的测试或失效说明

**方案：** 先用仓库搜索和部署访问日志确认旧固定趋势路由没有剩余消费者，再删除路由、专属 service 包装、测试和现役 API 文档；清理旧标签和首页旧 endpoint；把需求目录切换为 `active` 后执行实现与验证，完成后按真实状态改为 `closed`；走正式 Git Bundle 发布入口；验证公网健康、登录后页面、请求链和来源对账。若发现外部消费者，记录迁移范围、负责人、期限和移除条件，并保持需求未完成。

**测试场景：** 旧标签搜索、旧首页 API 请求为零、新接口实际命中、广告页与首页对账、百度推广汇总与趋势对账、生产未接入指标保持缺失。

**验收方式：** `https://insight.guangtuo.com` 登录后页面使用新链路；新实现为默认；无消费者时旧固定趋势路由、首页调用和旧文案均已删除；正式证据写入需求目录。

## 11. 验收标准

- AC-001：Given 原子 Dashboard 快照在范围内遗漏零投放日，When 首页聚合，Then 当前广告投入、展现和点击与 Dashboard 筛选结果一致而非 `—`。
- AC-002：Given 日期超出广告快照 coverage 或响应合同无效，When 首页聚合，Then 对应指标保持缺失，不补零。
- AC-003：Given 百度推广来源汇总 visits 非零而逐日加总不一致，When service 刷新或读取缓存，Then 返回稳定不一致错误且不写入/返回错误趋势。
- AC-004：Given 合法比较 query，When 请求区间接口，Then 返回七个唯一 sourceKey、当前逐日 visits、当前/上一汇总、占比和变化率。
- AC-005：Given 任一来源趋势读取失败，When 比较 query 完成，Then 响应为 PARTIAL、该行 UNAVAILABLE、其余渠道保持可用。
- AC-006：Given 未提供 `includeSourceComparison`，When 网站流量页读取区间接口，Then 响应与读取成本保持现有合同。
- AC-007：Given 首页首次加载，When 流量数据可用，Then 来源显示“全部”，图中出现全部访问和可用渠道线。
- AC-008：Given ALL 模式，When 用户切换图例，Then 对应渠道线隐藏/恢复且按钮键盘可用、状态可读。
- AC-009：Given 可对齐渠道表格行，When 用户点击或按 Enter/Space，Then 趋势切换到该渠道；点击原下钻链接只导航不切换。
- AC-010：Given 官网表单专属 UTM/UNKNOWN 行，When 用户浏览表格，Then 该行不提供虚假的百度统计趋势联动。
- AC-011：Given 非付费渠道，When 用户查看趋势指标，Then 只能选择访问；Given 百度推广，Then 可选择广告投入、展现或访问。
- AC-012：Given 全部模式，When 展示上一周期，Then 通过摘要和变化率对比，不叠加上一周期七渠道曲线。
- AC-013：Given 来源读取失败，When 页面渲染，Then 受影响位置诚实缺失，首页不生成异常行动中心或系统错误排行榜。
- AC-014：Given 已确认不存在剩余消费者并完成发布，When 检查代码、API 文档和正式入口网络请求，Then `tongji-trend`、`tongji-source-trends` 路由及专属包装已删除，且不存在旧链路 fallback。
- AC-015：Given 相同项目、设备和日期范围，When 对比首页、广告表现页和网站流量页，Then 各自共享指标精确一致。

## 12. 测试与验证计划

### 单元测试

- 广告稀疏日期补零仅发生在已验证 coverage 内；
- 精确字符串加总、峰值、占比和变化率；
- source comparison 运行时合同及非法状态；
- 全部模式共享最大值和 Tooltip 排序；
- source trend 与 summary 对账及缓存拒绝。

### 后端集成测试

- provider 请求的唯一百度推广 selector；
- 合法/非法 `includeSourceComparison`；
- COMPLETE、PARTIAL、请求级失败；
- 旧请求不触发额外来源读取；
- HIT、REFRESHED、FALLBACK 一致性门禁；
- SQLite 与 Postgres 现有缓存行为不变，无迁移差异。

### 前端浏览器测试

- 1440px 全部渠道图、图例、摘要和表格；
- 390px 无页面级溢出；
- 行点击、键盘切换、链接隔离；
- 百度推广访问、广告投入、展现切换；
- 单来源 UNAVAILABLE 不阻断其他来源；
- 官网咨询新名称和 53KF 边界提示；
- axe 和 reduced-motion。

### 建议验证命令

- `npm --prefix backend run test:marketing`
- `npm --prefix nextjs-frontend test`
- `npm --prefix nextjs-frontend run test:marketing:browser -- market-overview.spec.ts`
- `npm run lint`
- `npm run build`

### 正式证据

- 脱敏的百度统计付费来源 selector 请求与响应摘要；
- 同范围付费来源 summary 与每日 visits 加总；
- 首页与广告表现页广告汇总对账；
- 首页与网站流量页全部访问及渠道汇总对账；
- 正式入口桌面/移动截图、网络请求和控制台错误记录；
- 服务器 HEAD、origin/main、工作区状态和公网 revision 分别核验。

## 13. 性能、观测与安全

### 性能

- 比较字段缺省关闭，网站流量页不承担额外成本；
- 服务端七来源趋势使用最大并发 3；
- 复用现有 10 分钟来源趋势缓存和同 key refresh 去重；
- 前端不做七请求 fan-out；
- 响应只包含当前渠道逐日值，不复制上一周期七套趋势。

### 观测

- 记录比较请求耗时、来源读取数量、cache state、PARTIAL 来源数和稳定错误码；
- 单来源不一致使用 `TONGJI_SOURCE_TREND_MISMATCH`；
- 正式验收必须证明新 endpoint 实际命中和旧 endpoint 未命中；
- 不把技术观测信息做成市场负责人首页模块。

### 安全

- 沿用现有 JWT、项目所有权和白名单校验；
- 第三方响应继续限时、限大小并严格解析；
- 日志不得包含百度 access/refresh token、官网凭据、联系人或 IP；
- 本需求全部是只读数据读取，不产生投放、咨询、线索或订单写操作。

## 14. 风险与缓解

- 风险：百度推广真实 selector 与当前假设不同。缓解：U1 先做只读合同验证，选定单一值后硬切，不双试。
- 风险：七来源首次读取增加百度统计延迟或限流。缓解：服务端并发上限 3、缓存复用、refresh 去重和 PARTIAL 响应。
- 风险：来源汇总与逐日口径天然不一致。缓解：以相同 site/device/coverage/sourceKey 精确对账；不一致不缓存、不伪装为空。
- 风险：总线数值远大于小渠道，曲线被压缩。缓解：统一比例保证真实相对关系，允许隐藏总线/大渠道，Tooltip 保留精确值。
- 风险：表格行点击破坏原链接或键盘语义。缓解：原生行语义、独立键盘处理、链接阻止冒泡、浏览器和 axe 验收。
- 风险：旧坏缓存继续返回。缓解：HIT/FALLBACK 均执行 summary 对账，失败缓存不参与响应。
- 风险：首页与网站流量页产生合同分叉。缓解：两页共用 `WebsiteTrafficOverview` 类型和区间服务；比较能力只做可选 additive 字段。

## 15. 发布与回滚

### 发布

1. 需求进入实现时把目录状态从 `draft` 改为 `active`；
2. 先完成 U1 的真实只读 selector 证据和后端一致性门禁；
3. 完成 additive API 与前端硬切；
4. 运行后端、前端、浏览器、lint 和 build；
5. 仓库搜索和部署访问日志确认没有剩余消费者后，删除旧固定趋势路由、专属包装、测试和现役文档；再确认没有旧标签和隐藏 fallback；
6. 本地提交并推送，通过正式 Git Bundle workflow 快进服务器 main；
7. 从唯一正式域名执行登录后入口验收；
8. 更新运行文档和需求状态。

### 回滚

本需求没有数据库迁移，发布回滚可恢复到上一完整应用版本。默认优先修复新链路，不得通过重新启用旧固定趋势请求、旧 selector 双试或隐藏 feature flag 快速绕过。只有出现影响正式首页可用性的严重问题并经明确决策时，才回滚整个发布版本；再次切回新实现的退出条件是 selector、一致性门禁、完整测试和正式入口证据全部通过。

## 16. 替代方案

### 方案 A：前端并发请求七个现有单来源接口

优点是后端改动少。缺点是浏览器请求多、竞态复杂、错误组合难管理，并会放大第三方缓存穿透。否决。

### 方案 B：新建独立 `/website-traffic-source-comparison` endpoint

边界清晰，但会复制现有区间、上一周期、缓存、权限和错误合同，形成第二套网站流量 API。否决。

### 方案 C：扩展现有 `website-traffic-overview` 的可选字段

复用现有区间快照和上一周期语义，对旧消费者 additive 且默认零成本。采用。

## 17. 假设与开放问题

### 已确认假设

- 首页日期范围处于广告和百度统计已验证 coverage 时，才能进行同范围对账；
- 全部模式比较的是百度统计七个稳定访问渠道，不把官网表单专属 UTM/UNKNOWN 当作访问渠道；
- 当前不增加业务侧“未分类差额”行。

### 实现前必须关闭的技术问题

- 用真实只读响应确定百度推广唯一趋势 selector；当前 `searchBaiduProFc` 与已观察到的 `searchBaiduPro` 不一致，不能仅凭名称猜测。

该问题不改变产品范围，但它是 U1 完成和正式发布的门禁。

## 18. 后续衔接

- 实施状态：U1–U4 已在本地实现并关闭；U5 的旧链退役、正式发布和生产入口验收仍未完成；
- 当前执行入口：`issues/005-retire-old-flow-and-production-acceptance.md`；
- 是否适合 TDD：适合。优先用失败的汇总/趋势不一致测试和广告稀疏日期测试建立红灯，再实现合同与页面切换；
- 推荐下一步：审计旧固定趋势接口消费者，完成无 fallback 的退役与全量回归，再通过正式 Git Bundle 发布并从唯一生产域名验收。
