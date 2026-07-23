# 全站技术 SEO 审计与可配置评分 PRD

## Problem Statement

当前 SEO 检测只能分析用户提交的一个页面。它能够快速发现该页面的基础问题，但不能反映搜索引擎实际沿站内链接和 Sitemap 抓取多个路由时遇到的死链、重复元信息、错误索引指令、Canonical 冲突或问题覆盖范围。现有检查权重直接写在业务代码中，调整成本高，也没有记录评分规则版本；`meta keywords` 尚未纳入检测；Google、Bing、百度的平台验证标签虽然已被合并检查，但在报告中不够明确，且子路由检测可能遗漏只放在首页的标签。

## Solution

将 SEO 检测升级为“全站检测”和“单页检测”双模式：全站检测作为默认入口，从首页、站内链接和 Sitemap 发现同源公开路由，异步完成逐页分析并汇总整站问题；单页检测保留为快速复测工具。把检查项严重程度、权重和阈值集中到可维护配置文件，新增低权重 Keywords 检测，并在首页单独展示 Google、Bing、百度验证标签状态。每次单页或全站检测都保存完整历史报告。

## User Stories

1. As an SEO 负责人, I want to scan a website’s discoverable routes, so that I can see issues that do not occur on the homepage.
2. As an SEO 负责人, I want issues grouped by rule with affected URLs, so that I can prioritize fixes with the broadest impact.
3. As an operator, I want long-running site audits to show progress, so that I know whether the audit is queued, running, completed, truncated, or failed.
4. As a maintainer, I want rule weights and thresholds in one configuration file, so that I can review and adjust scoring without editing the audit algorithm.
5. As a China-focused SEO user, I want Google, Bing, and Baidu verification tags shown separately, so that I can confirm the agreed tag-based platform setup.
6. As a user, I want historical reports to retain the scoring rule version and scan mode, so that old and new results remain understandable.

## Scope

- In scope:
  - `/geo/seo-audit` 提供“全站检测 / 单页检测”双模式，全站检测默认选中。
  - 单页模式继续兼容现有同步 API 和历史报告。
  - 全站模式从提交 URL、同源可抓取链接、根 Sitemap 及 robots 声明的 Sitemap 发现 URL；支持 Sitemap index；URL 去重并只抓取同源 HTTP/HTTPS 页面。
  - 全站检测异步执行，显示队列/运行/完成/失败状态、已处理页面数、已发现页面数和配置上限。
  - 默认最多检测 200 个页面；达到上限时完成报告但明确标记“结果已截断”，不宣称覆盖全部路由。
  - 聚合报告展示整站技术健康度、问题数量、受影响页面数量、示例 URL 和逐页结果。
  - Keywords 检查非空内容、关键词数量、重复和明显堆砌，以低权重参与评分。
  - Google、Bing、百度验证标签固定从站点首页检查，分别展示“已检测到 / 缺失 / 空值”。只按标签判断，不检测 DNS 或验证文件。
  - 所有规则的权重、严重程度和主要阈值集中配置，并在报告中记录 `scoreVersion` 和实际总权重。
  - 单页及全站成功报告均按当前账户保存，可在历史报告中识别模式并重新打开。
  - 继续沿用现有私网、重定向、响应大小、协议和用户隔离安全边界。
- Out of scope:
  - 不接入 Google Search Console、Bing Webmaster Tools 或百度搜索资源平台账号/API。
  - 不宣称验证标签等于平台后台当前验证成功。
  - 不提供关键词排名、收录量、域名权重、反向链接数据库。
  - 不把服务器响应时间等同于真实 Core Web Vitals。
  - 本期不运行浏览器渲染，不保证发现仅在复杂客户端交互后出现的 URL。
- Later:
  - PageSpeed/CrUX/Lighthouse、JavaScript 渲染抽样、IndexNow 状态、Hreflang 双向验证、定时复测、报告对比与导出。

## Product Behavior

### 检测入口

- 页面默认选择“全站检测”，并明确提示扫描会异步执行且受页面上限约束。
- “单页检测”分析输入的精确 URL；“全站检测”以输入 URL 的站点为边界并从该 URL开始发现页面。
- URL 为空或不合法时不创建任务，并沿用现有用户可理解的错误信息。

### 全站任务

- 创建成功后立即展示任务状态，不要求用户一直停留在页面。
- 运行中持续显示进度；刷新或重新进入页面后可通过任务编号继续查询。
- 单个页面失败不会终止整站任务，该 URL 记录失败原因并继续处理其他页面。
- 根页面或所有入口都无法读取时任务失败，并展示可行动的原因。
- 达到页面上限时报告状态仍为完成，同时显示实际发现数、已检测数和截断说明。

### 报告

- 单页报告继续采用“检查对象 → 具体问题 → 检测事实 → 建议”。
- 全站报告先展示整站问题聚合，再展示受影响 URL；同一规则的问题按严重程度、受影响页面数和权重排序。
- 分数统一称为“技术健康度”，不是任何搜索引擎官方评分。
- 全站技术健康度按照所有已完成页面的可计分检查实例计算；站点级检查只计一次，页面抓取失败按关键可访问性问题计入。
- 平台验证状态独立展示，但仍保留一个低权重“平台标签完整性”规则，便于发现三平台标签缺失。

### 权重与规则维护

- 配置必须包含检查 ID、严重程度、权重和阈值；权重为非负整数，Keywords 默认权重为 1。
- 业务代码不得继续散落硬编码权重。配置缺项或值非法时，服务启动/测试应明确失败，而不是静默使用错误分数。
- 历史报告保存当次 `scoreVersion`、总权重和检查项权重，后续修改配置不重算旧报告。

### 历史与权限

- 历史摘要展示单页/全站模式、分数、问题数、页面数和检测时间。
- 用户只能创建、查询和打开自己的全站任务及历史报告。
- 旧单页历史 JSON 不迁移，继续兼容查看。

## Acceptance Criteria

- AC-001: SEO 检测页提供双模式且默认选择全站检测，单页模式仍可完成现有检测。
- AC-002: Keywords 出现在单页逐项结果中，缺失、空值、有效内容和明显重复均有具体事实，默认权重为 1。
- AC-003: 权重、严重程度和标题/描述/内容/性能等阈值来自一个有版本号的配置文件；报告返回 `scoreVersion`、`totalWeight`。
- AC-004: 修改注入的规则权重会改变可预测的测试分数，证明算法实际读取配置而非硬编码。
- AC-005: 输入任意子路由时，Google、Bing、百度标签仍从站点首页读取，并分别返回状态；三者全部为非空标签时平台标签规则通过。
- AC-006: 创建全站检测返回异步任务编号和初始状态；用户可轮询当前进度和最终结果。
- AC-007: 全站发现合并提交 URL、同源内部链接、默认 Sitemap 和 robots 声明 Sitemap，并支持 Sitemap index；不同来源的相同 URL 只检测一次。
- AC-008: 外域、非 HTTP/HTTPS、片段 URL、明显非页面协议不进入全站队列。
- AC-009: 单页抓取失败会记录到逐页结果但不会使其他页面停止；整站最终报告包含成功数、失败数和截断状态。
- AC-010: 全站报告按规则聚合受影响页面，至少提供受影响数量和 URL 列表，并可查看逐页分数与问题。
- AC-011: 全站任务和报告按用户隔离；其他用户查询统一返回不存在。
- AC-012: 成功的全站报告写入现有 SEO 历史，历史摘要可区分模式并重新打开完整报告；旧报告保持可读。
- AC-013: 页面刷新后仍能从历史或任务编号恢复已完成报告；任务失败显示明确错误，不产生伪成功历史。
- AC-014: 抓取继续执行私网地址、DNS rebinding、重定向、超时、页面大小和 HTML 类型防护。
- AC-015: 后端专项与全量测试、前端专项测试、生产构建和登录后的真实入口验收均通过；达到页面上限时 UI 明确显示截断。

## Metrics / Success

- 用户能在一次全站任务中看到实际检测页面数和每类问题的受影响 URL。
- 100% 新报告包含模式、评分规则版本和总权重。
- 同一站点重复 URL 不重复抓取；达到限制的任务 100% 显示截断状态。
- 单页功能和已有历史报告无回归。

## Constraints

- 本地继续使用 SQLite，生产继续兼容 Postgres 和 Sequelize 自动建表模式。
- 全站任务在当前 Node 服务内执行，必须限制页面数和并发，避免压垮被检测网站或本服务。
- 报告只保存结构化结果，不保存抓取到的完整 HTML 正文。
- 产品遵循 Google、Bing、百度可公开观察的技术规则，但不得将内部健康度描述为三家官方评分或排名保证。

## Open Questions

- 无。本期默认页面上限为 200，后续可依据真实运行时间和资源占用调整配置。

## Handoff

- PRD path: `docs/draft-2026-07-23-001-seo-site-audit/prd.md`
- Recommended next step: 按本 PRD 使用 TDD 依次完成规则配置、单页规则、全站服务、异步 API、历史兼容与前端验收。
