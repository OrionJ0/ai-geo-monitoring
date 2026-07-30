# 营销监控系统第一期技术方案

- 状态：Active（白名单真实数据试点已实现，等待完整生产验收）
- 日期：2026-07-29（2026-07-30 按百度商业开发者文档更新）
- 对应 PRD：`prd.md`
- 实施 issues：`issues/`

## 1. 目标与边界

第一期在现有 Express + Sequelize + Next.js 应用中增加一个轻量、只读的百度搜索推广监控模块。模块读取百度广告数据，保存当前项目最近 30 个自然日的本地快照，并提供项目汇总、按日趋势和按推广计划明细。

明确边界：

- 只支持百度搜索推广，不包含信息流。
- 只按整个百度账户绑定，不支持推广计划子集。
- 只读取展现、点击和广告消费，不调用写接口。
- 一次刷新覆盖项目全部活动绑定，任一账户失败都不替换旧快照。
- 落地页和销售系统没有 API 时只保留未来接口边界，不建假数据。
- 沿用单体、单进程和现有认证授权，不引入消息队列、微服务或通用 ETL。

## 2. 当前正式入口

当前后端入口是 `backend/app.js`，数据库使用 Sequelize，支持 SQLite 和 PostgreSQL；前端入口位于 `nextjs-frontend/src/app/`。根启动流程目前执行 `sequelize.sync()`。

营销模块实现时必须区分：

- 模块代码存在；
- 营销迁移已应用；
- `MARKETING_MONITORING_ENABLED=true`；
- `MARKETING_MONITORING_PILOT_MODE=true|false`；
- 路由和导航已接入；
- 真实百度账户已完成生产验收。

当前工程状态：

- 后端正式应用已经挂载营销状态、授权、绑定、看板和刷新路由，启动/关停链路也已接入；
- 默认 `MARKETING_MONITORING_ENABLED=false`；文档试点进入 `PILOT_READY`，真实响应试点进入 `PILOT_DATA_READY`，正式配置必须通过 `VERIFIED` 契约门禁才能进入 `READY`；
- 前端直达页面和管理员设置页已构建，但工作台导航保持隐藏；
- 默认配置不会向百度发起任何网络请求，也不会在正式业务流程产生营销数据；
- `PILOT_READY` 只挂载授权、callback、连接与账户目录；`PILOT_DATA_READY` 额外挂载白名单项目绑定、搜索快照、executor 和百度统计实时趋势；
- 真实报表响应、金额/时区、refresh 轮换与生产验收完成后，新增不可变 `VERIFIED` 契约版本并关闭试点模式，正式路径才会生效。

## 3. 关键决策

### 3.1 模块化单体

营销代码放在独立模块内，但仍由现有 Express 和 Next.js 进程承载。模块只暴露明确的路由、服务和模型注册入口，不建设 `SourceRegistry`、通用连接器或工作流平台。

### 3.2 真实契约先行

2026-07-30 已按百度商业开发者中心官方文档确认并实现以下请求边界：

| 能力 | 官方契约 |
|---|---|
| 授权页 | `GET https://u.baidu.com/oauth/page/index`，固定 `platformId=4960345965958561794`，参数为 `appId/scope/state/callback` |
| callback | `GET`，精确参数为 `appId/authCode/state/userId/timestamp/signature`，`state` 最长 512 |
| callback 验签 | 除 `signature` 外按 key 自然排序为 JSON，UTF-8 Base64 后用 `secretKey` 前 16 字符执行 AES-128-CBC/NoPadding，16 个 NUL 字节 IV，结果为大写 HEX |
| 换 Token | `POST https://u.baidu.com/oauth/accessToken`，JSON 参数 `appId/authCode/secretKey/grantType/userId` |
| 刷新 Token | `POST https://u.baidu.com/oauth/refreshToken`，JSON 参数 `appId/refreshToken/secretKey/userId` |
| 账户目录 | `POST https://u.baidu.com/oauth/getUserInfo`，支持主账户、子账户及 `lastPageMaxUcId` 游标，`pageSize` 最大 500 |
| 搜索计划报告 | `POST https://api.baidu.com/json/sms/service/OpenApiReportService/getReportData`，`reportType=2290316`、`DAY`、`startRow/rowCount`，QPS 50，最大 731 天 |

上述契约固化在 `baidu-marketing-docs-2026-07-30/manifest.json`。官方 Token 参数表写 `grantType=auth_code`，同页 callback Demo 却写 `access_token`；适配器遵循参数表，并把冲突保留为真实试点 blocker。

仍不得猜测的内容：

- 应用审核后生成的实际 SEARCH 只读 scope；
- `getUserInfo` 的真实普通/超管/代理商响应差异；
- 搜索计划报告成功响应体及完整分页终止条件；
- Refresh Token 是否轮换、响应丢失后的重放语义，以及百度侧撤权端点；
- 消费币种、固定 scale、报告时区和统计延迟；
- 业务错误的可重试性、退避和真实账户规模。

契约产物建议放置：

```text
backend/modules/marketing/contracts/baidu/
└── <contract-version>/
    ├── manifest.json
    └── fixtures/
        ├── oauth-token.success.redacted.json
        ├── oauth-refresh.*.redacted.json
        ├── accounts.success.redacted.json
        ├── search-report.success.redacted.json
        └── errors.*.redacted.json
```

`manifest.json` 至少记录证据日期、官方文档地址、应用权限、接口版本、wire 字段映射、金额归一化规则、ID 唯一作用域、时区、分页、限流、错误映射、撤权能力和已观察的 Refresh Token 行为。Issue 002 完成时必须同步修订本 Tech Spec、适配器类型和后续 issues 的验收标准。

### 3.3 固定 30 天快照

- 同步窗口：当前日期及向前共 30 个 `Asia/Shanghai` 自然日。
- 刷新接口不接受起止日期。
- 页面日期筛选只在本地覆盖范围内计算。
- 每次成功刷新整体替换项目当前活动快照。
- 失败、中断或归档竞争时不写入新事实。

这避免历史回补、范围任务复用和混合新鲜度。

### 3.4 精确值

SQLite/Sequelize 的 `BIGINT` 可能进入 JavaScript `Number`，不能用于外部大 ID 和精确指标。两种数据库统一使用规范十进制 `TEXT`：

- 外部 ID：非空原样字符串，不做数值转换；
- 展现和点击：仅数字的非负整数字符串；
- 消费：按契约门确认的固定 scale 归一为非负整数字符串；
- 聚合：服务层使用 `BigInt`；
- JSON：继续返回字符串；
- 前端：用字符串格式化，不用 `Number`、`parseInt` 或浮点求和。

金额字段先命名为 `cost_amount_scaled_text`，币种和 scale 来自版本化契约；若契约确认固定为人民币微元，可在 Issue 002 修订为更具体名称。

### 3.5 正交状态

不用一个 `data_state` 混合多个维度。读模型分别返回：

- `moduleState`：`DISABLED | PILOT_READY | PILOT_DATA_READY | READY | MISCONFIGURED | SCHEMA_MISSING | RECOVERY_FAILED`
- `projectState`：`ACTIVE | ARCHIVED`
- `sourceSummaryState`：项目级 `NOT_CONNECTED | CONNECTED | ACTION_REQUIRED | DISCONNECTED`
- `bindingSummaryState`：项目级 `NONE | ACTIVE | BLOCKED`
- `snapshotContentState`：`NONE | ZERO | DATA`
- `snapshotFreshnessState`：`NA | FRESH | STALE`
- `refreshState`：`IDLE | QUEUED | RUNNING | SUCCEEDED | FAILED | INTERRUPTED`
- `coverage`：起止日期、最后成功时间、快照修订号
- `bindings[]`：同一读取事务中的逐账户 connection/binding 状态、阻断码和管理员恢复动作

百度不可用属于来源或刷新状态，不影响本地读取接口返回 200。营销配置、数据库结构或启动恢复异常使营销模块 fail-closed 并隐藏入口，但不使共享单体的 GEO/SEO 全局 readiness 失败；发布门禁必须单独要求营销模块状态为 `READY` 后才允许扩大访问范围。

项目级聚合使用固定优先级：任一当前绑定需处理时为 `ACTION_REQUIRED/BLOCKED`；没有阻断且至少一条活动绑定时为 `CONNECTED/ACTIVE`；没有连接或绑定时分别为 `NOT_CONNECTED/NONE`；全部相关连接已本地断开时为 `DISCONNECTED/BLOCKED`。具体账户和处理动作始终以 `bindings[]` 为准。

## 4. 模块与文件结构

```text
backend/
├── modules/marketing/
│   ├── index.js
│   ├── config.js
│   ├── adapters/
│   │   └── BaiduMarketingClient.js
│   ├── contracts/baidu/<version>/
│   ├── domain/
│   │   ├── baiduOAuthSignature.js
│   │   ├── exactValues.js
│   │   ├── states.js
│   │   └── syncWindow.js
│   ├── migrations/
│   │   ├── index.js
│   │   ├── 001-authorization-connections.js
│   │   ├── 002-project-bindings.js
│   │   ├── 003-campaign-snapshots.js
│   │   └── 004-baidu-oauth-identity.js
│   ├── models/
│   │   └── registerMarketingModels.js
│   ├── routes/
│   │   ├── baiduAuthorizationRoutes.js
│   │   ├── baiduConnectionRoutes.js
│   │   ├── baiduBindingRoutes.js
│   │   └── marketingDashboardRoutes.js
│   └── services/
│       ├── BaiduAuthorizationService.js
│       ├── BaiduConnectionService.js
│       ├── BaiduBindingService.js
│       ├── MarketingDashboardService.js
│       ├── MarketingRefreshService.js
│       └── MarketingStartupService.js
├── scripts/
│   └── migrateMarketing.js
└── tests/marketing/

nextjs-frontend/src/
├── app/geo/marketing/page.tsx
├── app/admin/settings/marketing/result/page.tsx
├── app/admin/settings/BaiduMarketingSettings.tsx
├── components/marketing/
└── utils/marketing*.test.cjs
```

模块入口负责：

1. 读取配置；
2. 在根 `sequelize.sync()` 完成后注册营销模型；
3. 模块启用时校验显式迁移结构；
4. 恢复中断刷新；
5. 挂载营销路由和关闭钩子。

营销模型不得被根 `sequelize.sync()` 自动建表。开发、测试和部署都通过 `migrateMarketing.js` 应用显式迁移。已应用迁移永不修改；ledger 保存版本与 checksum，PostgreSQL advisory lock 和 SQLite 独占迁移事务保证同一时刻只有一个 runner。

## 5. 数据模型

第一期只有 5 张领域表。迁移 ledger 是技术表，不计入领域表。

### 5.1 `baidu_authorization_attempts`

| 字段 | 说明 |
|---|---|
| `id` | 内部 UUID |
| `launch_ticket_hash` | 一次性本站启动 Cookie 票据哈希 |
| `provider_state_hash` | 百度 OAuth state 哈希；消费 launch 时才生成，之前为空 |
| `result_ticket_hash` | callback 写入一次性结果 Cookie 时保存的哈希 |
| `operation` | `CONNECT` / `REAUTHORIZE` |
| `initiated_by_user_id` | 发起管理员 |
| `target_connection_id` | 重新授权目标，新连接时为空 |
| `expected_auth_generation` | 发起时连接授权代次 |
| `status` | `PENDING` / `PROCESSING` / `SUCCEEDED` / `FAILED` / `EXPIRED` / `OUTCOME_UNKNOWN` |
| `launch_consumed_at` | 启动票据使用时间 |
| `expires_at` | 尝试过期时间 |
| `completed_at` | 终态时间 |
| `failure_code` | 脱敏稳定错误码 |
| `created_at` / `updated_at` | 审计时间 |

约束：

- 启动票据、state 和结果票据都使用至少 256 bit 随机值，只存哈希并分别建立唯一索引。
- 创建尝试时只生成 launch 票据；launch 原子消费后才生成百度 state、保存哈希并构造 303，避免普通 JSON 暴露 state。
- 启动票据和结果票据都只能消费一次。
- callback 只有从 `PENDING` 原子进入 `PROCESSING` 的请求可以换 Token。
- 网络超时导致换 Token 结果不确定时进入 `OUTCOME_UNKNOWN`，不盲目重试授权码。

### 5.2 `baidu_marketing_connections`

| 字段 | 说明 |
|---|---|
| `id` | 内部 UUID |
| `status` | `CONNECTED` / `REAUTH_REQUIRED` / `DISCONNECTED` |
| `authorized_principal_id` | 百度授权主体 ID，TEXT |
| `authorized_principal_name` | 脱敏展示名 |
| `access_token_ciphertext` | Access Token 密文 |
| `refresh_token_ciphertext` | Refresh Token 密文，可为空 |
| `access_token_expires_at` | 过期时间 |
| `auth_generation` | 授权、重授权、断开时递增 |
| `token_version` | Token 成功更新时递增 |
| `refresh_claim_token` | 短期刷新占用令牌 |
| `refresh_claim_until` | 占用截止时间 |
| `created_by_user_id` | 创建管理员 |
| `last_error_code` | 脱敏稳定错误码 |
| `created_at` / `updated_at` | 审计时间 |

第一期明确复用现有 `SecretEncryptionService` 和 `CONFIG_ENCRYPTION_KEY`，不新增第二套密钥系统。禁止把密文或明文 Token 写入错误详情。现有加密服务不支持在线 keyring 轮换，因此第一期的密钥泄露恢复策略是：先阻断连接并在百度侧撤权，再清除全部百度 Token、轮换主密钥并逐连接重新授权；不得声称可以无中断轮换。

### 5.3 `baidu_project_bindings`

| 字段 | 说明 |
|---|---|
| `id` | 内部 UUID |
| `project_id` | 现有项目外键 |
| `connection_id` | 百度连接外键 |
| `external_account_id` | 百度账户 ID，TEXT |
| `external_account_name` | 展示名 |
| `status` | `ACTIVE` / `PAUSED` |
| `binding_version` | 暂停、恢复或改绑时递增 |
| `paused_reason` | `DISCONNECTED` / `REAUTH` / `ADMIN` 等稳定码 |
| `created_by_user_id` | 操作管理员 |
| `created_at` / `updated_at` | 审计时间 |

契约门未证明 ID 全局唯一前，数据库唯一约束使用 `(project_id, connection_id, external_account_id)`；服务层另禁止同一 `(connection_id, external_account_id)` 同时属于多个活动项目。若契约确认存在跨连接稳定的 canonical account identity，再用新迁移加强全局防重。第一期不含 `channel`、`scope_type` 或推广计划关联表。

当前绑定指纹：

```text
SHA-256(UTF-8(RFC 8785 风格 canonical JSON))
```

JSON 固定包含版本号和按 `bindingId` 排序的 `{bindingId,connectionId,accountId,bindingVersion}` 数组；契约测试保存固定输入/输出向量。

刷新运行保存该指纹；读模型只把与当前指纹一致的成功运行视为当前快照。

### 5.4 `baidu_campaign_daily_metrics`

| 字段 | 说明 |
|---|---|
| `project_id` | 项目外键 |
| `binding_id` | 绑定外键 |
| `refresh_run_id` | 产生当前快照的运行 |
| `metric_date` | Asia/Shanghai 自然日 |
| `external_account_id` | 账户 ID，TEXT |
| `campaign_id` | 推广计划 ID，TEXT |
| `campaign_name` | 推广计划名称 |
| `impressions_text` | 非负整数字符串 |
| `clicks_text` | 非负整数字符串 |
| `cost_amount_scaled_text` | 固定 scale 的非负整数字符串 |
| `created_at` | 写入时间 |

唯一约束：`(binding_id, campaign_id, metric_date)`。`project_id` 只用于项目快照读取和级联；提交前仍校验 binding、account 和响应账户一致。

迁移对十进制字符串增加长度和字符 CHECK；SQLite 与 PostgreSQL 分别使用等价表达式。服务层再次验证。禁止 `Model.sum`。

### 5.5 `baidu_marketing_refresh_runs`

| 字段 | 说明 |
|---|---|
| `id` | 内部 UUID |
| `project_id` | 项目外键 |
| `trigger_type` | `INITIAL` / `AUTO` / `MANUAL` |
| `status` | `QUEUED` / `RUNNING` / `SUCCEEDED` / `FAILED` / `INTERRUPTED` |
| `active_project_key` | 非终态为项目 ID，终态为空 |
| `execution_token` | 本次单进程执行防护令牌 |
| `binding_fingerprint` | 发起时活动绑定指纹 |
| `coverage_start` / `coverage_end` | 固定 30 天窗口 |
| `contract_version` | 本快照使用的不可变百度契约版本 |
| `currency_code` / `cost_scale` | 本快照金额解释 |
| `started_at` / `finished_at` | 生命周期时间 |
| `next_retry_at` | 自动重试最早时间 |
| `failure_code` | 脱敏稳定错误码 |
| `created_by_user_id` | 手动发起人；自动任务为空 |
| `created_at` / `updated_at` | 审计时间 |

约束：

- `active_project_key` 使用 `WHERE active_project_key IS NOT NULL` 的唯一索引，保证每项目至多一个非终态运行。
- CHECK 保证非终态必须有 `active_project_key` 和执行所需字段，终态必须释放它。
- 成功 run 必须同时保存 contract version、currency 和 scale，零数据快照也不例外。
- 启动恢复只在取得营销执行器 singleton 后，把遗留 `QUEUED/RUNNING` 标为 `INTERRUPTED` 并释放活动键；不建设 lease、heartbeat 或多实例调度。

所有业务键、外键、状态、精确值和审计时间明确 `NOT NULL`；状态与成对字段使用 CHECK。至少建立 `refresh_runs(project_id, created_at)`、`bindings(connection_id)` 和 `metrics(refresh_run_id)` 索引。SQLite 每个连接必须验证 `PRAGMA foreign_keys=ON`。

### 5.6 外键与删除

- 连接断开只清 Token 并暂停绑定，不删除连接审计记录。
- 项目删除前必须已归档且没有活动刷新。
- 删除项目时 bindings、metrics 和 refresh runs 使用 `ON DELETE CASCADE`。
- authorization attempt 和 connection 的管理员外键按现有用户删除策略处理，不泄露凭据。

## 6. 内部 API

所有 JSON 精确数值都返回字符串。状态变更接口只接受现有 `Authorization: Bearer <JWT>`，不以 Cookie 作为业务认证，因此不另建 Cookie 会话型 CSRF 协议。管理接口复用现有管理员授权；项目接口复用项目访问策略。嵌套资源必须在同一查询/事务用 `(project_id, child_id)` 定位，不匹配统一返回 404。

所有 JSON 错误使用 `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`；严格拒绝未知字段。各端点测试覆盖未登录、角色不足、跨项目、重复调用和资源不存在。断开、暂停、恢复和删除采用幂等语义：目标已在期望终态时返回当前资源，不重复产生副作用。

### 6.1 模块状态

```http
GET /api/marketing/status
```

返回 `moduleState` 和稳定错误码，不返回环境变量值。

### 6.2 授权与连接

```http
POST /api/admin/marketing/baidu/authorization-attempts
GET  /api/admin/marketing/baidu/authorization/launch
GET  /api/admin/marketing/baidu/oauth/callback
GET  /api/admin/marketing/baidu/authorization-results/current
GET  /api/admin/marketing/baidu/connections
GET  /api/admin/marketing/baidu/connections/:connectionId/accounts
POST /api/admin/marketing/baidu/connections/:connectionId/disconnect
```

创建尝试请求：

```json
{
  "operation": "CONNECT",
  "targetConnectionId": null
}
```

响应只包含本站同源地址：

```json
{
  "launchUrl": "/api/admin/marketing/baidu/authorization/launch",
  "expiresAt": "2026-07-29T12:00:00.000Z"
}
```

现有登录凭据保存在 `localStorage`，普通页面导航不会携带 Bearer header。因此创建尝试的认证 POST 同时设置短期、`HttpOnly; Secure; SameSite=Strict`、只限固定 launch 路径的一次性 Cookie；普通 JSON 和 URL 都不含票据或 provider state。launch 用 Cookie 定位尝试，重查发起用户仍为 active 管理员，原子消费票据，再生成百度 state、保存哈希并 `303` 到百度。

callback 完成后设置另一个短期、`HttpOnly; Secure; SameSite=Lax` 的一次性结果 Cookie，并总是 `303` 到不带查询参数的本站结果页 `/admin/settings/marketing/baidu/result`。结果页带现有 Bearer JWT 调用 `authorization-results/current`；服务端同时校验结果 Cookie 与发起管理员，返回本次 attempt 的脱敏终态，不能只从连接当前状态猜测结果。

断开连接时先在事务中把连接置为 `DISCONNECTED`、递增代次、暂停绑定，并取得仅存于当前内存的撤权所需凭据，然后立即清除数据库 Token。事务提交后才按契约尝试百度侧撤权；失败也不恢复本地连接，而是记录脱敏结果并提示管理员到百度控制台完成撤权。

### 6.3 项目绑定

```http
GET    /api/marketing/projects/:projectId/baidu-bindings
POST   /api/marketing/projects/:projectId/baidu-bindings
POST   /api/marketing/projects/:projectId/baidu-bindings/:bindingId/pause
POST   /api/marketing/projects/:projectId/baidu-bindings/:bindingId/resume
DELETE /api/marketing/projects/:projectId/baidu-bindings/:bindingId
```

新增绑定只接受 `connectionId` 和 `externalAccountId`。服务端重新读取账户目录确认归属，不信任前端名称。恢复时再次确认连接、账户和项目均有效，然后递增 `binding_version` 并清空旧口径活动快照。

### 6.4 看板

```http
GET /api/marketing/projects/:projectId/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD
```

单个响应返回同一读取修订：

```json
{
  "projectId": "project-id",
  "revision": "refresh-run-id-or-null",
  "states": {
    "moduleState": "READY",
    "projectState": "ACTIVE",
    "sourceSummaryState": "CONNECTED",
    "bindingSummaryState": "ACTIVE",
    "snapshotContentState": "DATA",
    "snapshotFreshnessState": "FRESH",
    "refreshState": "IDLE"
  },
  "bindings": [
    {
      "bindingId": "binding-id",
      "accountId": "opaque-account-id",
      "accountName": "账户展示名",
      "sourceState": "CONNECTED",
      "bindingState": "ACTIVE",
      "blockingCode": null
    }
  ],
  "coverage": {
    "from": "2026-06-30",
    "to": "2026-07-29",
    "lastSuccessfulAt": "2026-07-29T03:00:00.000Z",
    "currency": "CNY",
    "costScale": 6
  },
  "filter": {
    "from": "2026-07-01",
    "to": "2026-07-29"
  },
  "summary": {
    "impressions": "0",
    "clicks": "0",
    "costAmountScaled": "0"
  },
  "trend": [],
  "campaigns": [],
  "activeRun": null,
  "lastRun": {
    "runId": "run-id",
    "status": "SUCCEEDED",
    "failureCode": null,
    "nextRetryAt": null
  }
}
```

dashboard GET 是纯读，不创建 run、不调用百度。整个响应在同一数据库读取快照中生成：PostgreSQL 使用 `REPEATABLE READ READ ONLY`，SQLite 使用同一连接的显式读事务；所有事实查询限定捕获的 `refresh_run_id`。

第一期返回当前筛选范围的完整推广计划列表，不做服务端分页。契约门必须确认项目最大绑定数、项目合计计划行数和响应字节预算；绑定或刷新超过门禁时稳定拒绝，不能截断。真实规模不满足时先修订 API 和 PRD。

来源异常、需重授权、暂停、无快照和刷新失败仍返回 200 与业务状态。无权返回 403；项目不存在返回 404。`from/to` 必须同时省略或同时出现，使用严格日历日期、首尾均包含且 `from <= to`；格式错误或超出 coverage 返回 422。没有快照时两者必须省略，响应 `coverage=null`。

### 6.5 刷新运行

```http
POST /api/marketing/projects/:projectId/refresh-runs
GET  /api/marketing/projects/:projectId/refresh-runs/:runId
```

POST 无日期参数，body 只允许 `{"triggerType":"AUTO"|"MANUAL"}`；服务端根据调用路径和权限校验 trigger。成功创建返回 202 与 `Location`；已有活动运行时也返回 202、相同 `runId` 和相同 `Location`，不再创建第二个。归档项目、没有活动绑定或任一绑定暂停/需重新确认时返回 409。

run 资源固定返回 `runId/projectId/triggerType/status/coverage/createdAt/startedAt/finishedAt/failure{code,retryable,retryAfterAt}`，建议客户端按响应 `Retry-After` 轮询。终态不可逆；终态后客户端重新读取 dashboard。跨项目 runId 统一 404。

## 7. OAuth 与 Token 生命周期

### 7.1 回调流程

```text
管理员
  │ POST 创建授权尝试
  ▼
本站设置一次性 launch Cookie，返回固定同源 launchUrl
  │ GET launch，重查发起管理员并消费 Cookie 票据
  │ 生成 provider state 并保存哈希
  ▼ 303
百度授权页
  │ callback(appId, authCode, state, userId, timestamp, signature)
  ▼
本站精确解析单值参数
  │ 校验 appId 并按百度 AES-CBC 算法常量时间验签
  │ state 哈希定位尝试
  │ CAS: PENDING -> PROCESSING
  │ 重查管理员、目标连接、auth_generation
  │ 用 appId + authCode + userId 换 Token
  │ 事务 CAS 写连接并完成尝试
  │ 设置一次性结果 Cookie
  ▼ 303
无查询参数结果页
```

安全要求：

- callback 只接受 `appId/authCode/state/userId/timestamp/signature` 六个单值参数，拒绝未知键、重复键、超长值、错误 appId、签名篡改、过期 attempt 和重放；
- callback 验签使用官方 `secretKey` 前 16 字符、AES-128-CBC/NoPadding、零 IV 和大写 HEX；验签失败不得换 Token；
- launch、callback、结果页使用 `Cache-Control: no-store` 和严格 `Referrer-Policy: no-referrer`；
- CDN/LB/代理/APM/应用不得采集 launch Cookie、callback query、OAuth/Token 请求响应体或 303 `Location`；错误只写稳定码和 request ID；
- 新的重新授权或断开递增 `auth_generation`，使旧尝试失效；
- 最终写连接前再次校验管理员仍有效、目标连接代次未变、外部主体符合操作预期；
- Token 交换超时后不确定是否已消费授权码时标记 `OUTCOME_UNKNOWN`，由管理员重新发起。

### 7.2 Token 刷新占用

Token 到期前由连接服务统一刷新：

1. 使用单条条件更新抢占 claim：仅当 claim 为空/过期且 `auth_generation/token_version` 未变时写随机 claim，并检查 affected rows。
2. 抢占失败者等待短暂抖动后重读连接，不调用百度。
3. 抢占成功者提交短期 claim。
4. claim 持有者调用百度 refresh grant。
5. 事务按 `connection_id + auth_generation + token_version + refresh_claim_token` CAS 更新。
6. Access Token 更新；Refresh Token：
   - 响应缺失：保留旧值；
   - 响应与旧值相同：保留旧值；
   - 响应为新值：加密替换。
7. 清理 claim；确定失败按契约映射为可重试或 `REAUTH_REQUIRED`。

claim 截止时间必须大于单次百度请求超时及安全余量。晚到响应、断开或新授权后的响应无法通过 CAS。若 refresh grant 可能已被百度接受但本地没有拿到响应，进入 `REAUTH_REQUIRED(reason=REFRESH_OUTCOME_UNKNOWN)` 并暂停相关绑定，禁止 claim 过期后盲重试。

## 8. 绑定与快照一致性

### 8.1 绑定变更

新增、恢复、改绑或解除绑定都在事务中：

1. 锁定并重查活动项目；
2. 校验管理员和连接；
3. 更新绑定及 `binding_version`；
4. 删除该项目当前活动 metrics；
5. 使既有成功运行的绑定指纹与当前指纹不匹配。

暂停是唯一例外：暂停或连接断开时保留完整项目旧快照，读模型将其标为“历史快照 + 绑定暂停/来源异常”，并阻止整个项目继续刷新，直到管理员选择恢复、改绑或解除。这样不会用剩余账户静默生成另一套口径。

因此，新建、恢复、改绑或解除后不会把旧范围数据作为当前快照；恢复后等待新口径首次刷新。暂停期间虽然保留旧快照，但 snapshot content/freshness 与逐绑定 source/binding 状态分开表达，不能把它标成当前新鲜数据。

连接进入 `REAUTH_REQUIRED`、开始重新授权或断开时，必须在同一业务操作中暂停相关绑定并递增 `binding_version`。重授权成功后仍保持暂停，管理员重新验证账户后显式恢复。任何刷新最终提交都要校验连接仍为 `CONNECTED` 且 `auth_generation` 未变。

### 8.2 刷新算法

```text
创建 refresh run（唯一 active_project_key）
  │
  ├─ 重查项目 ACTIVE、活动绑定和指纹
  ├─ 逐连接取得可用 Access Token
  ├─ 拉取全部绑定的固定 30 天搜索报表
  ├─ 严格解析、校验完整分页、精确字段和响应账户归属
  ├─ 内存中按唯一键去重并核对聚合
  ▼
单个数据库事务
  ├─ 锁定项目并确认仍 ACTIVE
  ├─ 重算绑定指纹并比较
  ├─ CAS 校验 run 仍为 RUNNING、active_project_key 与 execution_token 均匹配
  ├─ 校验所有连接状态/auth_generation 与发起时一致
  ├─ 删除项目旧 metrics
  ├─ 插入新 metrics
  └─ run -> SUCCEEDED，释放 active_project_key
```

任何外部读取、解析、分页、Token、项目或绑定校验失败：

- 不执行快照替换事务；
- run 标为 `FAILED` 或 `INTERRUPTED`；
- 释放活动键；
- 完整旧快照继续可读。

项目归档事务先锁定项目并确认没有提交中的刷新。若归档先提交，刷新最终事务重查后失败。正在进行的 HTTP 请求只做 best-effort abort，正确性依赖最终事务栅栏。

PostgreSQL 写事务使用项目行 `FOR UPDATE`；SQLite 从事务入口使用 `BEGIN IMMEDIATE`，取得写锁后再重查项目、绑定和 run。`SQLITE_BUSY/BUSY_SNAPSHOT` 必须整事务回滚后重试，不能只重试末尾语句。

### 8.3 新鲜度与重试

- `lastSuccessfulAt + 10 分钟 < now` 即陈旧。
- `next_retry_at` 只决定自动重试何时可再次创建，不改变陈旧状态。
- 手动刷新可以绕过自动退避，但仍受同项目单活动运行和合理频率限制。
- 不自动重试非幂等 OAuth code exchange。

## 9. 单进程执行器

- dashboard GET 始终纯读；前端看到 `NONE/STALE` 后显式 POST，POST 只在数据库提交一个 `QUEUED` run。
- 进程内执行器使用全局小并发（第一期默认 1）、FIFO、有限队列和排队超时；不建设多实例抢占。
- 生产部署强制 stop-old-before-start-new。营销执行器先取得 singleton（PostgreSQL session advisory lock；单机 SQLite 使用部署锁）再恢复/消费运行；拿不到锁时营销模块 fail-closed，GEO/SEO 继续可用。
- `execution_token` 与 run 状态 CAS 防止中断或旧进程迟到完成。
- 应用取得 singleton 后把遗留非终态 run 标为 `INTERRUPTED`、使 execution token 失效并释放活动键。
- 优雅关闭停止接收新运行，给当前请求有限完成时间；未完成运行标为 `INTERRUPTED`。
- 项目规模很小，报表暂存于内存；契约门给出单项目最大行数和响应字节预算。

本方案接受“没有进程主管时进程崩溃不会自动拉起”的现状，不把应用内代码描述为部署高可用。

## 10. 前端

营销数据页：

- 项目标题、绑定账户和覆盖范围；
- 展现、点击、广告消费汇总；
- 按日趋势；
- 按账户 + 推广计划的完整明细；
- 独立的来源、绑定、快照和刷新状态；
- “立即刷新”和“前往百度营销”；
- 未接入来源的静态说明。

交互要求：

- 初次渲染不等待百度；
- 后台刷新时保留旧数据；
- dashboard 返回 `NONE/STALE` 时前端显式 POST；轮询当前 run，终态后重新读取整个 dashboard；
- 不在浏览器保存 Token、授权码或 state；
- 状态不能只靠颜色表达；
- 趋势图必须提供包含完整日期、指标、单位和币种的原生逐日表格；
- 键盘可操作项目选择、日期、刷新、授权、绑定、暂停、恢复、断开和外链；
- 授权/绑定对话框定义初始焦点、焦点陷阱、Escape 和关闭后焦点恢复，字段错误与控件关联；
- 使用单一持久 `aria-live="polite"` 节点，只在 QUEUED/RUNNING/终态语义变化时去重播报；轮询和数据更新不移动焦点；
- 归档和暂停状态明确禁用刷新并解释原因。
- 验证 320 CSS px、400% 缩放、长账户/计划名和超长精确值；除带可访问名称的表格滚动容器外，页面不得整体横向滚动。

前端已经提供基于 `node --test` 的 `npm --prefix nextjs-frontend test`，并提供基于 Playwright + axe 的 `npm --prefix nextjs-frontend run test:marketing:browser`。

## 11. 配置、安全与日志

建议环境变量：

```text
MARKETING_MONITORING_ENABLED=false
MARKETING_MONITORING_PILOT_MODE=false
MARKETING_MONITORING_ALLOWED_PROJECT_IDS=
BAIDU_MARKETING_APP_ID=
BAIDU_MARKETING_SECRET_KEY=
BAIDU_MARKETING_SCOPE=
BAIDU_MARKETING_REDIRECT_URI=
BAIDU_MARKETING_CONTRACT_VERSION=
BAIDU_MARKETING_HTTP_TIMEOUT_MS=
```

规则：

- 配置检查只报告缺失键名和稳定错误码，不回显值。
- 试点模式接受两级契约：`DOCUMENTED_PENDING_PILOT` 只挂载授权、callback、Token、连接和账户目录；`PILOT_VERIFIED` 还必须匹配获批 Scope、脱敏真实 fixture、金额试点口径和只读出站白名单，才进入 `PILOT_DATA_READY`。
- 正式模式拒绝有 blocker、无生产 allowlist、金额口径不完整或适配器未实现的契约。
- 验收阶段服务端只允许管理员和 `MARKETING_MONITORING_ALLOWED_PROJECT_IDS` 中的项目；设为明确的 `*` 才表示正式扩大访问，不能只隐藏导航。
- Redirect URI 必须精确匹配允许列表，只接受 HTTPS 生产地址；本地测试例外由显式测试配置控制。
- 出站客户端只允许契约清单中的百度 HTTPS 主机，不跟随到非白名单主机。
- HTTP 超时、响应大小、分页数和行数都有上限。
- 结构化日志只记录内部项目/连接/run ID、阶段、耗时和稳定错误码。
- 外部账户名称、推广计划名称按业务数据处理，不进入常规错误日志。
- 管理员模块状态提供最小运营摘要：陈旧项目数、连续失败数、超 deadline run、`REAUTH_REQUIRED`、`OUTCOME_UNKNOWN` 和最后成功时间；Issue 008 为这些状态写明负责人、处置步骤和恢复验证。
- 自动化测试扫描页面、API、日志哨兵和本地测试代理，确认敏感值未出现。
- 第一次真实授权前，先用合成 canary 走完整生产 ingress/callback/APM 链路并确认零命中；真实授权后再次扫描。

## 12. 数据库迁移与启动

新增脚本：

```text
npm --prefix backend run audit:marketing
npm --prefix backend run migrate:marketing
```

行为：

- `audit:marketing` 只读检查 ledger checksum、表、列、索引和 CHECK，拒绝迁移漂移与半应用状态。
- `migrate:marketing` 在方言对应互斥锁内应用不可变版本迁移，可重复执行。
- 发布顺序：备份 → apply migration → audit → 启动 → readiness → 入口验收。
- 模块禁用时营销结构缺失不影响现有应用。
- 模块启用时配置或结构失败使营销模块 fail-closed；正式模式还要求启动恢复成功。共享 GEO/SEO 全局 readiness 保持独立。
- 百度网络可达性不参与全局或营销模块 readiness。

PostgreSQL 集成测试必须使用 `POSTGRES_TEST_URL` 指向一次性数据库或 schema。测试 runner 在执行任何 DDL 前拒绝：

- `POSTGRES_TEST_URL` 缺失；
- `POSTGRES_TEST_URL === DATABASE_URL`；
- URL 或 schema 未带显式测试标识；
- 无法确认清理目标是本次创建的 disposable namespace。

## 13. 测试策略

### 13.1 单元与契约

- 精确十进制字符串解析、BigInt 聚合和格式化；
- 固定 30 天时区边界；
- OAuth 重复参数、过期、重放和代次竞争；
- Refresh Token 缺失、相同、新值三种响应；
- lossless wire JSON：裸大整数、字符串、前导零、指数和非法精确值；
- 百度分页、零数据、限流、授权失效和畸形响应；
- 版本化 manifest 与 fixtures 一致性。

### 13.2 SQLite 与 PostgreSQL

- 5 表迁移、CHECK、唯一约束和级联删除；
- 同项目活动 run 唯一；
- refresh claim 只允许一次外部 refresh grant；
- dashboard 在并发快照提交时仍为同一 revision；
- 绑定变更与刷新提交竞争；
- 归档与刷新提交竞争；
- 项目全有或全无替换；
- 真实零数据快照元数据；
- 精确值超过 `Number.MAX_SAFE_INTEGER` 仍一致。

### 13.3 API 与前端

- 项目和管理员权限；
- dashboard 单修订响应；
- 状态组合与 HTTP 语义；
- 日期筛选不触发百度；
- dashboard GET 零写入；并发 refresh POST 只创建一次后台 run；
- 键盘、焦点、axe、状态非颜色表达和响应式；
- 构建、lint 和前端测试。

### 13.4 入口级与生产

- 从真实导航进入营销页；
- 新路由确实调用营销模块，模块禁用时不影响 GEO/SEO；
- 根 `sequelize.sync()` 不创建营销表；
- 发布脚本先迁移审计再启动；
- 生产完成授权、账户绑定、报表核对和一次真实 refresh grant；
- 真实代理/APM/浏览器历史不包含敏感参数；
- 使用 VoiceOver 完成人工关键路径检查。

## 14. 实施顺序

1. **Issue 001**：模块骨架、前端测试入口、显式迁移基础。
2. **Issue 002**：百度真实契约清单和脱敏 fixtures；更新本规格。
3. **Issue 003**：OAuth、连接、重授权和断开。
4. **Issue 004**：搜索账户目录与账户级项目绑定。
5. **Issue 005**：固定窗口同步、项目原子快照、SQLite/PostgreSQL。
6. **Issue 006**：Refresh Token claim、运行恢复和并发栅栏。
7. **Issue 007**：看板、状态和自动化无障碍。
8. **Issue 008**：发布、配置、日志哨兵和入口回归。
9. **Issue 009**：真实百度生产与人工验收。
Issue 010 是 Later 停车项，不属于第一期实施顺序，也不阻塞第一期关闭；只有真实信息流需求获批后才另建需求目录。

Issue 002 是所有百度真实解析实现的阻塞门；Issue 009 通过前不得宣称生产接入完成。

## 15. Rollout 与回滚

上线：

1. 保持 `MARKETING_MONITORING_ENABLED=false` 部署代码。
2. 应用迁移并执行只读审计。
3. 在公网 HTTPS 域名验证 `/api/health`、`/api/ready` 和禁用状态 callback 路由。
4. 在百度为本项目新建专用应用，登记精确 callback，审核后取得 `appId/secretKey/scope`。
5. 配置测试项目 allowlist、`MARKETING_MONITORING_PILOT_MODE=true` 和 `baidu-marketing-docs-2026-07-30`，确认状态为 `PILOT_READY`。
6. 用合成 canary 验证 ingress/APM 不记录 callback query，再从正式入口完成真实授权和账户目录检查。
7. 部署脱敏真实 fixture，把契约切到 `baidu-marketing-pilot-2026-07-30`，确认状态为 `PILOT_DATA_READY`；只在项目白名单内完成绑定、搜索快照和百度统计实时读取。
8. 继续采集 Token refresh、金额/时区、失败响应和同口径后台核对证据，新增 `VERIFIED` 版本。
9. 把 `MARKETING_MONITORING_PILOT_MODE=false`，从正式入口完成最终安全与无障碍验收。
10. 验收通过后扩大项目准入并显示导航。

回滚：

- 同时关闭模块总开关和试点开关并重启，现有 GEO/SEO 继续使用原入口。
- 保留营销表以便诊断，不重新启用任何旧营销实现，因为此前没有旧实现。
- 若 OAuth 凭据或主密钥疑似泄露，先阻断本地连接并在百度侧撤权，清除全部百度 Token，轮换应用 Secret/`CONFIG_ENCRYPTION_KEY` 后逐连接重新授权。
- 数据迁移只做向前修复；破坏性删表另行审批和备份。

## 16. 验收命令基线

实现完成后的最小命令集合：

```bash
npm --prefix backend test
npm --prefix backend run test:marketing
npm --prefix nextjs-frontend test
npm --prefix nextjs-frontend run test:marketing:browser
npm --prefix nextjs-frontend run lint
npm --prefix nextjs-frontend run build
npm --prefix backend run audit:marketing
POSTGRES_TEST_URL='<disposable-test-url>' npm --prefix backend run test:postgres:marketing
npm run deploy:check
git diff --check
```

每个 issue 还必须在自己的 `Verification` 小节给出本切片的测试文件、命令和人工证据，不能只写验收复选框。

## 17. 已接受取舍与阻塞项

已接受取舍：

- 单进程执行器，没有多实例调度和进程主管；部署必须无重叠，营销 executor singleton 会拒绝第二执行器。
- 只保留当前 30 天活动快照，不做历史仓库。
- 第一版完整返回推广计划列表，不分页；真实规模超限即重新设计。
- 多账户项目仍保留，但项目刷新采用全有或全无。

实现阻塞项：

- Token `grantType` 冲突、refresh 轮换与响应丢失重放的真实验证；
- 金额币种/scale、报告时区和延迟口径的正式证据及百度后台同口径核对；
- 搜索报表与百度统计的真实错误响应和重试语义；
- 现有 `CONFIG_ENCRYPTION_KEY` 的生产保管和泄露后全量重授权流程。

## 19. 2026-07-30 白名单真实数据试点

- `baidu-marketing-pilot-2026-07-30` 固化真实 OAuth、账户目录、4 页搜索报表、百度统计站点目录和趋势响应结构；所有本地 fixture 均使用合成账户名、域名、ID 和指标。
- 搜索报表严格校验 `rowCount/totalRowCount`、账户、计划、日期和指标类型，消费按试点 `CNY`、2 位小数转为精确字符串；超精度直接拒绝。
- 百度统计只选择当前授权主体下唯一正常站点，读取 `trend/time/a` 的 PV、访问次数和 UV；`--` 保留为无数据，不转换为 0。该数据在试点阶段实时读取，不进入搜索广告原子快照。
- 服务器 Token 不删除、不导出；本地开发只使用脱敏 fixture。`PILOT_DATA_READY` 不等于正式 `READY`，正式导航继续隐藏。

## 18. 后续来源边界

落地页 API 开放后只接原始咨询；销售 API 开放后只接订单和订单签订金额。两个来源没有统一 ID 时，由用户为订单选择一条主要归因咨询。该能力不在本期建表、不在本期 API 返回占位对象，也不以官网访问量、有效商机、毛利或模拟数据代替。
