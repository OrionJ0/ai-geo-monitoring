# 全站技术 SEO 审计：正式实现与验证

> 历史方案说明：本文记录的是已退役的 v3 平行权重评分。2026-07-23 起，新报告正式使用“技术健康分 v4”的四阶段、覆盖率聚合与阻断封顶模型；当前实现与验证见 `2026-07-23-seo-technical-health-v4.md`。本文仅用于解释既有历史报告，不再是新报告的推荐评分路径。

## 交付结果

SEO 检测正式入口 `/geo/seo-audit` 已从单页 MVP 升级为双模式：默认“全站检测”异步扫描同源公开页面，“单页检测”继续同步分析输入的精确 URL。两种成功报告都写入当前账户历史，旧单页历史无需迁移即可继续打开。

技术健康度是本产品内部的可维护评分，不是 Google、Bing 或百度官方评分，也不承诺收录或排名。页面展示始终区分“具体问题、检测事实、修改建议”，并在全站报告中额外展示受影响页面数量与 URL。

## 可维护评分配置

唯一正式配置入口为 `backend/config/seoAuditRules.js`：

- `version`：写入每份报告的 `scoreVersion`，用于解释历史分数。
- `checks`：23 个检查项的 `severity` 与 `weight`；业务分析代码不再硬编码权重。
- `crawlerProfiles`：维护搜索、AI 搜索、用户触发和 AI 训练/数据使用四类 robots token，包含是否计分、策略类型和官方说明链接。
- `thresholds`：Title、Description、正文、响应时间、HTML 体积和 Keywords 数量阈值。
- `crawl`：全站页数上限 200、并发 3、Sitemap 上限 20、递归深度 3、唯一链接状态抽查上限 500、浏览器渲染抽样上限 3。
- Keywords 检查 ID 为 `meta-keywords`，默认低权重 1；缺失、空值、重复、过多和有效内容均返回具体事实。
- Sitemap 检查在 `2026-07-23-v3` 提升为高优先级、权重 7；返回 200 但 URL 列表为空仍然失败。

配置在服务创建时完整校验：缺少规则、非法严重程度、负权重或非正整数抓取配置会直接失败，不会静默生成错误分数。修改配置时应同步更新 `version`，并通过 `backend/tests/SeoAuditService.test.js` 的注入配置测试验证分数变化。

## 全站抓取与聚合

`SeoSiteAuditService` 合并四类 URL 来源：提交 URL、同源标准链接、根 `/sitemap.xml`、robots 声明的 Sitemap。Sitemap index 可递归读取；URL 会移除片段、限制为同源 HTTP/HTTPS 并全局去重。

2026-07-23 对 `https://gato.com.cn/` 的真实复现发现：首页有 58 个链接，robots 允许抓取，但 Sitemap 的 `urlset` 为空；首页第一个 `<a>` 又指回 `/`。旧实现把 `addPage()` 的布尔返回值直接作为 Cheerio `each` 回调结果，重复首页返回 `false` 后触发 Cheerio 提前终止，后续链接均未读取。修复后回调不再返回该布尔值；真实服务在最多检测 10 页的条件下发现 45 页、成功检测 10 页并正确标记截断。

每个页面复用现有 `SeoAuditService` 的 23 项规则与 `SeoSiteClient` 安全边界，因此单页和全站不会出现两套评分逻辑。页面失败只生成一条关键访问问题并继续；Sitemap 和平台标签按站点计分一次，爬虫权限按每个页面路径解析并只聚合受影响 URL。站点总分按本次实际检查实例的通过权重除以总权重计算，同一问题按检查 ID 汇总受影响 URL。

## 全站专项审计

全站模式在 v4 技术健康分之外增加 `sitewide-audit-v4` 专项层。专项结果不静默改变既有评分，单独返回检查状态、受影响 URL、检测事实与建议：

- 跨页重复 Title 与 Meta Description。
- Canonical 聚类，以及同页多声明、链和循环。
- HTTP 重定向链与循环。
- 最多 500 个唯一目标的失效内链和外链状态。
- 有效 Sitemap 页面清单中没有内部入链的疑似孤儿页面，并明确显示 Sitemap 发现来源与零入链证据；没有有效页面清单时返回“暂时无法检查”。
- Sitemap 页面按零入链、仅 Footer 入链、导航/栏目/正文等结构性入链分类；仅依赖 Footer 的页面单独提示。
- 导航中的空 href、`#`、`javascript:`、无 href 的 `<a>`，以及能从 `role`、目标属性或内联跳转代码确认用于页面跳转的 `span` / `div`；仅有点击样式、`cursor-pointer` 或通用点击事件不作为 SEO 错误。
- Sitemap、robots Sitemap 声明、Canonical、`og:url` 与检测入口的来源一致性，并提示 localhost、回环或私网站点地址。
- hreflang 语言代码、重复语言目标、目标可访问性与双向回链。
- Sitemap 中失效、重定向、noindex 页面，以及已抓取可索引页面的缺失项。
- 最多 3 页源码与无头 Chrome 执行 JavaScript 后的标题、描述、正文量和链接量差异；导航抽样只触发 hover/focus，不点击业务操作，并记录交互后才出现的链接。
- 与同一账户、同一站点上一次全站报告比较的新增、已解决和持续问题实例。

无头 Chrome 通过 DevTools Protocol 直接运行，不新增浏览器框架依赖。浏览器网络无法由应用层 DNS 校验可靠固定，因此生产环境默认不启动渲染器；只有运行环境已通过容器、网络命名空间或等价出口策略隔离浏览器网络时，才可设置 `SEO_RENDER_NETWORK_ISOLATED=true`。未启用隔离、未找到 Chrome 或只有部分样本成功时，该检查明确返回“证据不足”，不会把部分证据伪装成完整通过。可通过 `SEO_RENDER_BROWSER_EXECUTABLE` 指定 Chrome/Chromium 路径。

Google、Bing、百度验证状态固定从站点首页读取以下标签：

- `google-site-verification`
- `msvalidate.01`
- `baidu-site-verification`

状态分别为“已检测到、缺失、内容为空”。该信号不代表平台后台仍处于验证成功状态。

## 搜索与 AI 爬虫权限

报告使用 `RobotsAccessService` 按目标页面的路径和查询参数解析 `robots.txt`，遵循最具体 User-agent、同等具体分组合并、最长路径优先及同长度 `Allow` 优先。矩阵覆盖：

- 搜索引擎：Googlebot、Bingbot、Baiduspider；纳入评分。
- AI 搜索：OAI-SearchBot、Claude-SearchBot、PerplexityBot；纳入评分。
- 用户触发访问：ChatGPT-User、Claude-User、Perplexity-User；robots 规则可能不适用，不计分。
- AI 训练与数据使用：GPTBot、Google-Extended、ClaudeBot、CCBot；是否开放属于内容授权策略，不计分。其中 Google-Extended 是 robots 控制 token，不是独立 HTTP User-Agent。

`robots.txt` 普通 4xx 或空内容会被解释为“未声明抓取限制”，但独立的文件有效性检查仍会报告文件缺失或为空；429、5xx、网络失败以及非空但无有效 User-agent 的内容为“无法判断”。因此产品只陈述 robots 声明层面的权限，不把“允许”写成“真实 UA 可访问、已经抓取、已经收录或会被 AI 引用”；真实访问仍可能受页面状态、WAF、登录、IP 校验和平台策略影响。

实现依据以各平台公开文档为准：[Google crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers)、[Google robots 解释](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec)、[Bing crawlers](https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0)、[百度 robots](https://www.baidu.com/search/robots_english.html)、[OpenAI crawlers](https://developers.openai.com/api/docs/bots)、[Anthropic crawlers](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)、[Perplexity crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers) 与 [CCBot](https://commoncrawl.org/ccbot)。

## 异步任务、SQLite 与历史

全站任务使用 `seo_audit_jobs` 表保存归属、URL、状态、进度、最终历史 ID 和安全错误信息。正式 API 为：

- `POST /api/seo-audits/site`：创建任务并返回 `202`。
- `GET /api/seo-audits/jobs/:jobId`：查询进度；完成后通过历史记录返回完整报告。
- `GET /api/seo-audits`、`GET /api/seo-audits/:id`：列表和重新打开单页/全站报告。

任务与历史查询都带 `user_id` 条件，跨用户统一返回不存在。任务成功后先保存完整结构化报告，再标记完成；失败任务不创建历史。服务启动时会将 `queued` / `running` 任务重新入队。报告不保存抓取的 HTML 正文。

## 标准 CSV 导出与回导

`SeoAuditExchangeService` 提供版本化的 `seo_audit_report_v1` 长表格式。文件固定 26 列，用 `record_type` 展开报告摘要、聚合问题、全站专项检查、审计差异、单页检查、站点页面、页面问题、平台标签和爬虫权限；可见列适合 Excel、Numbers 或数据工具筛选，`record_json` 保存对应结构化记录，唯一 report 行用于原文件无损回导。

导出和导入均走当前用户隔离的历史接口。导出器会把缺少 `mode` 的旧版单页历史规范化为 `page`，因此升级前的报告也可导出。导入限制为 10MB、20000 行，校验表头顺序、schema、唯一 report 行及报告必需字段，并对可能被电子表格解释为公式的可见文本添加安全前缀。成功回导会创建一条 `source=imported` 的新历史，保留原报告编号和原检测时间，不覆盖已有记录。

## 前端行为

- 默认选择全站检测；模式说明会明确 200 页上限和单页精确范围。
- 全站运行中显示任务编号、阶段轨迹、发现/检测/失败页数；任务编号保存在浏览器本地，刷新后继续查询。百分比按阶段和已检测页数单调增长，发现新路由不会导致进度条回退。
- 全站报告顶部以“优先修复内容”统一展示页面技术问题、跨页专项问题和缺失的平台验证标签，并明确标注专项提示不计入技术健康分；下方继续展示 v4 四阶段账本、十二类全站专项审计、本次与上次问题差异、三平台标签和逐页账本。
- 导航链接可抓取性不再只展示三个示例：报告列出全部问题入口、元素类型、出现次数和有界的出现页面样本。没有 `href` 时只说明 HTML 无法提供跳转目标，不把问题出现页面误称为目标链接；历史报告也在展示层转换为相同口径。
- 历史摘要显示“全站/单页”、问题数、页数和截断状态。
- 页面提供“导入 CSV”，已打开报告提供“导出标准 CSV”；导入记录在历史摘要中标记“导入”。
- GEO 工作台在窄屏自动折叠侧栏，390px 下输入、模式选择和报告保持完整宽度。

## 验证证据

- SEO 后端专项：38 项测试通过；包含 Sitemap v3、旧版历史导出与真实站点发现回归，覆盖 robots、Sitemap 权重、CSV 往返、用户隔离、单页/全站聚合、历史与任务。
- SEO 前端专项：10 项测试通过；相关 TSX 改动 ESLint 通过。
- 生产构建：Next.js 28 个路由生成成功，`/geo/seo-audit` 正常静态生成。
- 真实入口：从 `http://localhost:3001/geo/seo-audit` 登录后，对 `https://example.com/` 完成单页报告 #10；页面展示 13 个爬虫 token 和命中事实，历史抽屉可找到报告 #10 并重新打开。
- 真实 UI：1440×900 和 390×844 截图检查通过；窄屏矩阵会改为纵向布局。真实页面控制台 0 error。
- SQLite 启动：本地后端在无 `DATABASE_URL` 时使用 `database.sqlite`，Sequelize 已创建 `seo_audit_jobs` 及用户/状态索引。
- SQLite 往返：报告 #10 导出为 53851 字节标准 CSV 后重新导入为报告 #11；模式、网址、原检测时间和完整展示数据均保留。
- 全仓回归：后端 452 项、前端 127 项全部通过；本次 SEO 提交未包含同期 AI 平台与问题集功能的未提交改动。

2026-07-24 全站专项审计增量验收：

- 后端全量 568 项（含真实 Chrome 集成）、前端工具测试 174 项、TypeScript 检查和本次相关文件 ESLint 全部通过。
- 放宽构建网络限制后，Next.js 生产构建成功并静态生成全部 28 个路由，包括 `/geo/seo-audit`。
- 正式 `SeoSiteAuditService` 对测试站点完成 125/125 页真实抓取，报告 10 个疑似孤儿页、8 个仅 Footer 入链页和 6 类 HTML 无法直接读取跳转地址的导航入口；JavaScript 抽样由本机 Chrome 实际执行并取得源码/渲染后证据。
- 全量 ESLint 仍受 29 个既有 CommonJS 测试文件 `require()` 规则错误阻断；这些文件不属于本次改动范围，未做越界调整。

2026-07-24 对抗式审查后的证据边界收紧：

- `sitewide-audit-v4` 在抓取截断、没有有效 Sitemap 页面地址、Sitemap 清单未读完、链接抽查达到上限、导航渲染证据缺失或 hreflang 目标未进入审计范围时返回“证据不足”或“暂时无法检查”，不再把未覆盖部分当作通过；历史 v2/v3 报告不会与 v4 误做问题增减比较。
- 提交入口发生跨域名重定向时，以最终入口的 origin 继续发现内部页面；审计页数之外、但已在已抓页面出现的内链目标仍会执行状态探测。
- 历史差异只比较相同规则版本、相同专项版本、相同 origin 且未截断的报告；本次证据不足的问题进入“未验证”，不会误报为“已解决”。
- 页面抓取失败时，依赖完整页面图的重复、Canonical、孤儿页和 hreflang 检查保持“证据不足”；该页面的历史逐页问题进入“本次未验证”，不会误报为“已解决”。
- 历史基线直接按 `requested_url` / `final_url` 的 origin 查询，不再受账户最近 50 份其他站点报告挤出；裸域跳转到 `www` 时仍可用相同提交入口找到上次报告。
- 报告持久化前移除逐页原始链接图，只保留有界的专项证据，避免历史报告体积随页面链接数无上限增长。

2026-07-24 `sitewide-audit-v4` 术语与判断边界验收：

- Sitemap 基础检查命名为“Sitemap 可用性”，跨页对比命名为“Sitemap 页面覆盖”；Sitemap 没有当前站点的有效页面清单时，页面覆盖、疑似孤儿页和内链来源质量均返回“暂时无法检查”，不再显示全部抓取页面缺失或零个孤儿页。
- 导航检查不再因 `cursor-pointer`、鼠标指针样式或通用点击事件直接判定 `span` / `div` 为 SEO 错误；无有效 `href` 的 `<a>`、明确页面跳转控件和交互后才创建的链接仍会报告。
- 后端全量 582 项、前端工具测试 177 项、TypeScript、相关文件 ESLint 及 Next.js 生产构建全部通过；生产构建静态生成 28 个路由。
- 正式认证 API 对 `http://192.168.9.206:3003/` 生成报告 #60，成功检测 64/64 页并返回 `sitewide-audit-v4`。该站 Sitemap 条目使用 `localhost:3003`，与检测入口不同源，因此 Sitemap 页面覆盖、疑似孤儿页和内链来源质量为“暂时无法检查”，URL 一致性明确报告来源不一致；私网检测不运行浏览器抽样，导航检查保持“证据不足”，且未再把仅有点击样式的菜单项误报为 6 类导航问题。

## 当前边界

本实现只对最多 3 页执行浏览器渲染抽样，并只检查最多 500 个唯一内外链目标；它不调用搜索平台账号 API，也不提供真实 Core Web Vitals、关键词排名、收录量、域名权重或外链数据库。后续如加入 Lighthouse/CrUX，应作为独立重任务证据，不得把当前服务器响应时间改名为 Core Web Vitals。
