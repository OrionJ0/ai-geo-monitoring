# 文档总览

`docs/` 只承担项目知识导航、现役专题文档、需求过程和历史证据，不再复制根 [README](../README.md) 中的完整产品说明与使用说明。

## 从哪里开始

| 目标 | 权威入口 |
| --- | --- |
| 了解产品、能力与本地启动方式 | [根 README](../README.md) |
| 理解业务背景、领域模型和统一术语 | [项目上下文](../CONTEXT.md) |
| 查看当前页面与数据接入状态 | [当前前端页面实施状态](#当前前端页面实施状态) |
| 查看正式入口、当前部署证据和运维流程 | [部署与运维](DEPLOYMENT.md) |
| 查接口、配置和安全边界 | [接口文档](API.md)、[环境变量](ENVIRONMENT.md)、[安全说明](SECURITY.md) |
| 查营销漏斗数据源与指标口径 | [ADR 0001](adr/0001-marketing-funnel-data-source-of-truth.md) |
| 查全局 UI、组件和可访问性标准 | [视觉设计规范](visual-design-spec.md) |
| 查未完成事项或待修 Bug | [MARK_LATER](../MARK_LATER.md)、[Fix Bug](fixbug.md) |

## 当前生产快照

本节只保留帮助读者判断文档状态所需的最小快照；完整运行证据以[部署与运维](DEPLOYMENT.md#当前正式单机实例)为准。

- 唯一支持的正式入口是 `https://insight.guangtuo.com`；历史域名和直接 IP 不是支持入口。
- 2026-08-05 A2 与审查加固均已通过独立 Git Bundle 正式发布，迁移 015 删除了生产数据库三个旧统计凭据列；统一 OAuth 是搜索推广与百度统计唯一正式凭据路径，003 已关闭。精确 revision、只读双产品复验、数据库和浏览器证据见[部署与运维](DEPLOYMENT.md#当前正式单机实例)。
- 百度营销、百度统计和既有 AI/GEO 数据已有生产真实数据证据。官网九键统计与脱敏咨询代码已部署，但生产仍缺专用官网项目和只读账号凭据，因此模块保持 `DISABLED`；代码已部署不等于官网数据已生产接通。53KF、线索池和销售订单仍未接入。

## 当前前端页面实施状态

下表区分“代码进入生产 revision”和“真实来源已生产接通”。2026-08-05 本次整理重新核验了公开健康与 revision，并在现有登录态完成关键词到搜索词精确下钻及全量搜索词页验收；其他需要登录的页面数据沿用 2026-08-04 已记录的验收证据。

| 页面 / 入口 | 实现与部署状态 | 当前数据边界 |
| --- | --- | --- |
| 工作台外壳与导航 | 固定顶部栏、静态分组侧栏、移动端覆盖侧栏、统一页面标题、共享设备/日期筛选和 `/geo` → 市场总览默认入口已部署 | 页面可见性与来源数据可用性解耦；旧 `/geo/marketing` 已单向重定向到市场总览 |
| 市场总览 | 投放效率、来源全链路、每日趋势、共享周期指标卡、响应式与无障碍已部署 | 生产已有百度广告、CPC 和百度统计真实数据；官网代码已部署但模块为 `DISABLED`；53KF、线索入池、订单数/金额及依赖指标仍缺失 |
| 广告表现 | 汇总、趋势、严格层级树、详情和共享筛选已部署 | 四份百度报告已生产真实刷新；搜索词保持独立事实，不能伪造成关键词 ID 的子节点 |
| 关键词分析 / 搜索词 | 关键词摘要、筛选、图表、详情、明细和独立搜索词下钻已部署 | 2026-08-05 已从正式关键词页进入精确搜索词下钻，并验证全量页显示 61 条本期真实搜索词；生产 fixture 未启用 |
| 网站流量 | 汇总、趋势、来源质量、入口/受访页面、共享筛选和分页已部署 | 正式页已有百度统计访问、UV、PV、质量和页面数据证据；无可信来源关联时继续显示缺失 |
| 咨询数据 | 表单/在线客服独立口径、趋势/分布、记录表、详情抽屉、九键来源分类和原始 `referrer` 证据代码已部署 | 官网生产配置仍为 `DISABLED`，所以九键真实页面数据尚不可观测；53KF 为 `NOT_CONNECTED`，不得用 fixture 冒充生产接通 |
| 订单结果 | 汇总、来源分布、趋势、筛选、表格和详情界面已部署 | 销售系统只读 API 未接入；生产固定显示不可用，完整示例只允许非生产环境显式启用且不持久化 |
| AI 数据分析 | 生产 revision 已包含正式路由和未接入状态页；完整示例仅在非生产环境可见 | 后端报告生成、不可变历史和正式来源取数链路尚未实现，当前不会生成生产营销 AI 报告 |

本地视觉与浏览器证据集中在 [`design-qa.md`](blocked-2026-07-31-001-market-monitoring-frontend-ia/design-qa.md)。它不是生产发布凭证。

## 现役专题文档

| 文档 | 职责 |
| --- | --- |
| [API](API.md) | 后端接口路径、权限、参数与返回合同 |
| [ENVIRONMENT](ENVIRONMENT.md) | 环境变量、默认值和敏感信息边界 |
| [DEPLOYMENT](DEPLOYMENT.md) | 正式生产真值、发布顺序、健康检查与运维排错 |
| [SINGLE_HOST_DEPLOYMENT](SINGLE_HOST_DEPLOYMENT.md) | Ubuntu/macOS 单机接管、Git Bundle、systemd 和 Web 图形会话 |
| [VERCEL](VERCEL.md) | 可选的前后端分离方案；不是当前正式发布路径 |
| [SECURITY](SECURITY.md) | 已实施安全措施、部署检查和安全验证 |
| [visual-design-spec](visual-design-spec.md) | 全项目 UI、布局、组件、状态、响应式与无障碍标准 |

`DEPLOYMENT.md` 负责“当前正式实例和怎么运维”，`SINGLE_HOST_DEPLOYMENT.md` 负责“如何接管和执行单机发布”；两者互相引用但不复制当前 revision。

## 进行中需求

| 需求 | 当前主题 |
| --- | --- |
| [营销数据 AI 分析报告](active-2026-08-04-001-marketing-ai-analysis-report/prd.md) | 只读证据包、异步生成和不可变历史；当前仅完成前端壳层 |
| [Flash 结构化分析可靠性](active-2026-08-05-002-flash-structured-analysis-reliability/prd.md) | 已定义目标事实/目标语义/开放竞品三轨合同、scoped SOV，以及“阶段 1 开放发现 → 模型外竞品注册表归一 → 阶段 2 无身份先验判断”的安全边界；S05 真实 Flash 定向复测 3/3 通过，但注册表 resolver/快照、不变性测试、自我修复清理、状态消费者和 41×3 新合同重跑尚未完成，暂不硬切，当前生产仍使用 v4 |
| [官网表单生产接入与首页性能优化](active-2026-08-05-004-website-form-production-home-performance/prd.md) | 官网 503 会话级短路与百度旧快照异步刷新已随 `98467f0` 推送到 GitHub，尚未部署或生产验收；官网生产启用仍须专用最小权限只读凭据，当前生产继续 `DISABLED` |

## 草案需求

草案只表示待评审方案，不改变当前代码、凭据或生产合同。

| 需求 | 当前主题 |
| --- | --- |
| [百度 Provider 模块化重构](draft-2026-08-05-005-baidu-provider-modularization/prd.md) | 003、006、007 关闭后拆分 OAuth、搜索推广和百度统计客户端，共用唯一安全 HTTP 内核并证明修正后行为等价 |
| [营销广告快照 API 资源化](draft-2026-08-05-006-marketing-api-resourceization/prd.md) | 003 关闭后实施轻量 Dashboard、广告层级、关键词和搜索词资源；先 additive 迁移，再硬切删除旧大响应并为 007 提供汇总合同 |
| [营销生产数据正确性与双周期回归](draft-2026-08-05-007-marketing-production-data-correctness/prd.md) | 003、006 关闭后修复广告/关键词上期、百度统计来源对账和同路径页面消歧，再解除 005 的等价重构门禁 |

## 阻塞需求

| 需求 | 阻塞点 |
| --- | --- |
| [市场工作台信息架构](blocked-2026-07-31-001-market-monitoring-frontend-ia/prd.md) | 页面、搜索词和生产日志验收已完成；目录内唯一未关闭 issue 是 53KF 外部接入，官网最小权限身份及线索/订单链路由独立后续承接，百度 `READY` 已移交营销监控系统 |
| [市场部虚拟机 Web 队列](blocked-2026-07-27-001-market-team-vm-web-queue/prd.md) | 目标虚拟机多浏览器发布与资源验收 |
| [豆包 Web 可信监测](blocked-2026-07-27-002-doubao-web-monitoring/prd.md) | 代码和本地真实采集已完成；等待目标虚拟机全流程验收与管理员正式启用 |
| [GEO 实体份额指标](blocked-2026-07-28-001-geo-entity-share-metrics/prd.md) | 真实入口硬切验收 |
| [营销监控系统](blocked-2026-07-29-001-marketing-monitoring/prd.md) | 白名单试点可用；正式 `READY` 仍缺四项百度契约证据和生产准入 |
| [AI 语义分析质量](blocked-2026-07-29-002-ai-semantic-analysis-quality/prd.md) | v4 仍是正式路径；等待 v5 硬切并退役 v4 运行时 |

## 已关闭需求

关闭目录保留 PRD、Tech Spec、issues 和验收证据，不再作为当前待办。

| 需求 | 入口 |
| --- | --- |
| 全站 SEO 审计 | [PRD](closed-2026-07-23-001-seo-site-audit/prd.md) |
| AI 平台设置 | [PRD](closed-2026-07-23-002-ai-platform-settings/prd.md) |
| 看板指标层级 | [PRD](closed-2026-07-23-003-dashboard-metric-hierarchy/prd.md) |
| 问题集运行报告与历史 | [PRD](closed-2026-07-23-004-question-set-run-reports/prd.md) |
| SEO 技术健康度 | [PRD](closed-2026-07-23-005-seo-technical-health-score/prd.md) |
| 问题集运行可靠性 | [PRD](closed-2026-07-26-001-question-set-run-reliability/prd.md) |
| DeepSeek Web 监测 | [PRD](closed-2026-07-26-002-deepseek-web-monitoring/prd.md) |
| SEO 响应可信度与风控 | [PRD](closed-2026-07-30-001-seo-audit-response-safety/prd.md) |
| 单品牌与平台运行范围 | [PRD](closed-2026-07-31-002-single-brand-platform-runtime/prd.md) |
| 问题集报告可信度 | [Tech Spec](closed-2026-07-31-003-question-set-report-trustworthiness/TECH-SPEC.md) |
| 市场总览渠道对比与真实数据修复 | [PRD](closed-2026-08-05-001-market-overview-channel-comparison/prd.md) |
| 百度统一 OAuth 凭据与营销 API 架构 | [PRD](closed-2026-08-05-003-baidu-unified-oauth-api-architecture/prd.md) |

## 决策与已验证解法

### ADR

- [0001 营销漏斗数据源真值](adr/0001-marketing-funnel-data-source-of-truth.md)
- [0002 营销 AI 分析只读工具边界](adr/0002-marketing-ai-analysis-read-only-tool-boundary.md)
- [0003 冻结报告的版本化图表意图](adr/0003-versioned-chart-intent-for-frozen-marketing-ai-reports.md)
- [0004 营销 AI 报告的最小搜索词样本](adr/0004-minimized-search-term-sample-for-marketing-ai-reports.md)

### Solutions

- [SEO 审计 MVP（历史 / 已退役）](solutions/2026-07-22-seo-audit-mvp.md)
- [全站 SEO 审计实现](solutions/2026-07-23-seo-site-audit.md)
- [SEO 技术健康度 v4](solutions/2026-07-23-seo-technical-health-v4.md)
- [生产进程、代理与域名切换记录](solutions/2026-07-30-ai-geo-production-deployment.md)
- [百度搜索推广完整层级接入](solutions/2026-08-03-baidu-search-hierarchy.md)

## 历史材料与台账

- [`ideas/marketing-monitoring-system.md`](ideas/marketing-monitoring-system.md) 是 2026-07-29 的早期一页方案，已明确标为历史，不是现行订单指标、来源链路或首页设计依据。
- [`fixbug.md`](fixbug.md) 只维护 Bug 台账；跨主题后续事项统一进入根 [MARK_LATER](../MARK_LATER.md)。
- `images/` 只保存根 README 使用的演示截图；需求专属设计图放在对应需求目录的 `assets/`。

## 维护规则

- 根 `README.md` 解释产品、能力、启动和使用方式；本文件只做导航与当前状态索引，不复制完整功能说明。
- `CONTEXT.md` 维护业务背景、领域模型和术语；稳定的架构裁决进入 `adr/`，已验证解法进入 `solutions/`。
- 单个需求使用 `draft-`、`active-`、`blocked-`、`closed-` 状态前缀；状态变化时只改前缀，并同步本索引。
- `DEPLOYMENT.md` 是正式实例与运行证据的权威入口；其他文档只引用它，不复制“当前服务器版本”。
- 历史验收必须带绝对日期并明确“历史”；未部署、已部署、生产已启用和登录后真实数据验收必须分别描述。
