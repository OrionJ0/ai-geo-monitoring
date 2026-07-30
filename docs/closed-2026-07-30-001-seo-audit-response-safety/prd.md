# SEO 审计响应可信度与风控止损 PRD

## Problem Statement

当前 SEO 审计能够安全地取得任意 HTTP 状态码的响应，但没有在页面分析前统一判断响应是否可信。目标站点返回 403、429、WAF JavaScript Challenge，甚至以 200 状态返回验证页面时，响应仍可能被当成正常 HTML 进入 SEO 评分。由此会产生三类用户问题：

- 把安全验证页当成目标页面，生成失真的标题、正文、Sitemap 和技术健康结论。
- 把“当前 GoodieAI 审计出口被拦截”错误表达为“目标网站存在 SEO 问题”。
- 已经识别到限流或安全拦截后仍继续请求 Sitemap、页面和链接，扩大目标站点风控及本系统出口 IP 被限制的风险。

此外，全站入口会保留用户提交的原始 URL，并把报告入口硬编码为站点根路径。`/cn`、`/cn/`、裸域等入口发生重定向时，队列去重和报告入口可能与真实落地 URL 不一致。

## Solution

为现有单页和全站 SEO 审计增加一条最小的响应可信度与止损链路：

- 使用脱敏 fixture 和本地 Mock Server 固化正常页面、WAF、限流、异常资源和重定向行为。
- 在任何页面进入 SEO 分析前，把响应分类为正常、WAF 拦截、限流、格式无效或普通 HTTP 错误；只有正常响应可以评分。
- 在每次真实 HTTP 请求处执行限速和计数；确认 WAF 或收到 429 后停止当前域名在本次任务中的后续请求。
- 把入口、robots.txt 和一个默认 Sitemap 作为有界预检，通过后才进入完整发现和页面抓取。
- 以重定向后的最终 URL 合并重复页面，并在报告中保留用户提交入口和真实落地入口。

本期修复不伪装搜索引擎 User-Agent，不通过代理或 IP 轮换规避目标站点风控，也不把 GoodieAI 是否被拦截推断成 Google、Bing、百度等搜索引擎是否被拦截。

## User Stories

1. As an SEO 用户, I want the audit to reject WAF and challenge pages, so that I do not receive a misleading SEO score for a security verification page.
2. As an SEO 用户, I want a clear distinction between target-site SEO defects and GoodieAI access being blocked, so that I know whether to fix the website or retry/contact the site administrator.
3. As a target-site operator, I want the audit to slow down and stop after rate limiting or WAF blocking, so that the audit does not keep sending avoidable requests.
4. As an SEO 用户, I want `/cn` and `/cn/` redirects to resolve to one audited page, so that the same page is not scored twice.
5. As a maintainer, I want reproducible fixtures and request diagnostics, so that classifier and crawler regressions can be verified without repeatedly accessing Hikvision or other third-party websites.

## Scope

- In scope:
  - 单页和全站模式共享响应分类规则，只有可信且符合预期资源类型的响应进入 SEO 分析。
  - 支持 `normal`、`waf_blocked`、`rate_limited`、`invalid_response`、`http_error` 五类结果。
  - 识别具有明确供应商或 Challenge 证据的 200/403 WAF 页面；普通低正文、脚本占比高或 MIME 配置异常不能单独触发 WAF 熔断。
  - 每次真实 HTTP 请求前执行限速；默认最大并发为 2，同一目标 origin 的请求启动间隔不短于 500ms。
  - 计数页面、robots、Sitemap、链接探活等真实 HTTP 请求，并单独记录重定向跳数和浏览器渲染尝试数。
  - WAF 或 429 打开当前任务的目标 origin 熔断器，拒绝本任务对该 origin 的后续请求。
  - 429 保留有效的 `Retry-After` 信息并提示用户稍后重试；本期不在任务内自动长时间等待或重试。
  - 全站抓取先执行“入口 + robots.txt + 一个默认 `/sitemap.xml`”有界预检。
  - 预检中的普通 robots/Sitemap 缺失、业务 403 或格式无效只影响该资源；确认 WAF 或 429 才触发域级止损。
  - 全站页面按 resolved URL 合并，保留 requested URL 与重定向别名；Canonical 仅作为 SEO 证据，不参与抓取去重。
  - 报告使用真实入口 resolved URL，不再固定写成 `origin/`。
  - 失败任务返回可行动的错误原因；WAF、429 或不可分析入口不生成成功 SEO 报告。
- Out of scope:
  - 不伪装 Googlebot、Bingbot、Baiduspider 或其他第三方爬虫身份。
  - 不使用代理池、虚拟 IP、IP 轮换、验证码破解或浏览器自动过 Challenge。
  - 不把 WAF 拦截计为目标站点技术健康扣分。
  - 不新增机器学习分类器、复杂信号权重平台或 CDN 适配器框架。
  - 不新增全任务 `maxNetworkRequests` 硬上限。
  - 不修改全站最多 200 页、Sitemap 最多 20 个、链接探活最多 500 个的现有产品上限。
  - 不修改现有“全站 = 最终入口同源”的扫描合同。
  - 不修改历史报告比较资格或回算既有报告。
- Later:
  - GoodieAI 自身对 robots.txt `Allow` / `Disallow` 的执行策略。
  - 跨进程、跨实例的域级限速、互斥和共享熔断状态。
  - `evidenceQuality`、分类器版本参与历史报告比较资格。
  - 根据实际请求遥测决定是否增加内部 `maxNetworkRequests` 保险丝。

## Product Behavior

### URL 与扫描范围

- 用户可以提交带路径或不带路径的网址。系统跟随安全重定向，并同时记录 `requestedUrl` 和 `finalUrl`。
- 全站范围继续由最终入口的 origin 决定，不从用户输入路径静默推导新的路径级 scope。
- `/cn` 与 `/cn/` 如果重定向到同一最终 URL，只分析和评分一次。
- 裸域、`www` 或不同语言路径如果落到不同最终 URL，允许产生不同入口事实；系统必须展示最终入口，而不是声称这些输入天然等价。
- 入口发生跨 origin 重定向时，以最终入口 origin 建立全站范围；范围确定后，站内 URL 重定向到外域时只保留重定向事实，不把外域页面内容计入本站评分。

### 响应分类

- `normal`：状态和内容足以支持对应类型分析，可以进入后续解析或评分。
- `waf_blocked`：存在明确的 WAF/Challenge 证据；当前任务停止访问该 origin。
- `rate_limited`：收到 429；当前任务停止访问该 origin，并在可用时展示建议重试时间。
- `invalid_response`：响应成功但内容不是预期资源，例如 robots/Sitemap 返回普通 HTML 错误页；该资源失败，但不自动熔断整个域名。
- `http_error`：普通 4xx、5xx 或其他不可用状态。入口不可用时任务失败；非入口页面失败时沿用现有逐页失败行为。
- Content-Type、响应体积、正文/脚本比例等只能作为分类证据；除非与明确 Challenge 特征组合，否则不得单独产生 `waf_blocked`。

### 有界预检与止损

- 全站任务依次取得入口、robots.txt 和一个默认 Sitemap。每一步都先分类，确认 WAF 或 429 后立即停止，不再递归 Sitemap 或启动页面循环。
- robots.txt 或默认 Sitemap 普通缺失、业务 403、空内容或格式无效不会单独阻止全站页面检测，但报告不得把它们描述为有效资源。
- 入口是 WAF、429、普通不可用响应或不可分析内容时，任务失败且不生成技术健康分。
- WAF 错误文案必须表达为“当前 GoodieAI 审计身份或出口被目标站点安全策略拦截，无法完成检测”，并明确不能据此判断搜索引擎是否也被阻止。

### 请求节奏与诊断

- 限速和计数发生在每次真实出站 HTTP 请求处，重定向链中的每一跳均计数并受限速控制。
- 浏览器渲染只记录渲染尝试数，不承诺精确统计浏览器加载的所有子资源。
- 成功报告记录实际请求计数和完成原因；达到页面上限时继续沿用截断语义。
- 失败任务通过任务错误码、错误文案和进度中的停止原因说明 WAF、429 或入口错误，不创建伪成功历史。

### Sitemap 与 robots.txt 表达

- Sitemap 响应是否可信、Sitemap 是否有有效 URL、Sitemap 页面覆盖是三个不同判断，不互相替代。
- robots.txt 响应可信度与其中声明的搜索引擎权限是两个不同判断。
- 本期只防止不可信 robots 内容进入解析，不新增 GoodieAI 自身的 robots 抓取授权决策。

## Acceptance Criteria

- AC-001: Given 正常 200 HTML，When 执行单页或全站检测，Then 页面进入现有 SEO 分析且结果保持兼容。
- AC-002: Given 200 状态的已知 Challenge HTML，When 执行入口预检，Then 结果为 `waf_blocked`、任务停止、不生成技术健康分，且不再请求 robots 或 Sitemap。
- AC-003: Given 带明确 Challenge 证据的 403，When 任一同源请求收到该响应，Then 当前任务对该 origin 熔断且不继续发送后续请求。
- AC-004: Given 普通业务 403 且没有 WAF 证据，When 请求 robots 或 Sitemap，Then 结果为资源不可用但不误判为 WAF；When 它发生在入口，Then 任务以入口不可访问失败。
- AC-005: Given 429 和有效 `Retry-After`，When 任一同源请求收到该响应，Then 当前任务停止后续同源请求并向用户展示限流原因及可用的重试时间。
- AC-006: Given robots.txt 或 Sitemap 返回 HTML 错误页，When 分类预期资源，Then 结果为 `invalid_response`，不得进入 robots/Sitemap 有效性解析。
- AC-007: Given 低正文、高脚本占比的合法 SPA，When 不存在明确 Challenge 证据，Then 不得仅因此分类为 `waf_blocked`。
- AC-008: Given 一个包含五次重定向的请求，When 请求完成，Then 六次真实 HTTP 请求都受到限速并被计数，重定向跳数单独记录为五。
- AC-009: Given 全站任务，When 有界预检未通过 WAF/429止损条件，Then 才开始递归 Sitemap、页面发现和并发抓取。
- AC-010: Given `/cn` 和 `/cn/` 最终落到同一 URL，When 它们同时被发现，Then 最终页面只分析和评分一次，并保留重定向别名。
- AC-011: Given 用户以 `/cn/` 作为入口且最终仍为 `/cn/`，When 报告生成，Then `finalUrl` 为真实入口而不是固定的站点根路径。
- AC-012: Given 同源 URL 重定向到外域，When 全站范围已经确定，Then 系统记录重定向事实但不把外域正文纳入本站评分。
- AC-013: Given WAF、429 和异常资源 fixture，When 运行自动化测试，Then 不需要访问 Hikvision 或其他未授权第三方站点即可稳定复现分类和止损行为。
- AC-014: Given 现有私网、DNS pinning、凭据 URL、响应大小和重定向安全测试，When 完成本期改动，Then 原安全边界全部继续通过。
- AC-015: Given 现有单页和全站公开 API，When 本期上线，Then API 路径、认证、任务状态主结构和同源扫描合同保持兼容，仅新增错误语义与诊断字段。

## Metrics / Success

- WAF、429 和无效资源 fixture 的误入评分次数为 0。
- 确认 WAF 或 429 后，本任务对同一 origin 的额外 HTTP 请求次数为 0。
- 所有新成功全站报告都能区分 requested URL 与真实 final URL，并提供请求计数及停止原因。
- `/cn` 与 `/cn/` 汇聚到同一最终 URL 时，重复评分次数为 0。
- 自动化验收不依赖对 Hikvision 或其他未授权第三方站点的重复访问。

## Constraints

- 继续使用真实 UA：`GoodieAI-SEO-Audit/1.0 (+https://gato.com.cn/)`。
- 不通过冒充搜索引擎、切换虚拟 IP 或规避 Challenge 的方式解除封控。
- 保留现有 SSRF、DNS rebinding、私网地址、重定向、响应体积和超时防护。
- fixture 必须脱敏，不保存真实 Cookie、Challenge Token、访问令牌、内部 IP 或可用于重放的请求标识。
- 本期运行模型仍以单后端进程为正式边界；多实例共享限速与熔断另行设计。
- 本期不在生产环境使用 Hikvision 进行全站扫描或压力测试；如需人工复核，只允许在冷却后进行最小只读预检。
- 由于 GoodieAI robots 执行延期，本期只能宣称修复响应误判和风控止损，不能宣称已经完整实现礼貌爬虫合规。

## Open Questions

- 无。429 在本期停止当前任务并展示 `Retry-After`，不自动等待后重试；GoodieAI robots 执行、多实例共享状态和总请求硬上限均明确延期。

## Handoff

- PRD path: `docs/closed-2026-07-30-001-seo-audit-response-safety/prd.md`
- Delivery status: 已完成。四个 issue 均已通过 TDD 验收，单页和全站正式入口已默认启用响应分类、评分闸门、逐跳限速计数、WAF/429 熔断、有界预检与 resolved URL 去重。
- Production path: `POST /api/seo-audits` 与 `POST /api/seo-audits/site` 均通过 `SeoAuditRuntimeService` 创建任务级 `SeoSiteClient`；不存在回退到无分类评分的生产 fallback。
- Remaining boundaries: GoodieAI robots 授权执行、多实例共享状态和总请求硬上限仍属于 Later，不在本期完成范围内。
