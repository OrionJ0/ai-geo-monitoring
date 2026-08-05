---
title: 营销广告快照 API 资源化 PRD
date: 2026-08-05
status: active
source: 2026-08-05 用户确认与 Claude CLI 两轮独立评估
scope: product
---

# 营销广告快照 API 资源化 PRD

## Problem Statement

当前营销 API 已按主数据源分开：百度推广广告快照、百度统计流量、百度统计页面报告、广告刷新任务和官网表单是不同接口。这一边界正确，不需要重命名为 `/ads/*`、`/traffic/*` 或建立通用营销 API 平台。

问题集中在广告 `/dashboard`：它一次返回项目和绑定状态、日期覆盖、汇总、趋势、计划、单元、关键词、搜索词、层级数量和刷新状态。不同页面只需要其中一部分，却都下载并解析完整响应：

- 市场总览只需要快照状态、广告汇总和趋势；
- 广告表现需要计划、单元和关键词层级，不需要搜索词；
- 关键词分析需要关键词及有限搜索词证据，不需要完整计划和单元数组；
- 搜索词页只需要搜索词，但本期和上期各调用一次完整 Dashboard。

生产已经观测到截至 2026-08-03 的 863 条真实关键词，2026-08-05 所选周期搜索词页显示 61 条真实搜索词。它们不是固定上限，但已经证明 over-fetch 和无后端分页不是纯理论问题。当前没有性能事故，也没有外部 API 消费者，因此适合现在冻结基线并实施内部读资源，不需要等待 003 关闭；但 003 与 006 的生产发布和观察窗口不得重叠。

## Solution

采用混合资源化：保留一个轻量快照根接口，按页面真实用途拆出广告层级、关键词和搜索词三个读资源。

本目录是广告页面读 API 最小化的唯一需求归属。不再并行设计 `dashboard?view=...`、逐页 BFF 或另一组同义资源；百度统计流量和官网表单继续使用各自现役接口，不被合并进一个全成全败的市场首页接口。

GoodieAI 自有广告读取接口只保留一份 OpenAPI 3.1 机器合同。它覆盖轻量 Dashboard 和三个详情资源，明确请求、响应、空值、错误、缓存、数据源和上游调用行为。前端 wire type 从该合同生成，后端用合同测试验证实际响应；`docs/API.md` 只保留现役路由和业务语义摘要，不复制字段表。百度上游合同不进入该 OpenAPI，继续由现有版本化 manifest 独立管理。

```text
GET /api/marketing/projects/:projectId/dashboard
  → revision、状态、绑定、coverage、filter、summary、trend、counts、刷新状态

GET /api/marketing/projects/:projectId/ad-hierarchy
  → 计划、单元、关键词层级读模型及全范围汇总

GET /api/marketing/projects/:projectId/keywords
  → 可分页、筛选、排序的关键词及全筛选范围汇总

GET /api/marketing/projects/:projectId/search-terms
  → 可分页、筛选、排序的搜索词
```

所有详情资源必须使用轻量 Dashboard 返回的同一 `revision`，并由服务端验证 `revision`、项目和所选日期范围属于同一份完整 `refresh_run_id` 快照。拆成多个 HTTP 请求不能破坏当前单事务读取提供的快照一致性。

迁移分两次正式发布：第一版 additive 增加新资源并迁移消费者，旧 Dashboard 保持原合同；第二版在消费者和生产调用为零后，将 Dashboard 硬切为轻量合同并删除旧大数组、兼容 adapter 和失效测试。不建立长期双版本或 fallback。

## User Stories

1. As a 市场负责人, I want 市场总览只读取汇总和趋势, so that 页面不下载与当前判断无关的完整广告层级和搜索词。
2. As a 投放分析人员, I want 关键词和搜索词支持服务端分页、筛选和排序, so that 数据增长时页面负载仍然有界。
3. As a 广告运营人员, I want 广告表现保留完整计划、单元和关键词层级, so that 资源化不会破坏现役树形分析。
4. As a 开发人员, I want 所有资源显式钉扎同一 revision, so that 多请求页面不会混用不同刷新快照。
5. As a 运维人员, I want 新接口先 additive 上线并有明确旧合同退役条件, so that 公开入口可以验证后再硬切。

## Scope

### In scope

- 建立轻量 Dashboard 快照根合同；
- 新增广告层级、关键词和搜索词三个只读资源；
- 所有详情资源要求 `revision`，并验证项目、日期和完整快照；
- 关键词与搜索词的服务端分页、筛选、排序和有界 page size；
- 广告层级与关键词资源返回和分页无关的全筛选范围 summary，供后续双周期比较使用；
- 广告层级继续返回计划、单元和关键词的一致快照读模型；
- 抽取唯一营销快照选择器，供 Dashboard 和三个资源共用；
- 保持四报表同次刷新、全成全败和同一 `refresh_run_id`；
- 页面只调用 GoodieAI API；三个详情资源只读取指定 revision 的数据库事实，不直接调用百度或各自触发刷新；
- 保持现役项目级刷新合并、stale/background refresh 和失败冷却，证明页面请求突发不会按消费者数量重复调用上游四报表；
- 前端按搜索词、关键词、广告表现、市场总览顺序迁移；
- 两次发布完成 additive 迁移和旧 Dashboard 大数组硬退役；
- 建立接口合同、消费者、响应体积、数据库查询和浏览器验收证据。
- 在拆接口前冻结 006 所有广告读取路由的唯一 OpenAPI 3.1 合同，并随 R1/R2 阶段更新现役状态；
- 由 OpenAPI 生成前端 wire type，并以后端合同测试阻止路由响应和文档漂移；
- 新增不可变迁移 016，使事实唯一键包含 `refresh_run_id`，并显式记录 revision 事实保留状态；这是实现 AC-006 所必需的 R2 范围例外。

### Out of scope

- 修改 003 的统一 OAuth、百度统计、迁移或产品状态；
- 修改 005 的百度 provider 或共享 HTTP 内核；
- 修改百度统计流量、页面报告或官网 `/api/website-data`；
- 接入百度统计推广产品、计划、单元、关键词、创意或搜索词行为；相关公共 API 能力裁决见 `docs/solutions/2026-08-05-baidu-tongji-promotion-api-capability.md`；
- 修改广告上游四报表、字段、日期、预算、限流、双读或原子刷新；
- 新增 `/v1`、`/v2`、版本请求头或外部开放 API；
- 将计划、单元、关键词拆成通用 CRUD；
- 修改广告、访问、咨询或销售数据的主数据源；
- 建设独立 composition root 整理；
- 支持多百度账号、多统计用户名或跨账号站点；
- 建设百度合同漂移监测；
- 为百度上游 API 建 OpenAPI、复制整套官方文档或改写现有 manifest；
- 为全项目建 Swagger 门户、API 网关或全量文档生成平台；
- 接入 53KF、线索池、订单或成交金额。

### Later

- 只有广告层级响应真实超过预算或树形页面改为懒加载时，再评估把计划、单元和关键词层级进一步拆分；
- 只有出现仓库外消费者时，再评估 URL 版本和正式弃用周期。

## Product Behavior

### 1. 开始与实施门禁

006 与 003 没有强技术依赖：006 只读取既有完整广告快照，不修改 OAuth、百度统计凭据、上游四报表或落库事务。因此基线、合同冻结和代码实施可以立即开始。

发布纪律仍保持串行：003、006、007 和 005 的生产发布及观察窗口不得重叠。若 003 已进入 A1/A2 发布窗口，006 等该窗口结束并重新冻结生产基线后再发布；若 006 先发布，不阻止 003 后续按其自身门禁执行。006 关闭后，007 的广告双周期工作才能消费最终资源合同；005 最后冻结正确行为。

验收顺序固定为：口径正确 → 不重复调用上游 → 页面最小返回体。资源化不得顺手改变指标语义；详情读取不得新增上游调用；只有前两项有证据后才以字节数和分页预算判断最小返回体。

### 2. API 合同真值

006 只定义 GoodieAI 自有的广告读取接口。唯一机器合同固定为 `docs/openapi/marketing-ad-read.openapi.yaml`：

- Issue 001 先交付分阶段合同：现役完整 Dashboard 标为 `LIVE_R0`，三个未上线详情 operation 标为 `PLANNED_R1`，轻量 Dashboard 候选 schema 标为 `PLANNED_R2`；
- R1 将三个 additive 详情资源标为现役，同时保留旧 Dashboard 响应；
- R2 在同一文件硬切轻量 Dashboard，删除旧大响应字段；
- `docs/API.md` 只摘要现役路由和业务语义，不建第二套字段真值。

每个 operation 必须标记数据源和上游行为。Dashboard 允许经现役单一协调路径触发合并刷新；`ad-hierarchy`、`keywords`、`search-terms` 必须标为只读数据库、零 Provider 调用。

### 3. 轻量 Dashboard

最终 Dashboard 继续承担“当前广告快照根”的职责，返回：

- 项目、模块、绑定和来源状态；
- `revision`；
- coverage、filter、币种和 cost scale；
- 广告 summary 和 trend；
- campaigns、adGroups、keywords、searchTerms 数量；
- active/last refresh run。

最终不再返回四个明细数组。Dashboard 无快照时继续诚实返回现役空状态，不能把缺失表示为零数据快照。

### 4. 广告层级

广告层级是服务广告表现页的快照读模型，不是新的数据库事实。它在一个响应中返回计划、单元和关键词，保留：

- 账户 → 计划 → 单元 → 关键词的严格结构；
- 搜索词不嵌入关键词节点；
- 父子 ID、名称和精确指标合同；
- 同一 revision、coverage、币种和 cost scale。
- 覆盖完整所选日期和层级过滤结果、与数组大小无关的 summary。

该接口不返回搜索词。若未来层级本身超过预算，再根据真实页面交互单独设计懒加载，不在首版提前拆成大量请求。

### 5. 关键词与搜索词资源

关键词和搜索词资源支持：

- 页码和有界 page size；
- 服务器允许列表内的排序字段与顺序；
- 文本查询；
- 计划、单元等现役可证明父级过滤；
- 所选日期范围；
- 总条数和总页数；
- 明确 `revision`、coverage、filter、currency 和 cost scale。
- 覆盖完整筛选结果、与当前页无关的 summary。

搜索词继续只稳定关联到推广单元并保留关键词名称，不伪造 `keywordId`。合法空页返回成功和空 `items`，不等于快照缺失或 revision 无效。

广告层级和关键词 summary 与明细使用同一 revision、filter 和事务。精确计数与金额保持十进制字符串，缺失保持缺失，不由前端下载全部分页或当前可见页重新计算。006 只建立这一合同；广告表现和关键词上期比较由 007 实施。

### 6. Revision 一致性

页面先读取轻量 Dashboard 获得某个日期范围的 `revision`，再用该 revision 请求详情。服务端必须：

- 先验证用户拥有项目权限；
- 验证 revision 属于该项目的成功完整刷新；
- 验证日期范围在该快照 coverage 内；
- 只读取该 revision 的事实；
- 在响应回显 revision。

刷新在两个请求之间完成时，详情仍读取旧 revision，不自动跳到新快照。页面需要新数据时重新获取 Dashboard revision，不在前端拼接新旧资源。

### 7. 兼容迁移

发布 R1：

- additive 增加三个资源；
- 旧 Dashboard 完整合同保持不变；
- 迁移搜索词、关键词和广告表现消费者；
- 市场总览暂时继续读取旧 Dashboard；
- 记录旧数组消费者和生产访问。

发布 R2：

- 前置条件是所有详细页面已使用新资源并通过生产观察；
- 市场总览切到轻量 Dashboard adapter；
- Dashboard 删除 campaigns、adGroups、keywords、searchTerms；
- 删除旧大响应 adapter、兼容分支、测试和现役说明；
- 新轻量合同成为唯一默认路径。

R1、R2 都是完整 Git Bundle 发布。出现阻断回归时使用后代 revert revision 快进恢复，不建立运行时 fallback。

### 8. 错误与空状态

至少区分：

- 参数或排序字段无效；
- revision 缺失；
- revision 不属于项目或不存在；
- revision 与日期范围不匹配；
- 完整快照不存在；
- 合法空页；
- 数据库或模块不可用。

权限验证必须先于 revision 细节，未授权用户不能通过 revision 判断其他项目资源是否存在。服务端错误继续使用现役稳定错误信封，不向浏览器泄漏 SQL、内部 ID 或上游报文。

## Acceptance Criteria

- AC-001：003 未关闭不阻止 006 冻结基线和实施代码；但两者生产发布/观察窗口不得重叠，006 发布前必须以当时正式凭据路径重新取得基线。
- AC-002：轻量 Dashboard 最终不返回计划、单元、关键词和搜索词数组，只返回快照根、汇总、趋势、数量和刷新状态。
- AC-003：广告层级只返回同一 revision 的计划、单元和关键词，不返回搜索词，不改变严格层级语义。
- AC-004：关键词和搜索词接口分页、筛选和排序有界，合法空页与无快照状态可区分。
- AC-004A：广告层级和关键词接口返回完整筛选范围 summary，且 summary 不随 page/pageSize 改变。
- AC-005：所有详情资源都要求并回显 revision，服务端只读取该项目、该 coverage、该 revision 的事实。
- AC-006：刷新在多请求之间完成时，已钉扎页面仍显示同一旧 revision，不混入新快照。
- AC-007：四报表刷新继续全成全败并使用同一 `refresh_run_id`，API 拆分不改变落库事务。
- AC-008：搜索词不伪造 `keywordId`，广告和流量主数据源边界不变。
- AC-009：R1 只 additive 增加资源并保持旧 Dashboard 合同，页面可以逐个迁移。
- AC-010：R2 前旧数组消费者、生产调用和兼容依赖均为 0；R2 后旧大响应代码和文档不存在。
- AC-011：市场总览、广告表现、关键词和搜索词页面只请求各自需要的资源，并正确展示加载、空、错误和刷新状态。
- AC-012：不增加 URL API 版本、provider 重构、多账号或独立 composition root 项目。
- AC-013：从 `https://insight.guangtuo.com` 验证新资源、revision 一致性和全部营销页面后，R2 才可成为正式默认。
- AC-014：Issue 001 在任何新路由实现前交付唯一 OpenAPI 3.1 合同，并且路由、字段、空值、错误、缓存、数据源和上游行为均可执行校验。
- AC-015：前端 wire type 由 OpenAPI 生成且有漂移检查；后端实际响应通过同一合同测试，不再手工维护第二套 wire type。
- AC-016：GoodieAI OpenAPI 不包含百度上游接口，`docs/API.md` 不复制字段表，006 不新建 Swagger 门户或全项目 API 平台。

## Metrics / Success

- 市场总览响应中的明细数组数量为 0；
- 搜索词页完整 Dashboard 请求数量为 0；
- 关键词和搜索词单请求返回行数始终不超过 page size；
- 所有详情响应的 revision 覆盖率为 100%；
- 同页混用不同 refresh revision 的事件为 0；
- 旧 Dashboard 大数组消费者和生产调用为 0；
- 页面或详情资源直接调用百度的次数为 0；同一项目请求突发只允许现役唯一刷新协调路径触发一次四报表刷新；
- 四报表、指标、来源和空值语义回归数量为 0；
- R1 前后记录 Dashboard 响应字节、DB 读取耗时和页面请求基线，用于验证资源化实际收益。
- OpenAPI 与后端响应、前端生成类型的漂移检查通过率为 100%，手写的重复 wire type 数量为 0。

## Constraints

- 正式入口固定为 `https://insight.guangtuo.com`；
- 当前只有仓库内 Next.js 消费者，不建设外部 API 版本治理；
- OpenAPI 只覆盖 006 负责的广告读取路由，不扩大到百度上游、百度统计流量、官网数据或全项目 API；
- API 路径和响应都是可观察合同，必须通过两阶段迁移退役；
- revision 必须来自完整成功快照，不允许调用方传任意 run ID 读取部分事实；
- page size、排序和过滤字段必须使用服务端允许列表；
- 精确金额继续使用字符串缩放值，不转换为浮点；
- 不修改任何已应用迁移；R2 只允许新增迁移 016。迁移时只信任 R1 当前成功 revision，R2 运行期固定保留当前与紧邻上一成功 revision，更早 revision 返回 `409 MARKETING_SNAPSHOT_UNAVAILABLE`；
- R1/R2 不与 003、005、007 的生产发布或观察窗口重叠；代码实现可以在不修改同一正式入口和合同的前提下独立进行；
- 不把代码已完成描述为生产已经切换。

## Open Questions

Issue 001 已用当前生产快照测量并固定：

1. Dashboard 未压缩 1,066,452 B、gzip 71,178 B；30 次原始读取 P95 为 153.53 ms，20 次正式 HTTPS gzip 请求 P95 为 297.63 ms；
2. 生产完整范围为 898 个关键词和 350 个搜索词，默认/最大 page size 冻结为 50/200；
3. 现役 UI 的排序、文本查询、父级和搜索词状态筛选已冻结，完整证据见 [production-baseline.md](production-baseline.md)。

这些参数影响实现配置，不改变“轻量根 + 三个资源 + revision 钉扎”的产品方向。

## Handoff

- PRD path: `docs/active-2026-08-05-006-marketing-api-resourceization/prd.md`
- Current state: `active`；003 已关闭，Issue 001 已完成只读生产基线与合同冻结，Dashboard、页面和生产接口未改变。
- Recommended next step: Issue 001 验收并提交后进入 Issue 002；006 关闭后进入 007，007 关闭后再进入 005。
