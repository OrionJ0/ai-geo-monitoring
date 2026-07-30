---
title: SEO 审计响应可信度与风控止损技术方案
date: 2026-07-30
status: closed
source: docs/closed-2026-07-30-001-seo-audit-response-safety/prd.md
scope: deep
---

# SEO 审计响应可信度与风控止损技术方案

## 1. 背景与目标

现有 `SeoSiteClient` 使用 `validateStatus: () => true` 保留所有 HTTP 响应，这是获取 403、429、WAF 页面和响应头证据所必需的行为，不应删除。实际缺陷位于下游：`SeoAuditService` 与 `SeoSiteAuditService` 没有统一验证响应是否可分析，全站页面还会无条件写入 `status: 'completed'`，导致 WAF/Challenge HTML 进入 Cheerio、规则检查和技术健康评分。

本方案的目标是在不改变现有 API 路径、认证、同源扫描范围和评分模型的前提下，建立最小的可信响应闸门与请求止损链路：

1. 任何响应必须先分类，只有 `normal` 可以进入对应资源解析和页面评分。
2. 限速和计数发生在 `requestWithRedirects` 的每次真实 Axios 调用处，覆盖所有重定向跳转。
3. 目标 origin 出现确认 WAF 或 429 后，当前任务立即停止该 origin 的后续请求。
4. 全站发现前只执行有界预检。
5. 页面按 resolved URL 合并，报告保留 requested URL、resolved URL 和重定向别名。

## 2. 范围与非目标

- 范围：
  - 单页和全站正式入口的响应分类与评分闸门。
  - 页面、robots、Sitemap、链接探活的预期类型分类。
  - Axios 事务级限速、计数、目标 origin 熔断和 429 `Retry-After` 提取。
  - 入口、robots、默认 Sitemap 三步有界预检。
  - resolved URL 去重、别名记录和报告入口修复。
  - 脱敏 fixture、本地 Mock Server、单元和入口级回归。
- 非目标：
  - 不移除 `validateStatus: () => true`。
  - 不自动执行 JavaScript Challenge，不新增浏览器绕过逻辑。
  - 不伪装搜索引擎 UA，不增加代理或 IP 轮换。
  - 不增加 CDN Adapter 框架、机器学习分类器或可运营的信号权重平台。
  - 不增加 `maxNetworkRequests` 硬上限。
  - 不更改技术健康分计算、规则权重或历史报告内容。
  - 不用 Canonical 做抓取去重。
- 延后事项：
  - GoodieAI 自身 robots.txt 授权执行。
  - 多进程/多实例共享限速、锁和熔断状态。
  - `evidenceQuality`、分类器版本参与历史比较资格。
  - 基于出站请求遥测增加内部总请求保险丝。

## 3. 当前系统认知

### 3.1 相关入口

- 单页 API：`POST /api/seo-audits`，由 `backend/routes/seoAudits.js` 调用 `createPageAuditRuntime()`。
- 全站 API：`POST /api/seo-audits/site` 创建异步任务；`backend/services/SeoAuditJobService.js` 调用 `createSiteAuditRuntime()`。
- 页面入口：`nextjs-frontend/src/app/geo/seo-audit/page.tsx`，现有界面已经展示同步错误消息和异步任务的 `job.error.message`。

### 3.2 当前请求与分析链

```text
用户 URL
  → SeoAuditRuntimeService
  → SeoSiteClient.fetchPage / probe
  → requestWithRedirects
  → Axios（validateStatus 接收所有状态）
  → SeoAuditService / SeoSiteAuditService
  → Cheerio、规则检查、评分和报告
```

当前问题：

- `backend/services/SeoSiteClient.js` 只校验页面 Content-Type，不分类 WAF、429、HTML Challenge 或资源类型错配。
- `backend/services/SeoSiteAuditService.js` 先递归最多 20 个 Sitemap，再开始页面循环，预检没有有界止损。
- `auditPage()` 取得响应后仍调用页面审计，并无条件把页面状态写为 `completed`。
- 发现队列先加入 `requestedUrl`，没有用 `entryFinalUrl` 建立入口别名和最终 URL 去重。
- 全站报告的 `finalUrl` 固定为 `${origin}/`，会丢失 `/cn/` 等真实入口路径。

### 3.3 需要沿用的模式

- 每次重定向前重新做协议、凭据、私网地址、DNS 解析与地址固定校验。
- `createCachedClient()` 在单个全站任务内复用同一 URL 的页面和探测响应。
- 页面失败作为逐页失败事实；入口完全不可分析时任务失败。
- 异步失败通过 `SeoAuditJob.error_code`、`error_message` 和 JSON `progress` 返回，不为失败任务创建历史报告。
- 成功报告不保存完整 HTML 正文。
- 规则变更通过 `backend/config/seoAuditRules.js` 版本化，旧报告不回算。

## 4. 需求、约束与规则

- REQ-001：所有页面分析调用方必须先验证 `classification.outcome === 'normal'`。
- REQ-002：分类器必须接收 `expectedKind`，同一个 200 HTML 对页面可以正常，对 Sitemap 可以无效。
- REQ-003：WAF 只能由明确 Challenge 证据触发；正文少、脚本多、体积大或 MIME 异常不能单独触发熔断。
- REQ-004：429 优先分类为 `rate_limited`，解析合法的秒数或 HTTP-date `Retry-After`，但本期不自动等待后重试。
- REQ-005：每次 Axios 调用都必须经过速率许可并增加一次 `networkRequests.total`；五次重定向对应六次真实请求和五个 `redirectHops`。
- REQ-006：并发配置改为 2，同一 origin 相邻请求的启动时间至少间隔 500ms。
- REQ-007：确认 WAF 或 429 后，当前任务中该 origin 的后续请求必须在发送前失败。
- REQ-008：目标站点 origin 的 WAF/429 是任务级致命错误；外域链接探活遇到同类响应只终止该外域后续探活，不把目标站点报告判为 WAF。
- REQ-009：全站页面只按 resolved URL 评分一次；requested URL 和别名继续保留为重定向证据。
- REQ-010：Canonical 只能进入 SEO 检查和报告，不能成为请求身份或去重键。
- REQ-011：入口跨 origin 重定向继续以最终入口 origin 建立扫描范围；范围确定后，子页面跨 origin 重定向不得把外域正文纳入本站评分。
- REQ-012：生产验收不得使用 Hikvision 或其他未授权第三方站点做全站扫描或压力测试。
- CON-001：保留现有 SSRF、DNS rebinding、私网、重定向次数、响应体积和超时边界。
- CON-002：不改变现有公开 API 路径、鉴权和异步任务主状态枚举。
- CON-003：不保存完整 WAF HTML、Cookie、Token、Authorization、内部 IP 或可重放 Challenge 信息。
- CON-004：本期限速和熔断状态以单个审计运行时为边界；跨任务、跨实例共享状态明确延期。
- PAT-001：使用依赖注入的 `request`、时钟和等待函数做确定性测试，不在测试中真实等待 500ms。
- PAT-002：U2–U4 可以分开评审，但不得只把分类器接入生产而不同时启用评分闸门、请求止损和有界预检。

## 5. 接口与数据契约

### 5.1 `classifyResponse`

在 `backend/services/SeoSiteClient.js` 内增加并导出纯函数：

```text
classifyResponse(response, expectedKind) → classification
```

`expectedKind`：

- `page`：需要可分析的 HTML 页面。
- `robots`：需要可作为 robots 文本继续交给现有有效性与权限解析器的响应。
- `sitemap`：需要可作为 XML/Sitemap 内容继续交给现有 Sitemap 解析器的响应。
- `link_probe`：只需要保留目标状态与重定向事实，不进入页面评分。

`classification`：

```json
{
  "outcome": "normal | waf_blocked | rate_limited | invalid_response | http_error",
  "expectedKind": "page | robots | sitemap | link_probe",
  "provider": "edgeone | cloudflare | null",
  "signals": ["bounded_machine_readable_signal"],
  "retryAt": "ISO-8601 or null"
}
```

约束：

- 分类器不得修改或裁剪原始 response。
- `signals` 只允许有界机器标识，不包含完整响应体、Cookie、Token 或大段脚本。
- 本期不暴露通用 `confidence` 数值；只有达到明确证据规则时才返回 `waf_blocked`。
- 空 robots、无 URL 的 Sitemap、XML 语义错误等继续由现有资源有效性逻辑判断；分类器只负责阻止明显不可信或类型不匹配的响应。

分类优先级：

1. 状态 429 → `rate_limited`。
2. 明确 EdgeOne、Cloudflare 或通用 Challenge 组合证据 → `waf_blocked`。
3. 最终状态非 2xx → `http_error`。
4. 响应明显不是 `expectedKind`，例如 robots/Sitemap 返回普通 HTML 错误页 → `invalid_response`。
5. 其余可继续分析的响应 → `normal`。

### 5.2 `SeoAuditCrawlerPolicy`

新增 `backend/services/SeoAuditCrawlerPolicy.js`，第一版保持一个模块，不拆分 RobotsPolicy、DomainRequestGate 或协调器。

最小行为接口：

```text
beforeRequest({ url, requestKind, redirectHop })
observeResponse({ url, classification })
snapshot()
```

- `beforeRequest()`：
  - 以当前 URL 的 origin 查找任务内状态。
  - 已熔断时抛出带原始停止原因的类型化错误。
  - 原子预留下一个请求启动时刻，并使用可注入等待函数满足 500ms 间隔。
  - 在真正调用 Axios 前增加一次请求尝试计数。
- `observeResponse()`：
  - `waf_blocked` 或 `rate_limited` 时打开当前 origin 的任务内熔断器。
  - 保存有界 provider、signals 和 retryAt。
  - 普通 403、5xx、`invalid_response` 不打开域级熔断器。
- `snapshot()`：
  - 返回可持久化诊断，不暴露内部计时器、响应正文或凭据。

策略不负责 robots 授权；本期 robots 只作为资源可信度和现有搜索引擎权限模拟的输入。

### 5.3 `SeoSiteClient` 请求契约

`createSeoSiteClient()` 增加可选策略、时钟/等待依赖；公开运行时也显式创建任务级 client，避免所有任务共用一份诊断状态。

`requestWithRedirects()` 的每一轮：

```text
解析并固定当前目标地址
→ policy.beforeRequest()
→ Axios request
→ 规范化 response
→ 如果是重定向，记录 redirect hop 并继续
→ classifyResponse(final response, expectedKind)
→ policy.observeResponse()
→ 返回原始 response + classification
```

补充参数：

- `fetchPage(url, { requestKind = 'page' } = {})`
- `probe(url, { expectedKind = 'link_probe', requestKind = 'link_probe' } = {})`

调用约定：

- 入口和页面：`expectedKind = page`
- robots：`expectedKind = robots`、`requestKind = robots`
- Sitemap：`expectedKind = sitemap`、`requestKind = sitemap`
- 链接探活：`expectedKind = link_probe`、`requestKind = link_probe`

`createCachedClient()` 的缓存键至少包含方法、URL 和 expectedKind，防止同一 URL 先按 Sitemap、后按普通链接探活时复用错误分类语义。

现有 `fetchPage()` 的 Content-Type 直接抛错逻辑并入分类器，避免在 `classifyResponse()` 之前丢失 WAF、状态码和诊断证据。`SeoAuditService` 中 robots、默认 Sitemap 和声明 Sitemap 的所有 `probe()` 调用都必须传入对应 expectedKind；只有 `normal` 结果可以进入现有 `analyzeRobots()`、`evaluateCrawlerAccess()` 和 `analyzeSitemap()`。

### 5.4 评分闸门与错误

页面分类非 `normal` 时不得执行 Cheerio 页面分析、23项规则或技术健康评分。

公开错误码：

- `SEO_AUDIT_BLOCKED_BY_WAF`
- `SEO_AUDIT_RATE_LIMITED`
- `SEO_AUDIT_INVALID_RESPONSE`
- 现有普通 HTTP、超时、内容大小和网络错误码继续沿用。

内部 `CIRCUIT_OPEN` 不直接暴露给用户；应映射回打开熔断器的原始错误码和安全文案。

错误对象可以携带以下安全字段，供异步任务写入 `progress`：

```json
{
  "stopReason": "waf_blocked | rate_limited | entry_http_error",
  "retryAt": "ISO-8601 or null",
  "requestDiagnostics": {}
}
```

### 5.5 请求诊断

每次 Axios 事务只计入一个 `byKind`，重定向是独立维度，避免总数重复：

```json
{
  "networkRequests": {
    "total": 0,
    "byKind": {
      "page": 0,
      "robots": 0,
      "sitemap": 0,
      "link_probe": 0
    },
    "redirectHops": 0
  },
  "renderAttempts": 0,
  "stopReason": "completed | page_limit | waf_blocked | rate_limited | entry_http_error"
}
```

- 成功全站报告写入 `site.crawlDiagnostics`。
- 失败全站任务把安全诊断写入 `progress.crawlDiagnostics`；不创建报告。
- 浏览器渲染只能记录逻辑尝试数，不纳入 Axios `networkRequests.total`。
- 本期不根据计数停止任务；计数用于评估后续 `maxNetworkRequests`。

### 5.6 兼容性

- `validateStatus: () => true` 保留。
- API 路径、认证、任务主状态、现有报告字段保持兼容；诊断字段均为 additive。
- `backend/config/seoAuditRules.js` 的 `crawl.concurrency` 改为 2，并新增 `minOriginIntervalMs: 500`；更新规则版本，旧报告不回算。
- 技术健康评分版本保持不变。
- 失败任务仍不进入成功历史；WAF/429 不参与目标站点评分。
- 不保留“分类失败后继续走旧评分路径”的 fallback。

## 6. 关键技术决策

- KTD-001：保留 Axios 全状态响应。理由：WAF、429、Request ID 和 `Retry-After` 都需要原始状态与响应头；问题在下游缺少可信度闸门，不在 Axios 接收行为。
- KTD-002：分类器使用 `expectedKind`。理由：同一个 HTML 对页面和 Sitemap 的有效性不同，不能靠全局状态码规则判断。
- KTD-003：第一版只接受高置信度 WAF 证据。理由：SPA、登录页和空壳应用可能正文少、脚本多，弱启发式不能触发域级熔断。
- KTD-004：限速和计数放在每次 Axios 调用前。理由：包裹 `fetchPage()` 只能看到一个逻辑请求，看不到最多五次重定向中的六次真实事务。
- KTD-005：429 停止当前任务而不自动等待重试。理由：异步任务不应占用 worker 长时间睡眠；`Retry-After` 用于提示用户和后续调度设计。
- KTD-006：熔断按当前请求 origin 生效。理由：目标站点和外域链接探活不是同一故障域；外域被 WAF 拦截不能把目标站点判为 SEO 失败。
- KTD-007：v1 使用任务级内存状态。理由：满足当前单进程运行中的请求节奏和本任务止损；跨任务/跨实例共享需要独立的持久锁与恢复语义，明确延期。
- KTD-008：不增加总请求硬上限。理由：先取得按类型和重定向计数的真实数据；页面、Sitemap 和链接上限继续作为现有边界。该决定不把 pageLimit 解释为请求预算。
- KTD-009：resolved URL 是网络身份，Canonical 是页面声明。理由：只有实际重定向结果可以合并抓取与评分，Canonical 可能错误、跨域或冲突。
- KTD-010：U2–U4 同一版本正式启用。理由：只识别 WAF 却不熔断和有界预检，会继续产生本可避免的请求。

## 7. 实现切片

### U1. Fixture 与本地 Mock Server

**目标：**

在不访问真实第三方站点的条件下，稳定复现正常响应、WAF、429、资源类型错误和重定向。

**依赖：**

无。

**涉及文件：**

- `backend/tests/fixtures/seo-responses/*`
- `backend/tests/helpers/createSeoAuditMockServer.js`
- `backend/tests/SeoSiteClient.test.js`

**方案：**

- 保存脱敏后的 EdgeOne Challenge 结构 fixture；所有 Token、Cookie、真实 Request ID、IP 和可重放参数替换为固定假值。
- Mock Server 使用 Node 标准库，至少提供正常 HTML、合法 SPA、200 Challenge、403业务页、403 WAF、429、HTML robots、HTML Sitemap、合法 robots/XML 和五跳重定向端点。
- Mock Server 记录收到的请求顺序、路径、时间和 UA，供入口级断言使用。

**测试场景：**

- fixture 中不包含敏感 Token、Cookie 或真实请求标识。
- Mock Server 可重复启动/关闭，不占用固定生产端口，不访问公网。
- 五跳重定向准确产生六次服务端请求。

**验收方式：**

- 所有测试可离线运行并稳定复现约定响应；无需请求 Hikvision。

### U2. 响应分类器与评分闸门

**目标：**

阻止 WAF、429、普通 HTTP 错误和类型不匹配响应进入页面评分或资源有效性解析。

**依赖：**

U1。

**涉及文件：**

- `backend/services/SeoSiteClient.js`
- `backend/services/SeoAuditService.js`
- `backend/services/SeoSiteAuditService.js`
- `backend/tests/SeoSiteClient.test.js`
- `backend/tests/SeoAuditService.test.js`
- `backend/tests/SeoSiteAuditService.test.js`

**方案：**

- 在 `SeoSiteClient.js` 实现并导出纯分类器。
- `fetchPage()` 和 `probe()` 返回原始响应及分类结果。
- 单页和全站入口在 Cheerio 解析前执行统一闸门。
- 全站逐页只有 `normal` 写入 `completed`；普通不可用页面写入现有失败结构。
- 确认目标 origin WAF/429时抛出任务级类型化错误，不将其转成普通逐页失败继续循环。

**测试场景：**

- 正常 HTML 保持现有评分。
- 200/403 Challenge 不产生分数。
- 普通403不误判 WAF。
- 429保留重试信息。
- HTML robots/Sitemap 不进入对应解析器。
- 合法 SPA 不因脚本占比触发WAF。

**验收方式：**

- 入口级测试证明非 `normal` 响应不会调用评分逻辑，WAF/429不会生成成功报告。

### U3. Axios 事务级限速、计数与熔断

**目标：**

控制每次真实出站请求的节奏，并在确认拦截后停止当前任务对故障 origin 的访问。

**依赖：**

U1、U2。

**涉及文件：**

- `backend/services/SeoAuditCrawlerPolicy.js`
- `backend/services/SeoSiteClient.js`
- `backend/services/SeoAuditRuntimeService.js`
- `backend/services/SeoAuditJobService.js`
- `backend/config/seoAuditRules.js`
- `backend/tests/SeoSiteClient.test.js`
- `backend/tests/SeoAuditJobService.test.js`

**方案：**

- 使用可注入时钟和等待函数实现任务级、按 origin 的请求启动间隔。
- 每次 Axios 调用前原子预留下一个启动时刻并增加请求计数；响应完成后更新分类和熔断状态。
- public/private runtime 都显式创建任务级 client 和 policy，避免诊断状态挂在进程默认 client 上。
- WAF/429 类型化错误携带安全诊断，`SeoAuditJobService` 写入失败任务进度。
- 把默认抓取并发从3调整为2，增加500ms origin间隔配置并更新规则版本。

**测试场景：**

- 两个并发同源请求的启动时间至少相隔500ms。
- 不同 origin 分别维护状态，但总页面 worker 并发不超过2。
- 五跳重定向计六次请求、五次 redirect hop。
- 熔断后下一次同源请求在调用 mock request 前失败。
- 目标 origin WAF/429终止任务；外域链接探活 WAF 不终止目标任务。
- 失败诊断不包含完整 HTML、Cookie 或 Token。

**验收方式：**

- 使用虚拟时钟验证节奏与熔断，不依赖真实等待；Mock Server 请求日志证明没有熔断后的额外请求。

### U4. 有界预检

**目标：**

在递归 Sitemap 和并发页面循环前，以最多三个逻辑资源完成目标站点可分析性和风控止损判断。

**依赖：**

U2、U3。

**涉及文件：**

- `backend/services/SeoSiteAuditService.js`
- `backend/tests/SeoSiteAuditService.test.js`
- `backend/tests/SeoAuditJobService.test.js`

**方案：**

- 明确预检顺序：入口 → robots.txt → 默认 `/sitemap.xml`。
- 入口响应通过缓存复用于后续页面分析；默认 Sitemap 通过相同 expectedKind 缓存复用于完整发现。
- robots 只有分类为 `normal` 时才提取声明 Sitemap。
- 普通 robots/Sitemap 404、业务403或 `invalid_response` 记录为资源失败并继续。
- 目标 origin WAF/429立即终止；不进入递归 Sitemap、页面循环、链接探活和渲染。

**测试场景：**

- 入口WAF只发出一个逻辑请求。
- robots WAF不请求默认 Sitemap。
- 默认 Sitemap WAF不进入递归和页面循环。
- robots 404 + 默认 Sitemap 404仍可从正常入口发现内部链接。
- HTML Sitemap不被当作有效 XML，但不导致普通页面审计失败。

**验收方式：**

- Mock Server 请求顺序和数量与预检决策一致；U2–U4 作为同一个正式版本启用。

### U5. Resolved URL 去重与真实入口

**目标：**

消除重定向别名的重复评分，并让报告入口与真实落地 URL 一致。

**依赖：**

U2。

**涉及文件：**

- `backend/services/SeoSiteAuditService.js`
- `backend/tests/SeoSiteAuditService.test.js`

**方案：**

- 发现阶段继续用规范化 requested URL 防止重复入队；页面响应后再使用 resolved URL 的 Map 合并分析结果。
- `requestedUrl → resolvedUrl` 记录为别名；同一 resolved URL 只生成一组页面检查和计分实例。
- 入口队列以 `entryFinalUrl` 建立网络身份，不再只加入原始 requested URL。
- 报告顶层 `finalUrl` 改为 `entryFinalUrl`；`site.origin` 继续来自最终入口。
- 子页面重定向到外域时记录链路与外域 final URL，但不解析外域正文为本站页面。
- Canonical 数据流保持不变，不参与去重。

**测试场景：**

- `/cn`、`/cn/` 汇聚到同一 resolved URL 时只评分一次。
- 两个并发别名最终落到同一页面时不产生重复检查实例。
- 入口 `/cn/` 未重定向时报告 finalUrl 保留 `/cn/`。
- 裸域跨 origin 重定向后以最终 origin 扫描。
- 范围内页面跳转到外域时不把外域内容加入本站分数。

**验收方式：**

- 报告页面、检查实例和分数中不存在 resolved URL 重复；requested/final/alias 证据可追溯。

## 8. 验收标准

- AC-001：Given 200/403 Challenge fixture，When 从单页和全站正式服务入口检测，Then 不执行页面评分且返回 WAF 错误。
- AC-002：Given 429 fixture，When 请求目标 origin，Then 保存合法 retryAt、停止当前任务后续同源请求且不自动重试。
- AC-003：Given 普通403和合法SPA，When 分类，Then 均不误判为WAF。
- AC-004：Given HTML robots/Sitemap，When 预检，Then 不进入有效性解析，但普通入口仍可继续全站审计。
- AC-005：Given 五跳重定向，When 完成请求，Then请求总数增加6、redirectHops增加5，每跳均经过安全校验与限速。
- AC-006：Given WAF出现在入口、robots或默认Sitemap，When 执行全站任务，Then 不发出决策点之后的任何目标origin请求。
- AC-007：Given `/cn`和`/cn/`指向同一最终页面，When 全站发现两者，Then 只生成一组页面检查和评分实例。
- AC-008：Given `/cn/`为真实入口，When 报告生成，Then 顶层finalUrl不被改写为`origin/`。
- AC-009：Given 子页面跨origin重定向，When 审计，Then 保存重定向事实但不把外域页面计入本站评分。
- AC-010：Given 成功或失败任务，When 查看报告或任务详情，Then 能看到有界请求诊断和明确停止原因。
- AC-011：Given 现有安全与SEO测试，When 本期完成，Then SSRF、DNS固定、私网、超时、大小限制、历史和评分回归全部通过。
- AC-012：Given 正式发布版本，When 检索生产入口，Then 单页和全站都走新评分闸门，不存在回退到旧的无分类评分路径。

## 9. 测试与验证计划

- 单元测试：
  - 分类优先级、expectedKind、WAF明确特征、429 Retry-After、普通403、SPA和HTML资源错配。
  - 策略的时间预留、计数、熔断和安全快照。
  - resolved URL alias Map 和跨origin边界。
- 集成测试：
  - `SeoSiteClient` 对本地 Mock Server 的真实重定向、状态、头部和请求次数。
  - `SeoAuditService.audit()` 证明非normal响应不评分。
  - `SeoSiteAuditService.audit()` 证明预检止损、页面继续策略和resolved去重。
  - `SeoAuditJobService` 证明失败任务错误码、stopReason、诊断持久化以及不创建历史。
- 回归测试：
  - `backend/tests/SeoSiteClient.test.js`
  - `backend/tests/SeoAuditService.test.js`
  - `backend/tests/SeoSiteAuditService.test.js`
  - `backend/tests/SeoAuditJobService.test.js`
  - `backend/tests/SeoAuditJobsSqlite.test.js`
  - 后端全量测试。
- 手工验证：
  - 仅使用本地 Mock Server和自有/明确授权站点。
  - 登录 `/geo/seo-audit` 验证同步错误、异步失败信息、正常报告真实入口和重复页面。
  - 不对 Hikvision 运行全站或高频测试。
- 构建/日志证据：
  - 后端专项与全量测试结果。
  - Mock Server 请求顺序、请求数量和熔断后零额外请求的断言。
  - 前端如未改代码，至少完成真实页面错误展示验证；如改动则补相关前端测试和构建。

## 10. 风险、缓解与回滚

- 风险：WAF误报阻止合法SPA。
  - 缓解：只使用明确供应商/Challenge组合证据触发 `waf_blocked`；弱信号不熔断；fixture含合法SPA反例。
- 风险：WAF漏报导致Challenge继续进入评分。
  - 缓解：200和403 Challenge都覆盖；未知 HTML 资源错配至少进入 `invalid_response`，不评分；记录有界signals便于补充fixture。
- 风险：限速只包逻辑fetch，漏掉重定向跳。
  - 缓解：限速与计数固定在 `requestWithRedirects` 的Axios调用点，并用五跳Mock端点验收。
- 风险：目标origin与外链origin共用致命状态，误终止整站。
  - 缓解：熔断按当前origin维护；只有已确定的站点origin错误升级为任务级失败。
- 风险：缓存复用错误expectedKind分类。
  - 缓解：缓存键包含expectedKind，或缓存原始响应后由调用方重新分类；第一版不得只按URL缓存已分类结果。
- 风险：请求计数让报告结构增长。
  - 缓解：只保存固定计数字段和有界signals，不保存每次请求明细。
- 风险：分类器、闸门和熔断分批上线产生半成品。
  - 缓解：U2–U4使用同一发布版本硬切，正式入口测试同时证明新路径生效、旧无分类路径不再调用。
- 回滚：
  - 发布前保留上一完整版本构建制品。
  - 如新分类器产生阻断性误报，回滚整个U2–U4发布单元；不得仅关闭评分闸门而保留识别逻辑，也不得增加静默旧路径fallback。
  - 修复后以新增fixture重放并重新发布。

## 11. 假设与开放问题

- 假设：当前正式部署仍是单后端进程；本期任务级内存状态不承诺跨任务、跨进程或跨实例共享。
- 假设：现有前端任务失败面板能够展示后端安全错误文案；如真实入口验收发现信息被截断，再做最小前端调整。
- 假设：脱敏 Hikvision Challenge 样本可以在实现阶段取得；若无法取得，先用结构等价的合成 EdgeOne fixture，不访问真实站点补抓。
- 开放问题：无。总请求硬上限、GoodieAI robots执行、多实例共享状态和历史比较资格均已明确延期，不阻塞本期。

## 12. 后续衔接

- 可拆 issue：
  - U1：脱敏响应 fixture 与本地 Mock Server。
  - U2：响应分类器与单页/全站评分闸门。
  - U3：Axios事务级限速、计数与任务级熔断。
  - U4：全站有界预检与失败诊断。
  - U5：resolved URL别名去重与真实入口修复。
- 建议第一个 issue：U1 + U2 的失败测试，先证明Challenge当前会误入评分，再实现分类器使测试转绿。
- 是否适合 TDD：适合。WAF误判、请求次数、熔断后零请求和resolved去重都能以确定性fixture和Mock Server做红绿重构。
- 发布要求：U2–U4必须作为同一个正式功能点完成、验收和提交；U5可在同一目标内随后完成，不单独启用旧评分fallback。

## 13. 实施结果

- U1–U5 已通过同目录四个 issue 完成，分类器、评分闸门、逐跳策略和有界预检作为一个正式版本启用。
- 单页正式入口 `POST /api/seo-audits` 与全站正式入口 `POST /api/seo-audits/site` 均由 `SeoAuditRuntimeService` 创建任务级 client；旧的无分类评分路径没有生产 fallback。
- 离线入口证据覆盖正常 HTML、合法 SPA、200/403 WAF、普通 403、429、HTML 伪装资源及五跳重定向；测试不依赖 Hikvision 或其他未授权第三方站点。
- 正常 `/cn → /cn/` 全站基线为 5 次 Axios 请求：页面 3、robots 1、Sitemap 1、链接探活 0；另记录 1 个重定向跳和 2 次逻辑渲染尝试。
- WAF/429 不进入评分且不创建伪成功历史；全站 robots WAF 的实际请求序列仅为入口与 `/robots.txt`。
- 全站页面按 resolved URL 合并，保留 requested URL 与别名；顶层 `finalUrl` 使用真实 `entryFinalUrl`，Canonical 仍只作为 SEO 证据。
- 本提交的临时干净 worktree 后端全量回归为 902 项通过、0 项失败；SEO 专项为 156 项通过、0 项失败。
- 已完成前端 lint、生产构建和登录后 SEO 报告页只读验收；未向 Hikvision 发起全站、高频或压力请求。
- GoodieAI robots 授权、多实例共享限速/熔断和 `maxNetworkRequests` 保持延期，当前交付不宣称完整礼貌爬虫合规。
