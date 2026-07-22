# SEO 检测 MVP：竞品调研、范围与实现

## 目标

在现有 GEO 工作台中增加一个能直接指导修改的 SEO 检测页。用户输入公开页面 URL 后，系统优先告诉用户“先修什么”，再展示基础分和分类明细。

当前版本定位为单页关键项检测，不宣称替代全站技术审计、真实用户性能监测、关键词排名或外链数据库。

## 竞品调研结论

本次参考了用户指定的五类产品：

- [98CE SEO 诊断](https://www.98ce.com/seo-diagnosis) 与 [测罗 SEO 诊断](https://www.celuo.com/seo_diagnosis)：按性能、移动端、内容、技术、关键词、可访问性、社交和链接质量等维度组织结果，适合借鉴分类结构。
- [Semrush Site Audit](https://zh.semrush.com/siteaudit/)：核心价值不只是分数，而是全站爬取、技术问题归类、严重程度和优先待办。MVP 借鉴了“优先修复队列”，没有复制其需要持续爬取和历史数据的全站能力。
- [站长工具 SEO 综合查询](https://seo.chinaz.com/)：更偏域名权重、收录、排名、流量估算、备案与基础设施信息。这些能力依赖搜索引擎或商业数据库，不适合首版自行估算。
- [UAPI SEO 检测](https://uapis.cn/tools/seo-checker)：单页输入、即时检查标题/描述/H1/Viewport/Canonical/Open Graph/图片 Alt/链接并提供预览，与当前产品形态最接近。

由此确定产品顺序：

1. 首屏给出按严重程度排序的修复行动，而不是把总分作为唯一主角。
2. 结果按用户可理解的类型分组，保留原始检测值、影响说明和明确建议。
3. 清楚标注能力边界，不把响应时间包装成 Core Web Vitals，也不生成没有数据来源的权重或排名。

## 当前 19 项检查

| 分类 | 检查项 | 失败优先级 |
| --- | --- | --- |
| 收录与抓取 | HTTP 状态、noindex、HTTPS、robots.txt、sitemap.xml/robots 声明 | 严重 / 高 / 中 |
| 页面信息 | Title 长度、Meta Description 长度、Canonical | 高 / 中 |
| 内容结构 | 单一 H1、标题层级、正文信息量、可抓取链接 | 高 / 中 / 低 |
| 移动与可访问性 | Viewport、图片 Alt、html lang | 高 / 中 |
| 结构化与分享 | JSON-LD、Open Graph、Twitter Card | 中 / 低 |
| 基础性能 | 服务器响应耗时、HTML 体积 | 中 |

总分按检查项权重计算，分值范围为 0–100。严重程度只用于修复顺序，分类得分则帮助判断问题集中在哪个领域。

## 实现结构

```text
/geo/seo-audit
      │ POST /api/seo-audits（JWT）
      ▼
SeoSiteClient ── 安全解析、固定 DNS、手动校验重定向、限时/限量抓取
      ▼
SeoAuditService ── Cheerio 解析、19 项规则、权重评分、分类与优先级
      ▼
SeoAuditHistoryService ── 按用户将完整报告保存到 SQLite
      │ GET /api/seo-audits、GET /api/seo-audits/:id
      ▼
页面结果 ── 优先修复队列 → 分数摘要 → 分类检查 → 搜索/分享预览
      └── 历史报告抽屉 ── 分页摘要 → 完整报告回放
```

安全抓取层会拒绝 URL 凭据、本机与私网 IP、解析到私网的域名，并在每次重定向后重新解析和校验。连接使用已校验的 DNS 地址，避免校验后再次解析造成 DNS rebinding；同时禁用代理继承，限制 5 次重定向、10 秒超时和 2 MB HTML 响应体。历史列表和详情均以 JWT 当前用户为查询条件，跨用户记录按不存在处理；仅保存结构化检测报告，不保存抓取到的 HTML 正文。

## 开源项目取舍

- [GoogleChrome/lighthouse](https://github.com/GoogleChrome/lighthouse)：适合后续补充实验室性能、可访问性、最佳实践和更完整的 SEO 审计；需要 Chrome 运行环境，任务更重，不适合直接塞入当前同步请求。
- [Unlighthouse](https://github.com/harlan-zw/unlighthouse)：在 Lighthouse 之上提供全站发现、采样、并行扫描和结果面板，适合未来的异步全站审计版本。
- [stjudewashere/seonaut](https://github.com/stjudewashere/seonaut)：Go + MySQL 的开源 SEO 爬虫，具备站内链接、重定向、Meta 和标题等全站问题分析，可作为独立服务方案参考。

首版没有引入这些依赖，原因是当前需求可以通过轻量 HTML 分析完成，而完整 Lighthouse/全站爬虫需要任务队列、浏览器运行时、并发限制、持久化、进度查询与历史对比。若升级，建议新增异步审计任务，而不是延长当前同步接口。

## 已验证证据

- 后端全量测试：372 项通过，覆盖分析规则、路由契约、用户隔离、分页历史、私网 IP、DNS 私网解析和私网重定向拦截。
- 前端全量 Node 测试：119 项通过；历史入口专项 ESLint 通过。
- 前端生产构建：`/geo/seo-audit` 已被 Next.js 静态生成。
- 真实入口：登录后从侧边栏进入 SEO 检测页，对 `https://gato.com.cn/` 检测成功，得到报告 #1、HTTP 200、65 分、7 个问题和 6 个分类；随后从“历史报告”抽屉看到该记录并重新打开完整报告。
- SQLite 启动证据：Sequelize 自动创建 `seo_audit_records` 表及 `user_id`、`user_id + checked_at` 索引；真实入口日志包含新增、分页列表和用户限定详情查询。
- 安全入口：未认证调用返回 401；认证后请求 `127.0.0.1` 返回 400 与 `PRIVATE_NETWORK_URL`。

## 后续升级顺序

1. 将 Lighthouse 放到独立 worker，补充 LCP、CLS、INP/TBT 等实验室或现场性能证据。
2. 增加异步全站爬取、页面去重、站内断链、重定向链和分页进度。
3. 在现有历史报告基础上增加分数趋势、问题负责人、已忽略规则和复测闭环。
4. 只有接入可信第三方数据源后，再增加关键词排名、收录量、域名权重和外链指标。
