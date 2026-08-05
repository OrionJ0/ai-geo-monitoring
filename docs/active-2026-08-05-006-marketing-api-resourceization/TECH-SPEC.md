---
title: 营销广告快照 API 资源化技术方案
date: 2026-08-05
status: active
source: docs/active-2026-08-05-006-marketing-api-resourceization/prd.md
scope: deep
---

# 营销广告快照 API 资源化技术方案

## 1. 背景与目标

当前 `MarketingDashboardService.read()` 在一个 `REPEATABLE READ` 事务中选择最新完整广告快照，再读取计划、单元、关键词和搜索词四张逐日事实表。`present()` 同时返回项目状态、绑定、覆盖范围、汇总、趋势、四组聚合明细、层级数量和刷新状态。

这个实现保证了一致性，但让只需要少量数据的页面也读取、聚合和传输全部广告事实。生产已经观测到 863 条真实关键词，搜索词页还会为本期和上期各请求一次完整 Dashboard。006 的目标不是重建营销 API，而是把现有广告快照读模型整理为：

```text
轻量 Dashboard（快照根）
        │ revision + coverage + filter
        ├── 广告层级资源（计划、单元、关键词）
        ├── 关键词资源（服务端分页）
        └── 搜索词资源（服务端分页）
```

所有资源仍读取同一 `refresh_run_id`。多 HTTP 请求不能降低现役单事务 Dashboard 提供的快照一致性。

## 2. 范围、非目标与开始门禁

### 2.1 范围

- 抽取唯一广告快照选择器；
- 建立轻量 Dashboard 合同；
- 新增广告层级、关键词和搜索词三个只读端点；
- 详情端点强制要求并回显 `revision`；
- 在数据库执行关键词和搜索词的聚合、筛选、排序与分页；
- 为广告层级和关键词资源提供与分页无关的全筛选范围 summary；
- 分 R1、R2 两次发布迁移仓库内消费者；
- R2 硬切后删除 Dashboard 四个旧明细数组及其 adapter、测试和现役说明；
- 从真实 API 和浏览器证明页面没有混用不同快照。

### 2.2 非目标

- 不修改百度四报表抓取、双读、预算、限流、原子落库或事实表；
- 不修改 003 的 OAuth、统计上下文、能力状态或迁移；
- 不修改 005 的 provider、HTTP 内核或第三方客户端；
- 不修改百度统计和官网数据 API；
- 不增加 URL `/v1`、请求头版本、通用 API gateway 或外部开发者平台；
- 不把计划、单元和关键词改成可写 CRUD；
- 不建设独立 composition root 整理；
- 不支持多账号、多统计用户名、合同漂移监测、53KF 或销售数据。

### 2.3 开始门禁

文档可在 003 实施前评审，但代码只能在 003 完成 A2、生产正式入口验证并关闭后开始。005 和 006 不并行，默认顺序为：

```text
003 closed → 006 implementation/observation/closed → 007 correctness/closed → 005 implementation
```

## 3. 当前系统认知

### 3.1 现役路由与响应

`backend/modules/marketing/routes/marketingDashboardRoutes.js` 当前注册：

- `GET /api/marketing/projects/:projectId/dashboard`；
- `GET /api/marketing/projects/:projectId/website-traffic-overview`；
- `GET /api/marketing/projects/:projectId/website-traffic-pages`；
- `POST /api/marketing/projects/:projectId/refresh-runs`；
- `GET /api/marketing/projects/:projectId/refresh-runs/:runId`。

这些端点已经按广告、百度统计和刷新任务分开。006 只处理第一个广告 Dashboard，不重命名其他端点。

现役 Dashboard 返回：

```text
projectId, projectName, revision,
states, bindings, coverage, filter,
summary, trend,
campaigns, adGroups, keywords, searchTerms,
hierarchyCounts, activeRun, lastRun
```

### 3.2 快照选择与一致性

`MarketingDashboardService.read()` 当前：

1. 检查项目、绑定和连接状态；
2. 选择项目最近一次 `SUCCEEDED` refresh run；
3. 对活动项目校验该 run 的 `binding_fingerprint`；
4. 校验所选日期在 `coverage_start..coverage_end` 内；
5. 在一个只读 `REPEATABLE READ` 事务中读取四张事实表；
6. 聚合后返回同一 revision。

资源化必须保留以上规则。不能让每个新 service 各自“找最新快照”，否则刷新恰好发生在请求之间时会混入不同 revision。

### 3.3 现役消费者

- `readMarketingDashboard.ts` 是前端 Dashboard 读取入口并负责日期越界后的 coverage clamp；
- `useMarketOverview.ts` 只消费广告 summary/trend/state；
- `useAdPerformance.ts` 和 `adPerformanceAdapter.ts` 消费计划、单元和关键词；
- `useKeywordAnalysis.ts` 消费关键词明细；
- `useAdSearchTerms.ts` 为本期和上期读取完整 Dashboard 并比较 revision。

R1 必须逐个迁移后三类详细消费者；R2 才能改变 `readMarketingDashboard.ts` 的正式响应类型并删除旧数组。

## 4. 需求、约束与规则

- REQ-001：Dashboard 是当前广告快照根，不是全部广告事实的传输容器。
- REQ-002：所有详情端点必须提供 `revision`，并只读取该 revision。
- REQ-003：revision 必须属于已授权项目的一次完整 `SUCCEEDED` refresh run。
- REQ-004：请求日期必须完全落在 revision coverage 内。
- REQ-005：广告层级在同一事务读取计划、单元和关键词，不包含搜索词。
- REQ-006：关键词和搜索词在服务端完成有界分页、允许列表筛选和排序。
- REQ-006A：广告层级和关键词 summary 在服务端按完整筛选结果计算，不受分页影响。
- REQ-007：精确计数与金额保持字符串，金额不得转为浮点。
- REQ-008：搜索词继续没有伪造的 `keywordId`。
- REQ-009：R1 保持旧 Dashboard 合同；R2 完成唯一正式路径硬切并删除旧实现。
- REQ-010：无快照、无效 revision、越界日期和合法空页必须可区分。

- CON-001：不修改事实表和已应用迁移。
- CON-002：不改变四报表刷新事务或 `refresh_run_id` 语义。
- CON-003：项目权限检查必须先于 revision 存在性检查。
- CON-004：所有排序、筛选和 page size 使用服务端允许列表或绑定参数。
- CON-005：R1 与 R2 是两个独立 Git Bundle 发布，不以运行时开关维持双合同。
- CON-006：003、005、006 或 007 的生产观察窗口不能重叠。

- PAT-001：复用现役项目 allowlist、所有权校验、错误信封和 SQL replacements。
- PAT-002：读取使用只读 `REPEATABLE READ` 事务。
- PAT-003：当前根资源使用 `private, no-store`；显式 revision 详情使用短时私有缓存。
- PAT-004：前端先取根 revision，再并发读取页面需要的详情资源。

## 5. 公共响应元数据

三个详情资源共享以下元数据，但不建立通用运行时“API 平台”抽象：

```json
{
  "schemaVersion": "marketing_keywords_v1",
  "projectId": "1",
  "revision": "refresh-run-id",
  "coverage": {
    "from": "2026-07-05",
    "to": "2026-08-03",
    "lastSuccessfulAt": "2026-08-04T00:00:00.000Z",
    "currency": "CNY",
    "costScale": 2
  },
  "filter": {
    "from": "2026-07-28",
    "to": "2026-08-03"
  }
}
```

规则：

- `schemaVersion` 表示响应形状，不改变 URL；
- `revision` 与数据库 `baidu_marketing_refresh_runs.id` 一一对应，但只作为不透明字符串；
- `coverage` 来自该 run，不由请求构造；
- `filter` 是服务端验证后的有效日期；
- 币种和 cost scale 只来自该 run；
- 浏览器不得自行合并不同 revision 或不同币种的数据。

## 6. API 合同

### 6.1 轻量 Dashboard

```text
GET /api/marketing/projects/:projectId/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD
```

R2 后响应：

```text
schemaVersion = marketing_dashboard_v2
projectId, projectName, revision,
states, bindings, coverage, filter,
summary, trend,
hierarchyCounts,
activeRun, lastRun
```

`hierarchyCounts` 继续包含 `campaigns`、`adGroups`、`keywords` 和 `searchTerms`。为避免读取四张全量明细后再数数组，计数由数据库在同一事务按 revision 和 filter 聚合；summary/trend 只读取计划事实。

无完整快照时 Dashboard 保留现役状态表达，`revision`、`coverage` 和 `filter` 为 `null`，summary 为精确零，counts 为零。调用方不能把该结果解释为“有一份零数据快照”。

### 6.2 广告层级

```text
GET /api/marketing/projects/:projectId/ad-hierarchy
  ?revision=<opaque>
  &from=YYYY-MM-DD
  &to=YYYY-MM-DD
```

响应：

```json
{
  "schemaVersion": "marketing_ad_hierarchy_v1",
  "projectId": "1",
  "revision": "refresh-run-id",
  "coverage": {},
  "filter": {},
  "summary": {
    "impressions": "0",
    "clicks": "0",
    "costAmountScaled": "0"
  },
  "campaigns": [],
  "adGroups": [],
  "keywords": [],
  "hierarchyCounts": {
    "campaigns": 0,
    "adGroups": 0,
    "keywords": 0
  }
}
```

字段与现役 Dashboard 三个数组一致，保留每项 trend。`summary` 按完整日期与层级过滤结果聚合，和数组长度无关。接口在一个只读事务中读取三张事实表、summary 和 count，并执行现役父子 ID/名称语义；不读取或返回搜索词。

### 6.3 关键词

```text
GET /api/marketing/projects/:projectId/keywords
  ?revision=<opaque>
  &from=YYYY-MM-DD
  &to=YYYY-MM-DD
  &page=1
  &pageSize=50
  &sortBy=impressions
  &sortOrder=descend
  &query=<text>
  &campaignId=<id>
  &adGroupId=<id>
```

响应：

```json
{
  "schemaVersion": "marketing_keywords_v1",
  "projectId": "1",
  "revision": "refresh-run-id",
  "coverage": {},
  "filter": {},
  "summary": {
    "impressions": "0",
    "clicks": "0",
    "costAmountScaled": "0"
  },
  "items": [],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "totalItems": 0,
    "totalPages": 0
  }
}
```

允许的 `sortBy`：`keywordName`、`impressions`、`clicks`、`costAmountScaled`、`ctr`、`averageCpc`；允许的 `sortOrder`：`ascend`、`descend`。`query` 对规范化后的关键词名称做包含匹配，最大 200 字符。`campaignId`、`adGroupId` 按事实字段精确匹配。CTR/CPC 排序使用精确分子分母比较，不转换为 JavaScript 浮点。

`page` 默认 1，`pageSize` 默认 50、最大 200。实施前可以根据生产测量下调默认值或最大值，但变更必须先更新本合同和测试，不能由客户端任意放大。

`summary` 应用与 `items` 相同的日期、query、campaignId 和 adGroupId 过滤，但聚合全部匹配事实，不受 page/pageSize 影响。summary、items、totalItems 必须在同一只读事务中读取。字段只覆盖现役关键词指标卡需要的精确指标；缺失为 `null`，不得补零。

### 6.4 搜索词

```text
GET /api/marketing/projects/:projectId/search-terms
  ?revision=<opaque>
  &from=YYYY-MM-DD
  &to=YYYY-MM-DD
  &page=1
  &pageSize=50
  &sortBy=impressions
  &sortOrder=descend
  &query=<text>
  &accountId=<id>
  &campaignId=<id>
  &adGroupId=<id>
  &keywordName=<text>
  &queryStatus=<ADDED|NOT_ADDED|NOT_ADDABLE>
  &matchType=<text>
```

响应信封与关键词一致，`schemaVersion` 为 `marketing_search_terms_v1`。允许的 `sortBy`：`searchTerm`、`keywordName`、`impressions`、`clicks`、`costAmountScaled`、`ctr`、`averageCpc`。

过滤允许 `query`、`accountId`、`campaignId`、`adGroupId`、`keywordName`、`queryStatus` 和 `matchType`。其中 `accountId + campaignId + adGroupId + keywordName` 用于保持现役关键词下钻的事实身份；`queryStatus` 与 `matchType` 对应正式页面已有筛选。所有 ID、枚举和文本都使用绑定参数与长度限制。

每项保留现役字段：账户、计划、单元、关键词名称、搜索词、query status、match type、精确指标和 trend。搜索词不返回 `keywordId`；`keywordName` 只是上游证据，不建立不可证明的关键词 ID 关系。CTR/CPC 排序与关键词资源相同，只按可靠分子分母做精确比较。

### 6.5 分页与排序确定性

关键词聚合键为账户、计划、单元和 `keyword_id`；搜索词聚合键为账户、计划、单元和 `search_term_key`。先按 revision、日期和过滤条件筛选逐日事实，再按聚合键汇总，最后排序和分页。

每个业务排序都追加稳定键作为 tie-breaker，确保同一 revision 的相邻页不会重复或遗漏。精确数值排序必须在数据库使用精确数值表达，不按字符串词法排序，也不转换为 JavaScript 浮点。

总数查询与 items 查询在同一个只读事务中完成。合法超出末页返回 `200`、空 `items` 和真实 pagination，不返回 404。

### 6.6 错误合同

继续使用 `{ error: { code, message } }`：

| HTTP | code | 语义 |
| ---: | --- | --- |
| 400 | `MARKETING_REVISION_REQUIRED` | 详情请求缺少 revision。 |
| 400 | `MARKETING_AD_RESOURCE_QUERY_INVALID` | 页码、page size、排序、过滤或日期格式非法。 |
| 403/404 | 现役项目错误码 | 项目不允许、无权访问或不存在。 |
| 404 | `MARKETING_REVISION_NOT_FOUND` | 完成权限检查后，该项目没有此完整 revision。 |
| 409 | `MARKETING_SNAPSHOT_UNAVAILABLE` | revision 对应事实已不可用或快照不完整。 |
| 422 | `DASHBOARD_DATE_OUT_OF_RANGE` | 日期不在 revision coverage 内。 |
| 500 | `MARKETING_AD_RESOURCE_FAILED` | 内部读取失败；浏览器只收到稳定消息。 |

revision 查找前先完成项目 allowlist 与所有权检查，避免枚举其他项目的 run ID。合法零事实不返回 `MARKETING_SNAPSHOT_UNAVAILABLE`。

### 6.7 缓存

- Dashboard 表示“当前可用快照”和活动刷新状态，保持 `Cache-Control: private, no-store`；
- 三个详情端点显式钉扎不可变 revision，使用 `Cache-Control: private, max-age=60`；
- 缓存键必须包含用户授权上下文、项目、revision、from、to、分页、排序和筛选；
- 不使用共享/public cache，不让 CDN 跨用户缓存营销数据。

## 7. 内部模块设计

### 7.1 `MarketingSnapshotSelector`

新增：

```text
backend/modules/marketing/services/MarketingSnapshotSelector.js
```

它只负责：

- 在事务中读取项目绑定和连接状态；
- 计算活动绑定 fingerprint；
- 为 Dashboard 选择当前可用完整 run；
- 为详情资源按项目精确解析显式 revision；
- 校验 `SUCCEEDED`、binding fingerprint、coverage 和日期；
- 返回规范化 snapshot context。

建议接口：

```js
selectCurrent({ projectId, from, to, transaction })
  => { project, bindings, snapshotRun, filter }

selectRevision({ projectId, revision, from, to, transaction })
  => { project, bindings, snapshotRun, filter }
```

selector 不执行权限校验、不读取事实、不聚合、不缓存，也不依赖 Express。项目权限继续由 route 调用现役 `dashboardService.assertAccess()` 完成。

这是资源一致性所必需的最小抽取，不是独立 composition root 项目。

### 7.2 `MarketingAdResourceService`

新增：

```text
backend/modules/marketing/services/MarketingAdResourceService.js
```

一个 service 足以承载三个高度相关的只读查询，首版不创建三个近似 service。它依赖 `sequelize` 和 `snapshotSelector`，提供：

```js
readHierarchy({ projectId, revision, from, to })
readKeywords({ projectId, revision, from, to, page, pageSize, ...filters })
readSearchTerms({ projectId, revision, from, to, page, pageSize, ...filters })
```

每个公开方法自行开启只读 `REPEATABLE READ` 事务，在该事务内解析 revision 并查询事实。不能先在事务外解析 revision，再在另一个事务读取数据。

### 7.3 Dashboard service

`MarketingDashboardService` 继续拥有：

- 项目访问检查；
- 当前快照根读取；
- summary、trend、状态、绑定和 refresh run 展示。

R1 先让它复用 selector，但继续读取并返回四组明细，确保旧合同不变。R2 删除明细查询与聚合，只查询计划 summary/trend 和四类聚合数量。

### 7.4 路由

新增：

```text
backend/modules/marketing/routes/marketingAdResourceRoutes.js
```

该 router 注册三个 GET 端点，复用 dashboard service 的访问检查和现役错误发送规则。`backend/modules/marketing/index.js` 只增加一次 service/router 装配；不顺手重排全部营销模块构造。

## 8. 数据查询设计

### 8.1 表与 revision

资源继续读取：

- `baidu_campaign_daily_metrics`；
- `baidu_ad_group_daily_metrics`；
- `baidu_keyword_daily_metrics`；
- `baidu_search_term_daily_metrics`；
- `baidu_marketing_refresh_runs`。

所有事实查询必须同时包含：

```text
project_id = :projectId
refresh_run_id = :revision
metric_date >= :from
metric_date <= :to
```

revision 不替代 project 条件。禁止仅凭全局 run ID 查询事实。

### 8.2 SQL 安全

数值、文本、ID 和分页值全部使用 replacements/bind。只有从常量允许列表映射出的列名和排序方向可以拼接 SQL；不能把 `sortBy` 或 `sortOrder` 原文插入。

文本查询先限制长度并转义数据库 LIKE 通配符。PostgreSQL 和测试数据库的大小写语义必须由合同测试固定，不能依赖环境默认 collation。

### 8.3 索引与迁移

006 首版不预设新索引或迁移。实现时先对真实规模执行 `EXPLAIN (ANALYZE, BUFFERS)`，证明现有 `(project_id, refresh_run_id, metric_date, ...)` 索引是否满足查询预算。只有出现真实慢查询证据时另增只服务该读路径的迁移，不能改写已应用迁移。

## 9. 前端读取流程

页面统一流程：

```text
读取轻量 Dashboard
        │
        ├── 无 revision：展示现役未连接/无快照/刷新状态
        │
        └── 有 revision：以 revision + effective filter 请求页面资源
                         │
                         ├── 响应 revision 相同：渲染
                         └── 不同或合同无效：拒绝渲染并提示重新加载
```

R1 期间轻量根尚未正式硬切，前端可从旧 Dashboard 获取相同 revision 和 filter，再请求新资源。每个 hook 继续使用请求序号或取消机制，防止旧日期请求晚回覆盖新日期。

搜索词周期比较的本期与上期必须使用同一 revision；若上期超出该 revision coverage，则诚实显示不可比较，不自动读取另一个 revision 拼接。

## 10. 实现切片

### U1：生产基线与合同冻结

**目标：** 只读测量现役 Dashboard 和逐页消费者，冻结后续资源共用的机器合同，不改变生产 API。

**涉及文件：**

- `backend/modules/marketing/contracts/MarketingAdReadContract.js`；
- `backend/tests/marketing/MarketingAdReadContract.test.js`；
- `production-baseline.md`；
- PRD、Tech Spec 和 Issue 001。

**验收：** 压缩/未压缩字节、P95、消费者和真实行数有脱敏生产证据；分页、筛选、排序、summary、schema、revision、缓存和错误合同由测试固定；现役 Dashboard JSON、路由、数据库和刷新行为不变。

### U2：搜索词资源纵向切片

**目标：** 建立唯一 selector 和第一个 additive 搜索词资源，并迁移搜索词页面。

**涉及文件：**

- `backend/modules/marketing/services/MarketingSnapshotSelector.js`；
- `backend/modules/marketing/services/MarketingAdResourceService.js`；
- `backend/modules/marketing/routes/marketingAdResourceRoutes.js`；
- `backend/modules/marketing/index.js`；
- `backend/tests/marketing/MarketingSnapshotSelector.test.js`；
- `backend/tests/marketing/MarketingAdResourceApi.test.js`；
- `nextjs-frontend/src/lib/marketing/useAdSearchTerms.ts`；
- `nextjs-frontend/src/lib/marketing/adSearchTermAdapter.ts`；
- 对应类型和测试。

**验收：** 搜索词 revision、权限、分页、筛选、排序、精确值、空页、缓存和错误合同通过；页面本期与上期使用同一 revision，不再下载两份完整 Dashboard；其他消费者与旧 Dashboard 保持不变。

### U3：关键词资源纵向切片

**目标：** 增加关键词资源并把关键词页迁移到服务端分页、筛选和排序。

**涉及文件：**

- `backend/modules/marketing/services/MarketingAdResourceService.js`；
- `backend/tests/marketing/MarketingAdResourceApi.test.js`；
- `nextjs-frontend/src/lib/marketing/useKeywordAnalysis.ts`；
- `nextjs-frontend/src/lib/marketing/keywordAnalysisAdapter.ts`；
- 对应类型和测试。

**验收：** 浏览器请求行数有界，列表总数、筛选、排序、合法空页和完整筛选范围 summary 与同 revision 事实一致；页面不再解析 campaigns、adGroups 或 searchTerms。

### U4：广告层级资源纵向切片

**目标：** 增加同 revision 的计划、单元、关键词层级资源并迁移广告表现页。

**涉及文件：**

- `backend/modules/marketing/services/MarketingAdResourceService.js`；
- `backend/tests/marketing/MarketingAdResourceApi.test.js`；
- `nextjs-frontend/src/lib/marketing/useAdPerformance.ts`；
- `nextjs-frontend/src/lib/marketing/adPerformanceAdapter.ts`；
- 对应类型、测试和浏览器证据。

**验收：** 广告树、精确指标、trend、全范围 summary 和父子事实正确；响应不读取搜索词，页面不再从 Dashboard 读取三层明细。

### U5：R1 发布与零详细消费者观察

**目标：** additive 发布三个资源和已迁移详细页面，证明旧 Dashboard 明细没有现役消费者。

**涉及文件：**

- R1 生产验收记录。

**验收：** 独立 R1 Git Bundle、正式 API、真实 Chrome、Network、日志和响应预算通过；详细页面只调用新资源，市场总览仍使用完整 Dashboard，需求继续 `active`。

### U6：轻量 Dashboard 硬切与本地清理

**目标：** 把 Dashboard 改为唯一轻量合同，切换市场总览并删除旧大响应代码和兼容依赖。

**涉及文件：**

- `backend/modules/marketing/services/MarketingDashboardService.js`；
- `backend/modules/marketing/routes/marketingDashboardRoutes.js`；
- `backend/tests/marketing/MarketingDashboardReader.test.js`；
- `backend/tests/marketing/MarketingDashboardApi.test.js`；
- `nextjs-frontend/src/lib/marketing/readMarketingDashboard.ts`；
- 市场总览 hook、类型、adapter、文档和验收记录。

**验收：** 本地 Dashboard 不返回四个明细数组；市场总览只消费轻量根；旧 adapter、fixture 合同、兼容分支、测试和现役说明删除。此时尚未完成 R2 生产发布，不提前关闭需求。

### U7：R2 发布、退役验收与关闭

**目标：** 用独立 R2 Git Bundle 正式发布硬切版本，证明旧大响应生产调用为零并关闭 006。

**涉及文件：**

- R2 Bundle、部署与生产验收记录；
- 006 PRD、Tech Spec、Issue 007 和目录状态；
- `docs/README.md` 与 `docs/DEPLOYMENT.md`。

**验收：** 正式 Dashboard 只有轻量合同，三个详情资源全部钉扎 revision；正式 Chrome 四页与 Network 通过，旧数组、adapter、fallback、测试和现役文档为零；目录改为 `closed` 并移交 007。

## 11. 验收标准

- AC-001：Given 003 未关闭，When 检查门禁，Then 006 不修改代码或生产 API。
- AC-002：Given R1 发布，When 调用 Dashboard，Then 旧响应合同保持不变，三个新资源 additive 可用。
- AC-003：Given 详情请求缺少 revision，When 调用任一新资源，Then 返回 400 且不选择最新快照代替。
- AC-004：Given revision 属于其他项目，When 已授权用户请求当前项目，Then 不返回该 revision 的存在或数据。
- AC-005：Given 请求日期超出 revision coverage，When 查询资源，Then 返回 `DASHBOARD_DATE_OUT_OF_RANGE`。
- AC-006：Given 刷新在根和详情请求之间完成，When 详情携带旧 revision，Then 只返回旧 revision 数据。
- AC-007：Given 广告层级请求，When 读取事实，Then 计划、单元和关键词属于一个 revision，且不返回搜索词。
- AC-008：Given 关键词或搜索词查询，When 分页排序，Then 每页有界、顺序稳定、总数正确且精确值未转浮点。
- AC-008A：Given 关键词查询，When 改变 page/pageSize，Then 完整筛选范围 summary 不变；Given 广告层级查询，Then summary 覆盖完整所选层级事实；两者均与同 revision 事实精确一致。
- AC-009：Given 搜索词响应，When 校验字段，Then 不存在伪造 `keywordId`。
- AC-010：Given 合法空页，When 查询，Then 返回 200、空 items 和有效 pagination；无快照使用不同错误/状态。
- AC-011：Given R1 观察结束，When 进入 R2，Then 旧明细消费者和生产调用均为 0。
- AC-012：Given R2 正式合同，When 调用 Dashboard，Then 不返回 campaigns、adGroups、keywords 或 searchTerms。
- AC-013：Given 正式域名登录用户，When 查看市场总览、广告表现、关键词和搜索词，Then 来源、日期、状态、指标和 revision 一致性正确。
- AC-014：Given 全仓搜索，When R2 完成，Then 旧大 Dashboard adapter、fallback 和当前文档引用为 0。

## 12. 测试与验证计划

### 12.1 自动化

- selector：当前快照、显式 revision、绑定 fingerprint、归档项目、日期边界和无快照；
- API：权限先行、revision 枚举保护、严格 query、分页上限、排序允许列表、空页和稳定错误；
- 数据：四类聚合、精确金额、trend、父子名称、搜索词无 keyword ID；
- 汇总：广告层级和关键词 summary 覆盖全部筛选结果，与分页无关并与 items/count 同事务；
- 一致性：根读取后插入新成功 run，详情仍返回旧 revision；
- 事务：count 与 items 同一快照，任一查询失败不返回部分响应；
- 前端：hook 请求形状、过期响应丢弃、日期 clamp、分页、空/错/刷新状态；
- 退役：R2 Dashboard schema 明确拒绝四个旧数组，旧消费者 import 搜索为 0。

### 12.2 性能基线

R1 前记录：

- Dashboard 压缩前/后响应字节；
- Dashboard DB 总耗时和各事实查询耗时；
- 搜索词页本期/上期请求数和传输字节；
- 关键词、搜索词最大观测行数；
- 新分页 SQL 的 `EXPLAIN (ANALYZE, BUFFERS)`。

R2 成功不以主观“更快”为准，而以市场总览明细数组为 0、详细页请求行数有界、响应字节下降且 P95 不回归为证据。

### 12.3 正式入口

每次发布都从 `https://insight.guangtuo.com` 登录验证：

- 公开 backend/frontend revision 与目标 Git Bundle 一致；
- `/api/ready` 为 ready；
- 四个营销页面显示真实百度广告数据；
- 浏览器 Network 中路径、revision、filter、分页和返回体符合阶段合同；
- 后端日志无 SQL、Token、原始上游响应或未处理错误；
- R2 后旧 Dashboard 大数组生产调用为 0。

## 13. 发布、恢复与退役

### 13.1 R1

R1 只 additive 增加资源并迁移详细页面。旧 Dashboard 仍是兼容合同，因此 R1 未完成正式退役，需求保持 `active`。

阻断回归通过 R1 后代 revert revision 快进恢复。因为没有数据库迁移，不恢复数据库；不得用 feature flag 或新接口失败后回退旧 Dashboard 的运行时 fallback。

### 13.2 R2

R2 前必须证明：

- 三个详细页面已稳定使用新资源；
- 市场总览只需要轻量字段；
- 仓库内消费者、诊断脚本和生产访问均不读取旧数组；
- R1 观察期没有 revision、指标或分页 P0/P1。

R2 同时切换轻量 Dashboard、更新市场总览、删除旧数组及其类型/adapter/测试/文档。不能只让新合同“可用”而保留旧数组作为隐藏兼容。

R2 阻断失败同样使用后代 revert revision 快进恢复到完整 R1 合同，并记录退出条件；修复后再次执行 R2，不增加长期双版本。

## 14. 风险与缓解

- 多请求混快照：详情强制 revision，服务端按项目和 coverage 校验；
- 分页统计不一致：count 和 items 同事务、同筛选、稳定 tie-breaker；
- SQL 注入：仅允许列表列名可拼接，其余全部绑定；
- 广告层级仍偏大：首版按真实页面保留一个层级资源，超过预算后再设计懒加载；
- R1 兼容永久化：R2 有零消费者和生产调用的明确门禁，完成时硬删除；
- 资源化顺手改口径：新资源直接复用现役聚合语义，指标变化另立需求；
- 与 007/005 冲突：不并行；006 只交付稳定资源与 summary，007 修正数据行为，005 最后做等价重构。

## 15. 关键技术决策

- KTD-001：采用轻量根 + 三个读资源，不拆成大量 CRUD。理由：匹配四个真实页面用途。
- KTD-002：使用响应 `schemaVersion`，不增加 URL 版本。理由：当前只有仓库内消费者且有可控两阶段迁移。
- KTD-003：详情必须提供 revision，不允许隐式 latest。理由：这是多请求保持一致性的必要条件。
- KTD-004：只抽取一个 `MarketingSnapshotSelector`。理由：去除快照选择重复，同时避免扩大为 composition root 项目。
- KTD-005：关键词和搜索词在 SQL 端分页。理由：内存聚合后分页仍会读取全部事实，不能解决资源预算。
- KTD-006：广告层级首版保持一个响应。理由：现役树形页面需要三层一致读模型，当前没有进一步拆分证据。
- KTD-007：R1 additive、R2 hard cut。理由：允许逐页验证，同时避免长期双合同和 fallback。
- KTD-008：默认 `006 → 007 → 005`。理由：先固定内部消费者需要的 API，再修正数据行为，最后以正确行为做 provider 纯等价重构。

## 16. 假设与开放问题

- Issue 001 已确认仓库内只有 Next.js 消费者；后端 CLI、诊断脚本和当前 Nginx 留存窗口未发现额外明细消费者，R1/R2 前仍须重新搜索与观察；
- refresh run 对应事实保留期足够支持页面所用 revision；若有清理策略，必须先固定可读取窗口和错误语义；
- 默认 page size 50、最大 200 已用生产 898 个关键词和 350 个搜索词基线验证并冻结；
- 现役 UI 的排序/筛选字段已在 Issue 001 冻结，机器合同位于 `backend/modules/marketing/contracts/MarketingAdReadContract.js`，后续不能为假想场景扩大允许列表；
- 若真实 SQL 计划证明必须增加索引，另增迁移并重新评审发布范围。

## 17. Handoff

- PRD: `docs/active-2026-08-05-006-marketing-api-resourceization/prd.md`
- Tech Spec: `docs/active-2026-08-05-006-marketing-api-resourceization/TECH-SPEC.md`
- Status: `active`；003 已完成正式关闭，Issue 001 已取得只读生产基线并冻结机器合同，现役 API、页面、数据库和刷新行为未改变。
- First implementation gate: 已通过；003 closed revision 与生产证据见 `docs/DEPLOYMENT.md`。
- Suggested first issue: Issue 002 交付 revision 钉扎的搜索词资源；selector 与第一个 additive 资源在同一纵向切片实现。
- Suggested issue split: U1–U7；R1 完成 U1–U5，R2 完成 U6–U7。
- Completion condition: R2 正式入口验证通过，轻量 Dashboard 成为唯一默认合同，旧大响应及其兼容代码和文档已删除；随后移交 007，不直接进入 005。
