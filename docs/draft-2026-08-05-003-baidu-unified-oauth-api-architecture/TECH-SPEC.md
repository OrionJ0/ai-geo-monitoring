---
title: 百度统一 OAuth 凭据与营销 API 边界整理技术方案
date: 2026-08-05
status: draft
source: docs/draft-2026-08-05-003-baidu-unified-oauth-api-architecture/prd.md
scope: deep
---

# 百度统一 OAuth 凭据与营销 API 边界整理技术方案

## 1. 背景与目标

目标是让搜索推广和百度统计复用当前 dev2 OAuth Access Token / Refresh Token，删除独立百度统计 Data API Token，同时保持两个产品的 API、缓存、事实和错误相互独立。

本方案遵循两个原则：

- 第一性原理：只有真实只读 API 调用能证明 Token、账号和站点关系成立；
- 奥卡姆剃刀：不为凭据切换引入大型客户端拆分、公开 API 重构、通用任务系统或未经验证的 scope 模型。

目标结构：

```text
baidu_marketing_connections
  ├── 一套 OAuth Access/Refresh Token（密文）
  ├── 一个经验证的 Tongji userName（非秘密）
  └── 两个产品访问状态（推广 / 统计）

BaiduConnectionService
  └── 唯一 Token 获取与刷新入口
        ├── 现有 BaiduMarketingClient 搜索推广方法
        └── 现有 BaiduMarketingClient 百度统计方法

公开数据边界保持不变
  ├── /api/marketing/.../dashboard                百度推广
  ├── /api/marketing/.../website-traffic-*        百度统计
  └── /api/website-data                           官网咨询
```

## 2. 范围与非目标

### 2.1 范围

- 生产服务器内的统一 Token 预检；
- 一个 OAuth Token 获取和刷新入口；
- 非秘密统计用户名的保存和真实验证；
- 搜索推广、百度统计分产品能力状态；
- 重新授权、刷新和断开时的状态失效；
- 百度统计运行时切换统一 OAuth Token；
- 删除旧统计 Token UI、路由、service 和数据库字段；
- 两个独立 Git Bundle 发布完成 expand/switch 和 contract；
- 管理、广告和流量正式入口验收；
- 现役 API 归属和主数据源文档整理。

### 2.2 非目标

- 不拆分 `BaiduMarketingClient`；
- 不修改搜索推广四报表、预算、双读或原子快照行为；
- 不新增通用验证任务、任务表或异步队列；
- 不新增或改名用户数据 API；
- 不改变连接列表的数组信封；
- 不持久化 OAuth scope；
- 不接入官网、53KF 或销售系统新数据；
- 不创建跨系统归因；
- 不保留独立统计 Token fallback；
- 不提前支持一个 OAuth 连接对应多个统计用户名。

### 2.3 延后事项

- [005 百度 Provider 模块化重构](../draft-2026-08-05-005-baidu-provider-modularization/TECH-SPEC.md)；
- [006 营销广告快照 API 资源化](../draft-2026-08-05-006-marketing-api-resourceization/TECH-SPEC.md)，不增加 URL 版本；
- 异步能力验证；
- OAuth scope 的真实响应建模。

## 3. 当前系统认知

### 3.1 OAuth 凭据

`backend/modules/marketing/migrations/001-authorization-connections.js` 已保存：

- `access_token_ciphertext`；
- `refresh_token_ciphertext`；
- `access_token_expires_at`；
- `auth_generation`；
- `token_version`；
- refresh claim 字段。

`backend/modules/marketing/services/BaiduConnectionService.js` 已实现 Token 解密、过期刷新、并发 claim 和版本递增。搜索推广已经通过该 service 获取 Token，这是本需求继续复用的唯一生命周期实现。

### 3.2 历史百度统计凭据

`backend/modules/marketing/migrations/006-tongji-credentials.js` 增加：

- `tongji_account_name`；
- `tongji_access_token_ciphertext`；
- `tongji_credential_updated_at`。

`backend/modules/marketing/services/BaiduTongjiCredentialService.js` 将用户名和第二枚 Token 视为一套凭据。`backend/modules/marketing/index.js` 的 `siteDirectory`、`resolveTongjiSite` 和 `readBoundTongjiContext` 都读取它。

本需求只保留用户名语义，删除第二枚 Token 语义。

### 3.3 Provider

`backend/modules/marketing/adapters/BaiduMarketingClient.js` 同时包含 OAuth、搜索推广和百度统计方法，也集中维护：

- 出站 allowlist；
- 搜索报告请求、行数、响应体和时间预算；
- 四报表双读稳定性；
- 百度统计响应预算和严格解析器；
- 稳定第三方错误码。

这些行为已经被大量合同测试覆盖。本需求不搬移或复制它们，只改变调用时传入的统计 Access Token。

### 3.4 绑定

`baidu_project_bindings` 当前保存：

- `connection_id`；
- 搜索推广外部账户 ID 和名称；
- 百度统计 `site_id` 和域名；
- 绑定状态与版本。

现有统计用户名在连接级。一个连接是否可以稳定对应一个统计用户名必须由预检证明；本需求不凭假设把用户名下沉到绑定，也不提前设计多用户名。

### 3.5 授权状态

`BaiduAuthorizationService.createAttempt(REAUTHORIZE)` 会增加 `auth_generation` 并暂停活动绑定；回调完成会增加 `token_version`。`disconnect` 会清空 Token 并同时增加两个版本。

新增产品能力后，以上事务都必须同步失效旧能力。仅保存请求观察到的 Token 版本而不在读取时校验是不够的。

### 3.6 迁移与发布

`MarketingMigrationRunner` 会按版本排序，在一次数据库事务中应用当前仓库的全部 pending 迁移；没有自动 down 流程。`docs/DEPLOYMENT.md` 要求一次执行 `npm run migrate:marketing`。

因此 `014` 和删除旧字段的 `015` 不能同时存在于首次切换 revision。必须使用两个 Git Bundle：

- A1 revision 只包含 `014` 和统一运行路径；
- A2 revision 在 A1 生产验收后才新增 `015`。

### 3.7 现役数据和 API

继续以 `docs/adr/0001-marketing-funnel-data-source-of-truth.md` 为准：

- 百度推广是广告投入、展现和点击的唯一主数据源；
- 百度统计是来源、访问、UV 和 PV 的唯一主数据源；
- 官网表单继续走 `/api/website-data`；
- 53KF 和销售系统尚未接入。

本需求不改变 `dashboard`、`website-traffic-overview`、`website-traffic-pages` 和 `refresh-runs` 的路径或响应。

## 4. 需求、约束与规则

- REQ-001：统一方案必须先通过生产服务器内无状态只读探针；探针工具可先发布，但不得包含业务迁移或运行路径切换。
- REQ-002：百度统计只能通过 `BaiduConnectionService` 获取 Access Token。
- REQ-003：统计用户名是非秘密上下文，保存前必须用当前 OAuth Token 验证。
- REQ-004：产品能力只对匹配的 `auth_generation + token_version` 有效。
- REQ-005：重新授权开始、回调完成、Token 刷新和断开必须原子失效旧能力；断开还必须清空统计用户名上下文。
- REQ-006：搜索推广和百度统计失败状态相互独立。
- REQ-007：连接列表保持裸数组，只 additive 增加产品状态。
- REQ-008：旧统计 Token UI、写路由和 service 在 A1 删除，旧字段在 A2 删除。
- REQ-009：搜索推广四报表仍全成全败并写同一 `refresh_run_id`。
- REQ-010：生产前提不成立时需求转 `blocked`，不继续 U2–U5。
- CON-001：生产 Token、Secret、Code 和原始授权响应不离开服务器。
- CON-002：不修改 001–013 已应用迁移。
- CON-003：A1 revision 不能包含 015，迁移 CLI 必须以最高允许版本 `014` 拒绝越界迁移。
- CON-004：A2 删除列没有 down migration；恢复必须使用 A2 后代的 revert 提交和 A2 前数据库备份，不能执行非快进回退。
- CON-005：上游超时、权限不足、账号不匹配和合法无数据必须区分。
- CON-006：公开数值继续使用精确字符串，日期继续使用上海完整日。
- CON-007：不增加 feature flag 或旧 Token fallback。
- PAT-001：复用现有 Token refresh claim 和 compare-and-set。
- PAT-002：复用现有 admin 权限、项目所有权、`no-store` 和错误响应形状。
- PAT-003：复用现有 provider allowlist、预算、双读和解析器。
- PAT-004：复用现有百度统计快照和缓存表，不混写广告事实。

## 5. 生产预检合同

### 5.1 目标

只读探针只回答一个问题：当前密文中的 OAuth Access Token 是否足以在当前账号、站点和报告合同下替代独立统计 Token。

若答案是否定，后续实现没有意义。

### 5.2 执行位置和秘密边界

探针在生产服务器仓库内运行，复用现有加密配置和 provider，但直接读取当前 Access Token，不调用会自动刷新的 `getAccessToken`。不得把 Token 作为命令参数、环境回显或输出内容。

探针脚本通过独立的 tooling-only Git Bundle 发布。该 revision 不包含迁移，不改变模块装配，不重启正式服务。建议路径：

```text
backend/scripts/verifyBaiduUnifiedOAuth.js
```

输入只允许：

- `connectionId`；
- `projectId`；
- `from/to`，默认最近一个上海完整日。

脚本从数据库只读连接和绑定，不接受 Token、Secret 或任意上游 URL。它不执行 Token refresh、OAuth callback、绑定写入、快照写入或任何百度写 API。

### 5.3 固定探针

| 产品 | 固定请求 | 验证 |
| --- | --- | --- |
| 搜索推广账户 | 现役账户目录方法 | 目标绑定账户可见。 |
| 搜索推广报告 | 报告类型 `2290316`、`2284618`、`2602783`、`2307838` | 使用现役预算和双读；四份合同全部通过。 |
| 百度统计站点 | `POST .../ReportService/getSiteList` | 目标 `site_id`、域名和活动状态匹配。 |
| 百度统计数据 | `trend/time/a`，最近一个完整日，现役趋势 metrics | 响应头、日期和指标合同通过；合法无数据与失败分开。 |
| 副作用检查 | 探针前后连接、Token 版本和绑定状态 | 三者保持完全不变。 |

探针与正式刷新共享现有限流和资源预算，不另开无上限调用。四报表双读的请求数量必须计入现役整轮预算。

### 5.4 输出

```json
{
  "connectionIdHash": "sha256:...",
  "projectId": "1",
  "tokenVersion": 7,
  "coverage": { "from": "2026-08-04", "to": "2026-08-04" },
  "marketing": {
    "state": "VERIFIED",
    "reportRowCounts": {
      "campaigns": 1,
      "adGroups": 1,
      "keywords": 10,
      "searchTerms": 3
    }
  },
  "tongji": {
    "state": "VERIFIED",
    "siteIdHash": "sha256:...",
    "rowCount": 1
  }
}
```

禁止输出完整 connection ID、Token、Secret、完整站点列表、关键词、搜索词或百度原始错误正文。

### 5.5 停止条件

以下任一结果使需求转 `blocked`，停止 U2–U5：

- OAuth Token 被百度统计明确拒绝；
- 已确认用户名下看不到目标站点；
- 只有旧 Data API Token 能读取目标数据；
- `Token + userName` 无法枚举目标站点并完成 `getData`；
- 当前证据反驳一个连接对应一个统计用户名。

阻塞记录必须说明证据、当前正式路径、未执行的迁移和下一产品决策。不得在本需求内新增双 Token fallback。

如果唯一失败原因是 Token 过期或可能缺少后来新增的统计权限，只读探针结束，需求保持 `blocked`。重新授权属于另行批准的维护操作，不属于探针：

1. 记录全部活动绑定并完成数据库备份；
2. 发起正式 REAUTHORIZE，接受其暂停绑定和替换 Token 的副作用；
3. 用新 Token 重跑固定探针；
4. 无论结果如何，逐个恢复原活动绑定并验证现役广告和统计页面；
5. 只有新 Token 双产品通过且绑定恢复完成，需求才能重新进入 `active`；失败时停止服务、恢复维护前数据库备份、重新启动并验收 A1 前旧实现和旧 Data API Token 路径。

## 6. 最小运行架构

### 6.1 Token 获取

`BaiduConnectionService` 新增返回刷新后版本快照的内部接口：

```js
BaiduConnectionService.getAccessContext(connectionId)
  => { accessToken, authGeneration, tokenVersion }
```

该方法先完成必要的 refresh claim 和 Token 刷新，再从已提交的新连接行返回 Token 与版本。现有 `getAccessToken(connectionId)` 保留为内部兼容包装，只返回 `getAccessContext(...).accessToken`；所有需要写能力状态的路径必须使用版本化上下文，禁止在取 Token 前读取版本。

百度统计调用从：

```text
BaiduTongjiCredentialService.getCredential(connectionId)
```

切换为：

```text
BaiduTongjiContextService.resolve(connectionId)
  -> 读取已验证 tongji_user_name
  -> BaiduConnectionService.getAccessContext(connectionId)
  -> 返回仅服务端使用的 { userName, accessToken, authGeneration, tokenVersion }
```

`BaiduTongjiContextService` 不实现 Token 刷新、不缓存第二份 Token、不包含 provider 方法。它必须吸收 `index.js` 中现有的 `resolveTongjiSite`、`readBoundTongjiContext` 和站点 TTL 复核，成为趋势、来源趋势、页面报表、站点目录和绑定校验的唯一统计上下文入口；不得与旧内联 resolver 并存。

### 6.2 模块装配

`backend/modules/marketing/index.js` 调整为：

```text
connectionService
  ├── reportProvider -> existing BaiduMarketingClient.fetchSearchReports
  └── tongjiContextService
        └── tongjiProvider -> existing BaiduMarketingClient Tongji methods
```

删除：

- `BaiduTongjiCredentialService` 实例；
- `tongjiCredentialService` route 注入；
- 所有 `getCredential()` 调用；
- 旧统计 Token 解密路径。

保留：

- `BaiduMarketingClient`；
- `createConcurrencyGate(2)`；
- `resolveTongjiSite`/`readBoundTongjiContext` 的站点和域名校验语义，但实现迁入唯一 context service 后删除旧内联函数；
- 现有 provider 方法、allowlist、预算和严格解析。

### 6.3 统计用户名

迁移后连接字段名为 `tongji_user_name`。

现有连接：

- 014 将 `tongji_account_name` 复制为候选值；
- 候选值不自动视为已验证；
- U1 只生成脱敏证据、不写数据库；A1 中用户名配置或首次统一上下文验证成功后才写 `tongji_user_name_verified_at`。

新连接：

- 如果授权用户信息能以真实合同提供兼容用户名，服务端仍必须调用 `getSiteList` 验证；
- 否则管理员只填写 `userName`；
- 服务端用当前 OAuth Token 实时读取站点目录，成功后保存；
- 一个连接本期只保存一个用户名。

统计站点继续保存在项目绑定行。用户名和站点的组合在绑定、恢复绑定和实际读取时都必须验证。

### 6.4 站点复核策略

统一所有统计读取路径：

- 配置/更新用户名：强制调用 `getSiteList`；
- 创建或恢复绑定：强制调用 `getSiteList` 并精确匹配 site ID、域名和活动状态；
- 正常趋势、来源趋势和页面读取：全部通过同一个 context service，复用当前绑定上下文，不为每个请求额外调用站点目录；
- 距离 `tongji_user_name_verified_at` 超过 24 小时、绑定版本变化或上游返回站点/账号错误：强制重新调用 `getSiteList`；
- 站点域名变化：返回现役 `BAIDU_TONGJI_SITE_DOMAIN_CHANGED`，不自动改绑。

`getSiteList` 复核成功后，使用本次 Access Context 的 `(authGeneration, tokenVersion)` CAS 更新 `tongji_user_name_verified_at`；CAS 失败则丢弃结果并要求重试。复核在现有 Tongji concurrency gate 内执行。24 小时 TTL 只缓存站点归属验证，不缓存 Token 或页面数据。

## 7. 能力状态模型

### 7.1 最小字段

只保存两个产品状态，不创建通用 capability 表：

在 `baidu_marketing_connections` 增加：

- `marketing_access_state`；
- `marketing_observed_auth_generation`；
- `marketing_observed_token_version`；
- `marketing_checked_at`；
- `marketing_last_error_code`；
- `tongji_access_state`；
- `tongji_observed_auth_generation`；
- `tongji_observed_token_version`；
- `tongji_checked_at`；
- `tongji_last_error_code`。

状态只允许：

- `UNKNOWN`；
- `VERIFIED`；
- `REAUTH_REQUIRED`；
- `ACCOUNT_MISMATCH`；
- `UPSTREAM_ERROR`。

### 7.2 有效状态计算

数据库中的状态是最近一次尝试结果，HTTP 输出必须由服务端计算：

```text
connection.status != CONNECTED
  => effective state = UNKNOWN

observed_auth_generation != connection.auth_generation
  OR observed_token_version != connection.token_version
  => effective state = UNKNOWN

otherwise
  => effective state = stored state
```

内部版本不需要暴露给浏览器。前端只消费服务端返回的有效状态。

### 7.3 原子失效

以下数据库写入必须在原连接事务中同时把两个产品状态重置为 `UNKNOWN`，清空 observed 版本、时间和错误。重新授权和 Token 刷新还要清空 `tongji_user_name_verified_at`，使保留的候选用户名必须用新 Token 再验证：

- `createAttempt(REAUTHORIZE)` 增加 `auth_generation`；
- `completeCallback` 写入新 Token 并增加 `token_version`；
- `BaiduConnectionService` 刷新成功并增加 `token_version`；
- `disconnect` 增加版本、清空 Token，并同时清空 `tongji_user_name` 与 `tongji_user_name_verified_at`。

不能依赖异步清理。

### 7.4 防并发回写

产品请求通过 `getAccessContext` 取得刷新完成后的 `(authGeneration, tokenVersion)`，随后发起上游请求。验证结果使用 compare-and-set：

```text
UPDATE baidu_marketing_connections
SET <product state and evidence>
WHERE id = :connectionId
  AND auth_generation = :observedAuthGeneration
  AND token_version = :observedTokenVersion
```

影响行数为 0 表示期间发生重授、刷新或断开；旧请求结果直接丢弃，不能把新版本重新标为 `VERIFIED`。

### 7.5 验证来源

- 搜索推广连接级 `VERIFIED`：当前 Token 的账户目录能读取目标账户；四报表完整性继续由项目 refresh run 和快照状态表达，不写入连接级能力。
- 百度统计连接级 `VERIFIED`：当前 `Token + userName` 的 `getSiteList` 合同通过且目标站点可见；具体站点的 `getData`、域名变化和页面数据错误继续由项目绑定及流量请求表达，不反复覆盖整个连接状态。
- 权限明确缺失：`REAUTH_REQUIRED`；
- 用户名不能由当前 Token 访问：`ACCOUNT_MISMATCH`；站点 ID 或域名错误不写该连接级状态；
- 超时、限流、网络或 5xx：`UPSTREAM_ERROR`。

合法无数据仍可以证明接口和合同可用，不等于 `UPSTREAM_ERROR`。

能力写回使用独立、短事务：账户目录规范化成功后写搜索推广状态，`getSiteList` 规范化且目标站点可见后写百度统计状态，不加入长时间四报表刷新事务或统计快照事务。任一产品路径收到百度明确的 Token/授权错误时可以用同一 CAS 写 `REAUTH_REQUIRED`；站点 ID、域名、趋势内容或页面数据错误只留在项目绑定/请求错误，不覆盖连接级访问状态。

## 8. 管理 API 契约

### 8.1 连接列表

保留：

```text
GET /api/admin/marketing/baidu/connections
```

响应继续是裸数组；单行 additive 增加 `products`，并删除旧统计 Token 状态字段：

```json
[
  {
    "id": "connection-id",
    "status": "CONNECTED",
    "principalId": "principal-id",
    "principalName": "name",
    "accessTokenExpiresAt": "2026-08-30T00:00:00.000Z",
    "tongjiUserName": "verified-user-name",
    "products": {
      "marketing": {
        "state": "VERIFIED",
        "checkedAt": "2026-08-05T12:00:00.000Z",
        "lastErrorCode": null
      },
      "tongji": {
        "state": "VERIFIED",
        "checkedAt": "2026-08-05T12:00:01.000Z",
        "lastErrorCode": null
      }
    }
  }
]
```

不返回内部版本、Token、Secret、scope、原始错误或完整站点列表。

### 8.2 统计用户名配置

新增：

```text
PUT /api/admin/marketing/baidu/connections/:connectionId/tongji-context
Body: { "userName": "..." }
```

规则：

- body 必须只有 `userName`；
- userName 非空、去除首尾空白、长度不超过 255；
- 连接必须是 `CONNECTED`；
- 服务端通过 `getAccessContext` 获取当前 OAuth Token 和版本并调用 `getSiteList`；
- 只有获得合法站点目录后才保存；
- 保存时使用 `WHERE auth_generation AND token_version` CAS 记录用户名和验证时间；CAS 冲突返回 409，不能把旧 Token 的验证结果写入新上下文；
- 响应只返回用户名、站点数量和验证时间，不返回站点明细或 Token；
- 更新用户名会暂停依赖旧统计上下文的活动绑定，需管理员用明确站点恢复。

旧路由：

```text
PUT /api/admin/marketing/baidu/connections/:connectionId/tongji-credential
```

在 A1 不再注册，返回标准 404，不保留 410、兼容 handler 或 feature flag。

### 8.3 现有目录和绑定路由

账户目录、站点目录、绑定创建、暂停、恢复和删除路径保持不变。站点目录不再以 `tongjiCredentialConfigured` 为前端门禁，而以 `tongjiUserName` 和 `products.tongji.state` 呈现真实状态。

### 8.4 错误合同

沿用现有 `{ error: { code, message } }`：

| HTTP | code | 语义 |
| ---: | --- | --- |
| 400 | `TONGJI_CONTEXT_REQUEST_INVALID` | 用户名请求字段无效。 |
| 404 | `CONNECTION_NOT_FOUND` | 连接不存在。 |
| 409 | `CONNECTION_NOT_CONNECTED` | 连接不可用。 |
| 409 | `BAIDU_REAUTHORIZATION_REQUIRED` | 百度明确要求重新授权。 |
| 422 | `TONGJI_ACCOUNT_NOT_AVAILABLE` | 用户名不能由当前 OAuth Token 访问。 |
| 422 | `TONGJI_SITE_NOT_AVAILABLE` | 目标站点不属于当前上下文。 |
| 502 | `BAIDU_TONGJI_RESPONSE_INVALID` | 上游响应合同无效。 |
| 503 | 现役队列错误码 | 上游请求排队失败，保留 `Retry-After`。 |

本需求不新增 `NO_DATA` 或分页合同；数据 API 继续沿用当前语义。

## 9. 数据库迁移与发布

### 9.1 迁移 014：expand

新增 `backend/modules/marketing/migrations/014-unified-oauth-context.js`。

在 `baidu_marketing_connections` 增加：

- `tongji_user_name`；
- `tongji_user_name_verified_at`；
- 第 7.1 节的两个产品状态字段。

默认值：两个产品状态为 `UNKNOWN`，所有验证版本和时间为空。

数据迁移：

- 非空 `tongji_account_name` 复制到 `tongji_user_name`；
- 不复制、不解密 `tongji_access_token_ciphertext`；
- 复制的用户名不写验证时间；
- 不因已有广告快照或统计缓存把能力初始化为 `VERIFIED`。

### 9.2 发布 A1：switch

A1 revision 包含：

- 014；
- `BaiduTongjiContextService`；
- 百度统计统一 Token 装配；
- 能力失效与 CAS 写回；
- 用户名配置 API；
- 删除旧统计 Token route、service 和 UI；
- 对应测试和现役文档更新。

A1 revision 明确不得包含 015。`backend/scripts/migrateMarketing.js` 增加可选 `--expected-latest=<version>` 门禁：在打开迁移事务前检查仓库最高迁移和全部 pending 版本，任何版本高于或不等于期望值都失败。A1 固定传 `014-unified-oauth-context`，A2 固定传 `015-drop-legacy-tongji-credentials`。

发布顺序：

1. 完成数据库备份；
2. 服务器 `HEAD` 快进到 A1 Git Bundle；
3. 使用 `--expected-latest=014-unified-oauth-context` 应用 pending 迁移；
4. 执行 migration audit；
5. 重启正式 backend/frontend；
6. 验证管理页、四报表刷新、网站流量和市场总览；
7. 记录旧路由调用为 0，代码与模块装配不存在旧 service；
8. 等待现役 OAuth Token 自然刷新，或在批准的维护验证中通过正式 connection service 完成刷新；刷新后用 `getAccessContext` 对当前版本复验账户目录、`getSiteList` 和目标站点 `getData`。

A1 后旧三个字段仍在数据库，但正式代码零读写。需求状态保持 `active`，不得声称旧凭据已完全退役。

A1 出现阻断性回归时，不对服务器执行非快进回退。创建 A1 的后代 revert 提交，明确恢复 A1 前旧统计凭据代码和 UI，走正常 Git Bundle 快进；014 是 additive，可暂时保留。该操作属于公开记录的正式回滚，不是新路径中的 fallback。回滚记录必须写明失败原因、当前正式路径、修复负责人和再次切回统一路径的退出条件，需求保持 `active`。

### 9.3 迁移 015：contract

只有 A1 门禁全部通过后，才在新的仓库 revision 中新增 `015-drop-legacy-tongji-credentials.js`。

015 在删除字段前执行门禁查询：

- 所有活动绑定的连接均为 `CONNECTED`；
- `tongji_user_name` 非空且已验证；
- 所有存在活动绑定的连接，其两个产品状态均为 `VERIFIED`；暂停、断开或无绑定连接不作为 contract 成功证据，但其中的旧统计 Token 也不得再有运行时消费者；
- 两个产品观察到的授权代次和 Token 版本都等于连接当前值；
- 没有仍处于重授或刷新 claim 的活动连接。

任一不满足则抛稳定迁移错误，整个迁移事务回滚。

通过后删除：

- `tongji_account_name`；
- `tongji_access_token_ciphertext`；
- `tongji_credential_updated_at`。

### 9.4 发布 A2

A2 是与 A1 不同的 Git Bundle 和 revision。

为避免旧进程访问被删除列：

1. 在 backend 仍运行时调用 `getAccessContext`，必要时先完成刷新；
2. 对该当前 Token 版本立即完成账户目录、`getSiteList` 和目标站点最小 `getData`，确认两个连接级状态与当前版本匹配；
3. 停止正式 backend service，冻结 Token 版本和数据库写入；
4. 在停止写入后创建 A2 专用数据库备份；
5. 快进 A2 Git Bundle；
6. 使用 `--expected-latest=015-drop-legacy-tongji-credentials` 应用 015；
7. 执行 migration audit；
8. 启动 backend/frontend；
9. 通过健康、就绪、管理和营销页面验收。

015 没有自动 down，正式部署器也只允许 fast-forward。恢复流程分两种：

- 015 事务失败：数据库已经自动回滚；保持服务停止，创建 A2 的后代 revert 提交删除 015 迁移文件和 A2 专属文档，再通过正常 Git Bundle 快进到恢复 revision；
- 015 已成功但后续验收失败：保持服务停止，先恢复 A2 前数据库备份，再快进到上述后代 revert revision，执行迁移 audit 后启动。

revert revision 必须是 A2 后代，不能把服务器 HEAD 非快进退回 A1。恢复后的数据库 ledger 不包含 015，因此代码也不能继续列出 015。不能只回退代码，也不能在新代码中恢复旧 Token fallback。部署失败默认保持服务停止，人工恢复完成前不得接回流量。

## 10. 公开数据 API 边界

本需求只整理归属，不改路径：

| API | 继续承担的职责 | 不允许承担的职责 |
| --- | --- | --- |
| `dashboard` | 搜索推广四报表快照 | 百度统计、官网咨询、销售结果 |
| `website-traffic-overview` | 百度统计区间汇总、来源、趋势 | 广告点击替代访问 |
| `website-traffic-pages` | 百度统计入口/受访页面分页 | 官网表单详情 |
| `refresh-runs` | 搜索推广原子刷新 | 百度统计和官网刷新 |
| `/api/website-data` | 官网表单咨询 | 百度流量和销售事实 |

当前接口名不完美不构成此次生产切换的必要条件。Dashboard 资源化由 006 承接，数据正确性由 007 承接，客户端拆分由 005 承接；三者都不扩大本次凭据迁移的失败面，也不属于 003 的关闭条件。

## 11. 关键技术决策

- KTD-001：先发布无状态探针，再设计业务迁移。理由：统一 Token 是可证伪外部前提，但探针工具本身需要先经过受控 Git Bundle 进入服务器。
- KTD-002：保留现有 `BaiduMarketingClient`。理由：凭据来源替换不要求搬移 allowlist、预算和解析器。
- KTD-003：用 `BaiduTongjiContextService` 取代旧凭据 service 和 `index.js` 的重复 resolver。理由：用户名、版本化 Access Context 和站点 TTL 需要一个唯一入口，但不需要新产品客户端。
- KTD-004：不持久化 scope。理由：真实形状尚未证明，产品 API 成功才是能力真值。
- KTD-005：只保存两个产品状态列，不建通用 capability 表。理由：当前只有两个明确产品，没有泛化需求。
- KTD-006：状态由服务端按授权代次和 Token 版本计算。理由：防止旧 `VERIFIED` 泄漏到新凭据。
- KTD-007：不建异步验证任务。理由：现有读取和刷新入口已经产生真实验证事实。
- KTD-008：连接列表保持裸数组 additive 扩展。理由：避免不必要的管理页面破坏。
- KTD-009：A1、A2 两个 Git Bundle，并由迁移 CLI 校验最高版本。理由：仓库边界提供观察期，CLI 门禁防止误入的 015 被 runner 自动应用。
- KTD-010：一个连接一个统计用户名。理由：符合现役模型；若生产预检反证，停止而不是提前泛化。
- KTD-011：公开数据 API 不重构。理由：接口命名债务不阻塞统一凭据。

## 12. 实现切片

### U1：只读探针工具与生产验证

**目标：** 用一个不改变正式连接、Token 和绑定的工具证明或证伪当前 OAuth Token 能读取搜索推广和百度统计数据。

**依赖：** 生产只读服务器访问、现有连接和项目绑定。

**涉及文件：**

- `backend/scripts/verifyBaiduUnifiedOAuth.js`；
- 现有 provider、加密读取和固定预算；
- 脱敏验证说明。

**方案：** 先以 tooling-only Git Bundle 发布脚本，不带迁移、不重启正式服务；脚本直接读取当前 Access Token，不调用自动 refresh。该阶段服务器仓库 HEAD 可以领先公开健康 revision，验收记录必须分别写明二者。按第 5 节执行并证明探针前后连接、Token 版本和绑定状态不变。旧 Token 过期或缺权限时停止并转 `blocked`；重新授权必须另行安排维护窗口，失败时恢复维护前数据库备份。

**测试场景：** 同 Token 双产品成功、合法无数据、统计权限不足、用户名不匹配、站点缺失、上游限流、四报表任一失败、自动刷新未被调用、连接与绑定零写入。

**验收方式：** 获得脱敏双产品证据；失败则目录改为 `blocked`，不进入 U2。

### U2：014 与产品状态

**目标：** 增加统一统计上下文和不会过期误报的产品状态。

**依赖：** U1 通过。

**涉及文件：**

- `backend/modules/marketing/migrations/014-unified-oauth-context.js`；
- `backend/modules/marketing/services/BaiduAuthorizationService.js`；
- `backend/modules/marketing/services/BaiduConnectionService.js`；
- `backend/scripts/migrateMarketing.js`；
- 授权、刷新、迁移和竞争测试。

**方案：** 增加显式列；所有版本变化事务原子失效；disconnect 清用户名；`getAccessContext` 在刷新后返回版本；验证结果 CAS 写回；`listConnections` 计算有效状态且不再读取旧列；迁移 CLI 增加最高版本门禁。

**测试场景：** 重授开始、回调成功、刷新竞争、断开及重连、请求内自刷新、旧请求晚回、迁移候选用户名不自动验证、`listConnections`/`disconnect` 零旧列读写、最高版本不符时拒绝迁移。

**验收方式：** 任一旧授权代次或 Token 版本都不能通过管理 API 显示 `VERIFIED`。

### U3：百度统计统一 Token 硬切

**目标：** 正式统计读取只使用 OAuth Token，并删除旧运行路径。

**依赖：** U2。

**涉及文件：**

- `backend/modules/marketing/services/BaiduTongjiContextService.js`；
- `backend/modules/marketing/index.js`；
- `backend/modules/marketing/routes/baiduBindingRoutes.js`；
- `backend/modules/marketing/services/BaiduTongjiCredentialService.js`；
- `backend/tests/marketing/BaiduTongjiCredentialApi.test.js`；
- `backend/tests/marketing/BaiduTongjiService.test.js`；
- `backend/tests/marketing/MarketingModule.test.js`。

**方案：** 新 context service 组合用户名和 `connectionService.getAccessContext`，统一趋势、来源趋势、页面报表和站点复核；删除旧 Token service、内联 resolver、路由和装配；保留 provider 和数据 service。

**测试场景：** 同一 Token 传入广告/统计 provider；旧字段写入 canary 仍不被读取；旧路由 404；统一 Token 失败不 fallback；TTL 成功回写；三类统计读取共享 resolver；用户名 CAS 冲突返回 409。

**验收方式：** 模块装配和调用证据显示没有旧 service，现有数据合同全部通过。

### U4：管理页面和 A1 发布

**目标：** 用户只维护 OAuth 和必要统计用户名，生产正式路径使用统一 Token。

**依赖：** U3。

**涉及文件：**

- `nextjs-frontend/src/app/admin/settings/BaiduMarketingSettings.tsx`；
- 管理 API 测试和前端 marketing 测试；
- `README.md`、`CONTEXT.md`、`docs/API.md`、`docs/DEPLOYMENT.md`、`docs/README.md`。

**方案：** 删除 Token 输入；连接列表仍消费数组；添加 `products` 状态和用户名配置；以最高迁移版本 014 发布 A1，完成真实页面和至少一次 OAuth refresh 后双产品复验。

**测试场景：** 旧前端字段零依赖、连接状态各分支、用户名验证、键盘操作、移动端、独立产品失败。

**验收方式：** 正式域名页面数据正确，旧路由调用为 0，A1 revision 不包含 015，迁移 CLI 明确拒绝高于 014 的版本。

### U5：A2 数据库 contract

**目标：** 在生产证明统一路径稳定后不可逆删除旧字段。

**依赖：** U4、至少一次真实 OAuth 刷新后双产品成功、停服前当前 Token 版本即时复验、A2 备份。

**涉及文件：**

- `backend/modules/marketing/migrations/015-drop-legacy-tongji-credentials.js`；
- migration/audit/fast-forward 恢复测试；
- 正式部署与需求状态文档。

**方案：** 015 自带门禁查询；A2 即时复验后停服务冻结版本、备份并以最高版本 015 迁移；恢复使用 A2 后代 revert 提交和备份，禁止非快进回退。

**测试场景：** 未验证连接阻止迁移、版本不匹配阻止迁移、活动 refresh claim 阻止迁移、成功删除三个字段、审计 checksum 正常。

**验收方式：** A2 正式页面通过，代码和数据库都不存在旧凭据路径，需求才可关闭。

## 13. 验收标准

- AC-001：Given 当前生产连接，When 执行 U1，Then 同一 OAuth Token 完成四报表、`getSiteList` 和 `getData`；否则需求停止。
- AC-002：Given 当前 Token 过期或缺权限，When 执行 U1，Then 探针不刷新或重授并转 `blocked`；只有独立维护窗口完成备份、重授、绑定恢复和复验后才能继续。
- AC-003：Given 任一版本变化，When 管理 API 读取产品状态，Then 旧状态只返回 `UNKNOWN`，不会返回 `VERIFIED`。
- AC-004：Given 旧验证请求晚于刷新完成，When 它尝试写回，Then CAS 影响 0 行且不覆盖新状态。
- AC-005：Given 统计读取，When provider 收到请求，Then Token 与 observed 版本来自刷新后 `getAccessContext`，用户名来自已验证上下文。
- AC-006：Given 旧统计密文字段包含测试 canary，When 所有统计路径运行，Then 没有 SQL 或 service 读取该字段。
- AC-007：Given 管理连接列表，When 新后端发布，Then响应仍为数组，现有页面不因信封变化失败。
- AC-008：Given 用户名配置请求，When body 含 Token 或额外字段，Then 返回 400 且不落库。
- AC-009：Given 统一 Token 不可用，When 统计读取失败，Then 不使用旧 Token fallback，不影响上一份完整广告快照。
- AC-010：Given A1 revision，When 迁移审计，Then 014 已应用、015 不存在，且最高版本门禁会拒绝任何越界版本。
- AC-011：Given A1 完成真实 OAuth 刷新，When 双产品复验，Then 当前版本两项状态均为 `VERIFIED`。
- AC-012：Given A2 前置条件缺失或产品状态不对应当前 Token，When 运行 015，Then 整个事务失败且旧字段保持存在。
- AC-013：Given A2 门禁全部通过，When 运行 015，Then 三个旧字段删除且 migration audit ready。
- AC-014：Given 正式域名登录用户，When访问管理及全部营销页面，Then 数据来源、日期、空值和错误状态保持现役语义。
- AC-015：Given 代码、日志和 API 响应，When扫描凭据形态，Then 不出现明文 Token、Secret、Code 或旧凭据 fallback。

## 14. 测试与验证计划

### 14.1 单元与集成测试

重点更新：

- `backend/tests/marketing/BaiduAuthorizationApi.test.js`；
- `backend/tests/marketing/BaiduAuthorizationRace.test.js`；
- `backend/tests/marketing/BaiduTokenRefreshClaim.test.js`；
- `backend/tests/marketing/BaiduTongjiCredentialApi.test.js`；
- `backend/tests/marketing/BaiduTongjiService.test.js`；
- `backend/tests/marketing/BaiduMarketingClient.test.js`；
- `backend/tests/marketing/BaiduCredentialLeak.test.js`；
- `backend/tests/marketing/MarketingMigration.test.js`；
- `backend/tests/marketing/MarketingMigrationCli.test.js`；
- `backend/tests/marketing/MarketingModule.test.js`；
- `backend/tests/marketing/MarketingSnapshotAtomicity.test.js`。

必须新增：

- 同一 `connectionService.getAccessContext` 结果供广告和统计调用；
- 四种版本变化的原子状态失效；
- disconnect 清除用户名和验证时间；
- 请求内自刷新返回新版本并允许合法 CAS；
- 旧请求 CAS 失败；
- 连接列表数组兼容；
- 用户名请求严格 body；
- 旧 Token canary 零读取；
- 旧路由 404；
- 迁移最高版本门禁分别接受 014/015 并拒绝越界；
- 015 门禁失败和成功；
- A2 后代 revert revision 与备份恢复后 audit 正常；
- A2 后旧字段及旧源码引用不存在。

`backend/tests/marketing/MarketingMigration.test.js` 和 `MarketingMigrationCli.test.js` 当前包含精确迁移版本断言；A1 必须把期望列表更新到 014，A2 再独立更新到 015，防止任一 revision 因测试列表滞后而在正式部署中停止。

### 14.2 浏览器验证

- 管理设置只有一个 OAuth 授权入口；
- 可配置或显示统计用户名，但没有统计 Token 输入；
- 搜索推广与百度统计状态独立；
- 重新授权后旧绿标立即消失；
- 市场总览、广告表现、关键词、搜索词和网站流量页面继续使用真实数据；
- 官网咨询和未接入销售指标保持原状态；
- 桌面、移动和键盘操作正常。

### 14.3 生产证据

A1 至少保存：

- U1 脱敏输出；
- A1 revision 和迁移 audit；
- 正式 OAuth refresh 前后 token version 变化及双产品状态；
- 一次四报表完整 `refresh_run_id`；
- 百度统计站点、趋势和页面读取状态；
- 旧路由访问日志为 0；
- 生产代码和模块装配没有 `BaiduTongjiCredentialService`；
- 正式浏览器截图和网络合同。

A2 至少保存：

- 停服前当前 Token 版本的双产品快速验证；
- 停服务时间和备份标识；
- 015 门禁结果；
- migration audit；
- 公开 revision；
- 管理及营销页面回归；
- 全仓旧字段、旧路由、旧 service 和现役双 Token 说明搜索为 0。

## 15. 风险与缓解

### R1：统一 Token 前提不成立

缓解：tooling-only U1 先行；探针不刷新、不重授、不改绑定；失败立即 `blocked`，不写业务迁移、不删除旧生产路径。

### R2：统计用户名不能由当前 Token 访问

缓解：以 `Token + userName` 能否枚举目标站点作为唯一可观测判据；一个连接无法覆盖当前目标站点时停止，不提前泛化。

### R3：旧能力状态覆盖新 Token

缓解：版本变化同事务失效；所有验证结果 CAS 写回；HTTP 服务端计算有效状态。

### R4：A1 与 A2 被错误合并

缓解：A1 revision 禁止包含 015；A2 独立 Git Bundle；迁移 CLI 以 expected latest 强制拒绝越界版本。

### R5：A2 删除字段后无法 down

缓解：停服务后备份；015 自带门禁；失败恢复备份并快进到 A2 后代 revert revision，不承诺自动 down 或非快进回退。

### R6：站点归属变化

缓解：用户名配置和绑定变更强制复核；正常读取使用 24 小时归属 TTL；域名变化明确失败。

### R7：大型重构扩大失败面

缓解：不拆 provider、不改公开 API、不改数据后处理、不建任务系统；后续分别由 006、007、005 独立承接。

## 16. 被拒绝的替代方案

### 16.1 双 Token fallback

拒绝原因：会隐藏统一路径失败，使旧实现永久存活，并继续要求人工维护第二枚秘密。

### 16.2 同时拆分 OAuth、推广和统计客户端

拒绝原因：凭据切换不要求搬移 allowlist、预算、限流、双读和解析器；收益不能覆盖同窗口风险。

### 16.3 异步验证任务

拒绝原因：需要任务持久化、去重、TTL、心跳和重启恢复；现役读取和刷新已经能产生真实验证事实。

### 16.4 持久化 OAuth scope

拒绝原因：真实响应形状未证明，且 scope 不能代替产品 API 验证。

### 16.5 同期重构公开数据 API

拒绝原因：当前端点已经按广告、流量和官网分开；命名和资源化债务不阻塞统一凭据。

## 17. 开放问题

以下问题由 U1 和 A1 真实运行回答：

1. 商业账号 Tongji 请求是否接受当前 dev2 OAuth Token？
2. 哪个统计用户名与当前 Token 的组合能够稳定枚举目标站点？
3. 一个用户名是否覆盖当前目标站点？
4. A1 运行中的真实 Refresh Token 是否轮换，刷新后两个产品是否继续可用？

如果生产证据表明必须使用多用户名、跨主体映射或继续双 Token，本系统不在 003 内扩张为该模型；需求转 `blocked` 并重新做产品决策。

## 18. Official References

- [百度统计商业账号接口说明](https://tongji.baidu.com/api/manual/Chapter2/drapi.html)
- [百度统计 getSiteList](https://tongji.baidu.com/api/manual/Chapter1/getSiteList.html)
- [百度统计 getData](https://tongji.baidu.com/api/manual/Chapter1/getData.html)

## 19. Handoff

- PRD: `docs/draft-2026-08-05-003-baidu-unified-oauth-api-architecture/prd.md`
- Tech Spec: `docs/draft-2026-08-05-003-baidu-unified-oauth-api-architecture/TECH-SPEC.md`
- Status: `draft`；已收敛为最小统一凭据方案，尚未实施。
- First issue: U1 tooling-only 探针发布与生产无状态只读验证。
- Completion condition: U1–U5 通过、A2 正式入口验收完成、旧实现与旧文档删除。
- Deferred architecture work: [006 营销 API 资源化](../draft-2026-08-05-006-marketing-api-resourceization/TECH-SPEC.md)、[007 营销生产数据正确性](../draft-2026-08-05-007-marketing-production-data-correctness/TECH-SPEC.md)与[005 Provider 模块化](../draft-2026-08-05-005-baidu-provider-modularization/TECH-SPEC.md)已独立建档，不属于本目录关闭条件。003 与 006 可独立实现但生产发布/观察窗口互斥；007 的统计正确性切片可独立、广告双周期等待 006；003、006、007 全部关闭后才进入 005。
