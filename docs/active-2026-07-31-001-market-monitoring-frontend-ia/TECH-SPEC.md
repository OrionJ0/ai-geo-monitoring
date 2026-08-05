---
title: 市场数据监控前端信息架构与市场总览技术方案
date: 2026-07-31
status: active
source: docs/active-2026-07-31-001-market-monitoring-frontend-ia/prd.md
scope: deep
---

# 市场数据监控前端信息架构与市场总览技术方案

## 0. 2026-08-04 口径更新与实施边界

本文主体保留 V1 工作台技术基线，并在本节及相关章节记录 V2 现役实现。不得再把其中“订单金额唯一结果”“需要关注为首页模块”等历史内容当作新版要求；“独立来源、不伪造跨系统归因”仍是当前数据诚信边界。

现行产品与视觉权威依次为：

1. `prd.md`（2026-08-03 版）；
2. `../visual-design-spec.md`；
3. `assets/market-overview-home-final-2026-08-03.png`。

新版目标按内置渠道展示“广告投入 / 展现 → 百度统计访问 → 官网表单咨询 / 在线客服咨询 → 线索入池 → 成交订单”，官网表单与 53KF 在线客服是独立事实。百度推广行的广告投入/展现来自百度营销，访问来自百度统计付费搜索；广告点击不得冒充访问。成交订单同时提供订单数和订单金额。CPA、成交率和整体转化率使用成交订单数，ROAS 使用成交订单金额。只有可信来源键或确认映射成立时，下游记录才进入同一渠道链路。

当前仓库已完成并部署新版页面视觉、交互、状态、响应式与无障碍实现，包含百度推广行、CPC、百度统计来源行和趋势，以及独立官网表单区间/逐日接口与“官网表单咨询”列。官网模块使用 `/api/website-data`、独立配置/服务/缓存仓储/迁移账本和前端 hook；百度继续使用 `/api/marketing`。2026-08-04 已进入 `main` 的九键版本硬切为分页读取联系人列表并统计全部表单记录，原始 `referrer`、UTM 和付费标识统一归入九键，缺失来源进入 `UNKNOWN`；统计快照不保存联系人或原始 URL。`/api/consultations` 继续按需提供脱敏列表/详情，不参与统计计算。2026-07-05 至 2026-08-04 已使用独立只读凭据对账 21 条记录：`DIRECT=3`、`BING_SEARCH=1`、`UNKNOWN=17`，逐日合计一致。九键版本尚未部署，官网生产仍缺专用项目与只读账号凭据并保持 `DISABLED`。53KF、客服转线索、订单结果接口合同仍缺失，ROAS/CPL/CPA 仍为诚实缺失状态。

同次盘点确认广告表现、关键词分析、网站流量、咨询数据和订单结果均已有本地设计实现。咨询数据页消费严格的 `consultation_records_v1` 浏览器合同，其中“原始咨询”仍是领域事实名称；配置完整时官网 adapter 为 `AVAILABLE/FULL`，失败时与 53KF 独立降级，53KF adapter 固定为 `NOT_CONNECTED`。订单结果没有网络客户端，生产数据源固定为 `UNAVAILABLE`，完整数据仅能在 `NODE_ENV !== 'production'` 时显式启用 fixture。逐页状态统一见 `../README.md#当前前端页面实施状态`。

## 1. 背景与目标

V1 实施开始时，应用入口、侧边栏和项目选择仍服务于 GEO/SEO 工具形态；该轮实现随后建立了单品牌内部工作台的新导航、默认项目上下文、旧版市场总览以及广告和网站流量下钻页。当前代码与生产都已使用完整导航和 `/geo/market-overview` 默认入口；各来源可用性仍由独立模块状态决定。

目标终态：

- 普通用户无需选择项目即可进入广拓上下文。
- 完整导航和市场总览立即接管 `/geo` 默认入口；未开放来源显示只读占位状态。
- `READY` 只控制百度真实数据正式开放，不再控制菜单或默认路由；GEO/SEO 能力继续从新分组访问。
- 市场总览分别读取广告数据库快照和百度统计数据库快照，允许单一来源失败；两者均使用访问触发式 10 分钟数据库缓存，无页面访问时不请求百度。百度统计基础快照按 PC / 移动端隔离，具体来源趋势只在用户选择后按来源和覆盖范围独立缓存。
- 正式切换后旧合并营销页退出推荐路径，不作为静默回退。

## 2. 范围与非目标

### 范围

- 默认监控项目的持久配置、鉴权读取和管理员维护。
- 前端统一项目上下文，不再以项目列表第一项作为回退。
- GEO 侧边栏配置化、分组化和能力门控制。
- `/geo` 默认入口解析。
- 新增市场总览、广告表现、关键词分析、网站流量、咨询数据和订单结果页面；关键词分析只指百度投放关键词，不把用户搜索词或推广计划聚合冒充关键词事实。
- 咨询数据与订单结果在真实来源缺失时仍提供完整、诚实的页面状态；非生产 fixture 只用于视觉与交互验收，不进入生产默认路径。
- 复用营销快照、刷新、百度统计和精确值工具。
- V1 市场总览的独立来源状态、相对趋势和确定性“需要关注”条目（新版首页已取消常驻“需要关注”模块）。
- 原项目看板、来源分析、SEO 检测的显示名称和导航选中态调整。
- 旧 `/geo/marketing` 的正式迁移和入口级验证。

### 非目标

- 不把官网聚合表单数量冒充记录级原始咨询；记录列表只来自已验证的官网联系人只读接口并在服务端脱敏。不接入尚未验证的 53KF 对话、线索池或销售订单事实。
- 不建立通用来源注册表或转换平台。
- 不改变百度合同、OAuth、绑定、刷新和快照事务语义。
- 不把百度统计写入广告本地快照。
- 不修改 GEO 指标、告警规则或报告语义。
- 不实现多品牌或多项目切换 UI。
- 不使用 AI 生成异常或行动建议。
- 不批准尚未由产品确认的波动阈值。

### 延后事项

- 53KF 有效对话的真实只读 adapter；官网记录级 adapter 已完成本地真实验证。
- 真实订单接口，以及咨询与订单结果的可审计人工关联。
- 真实历史数据驱动的阈值校准。
- 个性化首页和自定义看板。

## 3. 当前系统认知

### 3.1 前端入口与导航

- `nextjs-frontend/src/app/geo/page.tsx` 当前固定重定向到 `/geo/market-overview`。
- `nextjs-frontend/src/app/geo/layout.tsx` 消费统一导航合同，并维护登录态和响应式侧栏；主内容不渲染面包屑。
- 当前导航已切换为完整市场监控信息架构，页面入口与来源数据可用性解耦。
- `nextjs-frontend/src/utils/geoNavigation.test.cjs` 用源码契约测试固定现有菜单与旧路由重定向。
- 登录令牌保存在 `localStorage`，Next.js 服务组件无法在服务端安全解析当前用户，因此 `/geo` 的动态默认入口需要在受保护客户端环境中解析。

### 3.2 项目上下文

- `BrandProject` 是 GEO 数据、权限、监测任务和营销绑定的共同边界。
- `nextjs-frontend/src/utils/projectSelection.cjs` 当前在选中项和偏好项都无效时回退到项目列表第一项。
- 项目看板、来源分析、告警、问题库和运行报告分别维护项目列表和选择状态。
- 项目 API 的访问规则是管理员可访问全部项目，普通用户只能访问自己的项目。
- `Setting` 已提供唯一键值存储，但 `backend/routes/settings.js` 只允许有限白名单设置，且普通用户不能读取管理员设置。

### 3.3 营销模块

- `backend/modules/marketing/config.js` 已区分 `DISABLED`、`PILOT_READY`、`PILOT_DATA_READY`、`READY` 和配置错误。
- `PILOT_DATA_READY` 和 `READY` 都可读取广告快照和百度统计；`formalNavigation` 保留为百度来源正式开放状态，不再控制页面和菜单是否显示。
- `MarketingDashboardService` 从本地同一成功快照返回精确字符串形式的消费、展现、点击、逐日趋势，以及分开的计划、单元、关键词和搜索词集合。严格树到关键词；搜索词不含关键词 ID。
- `BaiduTongjiService` 每次调用实时读取项目明确绑定的活动站点，返回 PV、访问次数、访客数及逐日趋势；它不进入广告快照，也没有与广告相同的成功时间。
- 当前网站流量接入使用百度统计商业账号 API：`ReportService/getSiteList` 与 `ReportService/getData`。代码没有接入百度搜索资源平台，也不抓取其页面或调用未公开的读报表接口。
- 百度营销 dev2 OAuth 的 Access/Refresh Token 只服务搜索推广 API；百度统计商业账号 API 使用统计后台“数据 API”页面单独签发的账户名和 Token。两套凭据分别加密保存，统计 Token 保存前必须实时通过站点目录校验，任何生产路径不得以 dev2 Token 代替。
- 百度统计站点随项目绑定持久保存 `siteId` 和上游目录返回的域名。管理员必须从所选连接/搜索账户的实时站点目录中明确选择，运行时重新校验同一 `siteId` 仍为 `ACTIVE` 且域名未变化；缺失、停用或域名变化均返回明确错误，不回退到“唯一活动站点”。
- 两个服务都复用项目 allowlist；广告读取另有项目权限检查。
- `/geo/marketing` 已退役为到 `/geo/market-overview` 的单向服务端重定向；旧页面 UI 和数据读取逻辑已删除，不存在第二套正式首页或 fallback。
- 营销页面已有精确值、边界文案、等价数据表、焦点和窄屏测试。

### 3.4 需要沿用的模式

- 浏览器 API 始终使用同源 `/api/*` 和 `@/lib/axiosConfig`。
- 外部 ID、计数和金额保持规范十进制字符串；汇总不得经 JavaScript `Number`。
- 读取错误返回稳定 `error.code` 和安全用户文案，不泄露密钥、Token 或配置值。
- 百度广告 GET 保持纯读；刷新继续由显式 POST 创建。
- 来源失败时保留最后成功快照和来源状态。
- 管理员配置与普通用户只读状态分离。

## 4. 需求、约束与规则

### 需求

- REQ-001：管理员可以显式配置唯一默认监控项目。
- REQ-002：普通用户可以读取自己有权访问的默认项目上下文，但不能读取其他系统设置。
- REQ-003：默认项目不可用时页面阻断，不猜测其他项目。
- REQ-004：导航名称、分组和选中态来自同一配置。
- REQ-005：所有阶段都显示完整市场导航与转化结果占位页，页面可见不代表数据能力开放。
- REQ-006：市场总览始终是 `/geo` 默认入口；`READY` 只把百度来源从试点或占位状态切换为正式数据状态。
- REQ-007：市场总览允许广告或网站流量单独失败，并展示另一来源的可用数据。
- REQ-008：新版首页只有投放效率、全链路数据和每日趋势三个业务模块，另有面包屑/设备/全局日期行。
- REQ-011：六个营销页面共用 `MarketingPageFilters`、`MarketingFiltersProvider` 和 `MarketingMetricCard`；全局筛选初始为“PC 端 + 最近 7 天”，设备选择器不加多余视觉包裹并固定位于日期左侧，日期使用共享的最近 7/14/30/90 天预设并按上游覆盖裁剪；设备和日期在六页之间同步。缺少设备维度的页面仍允许修改全局设备，但标注“本页未应用”且按全部设备查询。每张总览卡固定显示本期、上期和较上一周期。
- REQ-009：数据健康、接入状态和复杂异常迁移到对应下钻或数据接入页，不作为首页常驻模块。
- REQ-010：正式切换后旧营销页不再作为推荐入口或回退路径。

### 约束

- CON-001：所有市场能力保持只读。
- CON-002：只有可信来源键或确认映射成立时，广告、网站、咨询、线索和订单记录才能进入同一来源行；不得把同期总量直接拼接成归因。
- CON-003：销售侧必须同步成交订单数和成交订单金额；不得用金额反推数量。CPA、成交率和整体转化率使用订单数，ROAS 使用订单金额。
- CON-004：百度真实数据正式开放必须晚于 `VERIFIED` 合同和入口级生产验收；导航与占位页可提前开放。
- CON-005：工作区存在其他未提交改动；实现必须限制在需求涉及文件，不覆盖无关修改。
- CON-006：前端认证依赖客户端 `localStorage`，不能把动态入口实现成未鉴权的服务端数据请求。
- CON-007：异常阈值未批准前，只能上线数据健康类事项或关闭趋势异常。

### 既有模式

- PAT-001：使用服务层封装设置校验和项目访问，不在路由中复制业务判断。
- PAT-002：对现有 API 做 additive 扩展，不改变既有字段含义。
- PAT-003：纯展示推导放在可独立单元测试的纯函数中。
- PAT-004：新页面复用共享数据客户端和展示组件，不复制当前合并页的请求状态机。
- PAT-005：页面路由始终可达，API 能力门继续使用服务端状态；页面可见不是数据授权控制。

## 5. 接口与数据契约

### 5.1 默认项目上下文

新增认证接口：

```http
GET /api/geo-projects/default-context
```

成功响应：

```json
{
  "success": true,
  "data": {
    "project": {
      "id": "11",
      "name": "广拓",
      "status": "active",
      "website": "https://example.com"
    },
    "source": "SYSTEM_DEFAULT"
  }
}
```

规则：

- `id` 对前端以字符串传递，避免不同页面混用字符串和数字比较。
- 返回字段只包含建立页面上下文所需的非敏感项目摘要。
- 普通用户仍受现有项目访问规则限制。
- 管理员可以读取任意被配置项目。
- 项目不存在、已归档或当前用户无权访问时不得选择其他项目。

错误：

| HTTP | code | 含义 |
|---|---|---|
| 409 | `DEFAULT_PROJECT_NOT_CONFIGURED` | 管理员尚未配置 |
| 409 | `DEFAULT_PROJECT_UNAVAILABLE` | 项目不存在或已归档 |
| 403 | `DEFAULT_PROJECT_FORBIDDEN` | 当前用户无权访问 |
| 503 | `DEFAULT_PROJECT_READ_FAILED` | 无法验证配置 |

新增管理员接口：

```http
PUT /api/geo-projects/default-context
Content-Type: application/json

{ "projectId": "11" }
```

规则：

- 请求只接受 `projectId` 一个字段。
- 目标必须是存在且活动的项目。
- 保存到现有 `settings` 表的内部键 `market_default_project_id`。
- 更新应使用唯一键 upsert；不新增业务表或营销迁移。
- 返回与 GET 相同的项目摘要。

错误：

| HTTP | code | 含义 |
|---|---|---|
| 400 | `DEFAULT_PROJECT_REQUEST_INVALID` | 字段或 ID 无效 |
| 404 | `PROJECT_NOT_FOUND` | 项目不存在 |
| 409 | `DEFAULT_PROJECT_ARCHIVED` | 目标已归档 |
| 403 | `ADMIN_REQUIRED` | 非管理员写入 |

### 5.2 营销状态能力

保留：

```http
GET /api/marketing/status
```

在现有 `moduleState`、`errorCode` 之外 additive 返回：

```json
{
  "moduleState": "PILOT_DATA_READY",
  "errorCode": null,
  "capabilities": {
    "pilotDataAccess": true,
    "formalNavigation": false,
    "adsRead": true,
    "trafficRead": true,
    "refreshAds": true
  }
}
```

映射：

| moduleState | pilotDataAccess | formalNavigation | adsRead | trafficRead |
|---|---:|---:|---:|---:|
| `DISABLED` / 错误状态 | false | false | false | false |
| `PILOT_READY` | false | false | false | false |
| `PILOT_DATA_READY` | true | false | true | true |
| `READY` | true | true | true | true |

说明：

- `formalNavigation` 表示百度来源是否完成正式开放，不控制工作台页面与菜单可见性，也不代替项目 allowlist、权限或 API `requireReady`。
- 广告与百度统计在当前合同中共用正式开放门；运行健康仍分别展示。
- 未来转化来源使用自己的能力合同，不塞入百度营销状态。

### 5.3 既有广告与流量接口

继续使用：

```http
GET  /api/marketing/projects/:projectId/dashboard
POST /api/marketing/projects/:projectId/refresh-runs
GET  /api/marketing/projects/:projectId/refresh-runs/:runId
GET  /api/marketing/projects/:projectId/website-traffic-overview
GET  /api/marketing/projects/:projectId/website-traffic-pages
```

兼容要求：

- 广告 Dashboard 和非来源字段不重命名、不删除、不改变含义。旧百度统计 `OTHER` 来源键已被新内置渠道目录硬切替代，不保留静默 fallback；消费方必须迁移到 `OTHER_SEARCH` 或 `EXTERNAL_REFERRAL`。
- 广告页面和市场总览读取广告 Dashboard；市场总览与网站流量页共用 `website-traffic-overview` 区间合同，网站流量页另读 pages 合同。三者复用鉴权和严格响应校验，但不静默回退到另一页面的数据接口。
- 市场总览使用等价的独立状态接收广告快照、百度统计全部来源比较和官网咨询；任一失败不会抹掉其他来源。
- 百度统计固定 30 日入口使用 `baidu_tongji_snapshots`，网站流量任意当前/上一周期使用 `baidu_tongji_range_snapshots`，明确来源趋势使用 `baidu_tongji_source_trend_snapshots`；三者不能混用唯一约束。基础快照按调用能力读取全站趋势、来源汇总或全站质量，来源趋势只在收到明确 `source` 参数时读取。任一缓存未命中或超过 10 分钟时才调用上游，同键并发请求合并，失败时可回退最后成功快照。
- 市场总览不得为追求“单接口方便”把百度统计刷新塞入广告快照 GET。
- `website-traffic-overview` 是单一百度统计渠道 API，不是跨系统归因 API。它暴露固定的七渠道目录 `BAIDU_PAID|DIRECT|BAIDU_SEARCH|BING_SEARCH|GOOGLE_SEARCH|OTHER_SEARCH|EXTERNAL_REFERRAL`，并使用百度稳定来源/引擎标识读取选中渠道的 `trend/time/a` 趋势；`source=ALL&metric=visits&includeSourceComparison=true` 返回全部渠道对比。
- 响应必须携带 `attribution.level = WEBSITE_TRAFFIC_SOURCE` 与 `isCrossSystemVerified = false`；非付费渠道只把 `visits` 放入“访问”。百度推广行的广告投入/展现来自 Dashboard，访问来自 `BAIDU_PAID` 统计趋势；不得用 Dashboard 点击数代替。

2026-08-05 硬切说明：固定 30 日 `tongji-trend`、`tongji-source-trends` 路由及其专属服务包装已经删除；当前正式代码和文档不得继续选择旧链路。

### 5.4 前端页面数据状态

共享页面状态：

```text
IDLE
  -> LOADING
  -> READY | PARTIAL | EMPTY | BLOCKED
```

来源槽位独立状态：

```text
AVAILABLE | ZERO | NO_DATA | STALE | SOURCE_ERROR | AUTH_REQUIRED | UNAVAILABLE
```

关键语义：

- `PARTIAL`：多个独立来源至少一个成功，且至少一个失败、未接或仅部分覆盖。
- `EMPTY`：请求成功但没有可展示数据，不等于接口失败。
- `BLOCKED`：默认项目、能力门或权限阻止读取。
- 咨询数据页读取 `consultation_records_v1` 的来源状态、列表和详情合同；配置完整时官网为 `AVAILABLE/FULL`，53KF 为 `NOT_CONNECTED`，因此正式列表只包含脱敏官网记录并显示部分覆盖原因。
- 订单结果生产数据源固定为 `UNAVAILABLE`；只有非生产环境显式请求时才进入 `DEMO`，且不调用接口、不持久化。

### 5.5 V1 历史：“需要关注”契约

> 本节只解释当前旧版代码，不属于新版首页目标。对应能力若继续保留，应迁移到数据健康或下钻页面。

前端纯函数输入：

```text
marketing module status
default project context
ad dashboard states and trend
traffic response or safe error code
approved anomaly rule version
current clock
```

输出每项包含：

```text
id
category: DATA_HEALTH | CONTINUOUS_TREND | DAILY_CHANGE
priority
source: ADS | TRAFFIC
title
detail
period
targetPath
evidenceKeys
```

规则：

- 数据健康项可以在没有趋势阈值配置时工作。
- 趋势和单日波动仅在存在批准的版本化规则时启用。
- 合并项必须保留全部 `evidenceKeys`，且目标路径一致。
- 最终按类别、核心指标影响、幅度和稳定 ID 排序后截取三条。
- 文案不得使用“导致”“带来”等归因性动词描述跨来源共同变化。

### 5.6 精确值与图表契约

- API 精确字符串是汇总、表格、下载和 tooltip 的权威值。
- 金额和计数的加总、比较、阈值判断继续使用 `BigInt` 或现有精确值函数。
- 图表几何不得直接把未验证的大整数转换为 `Number`。
- 图表使用由精确字符串计算出的 0–100 有界相对坐标；只对有界坐标转为 `Number`。
- 图表必须提供显示原始精确值的 tooltip 与等价数据表。
- 若设计要求绝对值坐标轴，必须先增加安全范围验证和降级路径，不能静默损失精度。

## 6. 关键技术决策

- KTD-001：默认项目使用现有 `settings` 表和专用服务/API，不新增营销领域表。理由：它是工作台上下文而非百度合同数据；沿用唯一键值存储足够。取舍：设置表无外键，服务层每次读取必须验证项目存在、状态和权限。
- KTD-002：默认项目缺失时 fail closed，不回退项目列表第一项或最近访问项目。理由：内部单品牌不代表可以猜测数据归属；错误项目比空页面风险更高。
- KTD-003：导航配置从 `geo/layout.tsx` 提取为纯配置构建器，由统一路由合同生成完整菜单及选中态；来源能力只控制页面数据状态。理由：无数据时仍需让内部用户理解完整业务结构，同时避免名称和选中态在多处漂移。
- KTD-004：市场总览在前端组合广告和百度统计两个既有接口，不新增跨来源聚合 API。广告和百度统计都读取各自数据库快照；保持独立接口可以保留纯读与部分失败语义。
- KTD-005：广告表现和网站流量共用请求客户端及展示组件，但保留独立页面状态。理由：复用逻辑而不制造两个来源必须同时成功的耦合。
- KTD-006：异常展示先实现数据健康规则；趋势规则由版本化配置显式启用。理由：PRD 尚未批准阈值，不能把示例数值固化为产品事实。
- KTD-007：图表几何使用精确值推导的相对坐标，权威数值仍为字符串。理由：兼顾可视化和“全链路不经浮点丢失精度”的既有合同。
- KTD-008：`/geo` 固定重定向到 `/geo/market-overview`。理由：首页结构始终可见，来源能力在页面内部独立解析，无需让入口依赖异步状态。
- KTD-009：新页面完成入口验收后，将 `/geo/marketing` 单向重定向到 `/geo/market-overview`。理由：避免旧合并页面成为第二套正式流程；共享组件可以保留，旧页面入口不能保留。
- KTD-010：当前百度广告与百度统计共用正式开放状态，但菜单始终显示、数据健康状态独立。未来来源使用 additive 能力，不提前建设通用 registry。
- KTD-011：来源拆分复用百度统计 `trend/time/a` 的官方 `source` 筛选，并保持为独立 API。理由：当前已验证解析器只覆盖逐日趋势；分别调用稳定筛选可以复用严格解析和精确字符串合同，且不会把“搜索引擎”误写成“百度自然搜索”。取舍：一次首页读取会产生三次百度统计来源请求，需遵守现有超时和错误边界；任何一次来源读取失败都使该来源接口整体失败，不返回伪完整结果。
- KTD-012：各阶段唯一主数据源和官网事件语义服从 `../adr/0001-marketing-funnel-data-source-of-truth.md`。百度统计继续作为网站来源、访问、UV 和 PV 主数据源；官网一方会话只用于表单来源归属和对账，不能替代、叠加或补齐百度统计。
- KTD-013：官网数据只由 GoodieAI 后端调用聚合统计接口；常规同步不读取联系人明细，前端不接收官网后台凭据或 JWT。官网 `organic_search` 没有引擎级键时只映射为“搜索引擎”；`contact_click_sessions` 只作为意向诊断，`submission_sessions` 只作为表单咨询部分覆盖。

## 7. 实现切片

### U1. 默认项目端到端配置

**目标：** 管理员可选择广拓项目，普通用户可安全解析同一上下文；缺失时明确阻断。

**依赖：** 无。

**涉及文件：**

- `backend/services/DefaultProjectContextService.js`
- `backend/routes/geoProjects.js`
- `backend/models/Setting.js`
- `backend/tests/DefaultProjectContextApi.test.js`
- `nextjs-frontend/src/app/admin/settings/page.tsx`
- `nextjs-frontend/src/lib/useDefaultProjectContext.ts`
- `nextjs-frontend/src/utils/defaultProjectContext.test.cjs`

**方案：**

- 用专用服务读写 `market_default_project_id`。
- 严格验证请求字段、项目状态和访问权限。
- 管理设置提供管理员选择控件和当前状态。
- 普通 hook 只消费专用读取接口，不读取完整管理员设置。

**测试场景：**

- 管理员配置活动项目并重新读取。
- 非管理员写入被拒绝。
- 未配置、归档、删除、无权和数据库失败。
- 字符串/数字 ID 统一。

**验收方式：** 管理员设置后，普通用户无需项目列表即可获得唯一广拓上下文；错误状态不会回退其他项目。

### U2. 配置化导航与固定市场总览入口

**目标：** 新分组、改名和选中态从同一配置产生；`/geo` 固定进入市场总览，来源状态只控制数据读取。

**依赖：** U1。

**涉及文件：**

- `backend/modules/marketing/routes/marketingStatusRoutes.js`
- `backend/modules/marketing/index.js`
- `backend/tests/marketing/MarketingModule.test.js`
- `nextjs-frontend/src/app/geo/layout.tsx`
- `nextjs-frontend/src/app/geo/page.tsx`
- `nextjs-frontend/src/app/geo/quick-links/page.tsx`
- `nextjs-frontend/src/app/geo/quick-links/quick-links.module.css`
- `nextjs-frontend/src/components/geo/GeoSidebar.tsx`
- `nextjs-frontend/src/lib/useWorkspaceNavigation.ts`
- `nextjs-frontend/src/utils/geoNavigation.test.cjs`

**方案：**

- 纯构建器生成菜单和路径选中态；主内容不再渲染重复当前页名称的面包屑。
- 所有阶段按市场总览、投放与流量、转化结果、AI 品牌监测、网站诊断、监测任务、常用网站和设置的顺序显示。
- 分组使用 Ant Design `Menu.ItemGroup` 静态展开全部子项，不维护 `openKeys`，也不渲染 `SubMenu` 触发器。
- 应用壳固定为一个视口高度：Header 固定，Sider 占满 Header 下方空间，根页面禁止滚动，仅 Content 承担主页面纵向滚动。
- 一级直接菜单使用中性灰，不能点击的一级分组标题使用更浅灰色；二者字号和字重一致且不使用常驻底框。二级列表不使用底板、关系线或伪元素，只使用统一缩进和较轻字号；末级当前项使用统一浅蓝选中态。
- `/geo` 固定进入市场总览；未开放来源在页面内显示中性占位状态。
- 工作台设置分组仅保留系统通知和个人中心，不跳转管理员设置中心。
- 常用网站按投放与访问、接待与线索、官网与采购三组静态维护九个来源系统、十个目的地卡片；分组标题使用完整内容行，卡片网格另起一行。图标优先读取来源站点 favicon 或官方品牌资源，加载失败时显示本地文字回退。已知地址由整张卡片使用新标签页和 `rel="noreferrer"` 打开，不渲染用途说明或独立操作链接；未知 Agent 地址显示不可操作状态。
- 页面内容遵循最小充分原则：不重复侧边栏页名和页面介绍；只保留数据、操作、状态、错误及必要口径；长口径使用 Tooltip 等按需交互。
- 改名只改变用户文案，保留现有 GEO 路由。

**测试场景：**

- 完整菜单和固定默认入口。
- 所有分组和子项初始即完整可见，桌面与移动端均不存在下拉触发器。
- 根页面无纵向滚动、侧栏位置固定、主内容区独立滚动。
- 直接子路由的选中态。
- 设置分组不存在管理员后台跳转。
- 常用网站的九个系统、十张目的地卡片、官方地址、整卡点击、新标签页安全属性和未知地址状态。
- 主内容不重复侧边栏页名，常驻页面不包含已列入删除清单的解释性文本。
- 窄屏折叠、键盘和焦点。

**验收方式：** 同一构建器在所有 moduleState 下输出完整目标分组，市场总览是默认入口且 GEO 入口仍在。

### U3. 营销共享数据客户端与广告表现页

**目标：** 从旧合并页提取广告读取、刷新和状态机，形成可独立验收的广告表现页面。

**依赖：** U1。

**涉及文件：**

- `nextjs-frontend/src/lib/marketing/useAdPerformance.ts`
- `nextjs-frontend/src/components/marketing/MarketingSourceState.tsx`
- `nextjs-frontend/src/components/marketing/AdMetrics.tsx`
- `nextjs-frontend/src/app/geo/marketing/ads/page.tsx`
- `nextjs-frontend/src/app/geo/marketing/marketing.module.css`
- `nextjs-frontend/src/utils/marketingValues.cjs`
- `nextjs-frontend/tests/marketing/marketing-page.test.cjs`
- `nextjs-frontend/tests/marketing/marketing-accessibility.test.cjs`

**方案：**

- 复用既有 dashboard 和 refresh-run API。
- 广告 dashboard GET 在缓存新鲜时纯读数据库；快照缺失或距最近成功刷新达到 10 分钟时，由该次访问创建 `ON_DEMAND` 运行并等待同项目 single-flight 刷新。没有页面访问时不创建运行、不调用百度；主动刷新仍使用只接受 `MANUAL` 的显式 POST。
- 去除项目选择器，使用默认项目。
- 保留精确金额、绑定健康、日期筛选和外部跳转；结构下钻显示项目、推广计划、推广单元和关键词，搜索词保持独立分析事实。
- 关键词分析页读取同一 Dashboard revision 的 `keywords` 范围聚合，不再停留在开发 fixture；投放关键词事实仍只由关键词 ID/名称和父级 ID 构成。页面可以按账户、计划、单元与关键词名称的严格证据键统计独立 `searchTerms` 数量，并跳转到独立搜索词视图，但不得把搜索词并入关键词实体或伪造关键词 ID。无效下钻参数不得静默退化为全量视图。
- 搜索词上一周期读取不阻塞本期展示，并设置有界超时；本期与上期响应都必须精确匹配各自请求日期范围，且非空 `revision`、币种和金额精度完全一致时才生成环比。范围下钻使用各周期自身的关键词 ID 解析名称证据，避免改名或迁移被误报为 0。
- 关键词分析的公开筛选层级只到直接所属推广单元；账户和推广计划 ID 仅参与实体唯一性及完整路径 Tooltip，不渲染为页面筛选器。
- 页面先以无副作用纯函数完成推广单元、显式标签、消费区间、关键词和四象限异常过滤，再生成 Scatter/Heatmap、选中详情、Pie 行动分布和同一集合的明细表。
- 当前数据中位数来自可绘制关键词的 CTR/CPC 中位数；账户平均值使用展现、点击和消费的加权汇总。两种基准都允许缺失，不提供人工目标线。
- 选中关键词键不进入 `filterKeywordRows`；选点只更新高亮、右侧详情和表格选中行。生产缺少显式标签时显示未分类或 `—`，不得根据象限自动生成行动建议。
- 表格关键词次级信息只渲染 `unitName`；完整 `accountName / projectName / schemeName / unitName` 仅在 Tooltip 中提供。

**测试场景：**

- 快照存在、零数据、无快照、陈旧、刷新失败、归档和绑定异常。
- 多账户同名计划、单元和关键词仍使用账户及稳定父级 ID 区分；搜索词不按关键词名称伪造实体关联。
- 精确大数不转浮点。
- 等价数据表和移动端。

**验收方式：** 受控直接入口可独立完成一次广告快照查看和手动刷新，结果与旧页面及 API 一致。

### U4. 网站流量独立页

**目标：** 形成不依赖广告页面成功的网站流量入口。

**依赖：** U1、U3 的共享来源状态组件。

**涉及文件：**

- `nextjs-frontend/src/lib/marketing/useWebsiteTraffic.ts`
- `nextjs-frontend/src/lib/marketing/websiteTrafficTypes.ts`
- `nextjs-frontend/src/app/geo/website-traffic/page.tsx`
- `nextjs-frontend/tests/marketing/website-traffic-page.test.cjs`
- `backend/tests/marketing/BaiduTongjiService.test.js`

**方案：**

- 正式页面默认读取 `/website-traffic-overview` 和 `/website-traffic-pages`，不写入广告快照，也不静默回退旧 `/tongji-trend`。
- 默认 `device=all`，表示真实省略百度设备过滤；来源、指标、页面视图、搜索、排序和分页都进入后端严格合同。
- 当前 `trend/time/a` 访问次数、UV、PV、质量指标，`source/all/a` / `source/engine/a` 来源汇总，以及入口/受访页面报告都已取得同站点真实账号响应证据并开放运行；来源行的质量指标与来源—页面联动仍无可信关联，分别保持缺失和 `sourcePageLinkage=false`。
- 分离无数据、来源错误、站点缺失、站点歧义和权限错误。
- 展示周期汇总、单指标趋势及其等价数据表、来源质量和入口/受访页面双视图。
- 页面文案明确未归因。

**测试场景：**

- 单正常站点成功。
- 无正常站点、多个正常站点、无连接、归档项目和 provider 失败。
- 无数据标记不按零处理。

**验收方式：** 广告 API 失败时，网站流量页仍可独立读取和解释百度统计结果。

### U5. V1 历史：市场总览三模块

**历史目标：** 建立 V1 全链路概览、独立趋势和部分失败可用的首页骨架。新版结构以本文件第 0 节和现行 PRD 为准。

**依赖：** U1、U3、U4。

**涉及文件：**

- `nextjs-frontend/src/app/geo/market-overview/page.tsx`
- `nextjs-frontend/src/app/geo/market-overview/market-overview.module.css`
- `nextjs-frontend/src/components/marketing/MarketJourneyOverview.tsx`
- `nextjs-frontend/src/components/marketing/MarketTrendPanel.tsx`
- `nextjs-frontend/src/lib/marketing/useMarketOverview.ts`
- `nextjs-frontend/src/utils/marketingChartSeries.cjs`
- `nextjs-frontend/tests/marketing/market-overview.test.cjs`

**方案：**

- 并发但独立读取广告和网站流量。
- 广告、网站展示真实数据；咨询和订单展示来源暂不可接入及具体依赖。
- 旧版没有订单数量和可信来源链路；新版必须增加订单数、订单金额与来源关系。
- 旧版趋势使用相对几何和精确 tooltip/数据表；新版趋势改为来源/指标两个下拉和当前/上期对比。
- 旧版显示来源更新时间；新版正常和缓存回退状态均不显示更新时间或陈旧提示，只有真实来源错误影响判断时显示错误。

**测试场景：**

- 两来源成功、广告单独失败、流量单独失败、两者失败。
- 未接入阶段无假数字。
- 广告和网站日期窗口不一致。
- 大数图表精度、移动端顺序和无障碍。

**验收方式：** 用户在单页看见投入、流量、接入状态；任一来源失败时另一来源仍保留。

### U6. V1 历史：确定性需要关注规则

> 新版首页已取消该常驻模块。本节不得作为新版首页验收要求；后续若保留规则，应迁移到数据健康或下钻页面并单独验收。

**目标：** 在产品批准规则后生成最多三条可解释、可下钻的事项。

**依赖：** U5；趋势阈值产品评审。

**涉及文件：**

- `nextjs-frontend/src/utils/marketingAttention.cjs`
- `nextjs-frontend/src/utils/marketingAttentionRules.cjs`
- `nextjs-frontend/src/components/marketing/MarketAttentionList.tsx`
- `nextjs-frontend/tests/marketing/marketing-attention.test.cjs`

**方案：**

- 先实现数据健康规则。
- 趋势规则由版本和启用状态控制，使用精确整数比较。
- 排序、合并、截断全部为纯函数。
- 下钻 query 只携带日期、来源和非敏感业务 ID。

**测试场景：**

- 超过三条时的稳定排序。
- 同类合并与禁止跨原因合并。
- 无基线、零数据和部分来源失败。
- 无批准阈值时只显示健康事项。

**验收方式：** 固定输入始终输出相同三条事项，每条可定位证据且不出现因果措辞。

### U7. AI 品牌监测读页面自动上下文

**目标：** AI 搜索表现和引用来源分析自动使用默认项目并完成改名。

**依赖：** U1、U2。

**涉及文件：**

- `nextjs-frontend/src/app/geo/project-dashboard/page.tsx`
- `nextjs-frontend/src/app/geo/sources/page.tsx`
- `nextjs-frontend/src/utils/projectSelection.cjs`
- `nextjs-frontend/src/utils/projectDashboardState.test.cjs`
- `nextjs-frontend/src/utils/sourcePageState.test.cjs`

**方案：**

- 移除普通视图项目选择器。
- 兼容包含 `project_id` 的历史链接：只有其与默认项目一致时继续；不一致时忽略并使用默认项目，同时不跨权限读取。
- 保留周期、平台和证据筛选。
- 更新导航名称和选中态，移除重复页名及常驻介绍。

**测试场景：**

- 默认项目成功、缺失、归档和历史 URL。
- 指标、来源明细和筛选行为未变。

**验收方式：** 用户无需项目选择即可访问原有全部 AI 品牌指标和引用证据。

### U8. 监测任务自动上下文

**目标：** 问题库、运行报告和适用的告警页面使用默认项目，不破坏运行深链。

**依赖：** U1、U2。

**涉及文件：**

- `nextjs-frontend/src/app/geo/prompts/page.tsx`
- `nextjs-frontend/src/app/geo/question-set-reports/page.tsx`
- `nextjs-frontend/src/app/geo/alerts/page.tsx`
- `nextjs-frontend/src/utils/promptPageState.test.cjs`
- `nextjs-frontend/src/utils/questionSetReportPage.test.cjs`
- `nextjs-frontend/src/utils/alertPageState.test.cjs`

**方案：**

- 项目选择改为默认上下文。
- 问题集报告的 `run_id` 深链继续工作；`project_id` 仅接受默认项目。
- 所有异步请求继续用 mutation project ID 和 request version 防止晚到响应污染。
- 管理项目入口移至管理员设置。

**测试场景：**

- 新建问题、问题集运行、报告深链、导入导出和告警 CRUD。
- 默认项目变化后的状态清理。
- 无默认项目时不创建任务。

**验收方式：** 现有监测任务主路径在单项目上下文下完整运行，旧深链不会读到其他项目。

### U9. 正式切流、旧入口退役与入口级验收

**目标：** 新导航和首页真正成为正式路径，并清除旧合并页面的生产选择。

**依赖：** U2–U8；百度 `VERIFIED`；视觉评审通过。

**涉及文件：**

- `nextjs-frontend/src/app/geo/marketing/page.tsx`
- `nextjs-frontend/src/app/geo/page.tsx`
- `nextjs-frontend/src/app/geo/layout.tsx`
- `nextjs-frontend/tests/marketing/marketing-page.test.cjs`
- `nextjs-frontend/playwright.marketing.config.ts`
- `README.md`
- `CONTEXT.md`
- `docs/README.md`
- `docs/active-2026-07-29-001-marketing-monitoring/prd.md`

**方案：**

- `/geo/marketing` 单向重定向到市场总览。
- `/geo` 始终进入市场总览；来源未开放时页面保持可读占位状态。
- 搜索生产引用、默认值和文档，移除把旧合并页描述为现役入口的内容。
- 从真实登录入口完成桌面、移动、直接 URL、权限和旧路径验证。

**测试场景：**

- 不同 moduleState 使用同一入口但显示不同数据状态。
- 旧 URL 重定向且不出现第二套 UI。
- 新页面调用新共享客户端，旧页面逻辑未作为 fallback 执行。
- 构建、lint、营销测试和真实入口截图。

**验收方式：** 入口级证据证明正式用户走新市场总览、旧页面未被调用，GEO/SEO 仍可达。

## 8. V1 历史验收标准

> 以下 AC 记录旧版实现目标。新版验收以 `prd.md` 第 8 节和 `../visual-design-spec.md` 第 17 节为准。

- AC-001：Given 未配置默认项目，When 用户进入工作台，Then 页面显示阻断状态且不读取项目列表第一项。
- AC-002：Given 任意 moduleState，When 用户打开侧边栏，Then 完整目标分组和菜单项可见。
- AC-003：Given 用户进入 `/geo`，Then 进入市场总览且 AI 品牌监测仍可访问。
- AC-004：Given 广告成功且百度统计失败，When 打开市场总览，Then 广告数据可见、流量显示来源异常。
- AC-005：Given 百度统计成功且广告快照失败，When 打开市场总览，Then网站流量可见、广告显示安全错误。
- AC-006：Given 转化来源尚无 API，When 打开市场总览，Then 对应的咨询数据和订单结果没有数值且说明具体依赖。
- AC-007：Given 任意大整数指标，When 渲染汇总、表格和图表，Then 权威值不经浮点聚合或截断。
- AC-008：Given 未批准趋势阈值，When 生成需要关注，Then 只返回数据健康事项。
- AC-009：Given 超过三条候选事项，When 排序，Then 使用稳定优先级返回三条且合并保留证据。
- AC-010：Given 历史 GEO 深链，When 项目与默认项目一致，Then 原报告和筛选仍可打开。
- AC-011：Given 历史深链指向其他项目，When 普通用户打开，Then 不跨项目读取并回到默认上下文。
- AC-012：Given 正式切流完成，When 访问 `/geo/marketing`，Then 单向进入市场总览且旧 UI 不执行。
- AC-013：Given 管理员进入后台，When 使用桌面或移动端侧边栏，Then 可返回数据工作台，账号与权限、系统管理及其子项始终完整可见。
- AC-014：Given 页面内容超过视口，When 用户滚动页面，Then Header 和 Sider 位置不变，HTML 与 body 不滚动，只有 Content 的滚动位置变化。
- AC-015：Given 多个一级分组，When 页面首次渲染，Then 全部分组无需操作即完整展开，一级直接项与分组标题的基础字体样式一致且不显示常驻底框，二级列表仅通过缩进和较轻字号区分层级。
- AC-016：Given AI 搜索表现数据 section，When 页面渲染，Then section 不存在装饰性 `::before` 色条。
- AC-017：Given 用户进入常用网站，When 页面渲染，Then 九个指定系统和十张目的地卡片完整出现，分类标题位于卡片网格上方且每个网站有图标，已知入口整卡安全打开新标签页，未知 Agent 地址没有虚构链接。
- AC-018：Given 用户查看一级导航，When 比较直接入口和分组标题，Then 可点击直接入口使用中性灰，不能点击的分组标题使用更浅灰色；设置分组不包含管理设置。
- AC-019：Given 用户进入任一正式工作台或管理员页面，When 主内容渲染，Then 不重复侧边栏页名，不展示非必要常驻说明；必要口径可通过按需交互访问。

## 9. 测试与验证计划

### 单元测试

- 默认项目 ID 校验、设置解析、访问判定和错误码。
- 营销 moduleState 到 capability 的完整映射。
- 菜单、默认入口和选中态构建器。
- 精确值格式、相对图表坐标和等价数据。
- 页面聚合的 partial/empty/blocked 状态机。
- 需要关注的优先级、合并、阈值门和稳定排序。

### API 与服务集成测试

- 默认项目 GET/PUT 的管理员、普通用户、归档、删除和数据库错误。
- 既有营销 dashboard、refresh-run 和 Tongji 接口回归。
- 项目 allowlist 和默认项目组合不一致时 fail closed。
- `PILOT_DATA_READY` 与 `READY` 能力差异。

### 前端组件与源码契约测试

- 新菜单始终暴露完整信息架构，未开放来源显示页面级缺失或部分覆盖状态，不渲染生产 fixture。
- 管理员后台导航名称、选中态、静态完整分组、返回工作台和移动端覆盖行为。
- 固定应用壳、单主滚动容器、一级菜单字体样式和 section 无伪元素装饰。
- 页面标题、介绍段、眉题、卡片说明和独立外链操作的删除契约。
- 页面没有项目列表第一项回退。
- 市场总览不展示模拟订单或转化数据；订单结果的开发 fixture 与生产默认路径隔离，真实订单数和订单金额接入后才能进入首页指标。
- 等价数据表、ARIA live region、键盘焦点和窄屏规则。

### 入口级浏览器验证

- 从登录页进入 `/geo` 的实际默认路径。
- 桌面 1440px、移动 375px 的市场总览和侧边栏。
- 广告或流量单一来源失败。
- 旧 `/geo/marketing` 重定向。
- AI 搜索表现、引用来源、SEO、问题库和运行报告可达。
- 管理员配置默认项目后普通页面立即使用。

### 门禁证据

- 前端测试、lint 和生产构建。
- 后端常规测试、营销专项测试和迁移审计。
- `rg` 证明没有生产导航、默认重定向或文档继续指向旧合并页。
- 正式切流前后真实入口截图和日志。

## 10. Rollout、回滚与观测

### Rollout

1. 上线默认项目接口和管理员配置。
2. 开放完整导航、市场总览、广告表现、关键词分析、网站流量及两个具有诚实来源状态的转化结果页面。
3. 使用真实广告快照和百度统计完成页面、部分失败和视觉验收。
4. 百度达到 `VERIFIED` 后，将模块置为 `READY`，把来源状态切换为正式数据。
5. 同一发布中重定向旧合并页并更新文档。

### 回滚

- `READY` 切换后发现问题，优先修复新页面。
- 若必须回滚百度真实数据，回滚 `READY` 配置并恢复来源占位状态；不得在新版本中增加旧页面静默 fallback。
- 默认项目设置是可逆配置，回滚代码不会删除项目或营销数据。
- 本次新增百度统计任意区间、来源趋势、页面报告、百度广告四层快照、官网数据和咨询审计迁移。代码回滚不能假定旧版本理解未来 schema；SQLite 必须使用按 release commit 保留的不可覆盖迁移前快照，让代码与数据库一起回到兼容版本，Postgres 则使用已登记的外部备份引用。默认优先向前修复。

### 观测

- 记录默认项目解析失败的稳定错误码，不记录敏感配置值。
- 区分广告读取、百度统计读取、默认上下文和页面刷新失败。
- 监控 `/api/marketing/status` 的 moduleState、营销刷新状态和 Tongji 安全错误码。
- 前端错误日志不得包含 Token、授权码、完整外部响应或敏感查询参数。

## 11. 风险与缓解

- 风险：默认项目设置无数据库外键，项目被归档或删除后留下悬空值。
  缓解：每次读取实时验证；项目归档/删除流程增加默认项目占用检查或清除，并返回稳定阻断状态。

- 风险：多个页面同时迁移项目选择，可能破坏报告深链或晚到请求隔离。
  缓解：按读页面和任务页面分两个切片；保留 mutation project ID、request version 和深链回归。

- 风险：百度统计实时失败导致首页看起来整体不可用。
  缓解：来源独立状态和 `allSettled` 组合，广告本地快照不受影响。

- 风险：图表把精确字符串转成浮点导致金额或计数失真。
  缓解：BigInt 计算相对坐标，权威值只用字符串；测试超出安全整数的大数。

- 风险：异常示例阈值被误当成正式业务口径。
  缓解：无批准规则版本时禁用趋势异常，只交付数据健康事项。

- 风险：隐藏导航但直接 URL 或 API 仍可越权。
  缓解：服务端 moduleState、allowlist、项目权限三重检查；浏览器验证直接路径。

- 风险：旧合并页长期保留形成两套行为。
  缓解：新页面验收后单向重定向旧路由，并搜索清理生产引用和文档。

## 12. 假设与开放问题

### 已采用假设

- 正式百度搜索账户与百度统计站点 `23412673`（`gato.com.cn`）明确绑定到广拓默认项目；不读取或自动选择同一授权主体下的其他站点。
- 当前百度广告和百度统计共用 `READY` 正式开放门，来源运行健康独立。
- 普通用户只在业务页面查看来源健康；数据连接和默认项目写操作只对管理员开放。

### 仍待真实环境验证

1. 2026-08-03 使用临时本地百度统计 Data API Token 只读验证：百度统计商业 API 返回三个活动站点，其中 `siteId=23412673` 的域名为 `gato.com.cn`；因此“唯一活动站点”假设已被否定并退役。正式数据库中的两套加密凭据、项目绑定和生产入口仍需完成本次部署后验收。
2. 2026-08-03 对 `siteId=23412673` 只读调用 `source=through`、`source=search,0`、`source=link` 均返回成功且当前为诚实零数据；网站安装统计代码后的数据到达、限流与生产统计 Token 下的持续表现仍待观察。
3. 百度搜索资源平台面向自然搜索曝光、点击、关键词、索引与抓取；截至本轮查阅的官方公开资料，没有发现可用于读取这些报表的公开 API。若未来需要其数据，应单独立项并获得官方接口合同，不得用页面抓取替代。
4. 官网聚合统计接口、最多 31 日逐日聚合、脱敏记录级列表/详情已完成本地真实区间与页面对账并部署；官网上游仍没有全部表单记录数和可验证的只读角色合同，生产专用项目与只读账号凭据尚未配置，因此正式入口保持 `DISABLED`。
5. 53KF 有效对话、跨系统来源关联、线索入池、可信订单数量和 CPA 正式分母仍未建立。

### V1 遗留问题（不再阻塞新版首页结构）

1. 趋势异常的历史基线、最小样本量、阈值和规则版本；如继续，应在数据健康或下钻页另立需求。
2. “需要关注”如需持久化、已读和处理状态，应另立需求，不回到新版首页首屏。
3. 默认项目被归档时，是阻止归档，还是允许归档并自动清空设置；本方案倾向阻止并要求管理员先改配。

## 13. 替代方案

### A. 新增一个跨来源市场总览 API

不采用。它会把本地广告快照和实时百度统计绑定成一次服务端请求，增加外部失败对本地快照的影响，也容易让调用方误解为同一归因快照。前端独立组合更符合现有合同。

### B. 删除 `project`，把广拓设成全局单例

不采用。`project` 是 GEO 数据、权限、报告和营销绑定的现役边界；删除会扩大迁移风险。显式默认项目可以实现相同用户体验。

### C. 继续保留项目选择器但默认选广拓

不采用。它保留了不必要的用户决策，并继续允许列表第一项误选。管理员配置与普通用户隐藏选择器更符合单品牌内部系统。

### D. 用一个 feature flag 控制所有市场菜单

不采用。完整导航始终显示；来源能力只决定页面展示真实数据、空状态还是不可用说明，不删除菜单项。

## 14. 后续衔接

- 官网与漏斗主数据源决策已固定在 `../adr/0001-marketing-funnel-data-source-of-truth.md`；官网聚合/脱敏记录级适配器和各市场页面前端已完成本地接入或诚实缺失态。新版仍待：官网最小权限生产身份和部署验收、53KF 有效对话、客服转线索审计、订单数/金额接口、指标语义与覆盖门禁。
- 建议第一个 issue：默认项目端到端配置。
- 适合 TDD：来源映射、订单去重、指标分母、缺失值状态、表头联动和正式入口硬切。
- 视觉标准和高保真稿已经确认，市场页面前端实现状态见 `../README.md#当前前端页面实施状态`。下一步不是继续补静态页面，而是完成未接来源合同、部署与正式入口验收。
