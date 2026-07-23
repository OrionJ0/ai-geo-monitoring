# 全站技术 SEO 审计：正式实现与验证

## 交付结果

SEO 检测正式入口 `/geo/seo-audit` 已从单页 MVP 升级为双模式：默认“全站检测”异步扫描同源公开页面，“单页检测”继续同步分析输入的精确 URL。两种成功报告都写入当前账户历史，旧单页历史无需迁移即可继续打开。

技术健康度是本产品内部的可维护评分，不是 Google、Bing 或百度官方评分，也不承诺收录或排名。页面展示始终区分“具体问题、检测事实、修改建议”，并在全站报告中额外展示受影响页面数量与 URL。

## 可维护评分配置

唯一正式配置入口为 `backend/config/seoAuditRules.js`：

- `version`：写入每份报告的 `scoreVersion`，用于解释历史分数。
- `checks`：22 个检查项的 `severity` 与 `weight`；业务分析代码不再硬编码权重。
- `thresholds`：Title、Description、正文、响应时间、HTML 体积和 Keywords 数量阈值。
- `crawl`：全站页数上限 200、并发 3、Sitemap 上限 20、递归深度 3。
- Keywords 检查 ID 为 `meta-keywords`，默认低权重 1；缺失、空值、重复、过多和有效内容均返回具体事实。

配置在服务创建时完整校验：缺少规则、非法严重程度、负权重或非正整数抓取配置会直接失败，不会静默生成错误分数。修改配置时应同步更新 `version`，并通过 `backend/tests/SeoAuditService.test.js` 的注入配置测试验证分数变化。

## 全站抓取与聚合

`SeoSiteAuditService` 合并四类 URL 来源：提交 URL、同源标准链接、根 `/sitemap.xml`、robots 声明的 Sitemap。Sitemap index 可递归读取；URL 会移除片段、限制为同源 HTTP/HTTPS 并全局去重。

每个页面复用现有 `SeoAuditService` 的 22 项规则与 `SeoSiteClient` 安全边界，因此单页和全站不会出现两套评分逻辑。页面失败只生成一条关键访问问题并继续；站点级 robots、Sitemap 和平台标签只计分一次。站点总分按本次实际检查实例的通过权重除以总权重计算，同一问题按检查 ID 汇总受影响 URL。

Google、Bing、百度验证状态固定从站点首页读取以下标签：

- `google-site-verification`
- `msvalidate.01`
- `baidu-site-verification`

状态分别为“已检测到、缺失、内容为空”。该信号不代表平台后台仍处于验证成功状态。

## 异步任务、SQLite 与历史

全站任务使用 `seo_audit_jobs` 表保存归属、URL、状态、进度、最终历史 ID 和安全错误信息。正式 API 为：

- `POST /api/seo-audits/site`：创建任务并返回 `202`。
- `GET /api/seo-audits/jobs/:jobId`：查询进度；完成后通过历史记录返回完整报告。
- `GET /api/seo-audits`、`GET /api/seo-audits/:id`：列表和重新打开单页/全站报告。

任务与历史查询都带 `user_id` 条件，跨用户统一返回不存在。任务成功后先保存完整结构化报告，再标记完成；失败任务不创建历史。服务启动时会将 `queued` / `running` 任务重新入队。报告不保存抓取的 HTML 正文。

## 前端行为

- 默认选择全站检测；模式说明会明确 200 页上限和单页精确范围。
- 全站运行中显示任务编号、阶段轨迹、发现/检测/失败页数；任务编号保存在浏览器本地，刷新后继续查询。
- 全站报告先展示按严重程度、影响页面数和权重排序的问题，再展示三平台标签和逐页账本。
- 历史摘要显示“全站/单页”、问题数、页数和截断状态。
- GEO 工作台在窄屏自动折叠侧栏，390px 下输入、模式选择和报告保持完整宽度。

## 验证证据

- 后端全量：411 项测试通过（包含工作树同期新增测试）；含 URL/Sitemap 发现、同源去重、失败容错、截断进度、配置注入、用户隔离、任务恢复，以及真实临时 SQLite 建表和报告落库。
- 前端全量：111 项 Node 测试通过；相关改动 ESLint 通过。
- 生产构建：Next.js 28 个路由生成成功，`/geo/seo-audit` 正常静态生成。
- 真实入口：从 `http://localhost:3001/geo/seo-audit` 登录后，对 `https://example.com/` 完成全站报告 #7（1/1 页）和单页报告 #8；历史抽屉可区分模式并重新打开完整报告。
- 真实 UI：1440×900 和 390×844 截图检查通过；窄屏侧栏自动折叠。真实页面控制台 0 error，唯一 warning 是 Next.js 开发模式 CSS preload 提示。
- SQLite 启动：本地后端在无 `DATABASE_URL` 时使用 `database.sqlite`，Sequelize 已创建 `seo_audit_jobs` 及用户/状态索引。

## 当前边界

本实现不执行浏览器渲染，不遍历外域链接，不调用搜索平台账号 API，也不提供真实 Core Web Vitals、关键词排名、收录量、域名权重或外链数据库。后续如加入 Lighthouse/CrUX，应作为独立重任务证据，不得把当前服务器响应时间改名为 Core Web Vitals。
