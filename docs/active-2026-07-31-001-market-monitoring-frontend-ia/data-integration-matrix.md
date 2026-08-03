# 市场工作台真实数据接入矩阵

> 盘点日期：2026-08-04。状态描述区分“代码存在”“本地真实调用”“生产已生效”三层；最终证据与状态以本轮 Run Report 为准。

## 状态定义

- `真实接入`：正式前端默认调用受鉴权 GoodieAI API，后端读取真实来源或已持久化真实事实，不启用 fixture。
- `部分接入`：页面或合同已存在，但来源粒度、凭据、生产配置或真实入口验收仍有缺口。
- `仅 fixture`：只有隔离测试/开发数据，不得作为本地或生产业务数据。
- `未接入`：页面有业务位置，但没有可用来源适配器。
- `上游无接口`：已查证当前来源没有满足字段、权限或历史覆盖的可用接口，必须保持诚实缺失态。

## 逐页矩阵

| 页面、组件和可见指标/交互 | 前端 hook / 数据源 | GoodieAI 内部 API | 上游数据源和上游接口 | 当前状态 | 本地与生产配置 | 鉴权、项目所有权和敏感字段 | 缺口、实施动作和验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 市场总览 `/geo/market-overview`：ROAS、CPL、CPA、CPC；按来源的广告投入、展现、访问（点击）、官网表单咨询、线索入池、成交订单/金额、整体转化率；每日趋势、来源/指标切换 | `useMarketOverview`、`useWebsiteFormConsultations`、`useWebsiteFormConsultationDays` | `GET /api/marketing/projects/:projectId/dashboard`、`tongji-trend`、`tongji-source-trends`；`GET /api/website-data/projects/:projectId/form-consultations`、`form-consultation-days` | 百度营销四份报告 2290316/2284618/2602783/2307838；百度统计来源报告；官网 `GET /api/v1/admin/stats/dashboard` | 百度与官网聚合在本地代码中真实接入；官网已完成本地真实页面对账，生产待部署验收。53KF、线索、订单未接入；销售范围明确排除 | 后端营销开关、项目白名单、百度 OAuth/统计绑定；独立 `GATO_WEBSITE_FORM_*`；前端生产 fixture 必须关闭 | JWT + 项目所有权；百度 Token 仅数据库密文；官网凭据仅服务端；聚合响应禁止联系人/会话明细 | 本地 production build 从正式页面入口请求 `/api/website-data/projects/6/form-consultations`，2026-07-06 至 2026-08-04 显示两条来源行、合计 3 个会话；销售字段继续 `UNAVAILABLE`，不得计算 ROAS/CPL/CPA/转化率 |
| 广告表现 `/geo/ad-performance`：总消费、总展现、总点击、CTR、平均 CPC；每日趋势；计划→单元→关键词下钻与搜索 | `useAdPerformance`、`adPerformanceAdapter` | `GET /api/marketing/projects/:projectId/dashboard` | 百度营销四份独立报告；搜索词只关联单元并保留关键词名称证据 | 本地代码真实接入；开发 fixture 可显式启用但生产必须关闭；生产待部署验收 | `MARKETING_MONITORING_*`、百度连接/绑定与合同版本；`NEXT_PUBLIC_AD_PERFORMANCE_FIXTURE` 生产不得为 true | JWT + 项目所有权；Token 密文；响应使用精确整数/金额缩放字符串 | 复核四报表同一 `refresh_run_id` 全成全败、父子一致、搜索词不伪造 keywordId；入口网络证据证明 dashboard 默认路径 |
| 关键词分析 `/geo/keyword-analysis`：有展现/点击关键词、点击覆盖率、未获点击；消费、展现、点击、CTR、平均 CPC；象限、行动建议、单元/区间/异常筛选 | `useKeywordAnalysis`、`keywordAnalysisAdapter` | `GET /api/marketing/projects/:projectId/dashboard` 的 `keywords` | 百度营销关键词报告 2602783 | 本地代码真实接入；生产待部署；开发 fixture 仅用于隔离 UI 验收 | 同营销配置；`NEXT_PUBLIC_KEYWORD_ANALYSIS_FIXTURE` 生产不得为 true | JWT + 项目所有权；无 Token 下发 | 验证真实关键词响应严格解析、页面筛选/排序与后端快照对账，证明生产未启用 fixture |
| 网站流量 `/geo/website-traffic`：访问次数、访客数、PV、跳出率、平均访问时长、平均访问页数；当前/上期趋势；来源质量；入口/受访页面、搜索/排序/分页 | `useWebsiteTrafficOverview`、`useWebsitePageReport` | `GET /api/marketing/projects/:projectId/website-traffic-overview`、`website-traffic-pages` | 百度统计 `source/all/a`、`source/engine/a`、全站质量、入口页和受访页报告 | 本地代码真实接入；生产待部署验收；无 fixture 默认路径 | 百度统计凭据/站点绑定保存在独立表；营销开关和项目白名单 | JWT + 项目所有权；统计凭据数据库密文；页面 URL 需严格解析并排除跨域污染 | 验证固定/任意范围快照、缓存回退边界、精确分页、真实来源/页面响应与页面展示对账 |
| 原始咨询 `/geo/consultations`：官网表单和在线客服独立摘要、趋势/来源、记录筛选/搜索/排序/分页、按需详情抽屉 | `useConsultationRecords` + 官网逐日 hook | `GET /api/consultations/status`、`GET /api/consultations/projects/:projectId/records`、`records/:recordId`；官网逐日聚合 API | 官网真实存在 `GET /api/v1/admin/contact/list`、`GET /api/v1/admin/contact/:id`；53KF 官网公开说明有开放 API 和聊天记录，但未提供当前账户可调用端点/权限/字段证据 | 官网聚合和脱敏记录级 adapter 已在本地真实接入；53KF 为独立 `NOT_CONNECTED`；整体覆盖为 `PARTIAL`，生产待配置/验收 | 官网复用独立服务端配置；53KF 尚无账号级只读凭据和端点配置 | Header-only JWT + 项目所有权；详情先检查审计 schema；姓名/电话/邮箱服务端脱敏；禁止 IP、原始 Token、完整上游响应进入日志/报告 | 独立只读凭据对 2026-08-01 至 2026-08-04 返回 3 条记录；production build 所选 30 日列表返回 20 条脱敏表单记录并命中 `/api/consultations/projects/6/records`，同时展示官网来源和 53KF 未接入；53KF 解阻前不得把自动问候/窗口打开计为咨询 |
| 订单结果 `/geo/order-results`：订单数、签订金额及列表/筛选的完整设计态 | `orderResultsDataSource` | 无生产订单 API | 内部销售系统（本轮明确排除） | 生产 `UNAVAILABLE`；完整数据仅非生产显式 demo | 无生产销售配置；非生产 demo 受 `NODE_ENV !== production` 约束 | 不读取订单、客户或金额明细 | 保持诚实缺失态；不得新增假 API、生产模拟数据或由金额反推数量 |
| GEO 项目看板 `/geo/project-dashboard`（`/geo/dashboard`、`tasks`、`history` 重定向）：品牌提及率、SOV、推荐率、运行/回答/分析覆盖/失败、引用率、排名、竞品、来源变化、趋势、平台/分类/记录/机会 | 页面内请求 + `useDefaultProjectContext`、`useAIPlatformCatalog` | `GET /api/geo-projects/default-context`、`GET /api/geo-projects/:id/dashboard`、`GET /api/ai-platforms` | GoodieAI 数据库中的真实任务/回答/语义分析/引用证据；采集来源为已配置 OpenAI 兼容 API、DeepSeek Web、豆包 Web | 正式真实链路已存在；本轮复核而非另造营销接口 | AI 平台 Key 数据库密文；Web 平台使用服务器专用 Chrome/Profile | JWT + 项目所有权；管理员管理平台；浏览器不接收 API Key/Cookie/Profile | 回归默认项目、历史平台不被当前启停隐藏、缺失/无可验证引用态；生产逐页确认真实记录 |
| 问题库 `/geo/prompts`：问题/问题集 CRUD、批量、启停、运行、历史、表现指标 | 页面内请求 + 默认项目/平台目录 hook | `/api/geo-projects/:id/prompts*`、`question-sets*`、运行接口 | GoodieAI DB；运行时调用已配置 AI API/Web 平台 | 真实接入 | 平台配置和专用 Web 会话 | JWT + 项目所有权；写操作保留现有幂等/范围规则 | 回归 CRUD/运行与真实平台状态；不把营销 fixture 引入该链路 |
| 问题集报告 `/geo/question-set-reports`、项目报告 `/geo/reports`：运行、暂停/恢复/重试、历史、导入导出、PDF、回答/分析/引用证据 | 页面内请求 | `/api/geo-projects/:id/question-set-runs*`、`reports*`、证据下载 | GoodieAI DB + AI API/Web 采集证据 | 真实接入；部分 Web 平台依赖服务器图形会话 | 平台配置、Chrome Profile、证据目录、调度配置 | JWT + 项目/运行所有权；证据下载鉴权；不得暴露 Profile/Cookie | 回归真实入口与服务日志；确认失败不静默换旧 provider/fixture |
| 引用来源 `/geo/sources`：来源类型、域名/URL、引用次数、覆盖回答、平台/分类、新增/流失/保留、机会与记录 | 页面内请求 + 平台目录 hook | `GET /api/geo-projects/:id/sources` | 已保存的真实 AI 回答显式引用证据 | 真实接入 | 同 AI 平台配置 | JWT + 项目所有权；外链只作为已清洗证据展示 | 回归 explicit-citation 口径，无可验证样本不制造引用率 |
| 告警规则 `/geo/alerts`：可见度、竞品、情绪、引用、平台差异、来源流失、任务失败阈值 CRUD/启停 | 页面内请求 + 默认项目 hook | `/api/geo-projects/:id/alerts*` | GoodieAI DB 中规则与真实 GEO 指标 | 真实接入 | 无额外上游配置 | JWT + 项目所有权；阈值严格验证 | 回归 CRUD 和项目切换竞态；不需外部营销 API |
| SEO 检测 `/geo/seo-audit`：单页/全站抓取、技术健康、robots/Sitemap/索引信号、搜索平台标记、历史、CSV 导入导出、异步进度 | 页面内请求 | `/api/seo-audits/runtime`、`jobs*`、history/import/export 等 | 用户指定公开站点的真实 HTTP/HTML/robots/Sitemap；可选隔离浏览器渲染 | 真实接入 | SSRF 网络策略、浏览器路径、渲染网络隔离开关 | JWT + 用户所有权；SSRF/私网/元数据地址拒绝；下载鉴权 | 回归评分版本、异步恢复、网络边界与生产真实页面；不属于营销数据拼接 |

## 外部阻塞

1. 53KF：官方公开材料证明产品具有聊天记录和开放 API 能力，但没有公开可执行的聊天记录端点合同；当前项目也没有 53KF 账号级只读凭据。解除条件是 53KF 为当前账户开通只读 API，并提供认证方式、聊天记录/消息端点、访客/客服/机器人发送方字段、稳定会话 ID、来源字段、限流和历史保留期；完成真实只读样本验证后才能从 `NOT_CONNECTED` 切为 `AVAILABLE/PARTIAL`。
2. 销售系统：本轮明确排除。订单数、订单金额、线索入池和依赖指标继续 `UNAVAILABLE`。
3. 官网最小权限：官网明细接口真实存在，但当前上游 JWT 守卫没有可验证的只读角色合同；GoodieAI 只执行 GET 且只返回脱敏字段。生产启用前仍需确认专用服务账号、轮换和撤权责任。
4. 生产 Git Bundle：桥接提交 `2bbd8c4` 已推送到 GitHub `main`，但 2026-08-04 的正式 workflow 在上传 Bundle 前因 production Environment 缺少四个 SSH secrets 而失败，服务器代码、数据库和服务均未改变。解除条件是配置 `AI_GEO_DEPLOY_HOST`、`AI_GEO_DEPLOY_USER`、`AI_GEO_DEPLOY_SSH_KEY`、`AI_GEO_DEPLOY_KNOWN_HOSTS`，确认受限 forced-command 公钥和人工恢复值守，再先完成桥接部署；在此之前不得推送第二阶段业务提交。

## 2026-08-04 本地验收摘要

- 官网真实只读：2026-08-01 至 2026-08-04，聚合会话数 3、记录总数 3、返回 3；列表字段全部脱敏，详情合同不返回原始联系人和 IP。原始响应和凭据未写入日志、截图或本文。
- production build 页面：市场总览命中 `/api/website-data/projects/6/form-consultations` 并展示合计 3 个官网可归因会话（直接 2、自然搜索 1）；原始咨询所选 30 日命中逐日和记录 API，列表返回 20 条脱敏表单记录，并明确显示官网与 53KF 两个独立状态；订单页没有订单 API 请求并显示不可用。20 条原始记录不等于 3 个可归因会话。
- AI/GEO/SEO 回归：项目看板、来源、SEO 检测、问题集报告分别命中各自既有内部 API 并返回 200；没有新增营销数据拼接或 fixture 回退。
- 自动化门禁：后端 994/994、营销 131/131、官网数据 28/28、咨询记录 35/35、前端单元 72/72、部署专项 26/26、Playwright 23/23；lint 和 38 路由 production build 通过。
- 本地限制：没有复制生产百度 Token，故本轮本机只验证百度严格合同、快照、鉴权和浏览器缺失态；生产 Token 的真实四报表证据必须在服务器部署后重新验收。
- 生产限制：workflow `30842859133` 因发布开关为 false 安全跳过；临时开启后 `30842939667` 在 SCP 前因 SSH secrets 为空失败，随后已把 `AI_GEO_DEPLOY_ENABLED` 恢复为 false。没有发生服务器快进、迁移、服务停止或数据写入。
