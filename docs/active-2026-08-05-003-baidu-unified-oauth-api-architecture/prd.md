---
title: 百度统一 OAuth 凭据与营销 API 边界整理 PRD
date: 2026-08-05
status: active
source: 2026-08-05 用户确认的统一凭据要求与 Claude CLI 对抗式评审
scope: product
---

# 百度统一 OAuth 凭据与营销 API 边界整理 PRD

## Problem Statement

当前百度商业开发者应用已经申请搜索推广读取、搜索报表和百度统计权限，但系统仍维护两套 Token：搜索推广使用 dev2 OAuth Access Token / Refresh Token，百度统计由管理员另外填写 Data API Token。

这套历史实现带来四个直接问题：

- 管理员需要维护两套会过期的秘密凭据；
- 管理页面把历史实现描述成百度官方强制要求，容易形成错误认知；
- 百度统计是否真实可用取决于第二套人工 Token，而不是当前 OAuth 连接；
- 凭据、产品 API 和页面指标之间的关系没有被清楚表达。

需要统一的是凭据来源，不是产品 API 或数据事实。搜索推广和百度统计仍是不同产品：广告投入、展现和点击来自百度推广；来源、访问、UV 和 PV 来自百度统计。官网咨询继续来自官网接口，线索和成交等待销售系统。

“应用勾选了百度统计权限”或“数据库里存在 OAuth Token”都不能证明统一方案成立。Token 可能早于新增权限签发，也可能与统计 `userName` 或目标站点不匹配。正式运行路径修改前必须先用生产服务器内的同一 OAuth Token 完成真实只读验证；若前提不成立，本需求停止，不通过增加兼容层或反复重新授权掩盖。

## First Principles

1. 真实 API 调用结果是权限真值，控制台勾选、scope 字段和本地 fixture 只是线索。
2. `userName` 和 `site_id` 是百度统计调用上下文，不是第二套秘密 Token。
3. 共用 Token 不改变广告、访问、官网咨询和销售结果的主数据源。
4. 能通过现役代码边界完成的切换，不引入新任务系统、公开 API 改名或大型客户端重构。
5. 生产前提验证失败时停止实施，保留当前生产路径并把需求标记为 `blocked`。
6. 旧实现一旦完成正式切换就必须删除，不保留静默 fallback。

## Solution

采用最小可证伪方案：

1. 先通过独立只读工具发布，在不改现役连接和绑定的前提下执行统一凭据探针；
2. 预检通过后，百度统计改为通过现有 `BaiduConnectionService` 获取 OAuth Access Token；
3. 百度统计继续保存一个经真实站点目录验证的 `tongji_user_name`，但不再保存第二枚统计 Token；
4. 管理端保留一个 OAuth 授权入口；如 OAuth 用户信息无法可靠提供统计用户名，只允许管理员配置非秘密 `userName`，保存时必须立即用 OAuth Token 验证；
5. 连接列表按搜索推广和百度统计展示独立能力状态，能力状态只对当前授权代次和 Token 版本有效；
6. 保留现有 `BaiduMarketingClient` 和公开数据 API，只更换凭据解析边界并整理文档中的 API 归属；
7. 使用两个独立生产发布完成数据库迁移：第一版新增统一上下文并正式切换，第二版在真实刷新周期验证后删除旧字段。

## User Stories

1. As a 系统管理员, I want to authorize Baidu once, so that I no longer maintain a second secret Tongji token.
2. As a 系统管理员, I want separate advertising and Tongji capability states, so that one product failure is not mistaken for the other product being unavailable.
3. As a 市场负责人, I want page metrics to keep their real data sources, so that shared authorization does not create false attribution.
4. As a 运维人员, I want a hard production preflight and two explicit release gates, so that irreversible schema cleanup happens only after the unified path is proven.
5. As a 开发人员, I want the smallest change against existing provider and public contracts, so that credential convergence does not trigger unrelated regressions.

## Scope

### In scope

- 当前生产 OAuth Token 调用搜索推广四份官方报告；
- 同一 Token 调用百度统计 `getSiteList` 和目标站点最小 `getData`；
- 验证统计 `userName`、`site_id` 和域名的真实对应关系；
- 当前 Token 缺少统计权限时，停止只读探针；重新授权只能作为另行批准的维护操作执行，并必须恢复及复验受影响绑定；
- 至少完成一次由现役 Token 生命周期管理执行的 OAuth Refresh Token 刷新及双产品复验；
- 百度统计运行时改为复用现有 OAuth Access Token；
- 保存非秘密、经验证的统计用户名；
- 为连接保存搜索推广和百度统计的分产品能力状态；
- 重新授权、断开和 Token 刷新时原子失效旧能力状态；
- 管理页面删除统计 Token 输入，只保留 OAuth 授权和必要的统计用户名配置；
- 删除旧统计 Token 写入路由、专属凭据服务和现役说明；
- 通过新迁移最终删除旧统计 Token 数据库字段；
- 保持现有营销页面、公开数据接口、快照、缓存和数据口径不变；
- 补齐自动化、迁移、生产只读和真实浏览器验收。

### Out of scope

- 拆分或重写现有 `BaiduMarketingClient`；
- 新建通用异步任务系统或能力验证任务表；
- 新增 `/ads/*`、`/traffic/*` 或重命名现有公开数据 API；
- 退役当前 Dashboard 接口；
- 持久化或依赖未经真实验证的 OAuth scope 响应；
- 接入 53KF、销售系统、线索、订单或成交金额；
- 修改官网 `/api/website-data` 模块；
- 将生产 Token、Secret Key 或服务器数据库复制到本地；
- 使用百度统计推广分析数据替代广告报告；
- 使用旧统计 Token 作为 fallback。

### Later

- [005 百度 Provider 模块化重构](../draft-2026-08-05-005-baidu-provider-modularization/prd.md)：在 003、006、007 关闭后拆分 OAuth、搜索推广和百度统计客户端；
- [007 营销生产数据正确性与双周期回归](../draft-2026-08-05-007-marketing-production-data-correctness/prd.md)：广告/关键词双周期在 006 最终资源合同上实施；百度统计来源对账和页面消歧可独立进行；
- [006 营销广告快照 API 资源化](../draft-2026-08-05-006-marketing-api-resourceization/prd.md)：独立实施轻量 Dashboard、广告层级、关键词和搜索词资源，不增加 URL 版本；006 与 003 的生产发布/观察窗口不得重叠；
- 有真实需求后再建设持久化异步能力验证任务；
- 53KF、销售系统和可信跨系统归因。

## Product Behavior

### 1. 生产预检

只读探针必须在修改业务运行路径和删除旧凭据之前完成。探针工具本身通过独立 Git Bundle 进入服务器仓库，不包含数据库迁移，不重启或修改正式服务，只输出脱敏状态、日期、行数、站点哈希和 Token 版本。

| 检查 | 通过条件 |
| --- | --- |
| 搜索推广 | 同一 OAuth Token 能读取目标账号，并完成四份最小报告合同校验。 |
| 百度统计站点 | 同一 Token 和已确认 `userName` 能读取目标域名及 `site_id`。 |
| 百度统计数据 | 目标站点最小 `getData` 请求通过合同校验。 |
| 当前 Token 状态 | 探针直接使用当前密文对应的 Access Token，不调用刷新、不发起重新授权。过期、无效和缺权限分别报告。 |

以下任一情况触发硬停止：

- 对已确认的统计用户名，OAuth Token 无法访问目标站点；
- 经批准的维护性重新授权后仍无统计权限；
- `Token + userName` 无法通过 `getSiteList` 枚举目标站点并完成 `getData`；
- Refresh Token 刷新后任一产品持续不可用；
- 需要继续使用第二枚统计 Token 才能读取数据。

硬停止后需求目录改为 `blocked`，记录脱敏证据和下一决策，不实施统一切换，不删除当前生产凭据。

重新授权不属于只读探针。若只读探针表明旧 Token 需要重授，必须另行安排维护窗口：记录当前活动绑定、完成数据库备份、发起正式重新授权、恢复全部被暂停绑定，并重新验证现役广告和统计页面。若重授仍失败，停止服务并恢复维护前数据库备份，使 OAuth Token、旧 Data API Token 和活动绑定回到原状态；重新启动并验收当前正式路径后，需求继续 `blocked`。

### 2. 授权和统计用户名

- 管理端只有一个 dev2 OAuth 授权入口；
- Access Token / Refresh Token 继续只保存服务器数据库密文；
- 系统优先使用经真实验证的用户名映射；
- 如果百度授权响应不能可靠提供统计 `userName`，管理员可以填写用户名，但不能填写统计 Token；
- 用户名保存前必须用当前 OAuth Token 成功调用 `getSiteList`；
- 一个连接在本期只支持一个统计用户名；若生产证据显示目标站点需要多个用户名，需求停止并另行设计，不自动扩展模型；
- 项目继续绑定明确的 `site_id` 和域名，不默认选择第一站点。

### 3. 能力状态

管理端展示两个产品能力：

- 搜索推广访问；
- 百度统计访问。

状态为：

- `UNKNOWN`：当前授权代次或 Token 版本尚未验证；
- `VERIFIED`：当前版本的真实请求已通过；
- `REAUTH_REQUIRED`：百度明确表示需要重新授权；
- `ACCOUNT_MISMATCH`：统计用户名不能由当前 OAuth Token 读取；站点或域名错误继续属于项目绑定状态，不覆盖整个连接状态；
- `UPSTREAM_ERROR`：上游、网络或限流导致本次无法确认。

前端不自行比较版本。服务端只有在连接为 `CONNECTED` 且能力记录对应当前 `auth_generation + token_version` 时才返回 `VERIFIED`。

重新授权开始、回调完成、Token 刷新成功和断开连接时，服务端必须在同一数据库事务中失效旧能力状态。断开连接同时清除统计用户名和验证时间。上游超时不能被解释为需要重新授权。

### 4. 现役 API 边界

本需求不改变公开路径或响应结构，只明确它们的归属：

| 现役 API | 数据职责 |
| --- | --- |
| `/api/admin/marketing/baidu/*` | OAuth 连接、非秘密统计用户名、账户/站点目录和项目绑定。 |
| `/api/marketing/projects/:projectId/dashboard` | 百度推广四报表的广告汇总与层级事实。 |
| `/api/marketing/projects/:projectId/website-traffic-overview` | 百度统计区间访问、来源和趋势。 |
| `/api/marketing/projects/:projectId/website-traffic-pages` | 百度统计入口/受访页面。 |
| `/api/marketing/projects/:projectId/refresh-runs*` | 百度推广原子刷新。 |
| `/api/website-data/*` | 官网表单咨询，继续独立。 |

连接列表继续返回现有裸数组，只在单行内 additive 增加 `products` 状态；不得改成新的响应信封。现有页面不直接消费百度原始响应。

### 5. 数据来源

| 数据 | 唯一主数据源 |
| --- | --- |
| 广告投入、展现、广告点击、计划、单元、关键词、搜索词 | 百度推广 |
| 来源、访问次数、UV、PV、入口页、受访页 | 百度统计 |
| 官网咨询 | 官网成功表单接口 |
| 在线客服咨询 | 53KF，尚未接入 |
| 线索、机会、订单、成交金额 | 销售系统，尚未接入 |

共享 Token 不允许跨行替代、求和、补差或推断归因。

### 6. 发布和用户可见状态

发布 A1：

- 新增统一上下文和能力字段；
- 正式运行时只读取 OAuth Token；
- 删除统计 Token UI、写路由和服务；
- 旧数据库字段保留但零读写；
- 正式页面验证广告和流量仍可用。

发布 A2：

- 只能在 A1 完成至少一次真实 Token 刷新后双产品复验、旧路由零调用、旧字段零读写后进行；正式停服前必须对当前 Token 版本再次完成双产品快速验证；
- 新增并应用删除旧字段的迁移；
- 再次完成管理页、广告页、关键词页、网站流量页和市场总览验收。

A1 和 A2 必须是两个不同 Git Bundle 发布。A1 迁移命令必须声明最高允许版本为 `014`；A2 迁移命令声明为 `015`。A2 迁移文件不得提前进入 A1 仓库版本。

## Acceptance Criteria

- AC-001：生产预检使用同一 OAuth Token 分别完成搜索推广四报表、百度统计 `getSiteList` 和目标站点 `getData`。
- AC-002：只读探针不刷新或替换当前 Token、不暂停绑定；若需要重新授权，必须在独立维护窗口完成备份、重授、绑定恢复和 AC-001 复验，失败则需求转 `blocked`。
- AC-003：统计用户名和目标站点关系经真实 `getSiteList` 验证；系统不默认取第一站点。
- AC-004：百度统计正式运行时只通过 `BaiduConnectionService` 获取 OAuth Access Token，不读取独立统计 Token。
- AC-005：管理端不再提供统计 Token 输入；若需要人工信息，只允许输入非秘密统计用户名并实时验证。
- AC-006：连接列表保持裸数组兼容，并分别展示搜索推广和百度统计的有效能力状态。
- AC-007：重新授权开始、回调完成、Token 刷新和断开连接都会原子失效旧能力状态及用户名验证时间；断开同时清除统计用户名；旧版本不能显示 `VERIFIED`。
- AC-008：至少一次真实 OAuth Refresh Token 刷新后，搜索推广和百度统计均重新验证成功。
- AC-009：四份搜索推广报告仍在同一次项目刷新中全成全败，并写入同一 `refresh_run_id`。
- AC-010：现有 Dashboard、流量总览、页面数据、刷新任务和官网接口路径及响应语义不变。
- AC-011：发布 A1 不包含删除旧字段的迁移且迁移工具拒绝高于 `014` 的版本；发布 A2 只在当前 Token 版本通过即时验证后以最高版本 `015` 独立执行。
- AC-012：发布 A1 后旧统计凭据路由不存在，旧凭据 service 不被装配，旧字段运行时读写为 0。
- AC-013：发布 A2 后旧统计账号和 Token 字段从数据库删除；已应用历史迁移未被改写。
- AC-014：Access Token、Refresh Token、Secret Key 和原始授权响应不出现在浏览器、日志、测试 fixture、文档或 Git diff 中。
- AC-015：广告指标只来自百度推广，流量指标只来自百度统计，官网咨询继续来自官网接口。
- AC-016：从 `https://insight.guangtuo.com` 登录验证管理页、市场总览、广告表现、关键词、搜索词和网站流量页面实际使用统一路径。
- AC-017：A2 后代码搜索、路由回归和生产观测均证明旧统计 Token 路径不存在；没有 feature flag 或 fallback。

## Metrics / Success

- 每个百度连接的现役秘密凭据由两套收敛为一套；
- 统计 Token 输入入口为 0；
- 当前 Token 版本的双产品验证覆盖率为 100%；
- 旧统计 Token 路由调用和运行时字段读写为 0；
- Token 刷新后双产品复验有明确成功或失败状态；
- 生产页面不存在因凭据统一造成的数据来源变化；
- 凭据明文泄露事件为 0。

## Constraints

- 正式入口固定为 `https://insight.guangtuo.com`；
- 百度 callback 必须与开发者控制台登记地址完全一致；
- 生产 Token 只存在服务器数据库密文和服务端内存；
- 只读探针不得调用 Token 刷新、重新授权、绑定写入或业务数据写入；重新授权属于另行批准的维护操作；
- 已应用迁移不能改写；迁移 runner 会一次性应用当前版本的全部 pending 迁移；
- A1 与 A2 必须使用两个独立仓库 revision、Git Bundle 和最高迁移版本门禁；
- A2 删除列后没有自动 down migration；回滚需要先恢复 A2 前数据库备份，再通过 A2 后代的 revert 提交快进到不含 015 的恢复 revision；
- 保留现有 provider、公开 API、快照和缓存合同；
- 不把上游超时、无数据和权限不足混为同一状态；
- 本系统只支持一个连接对应一个统计用户名，不规划多账号、多统计用户名或跨账号站点扩展。

## Open Questions

以下问题由生产预检回答，任一否定答案都可能阻塞实施：

1. 当前或重新授权后的 dev2 OAuth Token 是否能作为百度统计商业账号请求中的 `accessToken`？
2. 当前连接应使用的统计 `userName` 是什么，`Token + userName` 能否稳定枚举目标站点？
3. 同一统计用户名是否能枚举当前所有目标站点？
4. OAuth 刷新是否轮换 Refresh Token，刷新后两个产品是否继续可用？

本需求不预先假定答案。预检失败时保留当前生产路径，并提交新的产品决策，不在本需求内扩张兼容架构。

## Official References

- [百度统计商业账号接口说明](https://tongji.baidu.com/api/manual/Chapter2/drapi.html)
- [百度统计 getSiteList](https://tongji.baidu.com/api/manual/Chapter1/getSiteList.html)
- [百度统计 getData](https://tongji.baidu.com/api/manual/Chapter1/getData.html)

## Handoff

- PRD path: `docs/active-2026-08-05-003-baidu-unified-oauth-api-architecture/prd.md`
- Tech Spec path: `docs/active-2026-08-05-003-baidu-unified-oauth-api-architecture/TECH-SPEC.md`
- Current state: Issue 001 已用生产服务器内同一现役 OAuth Token 完成搜索推广四报表与百度统计最小查询，双产品均为 `VERIFIED/HAS_DATA` 且副作用摘要不变。正式业务路径仍为双凭据，尚未执行迁移 014/015、重新授权或正式发布。
- Recommended next step: 按顺序实施 Issue 002 的版本化产品能力状态；后续顺序为 006 → 007 → 005，三者均不属于 003 的实施或关闭条件。
