---
title: 全局 AI 平台设置中心技术方案
date: 2026-07-23
status: closed
source: docs/closed-2026-07-23-002-ai-platform-settings/prd.md
scope: deep
---

# 全局 AI 平台设置中心技术方案

## 1. 背景与目标

当前 AI 平台配置由 `backend/services/AIPlatformService.js` 在进程启动时读取环境变量，并在多个后端服务和前端页面中硬编码平台列表。管理员只能通过 `/admin/platforms` 查看密钥是否存在，无法维护配置；运行前检查又把“没有启用问题”和“平台不可用”合并成同一提示。

本方案将数据库设为 AI 平台运行配置的唯一正式来源，在 `/admin/settings` 提供全局管理页面，并让单问题、问题集、项目和定时任务共用同一套平台解析、错误语义和运行参数。正式切换后不再读取平台 API Key、Base URL、模型或运行参数环境变量；环境仅保留加密主密钥、私网精确白名单和网络代理等部署级能力。

## 2. 范围与非目标

### 范围

- 新增 AI 平台配置表，预置豆包、DeepSeek、千问与腾讯混元的非敏感基本信息。
- 使用环境级主密钥加密存储 API Key；列表和普通读取接口只返回配置状态和末四位，管理员可通过禁止缓存的专用接口主动显示单个平台密钥。
- 提供管理员平台增删改查、启停、清除密钥和主动连接测试接口。
- 提供登录用户可读的平台目录接口，供项目与问题表单动态选择。
- 将全局并发、重试、默认超时和默认最大 Token 存入现有 `settings` 表。
- 统一为 OpenAI Chat Completions 与 OpenAI Responses 两种协议适配器，不再把供应商名称写进调用类型。
- 将项目、问题、问题集、直接检测和定时任务运行切换到数据库配置。
- 保存每次实际运行使用的平台名称和模型名称，并返回可运行/跳过平台的结构化摘要。
- 将 `/admin/platforms` 和 `GET /api/platforms/ping` 退役，设置中心成为唯一管理入口。

### 非目标

- 不自动导入 `.env` 中已有 AI 平台配置，也不提供运行时回退。
- 不支持用户级密钥、一个平台多个模型或任意 REST 字段模板。
- 不在管理页面开放代理、私网段或加密主密钥配置。
- 不实现在线轮换加密主密钥。

### 延后事项

- 平台内持久化多模型配置、成本统计、调用延迟趋势和平台级健康告警。
- 独立历史平台快照表；第一版由运行记录固化平台代码、平台名称与模型名称。

## 3. 当前系统认知

### 相关入口

- 后端启动与自动建表：`backend/app.js`
- AI 请求：`backend/services/AIPlatformService.js`
- 平台过滤：`backend/services/PlatformSelectionService.js`
- 项目/问题集运行：`backend/services/ProjectRunService.js`、`backend/routes/geoProjects.js`
- 直接检测与定时任务：`backend/routes/detection.js`、`backend/routes/schedules.js`、`backend/services/SchedulerService.js`
- 管理设置：`backend/routes/settings.js`、`nextjs-frontend/src/app/admin/settings/page.tsx`
- 旧平台自检：`backend/routes/platforms.js`、`nextjs-frontend/src/app/admin/platforms/page.tsx`
- 平台选择表单：`nextjs-frontend/src/app/geo/projects/page.tsx`、`nextjs-frontend/src/app/geo/prompts/page.tsx`

### 现有数据流

1. `AIPlatformService` 构造时从 `DOUBAO_*`、`DEEPSEEK_*` 等环境变量生成静态 `platforms` 对象。
2. `ProjectRunService` 使用硬编码大陆平台与 `getAvailablePlatforms()` 构造问题 × 平台任务。
3. 构造不到任务时统一返回“没有可运行的启用问题，或监测平台暂不可用”。
4. 项目与问题表单只认识 `doubao`、`deepseek`，记录表中的平台字段也使用固定 ENUM。
5. 运行并发、重试、超时和最大 Token 分散在环境变量和服务常量中。

### 现有测试与模式

- 后端使用 Node `node:test`，已有路由安全测试、平台选择测试和项目运行服务测试。
- 前端使用源码契约测试和 CommonJS 工具单元测试，构建由 Next.js TypeScript 校验兜底。
- 数据库使用 Sequelize；启动时 `sequelize.sync()` 并通过幂等 `ensureColumn` 兼容已有实例，没有独立迁移框架。
- 管理接口使用 `adminRequired`，普通业务接口由挂载层的 `authRequired` 保护。

## 4. 需求、约束与规则

- REQ-001：数据库是平台名称、接口、模型、密钥、启用状态和运行参数的唯一正式来源。
- REQ-002：系统预置豆包、DeepSeek、千问与腾讯混元基本信息；预置密钥为空且默认启用。
- REQ-003：DeepSeek 初始默认模型必须为 `deepseek-v4-flash`。
- REQ-004：管理员可新增 `openai_chat_completions` 或 `openai_responses` 适配器平台，新平台默认启用。
- REQ-005：配置状态、启用状态与测试状态互相独立；连接测试不自动启停平台。
- REQ-006：更新时空 API Key 表示保留，清除密钥必须调用独立接口。
- REQ-007：新配置只能选择已启用、未归档且配置完整的平台；运行时允许部分成功。
- REQ-008：零可运行任务时不得扣配额、创建等待记录或发起平台请求。
- REQ-009：单问题、问题集、项目和调度器必须复用同一运行前解析结果。
- REQ-010：运行记录必须固化实际 `platform_name` 与 `model_name`。
- CON-001：`CONFIG_ENCRYPTION_KEY` 是唯一允许的密钥解密根；缺失或无效时禁止保存、测试和运行密钥。
- CON-002：自定义 Base URL 默认仅允许公网 HTTPS；私网仅允许 `AI_PLATFORM_PRIVATE_HOST_ALLOWLIST` 中精确 `host:port`。
- CON-003：API 响应、应用日志和平台错误不得包含密钥、密文、认证头或供应商原始敏感正文。
- CON-004：全局并发 1–5、重试 0–3、超时 10–180 秒、最大 Token 256–32768。
- PAT-001：接口沿用 `{ success, message?, data? }`；业务校验返回 400，认证/权限沿用 401/403，服务端异常返回脱敏 500。
- PAT-002：平台代码创建后不可修改；只允许小写字母、数字和连字符，长度 2–50。
- PAT-003：预置平台不可删除；自定义平台对外使用“删除”术语，内部软删除并保留历史显示能力。
- PAT-004：模型刷新只调用供应商 OpenAI 兼容 `/models`；成功时去重并完整返回，不做“常用/最新”启发式筛选，也不持久化目录。

## 5. 接口与数据契约

### 5.1 数据模型

新增 `ai_platform_configs`：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | INTEGER | 主键 |
| `code` | STRING(50) | 唯一、不可修改 |
| `name` | STRING(100) | 管理员可编辑 |
| `adapter_type` | STRING(50) | `openai_responses` / `openai_chat_completions` |
| `base_url` | STRING(2048) | 完整请求 URL，保存前执行网络边界校验 |
| `encrypted_api_key` | TEXT | AES-256-GCM 版本化密文，响应中永不返回 |
| `api_key_last4` | STRING(4) | 仅用于管理页提示 |
| `default_model` | STRING(255) | 每个平台一个默认模型 |
| `request_timeout_seconds` | INTEGER NULL | 空值表示继承全局设置 |
| `max_tokens` | INTEGER NULL | 空值表示继承全局设置 |
| `enabled` | BOOLEAN | 新建与预置均默认为 true |
| `builtin` | BOOLEAN | 预置平台为 true |
| `archived_at` | DATE NULL | 自定义平台软归档时间 |
| `test_status` | STRING(20) | `untested` / `success` / `failed` |
| `last_tested_at` | DATE NULL | 最近测试时间 |
| `last_test_error_code` | STRING(50) NULL | 归一化失败码 |
| `last_test_message` | STRING(255) NULL | 脱敏的人类可读结果 |

现有 `settings` 增加四个受控键：

- `ai_run_concurrency=2`
- `ai_retry_count=3`
- `ai_default_timeout_seconds=90`
- `ai_default_max_tokens=4096`

`question_records.platform` 与 `visibility_metrics.platform` 从固定 ENUM 迁移为 `STRING(50)`；`question_records` 新增可空 `platform_name STRING(100)` 与 `model_name STRING(255)`。已有记录保持原平台值，新增记录保存任意有效平台代码、运行时平台名称和实际模型。

### 5.2 管理接口

所有接口均要求管理员权限：

- `GET /api/admin/ai-platforms`：返回未归档平台列表。
- `POST /api/admin/ai-platforms`：新增自定义平台。
- `PUT /api/admin/ai-platforms/:id`：更新可编辑字段；`api_key` 缺失或空字符串均保留旧值。
- `PATCH /api/admin/ai-platforms/:id/enabled`：只更新启用状态。
- `GET /api/admin/ai-platforms/:id/models`：使用已保存密钥读取供应商模型列表，并合并当前默认模型。
- `GET /api/admin/ai-platforms/:id/api-key`：管理员主动显示单个平台密钥，响应使用 `Cache-Control: no-store`。
- `DELETE /api/admin/ai-platforms/:id/api-key`：清除密钥并重置测试状态。
- `DELETE /api/admin/ai-platforms/:id`：删除非预置平台；实现为软删除。
- `POST /api/admin/ai-platforms/:id/test`：使用已保存配置发起最小请求并保存脱敏结果。

创建/更新输入：

```json
{
  "name": "Example AI",
  "code": "example-ai",
  "adapter_type": "openai_chat_completions",
  "base_url": "https://api.example.com/v1/chat/completions",
  "api_key": "写入后默认不回显；管理员可通过专用操作主动显示",
  "default_model": "example-model",
  "request_timeout_seconds": null,
  "max_tokens": null,
  "enabled": true
}
```

平台读取输出不包含 `encrypted_api_key` 或 `api_key`，仅包含：

```json
{
  "id": 3,
  "code": "example-ai",
  "name": "Example AI",
  "adapter_type": "openai_chat_completions",
  "base_url": "https://api.example.com/v1/chat/completions",
  "default_model": "example-model",
  "request_timeout_seconds": null,
  "max_tokens": null,
  "enabled": true,
  "builtin": false,
  "configured": true,
  "api_key_last4": "1234",
  "test_status": "untested",
  "last_tested_at": null,
  "last_test_error_code": null,
  "last_test_message": null
}
```

运行设置继续使用 `GET/PUT /api/settings`，只扩展允许键，不改变 SEO 和现有系统设置字段。

### 5.3 登录用户平台目录

`GET /api/ai-platforms` 要求登录，返回未归档平台的非敏感选择信息：

- `code`、`name`
- `enabled`
- `configured`（密钥、Base URL、默认模型均完整）
- `selectable`（`enabled && configured`）
- `unavailable_reason`：`disabled` / `missing_api_key` / `missing_base_url` / `missing_model` / null

该接口不返回 Base URL、末四位、测试状态和任何密钥相关存储字段。

### 5.4 运行解析契约

运行入口把问题、项目平台范围与当前平台配置交给统一解析器，输出：

```json
{
  "targets": [{ "prompt_id": 1, "platform": "deepseek", "model_name": "deepseek-v4-flash" }],
  "skipped_platforms": [{ "platform": "doubao", "name": "豆包", "reason": "missing_api_key", "message": "豆包未配置 API Key" }],
  "error_code": null,
  "message": "已加入 1 个运行任务；豆包未配置 API Key，已跳过。"
}
```

零目标的优先级固定为：

1. 没有启用问题：`no_enabled_questions`。
2. 问题平台与项目范围无交集：`platform_scope_mismatch`。
3. 有候选平台但均不可用：按平台逐项返回 `disabled`、`missing_api_key`、`missing_base_url`、`missing_model` 或 `config_unavailable`。

HTTP 状态沿用 400；响应 `data` 必须携带 `error_code` 和 `skipped_platforms`，不使用合并式模糊提示。

### 5.5 平台调用错误

适配器只向上返回归一化错误：

- `authentication_failed`
- `rate_limited`
- `timeout`
- `network_error`
- `provider_error`
- `invalid_provider_response`
- `config_unavailable`

连接测试和正式运行共用 URL 校验、请求构造与错误归一化。运行服务负责把错误码转换成 PRD 中的中文提示。

## 6. 关键技术决策

- KTD-001：平台配置使用独立表而不是 JSON 设置项。平台需要唯一性、软归档、独立测试状态与局部更新，结构化表能避免并发覆盖和不可查询的大 JSON。
- KTD-002：API Key 使用 Node `crypto` 的 AES-256-GCM，密文格式包含版本、随机 IV、认证标签和数据；不新增第三方加密依赖。主密钥从 `CONFIG_ENCRYPTION_KEY` 解析为 32 字节材料，错误时 fail closed。
- KTD-003：请求前按平台代码即时读取数据库配置，不在长生命周期对象中缓存密钥。这样管理员保存后无需重启即可生效，也避免过期内存配置；平台目录等非敏感读取允许在单次请求内复用查询结果。
- KTD-004：预置初始化只使用代码常量写入名称、Base URL、适配器和模型，不读取平台环境变量。初始化采用 `findOrCreate`，不覆盖管理员后续修改。
- KTD-005：Base URL 保存与请求前双重校验。域名先解析全部 A/AAAA 地址，任何地址属于 loopback、link-local、私网或保留段即拒绝；只有精确白名单 `host:port` 可放行私网。重定向禁用，防止测试与运行时 SSRF 绕过。
- KTD-006：`AIPlatformService` 保留为唯一调用门面，但从静态环境配置重构为数据库配置 + 适配器注册表。上层不接触密钥和供应商请求细节。
- KTD-007：运行设置通过 `SettingsService` 解析为强类型快照，平台级超时和最大 Token 覆盖全局值；重试次数和并发始终使用全局设置。
- KTD-008：对固定平台 ENUM 执行显式启动迁移。SQLite 的既有 ENUM 实际存储为 TEXT，可直接接收动态代码；PostgreSQL 仅在列仍为 ENUM 时转换为 `VARCHAR(50)`。迁移幂等执行后再启动调度器，避免每次启动重复获取表级锁。
- KTD-009：平台名称和默认模型均可修改，因此通过 `question_records.platform_name` 与 `question_records.model_name` 固化运行时快照；平台代码仍作为历史兜底标识。
- KTD-010：正式切换采用硬切，不保留 `GET /api/platforms/ping`、静态 `platforms` 对象、旧管理页面或 AI 环境变量 fallback。

## 7. 实现切片

### U1. 平台配置持久化与安全边界

**目标：** 建立可安全保存、读取和初始化的平台配置基础。

**依赖：** 无。

**涉及文件：** `backend/models/AIPlatformConfig.js`、`backend/models/index.js`、`backend/services/SecretEncryptionService.js`、`backend/services/PlatformUrlPolicyService.js`、`backend/services/AIPlatformConfigService.js`、`backend/app.js`、对应 `backend/tests/*.test.js`。

**方案：** 先用公开服务接口测试预置数据不导入环境密钥、密钥加密往返、脱敏序列化和 URL 策略，再实现模型、服务和启动初始化。初始化失败不创建半成品密钥；缺失主密钥不影响无密钥预置和普通页面启动。

**测试场景：** 两个预置平台字段正确；DeepSeek 模型正确；已有行不被覆盖；明文不落库；错误主密钥不能解密；公网 HTTPS 放行；HTTP、凭据 URL、私网和解析到私网的域名拒绝；精确白名单放行。

**验收方式：** 新数据库启动后存在两个未配置且启用的预置平台，数据库与接口中均不存在 `.env` 平台密钥明文。

### U2. 管理 API、运行设置与连接测试

**目标：** 管理员能完整维护平台和运行参数，普通用户只能读取安全目录。

**依赖：** U1。

**涉及文件：** `backend/routes/adminAIPlatforms.js`、`backend/routes/aiPlatforms.js`、`backend/routes/settings.js`、`backend/services/AIPlatformService.js`、`backend/app.js`、对应路由与服务测试。

**方案：** 管理接口统一调用配置服务并做字段级校验；连接测试通过调用门面发起最小生成请求。适配器输出统一响应文本、响应耗时、实际模型或归一化错误，不保存供应商原始正文。

**测试场景：** 非管理员拒绝；新增默认启用；代码重复/非法 URL/参数越界拒绝；空密钥保留；单独清除；关键字段变化重置测试状态；测试不改变启用状态；读取接口不泄露秘密；设置边界值正确。

**验收方式：** 通过管理员 API 完成新增、编辑、启停、测试、模型读取、主动显示/清除密钥和删除；登录用户目录只返回非敏感字段。

### U3. 设置中心前端

**目标：** `/admin/settings` 成为 AI 平台、运行设置和站点 SEO 的唯一管理页面。

**依赖：** U2。

**涉及文件：** `nextjs-frontend/src/app/admin/settings/page.tsx`、可拆分的同目录组件、`nextjs-frontend/src/app/admin/layout.tsx`、前端源码契约/工具测试。

**方案：** 默认打开 AI 平台页签；表格把接口参数与当前模型拆成独立列，弹窗只编辑当前默认模型，不刷新模型目录；API Key 输入留空提示“保留现有值”，主动显示使用管理员专用接口，清除使用 `Popconfirm`；运行设置使用数字控件的前后端双重范围校验；AI 分析 API 页签单独刷新临时模型目录并分别保存分析平台和模型；SEO 表单保留原数据流。

**测试场景：** 三页签存在；旧 SEO 字段仍能读写；新增平台默认启用；密钥不回填；停用平台仍能测试；清密钥二次确认；API 错误使用统一错误提取。

**验收方式：** 管理员从一个页面完成全部设置操作，浏览器网络响应和页面状态不出现密钥明文。

### U4. 动态平台目录与运行前解析

**目标：** 项目、单问题和问题集不再依赖硬编码平台列表，并返回准确的可运行性结果。

**依赖：** U2。

**涉及文件：** `backend/services/PlatformSelectionService.js`、`backend/services/ProjectRunService.js`、`backend/routes/geoProjects.js`、`nextjs-frontend/src/app/geo/projects/page.tsx`、`nextjs-frontend/src/app/geo/prompts/page.tsx`、共享平台目录 hook/utility、对应测试。

**方案：** 表单启动时读取 `/api/ai-platforms`；不可选择项仍展示原因。历史项目中的未知或已归档代码只读显示，不进入新保存值。运行前一次加载平台配置快照，构造 targets 和 skipped_platforms，再扣精确目标数量的配额。

**测试场景：** 自定义平台可选择；未配置平台禁选；已停用/归档不能新选；无启用问题、范围不匹配、平台缺密钥分别报错；部分平台可用时继续创建任务并返回跳过摘要；全不可用时不扣配额、不创建记录。

**验收方式：** 问题库单问题、问题集和项目页都能选择数据库中新建的平台，错误提示不再使用合并文案。

### U5. 正式运行硬切与历史模型固化

**目标：** 所有正式运行入口使用数据库配置，并彻底退役旧平台路径。

**依赖：** U1–U4。

**涉及文件：** `backend/services/AIPlatformService.js`、`backend/services/ProjectRunService.js`、`backend/services/SchedulerService.js`、`backend/routes/detection.js`、`backend/routes/schedules.js`、`backend/routes/statistics.js`、平台相关分析/报表服务、`backend/models/QuestionRecord.js`、`backend/models/VisibilityMetric.js`、`backend/app.js`、前后端历史显示与测试。

**方案：** 所有调用门面接收平台代码，由门面读取/解密数据库配置；并发与重试读取强类型设置。记录创建时写入当前模型。删除环境平台对象、固定平台过滤、旧 ping 路由和管理页；文档改为数据库配置入口，环境文档只保留部署级变量。

**测试场景：** 数据库配置更新后无需重启生效；无 `DOUBAO_API_KEY`/`DEEPSEEK_API_KEY` 读取；直接检测、单问题、问题集、项目、调度器均走新门面；历史记录展示实际模型；旧接口返回 404，旧菜单和页面不存在。

**验收方式：** 从真实登录入口手工配置 DeepSeek，运行单问题和问题集并确认记录模型；代码搜索不存在旧环境读取和正式调用引用。

## 8. 验收标准

- AC-001：Given 新数据库，When 后端首次启动，Then 写入豆包、DeepSeek、千问与腾讯混元基本信息，API Key 均为空且默认启用。
- AC-002：Given 环境中存在旧平台 API Key，When 初始化预置，Then 数据库仍不导入该密钥。
- AC-003：Given 有效加密主密钥，When 管理员保存 API Key，Then 数据库存储密文，列表与普通 API 不返回明文或密文；只有管理员主动显示单个平台密钥时返回明文且禁止缓存。
- AC-004：Given 管理员未主动测试，When 启用平台，Then 平台保持启用且测试状态仍为未测试。
- AC-005：Given 管理员修改 URL、密钥或模型，When 更新成功，Then 测试状态重置为未测试。
- AC-006：Given 一个公网 HTTPS OpenAI 兼容地址，When 管理员新增平台，Then 平台默认启用并出现在动态目录。
- AC-007：Given 未列入白名单的私网地址，When 保存或测试，Then 请求被拒绝且未发出网络调用。
- AC-008：Given 问题集没有启用问题，When 运行，Then 返回 `no_enabled_questions` 且不扣配额、不建记录。
- AC-009：Given 豆包未配置、DeepSeek 可用，When 同时运行，Then DeepSeek 任务入队且响应明确提示豆包被跳过。
- AC-010：Given 所有候选平台不可用，When 运行，Then 响应逐项说明原因且零运行记录。
- AC-011：Given 管理员修改并发、重试和默认参数，When 下一次运行，Then 新值无需重启即生效，平台覆盖优先。
- AC-012：Given 自定义平台运行完成，When 查询历史，Then 平台代码、运行时平台名称与实际模型均被保留。
- AC-013：Given 正式切换完成，When 搜索或调用旧入口，Then 不存在平台密钥环境变量读取、`/api/platforms/ping` 或 `/admin/platforms`。
- AC-014：Given 管理员访问 `/admin/settings`，When 切换页签，Then AI 平台、运行设置和站点 SEO 都能正常读写。

## 9. 测试与验证计划

- 单元测试：加密格式与错误路径、URL/解析地址策略、设置范围、适配器请求与响应解析、错误归一化、运行目标与跳过原因。
- 集成测试：管理员权限和平台 CRUD；密钥写入/保留/清除；连接测试状态；公共目录脱敏；部分成功与零目标不扣配额。
- 迁移测试：临时 SQLite 数据库从既有 schema 启动，验证平台列允许自定义代码、旧记录保留、新列可写。
- 前端契约测试：管理菜单、三页签、动态平台接口、旧页面和旧 ping 调用消失。
- 构建：后端全量 `node:test`、前端 lint 和生产构建均通过。
- 手工验证：从管理员登录 → 保存 DeepSeek → 可选连接测试 → 普通用户创建/编辑项目与问题 → 运行单问题和问题集 → 查看运行与历史模型。
- 安全证据：检查数据库/API 响应/应用日志不含测试密钥；对 localhost、RFC1918、IPv6 loopback 与 DNS 私网解析执行拒绝测试。
- 正式入口证据：在未配置任何旧 AI 环境变量的进程中，从 HTTP API 完成一次真实运行；旧接口返回 404。

## 10. 发布、回滚与观测

### 发布顺序

1. 部署前生成并安全注入 `CONFIG_ENCRYPTION_KEY`。
2. 启动时完成表创建、平台字段迁移、预置平台和默认运行设置初始化。
3. 管理员在设置中心人工填写平台 API Key；系统不读取旧环境变量。
4. 验证连接和单问题真实运行后，启用定时任务。

### 回滚边界

- 数据模型为加法式，代码回滚不删除 `ai_platform_configs`、`platform_name` 或 `model_name` 数据。
- 不通过恢复旧环境变量 fallback 回滚。若新链路故障，应停用受影响平台或修复新实现。
- 由于旧平台密钥不会自动迁移，正式发布前必须把“人工填写至少一个平台”列为运维前置条件。

### 观测

- 启动日志只记录预置创建/已存在，不记录密钥和完整配置。
- 运行完成日志记录项目、平台代码、模型、数量、耗时和归一化结果，不记录请求头与响应正文。
- 平台测试结果在数据库记录状态、时间和归一化错误码，供管理员页面查看。

## 11. 风险与缓解

- 风险：缺少 `CONFIG_ENCRYPTION_KEY` 导致管理员保存后才发现不可用。缓解：设置页和写接口明确返回“平台密钥加密未配置”，预置和无密钥读取仍可用。
- 风险：错误 URL 校验造成 SSRF。缓解：保存与调用双重校验、DNS 全量解析、禁重定向、私网精确白名单。
- 风险：PostgreSQL 固定 ENUM 阻止自定义平台写入。缓解：启动时显式转换为 `VARCHAR(50)`，并用迁移测试覆盖 SQLite 与 PostgreSQL SQL 分支。
- 风险：平台更新与运行并发导致同一批任务使用不同配置。缓解：一次运行开始时加载配置快照，并把模型写入每条目标记录。
- 风险：管理员停用或归档仍被项目引用的平台。缓解：不物理删除配置；项目编辑保留既有平台代码，运行时明确跳过并返回原因，只有新增选择受当前可选目录限制。
- 风险：供应商响应格式不一致。缓解：适配器边界校验响应，无法提取文本时返回 `invalid_provider_response`，不把原始响应透传给用户。
- 风险：全量切换期间旧文档误导。缓解：同一切片删除旧入口并更新 `README.md`、`docs/API.md`、`docs/ENVIRONMENT.md` 和项目规则中当前入口说明。

## 12. 假设与开放问题

- 豆包按火山方舟官方联网内容插件文档使用 Responses API。联网工具由请求适配器按需加入 `tools: [{"type":"web_search"}]`；不预设关键词数量等非必要参数。协议仍不由平台名称隐式决定，管理员可根据供应商文档选择 Chat Completions 或 Responses，系统只按 `adapter_type` 构造请求。
- 假设 `CONFIG_ENCRYPTION_KEY` 在单一部署环境中稳定且由部署系统保管；第一版不负责轮换。
- 产品开放问题已在 PRD 中关闭。若实际供应商拒绝最小测试提示词，仅调整适配器测试请求，不改变连接测试契约。

## 13. 后续衔接

- U1–U5 已按 TDD 完成代码实现并接入正式入口。
- 自动化证据：后端全量测试 486/486、前端工具测试 174/174、Node 语法检查、差异格式检查与 Next.js 生产构建均通过。
- 正式入口证据：重启当前本地后端后，管理员 `/admin/settings` 的 AI 平台表显示豆包、DeepSeek、千问和腾讯混元四个预设；既有千问连接信息保持不变，腾讯混元显示 TokenHub 地址、`hy3` 和“未配置”密钥状态。
- 历史验收中的“千问强制联网参数被接受即成功”结论已废止。OpenAI Chat Completions 兼容响应没有本次搜索的显式证明时只能标记为“无法验证”；千问需要切换到供应商支持的 Responses API，并从 `web_search_call.action.sources` 获取可核验来源。
- 真实供应商验收：千问 Chat Completions 调用只返回函数样式文本且没有搜索证据，系统正确标记为“证据不足”；切换 `qwen3.7-plus` 到 `openai_responses` 后，响应包含 `web_search_call.action.sources`，页面展示了测试输入、模型输出和含 18 个来源 URL 的供应商响应。

## 14. 2026-07-23 扩展：批量问题、请求参数与联网验证

### 14.1 需求补充

- 问题库继续保留单问题新增、编辑和单独运行。
- 新增批量问题入口，用户在文本框中按换行或中英文分号分隔问题；逗号不作为分隔符，避免拆坏自然语言问题。
- 单次最多提交 100 条；前端去除常见列表序号、空行和完全重复项，后端再次校验，并按规范化问题跳过库内及批次内重复项。
- “生成问题建议”暂时只从问题库界面隐藏，不删除后端能力和历史数据。
- 管理员可查看和编辑每个平台默认模型的额外请求体参数，格式为 JSON 对象。
- 连接测试与联网能力测试互相独立；联网测试必须区分成功、失败和证据不足，不以回答内容“看起来新”作为成功依据。
- 千问 Chat Completions 可配置 `enable_search: true` 与 `search_options.forced_search: true`，但成功响应本身不能证明实际联网，也不返回可提取来源。需要引用来源时，`qwen3.7-plus` 使用 OpenAI Responses 兼容协议和 `web_search` 工具。
- 豆包使用用户指定模型，并根据火山方舟官方文档改用 Responses API 的 `web_search` 工具；不再依赖 Chat Completions 是否默认联网。

### 14.2 批量新增接口

`POST /api/geo-projects/:projectId/prompts/batch`

```json
{
  "questions": ["问题一", "问题二"],
  "question_set_id": null,
  "tags": ["购买决策"],
  "platforms": ["qwen"],
  "enabled": true
}
```

创建与跳过结果：

```json
{
  "created_count": 2,
  "skipped_count": 1,
  "created": [{ "id": 1, "question": "问题一" }],
  "skipped": [{ "question": "重复问题", "reason": "duplicate" }]
}
```

项目、平台范围和问题集只校验一次；写入在同一数据库事务中完成。非法数组、空问题或超过 100 条时整批拒绝，不产生部分写入。

### 14.3 平台请求参数契约

`ai_platform_configs` 增加：

- `request_options JSON NOT NULL DEFAULT {}`：额外请求体参数。
- `web_search_test_status STRING(20)`：`untested` / `success` / `failed` / `inconclusive`。
- `last_web_search_tested_at`、`last_web_search_test_error_code`、`last_web_search_test_message`。

`request_options` 只接受普通 JSON 对象，序列化后不超过 16 KiB。为保证路由、鉴权和响应解析稳定，禁止覆盖 `model`、`messages`、`input`、`stream`、`max_tokens`、`max_output_tokens`，并递归拒绝 `__proto__`、`prototype`、`constructor`。

系统先生成协议默认请求体，再合并额外参数，最后写入受保护的模型、输入与 Token 字段。配置变化会同时把连接测试和联网测试重置为未测试。

OpenAI 兼容 Base URL 可填写 API 根地址或完整请求地址；请求层根据适配器补全唯一的 `/chat/completions` 或 `/responses` 后缀，避免重复拼接。

### 14.4 联网能力检测

新增 `POST /api/admin/ai-platforms/:id/test-web-search`。测试使用平台当前保存的适配器、模型和请求参数发起一条明确要求联网的时效性问题，并从供应商原始结构中寻找可机读证据：

- `usage.plugins.search.count > 0`；
- Responses 输出中存在 `web_search_call` 等联网工具调用或结果项。

只有供应商响应中存在搜索元数据或联网工具调用时为 `success`；调用失败为 `failed`；生成成功但没有上述证据为 `inconclusive`。强制联网参数被服务端接受不算证据。HTTP 响应临时返回并在设置页展示本次输入、模型文本和供应商原始响应；数据库不保存这些临时内容，只保存脱敏状态、时间、证据类型或归一化错误码。

千问 `qwen3.7-plus` 使用 `openai_responses` 适配器时，请求层发送 `tools: [{"type":"web_search"}]`，并从 `output[type=web_search_call].action.sources` 提取引用 URL。AI 结构化分析调用会显式移除联网工具和监测请求参数，避免分析过程产生额外搜索。

### 14.5 新增验收标准

- AC-015：Given 多行与分号混合文本，When 批量新增，Then 问题正确拆分且含逗号的自然语言保持完整。
- AC-016：Given 批次内或库内存在规范化重复问题，When 批量新增，Then 重复项被明确跳过，其余问题一次创建成功。
- AC-017：Given 问题库页面，When 加载，Then 单问题和批量新增同时可用，“生成问题建议”不可见，按钮不再受全局黑色背景污染。
- AC-018：Given 千问根 Base URL和 `openai_responses` 适配器，When 发起联网调用，Then 请求发送到唯一的 `/responses` 路径，携带 `web_search` 工具，并可从 `web_search_call.action.sources` 提取来源。
- AC-019：Given 管理员保存额外请求参数，When 正式运行或测试，Then 使用同一参数且接口不返回 API Key。
- AC-020：Given 模型生成成功但没有搜索调用证据，When 检测联网能力，Then 显示“证据不足”而不是误报成功。
- AC-021：Given 管理员检测联网能力，When 测试完成，Then 页面展示本次输入、模型输出与供应商响应体，且数据库只保留简短状态。

## 15. 2026-07-23 扩展：提示词可见、临时模型目录与协议收敛

### 15.1 分析提示词

- `AIResponseAnalysisService.getPromptDefinition()` 与正式 `buildPrompt()` 共用同一模板生成逻辑。
- `GET /api/settings/analysis-api/prompt` 仅允许管理员读取，返回 `version`、带运行时占位符的 `template`、`runtime_fields` 和 `expected_output`。
- 设置页只读展示模板和期望 JSON。提示词仍由代码版本管理，本次不开放在线编辑，避免未验证修改直接改变历史指标口径。

### 15.2 模型目录

- `GET /api/admin/ai-platforms/:id/models` 使用已保存的 Base URL 与 API Key，按 OpenAI 模型目录契约请求根路径下的 `GET /models`。
- 成功响应统一为 `models`、`current_model`、`source: "provider_api"`、`persisted: false`。目录本身不写数据库，只有管理员保存的平台默认模型或分析模型会持久化。
- 供应商没有返回任何有效模型 ID 时必须报错，不能用已保存模型伪装成刷新成功。前端保留当前值；AI 平台弹窗允许手工填写平台默认模型，但不提供模型刷新按钮。
- DeepSeek 与标准 OpenAI 明确支持该模型目录契约；其他 OpenAI 兼容供应商是否实现 `/models` 由其服务端决定。静态官网模型页或“可部署模型”管控接口不冒充当前 API Key 可调用目录。

### 15.3 调用类型

- 内部只保留 `openai_chat_completions` 与 `openai_responses` 两种协议类型。
- 供应商名称不决定协议；豆包、千问和自定义平台均按所选协议构造 `/chat/completions` 或 `/responses` 请求。
- 启动时把历史 `doubao_responses` 记录硬迁移为 `openai_responses`，不再保留旧类型作为运行时 fallback。
- 两种类型不能进一步合成一套请求体：二者虽然都属于 OpenAI API 家族，但端点、输入字段、Token 字段和搜索工具返回结构不同。

### 15.4 结构化分析协议 v2

- 分析模型只返回 `entities`、`target_entity_name`、`competitor_matches`、`mentions`、`candidate_lists`、`recommendations`、`claims` 和 `sentiment`，不得返回次数、排名数字、比例、SOV 或综合分数。
- `entities` 必须覆盖回答中出现的全部品牌与公司；每个实体必须至少对应一个可以在原回答按顺序定位的短 `surface_forms`。不保存完整句子副本。
- 目标品牌和已配置竞品由分析模型显式映射到 `entities.name`。服务端只校验引用，不再使用名称包含关系或别名相似度猜测目标实体。
- 程序按目标实体的提及行数计算提及次数，按明确推荐关系计算是否推荐，按首个 `ordered=true` 候选数组的下标计算排名；仅配置竞品时计算 SOV。
- `claims` 是待核验事实声明，不代表事实正确。未接入已审核事实库前不计算事实正确率。
- 引用数量、来源清单、官网引用次数和是否引用官网由 `CitationAnalysisService` 从监测平台原始响应及可核验 URL 直接提取，并合并到 `analysis_structure.citations`；分析模型不参与引用判断。
- 新运行写入 `analysis_structure`，历史 `ai_structured_v1` 的 `analysis_evidence` 只读兼容，不作为 v2 回退。

### 15.5 验证证据

- 自动化：后端 `484/484`、前端工具测试 `173/173` 通过；改动设置页和问题集报告页 ESLint 通过；Next.js 生产构建通过。
- 全量 ESLint 仍有项目既存的 `.cjs` 测试文件 `require()` 规则错误，与本功能无关，生产构建不受影响。
- HTTP 入口：重启 `localhost:3002` 后健康检查成功，启动迁移把数据库中豆包的 `doubao_responses` 改为 `openai_responses`。
- 页面入口：`/admin/settings` 同时显示版本化分析提示词、期望 JSON 和当前调用协议；只有“AI 分析 API”页签提供模型目录刷新，刷新成功后立即展开包含本次临时目录的下拉框。
- 真实供应商：通过设置页使用当前已保存密钥调用模型目录，DeepSeek 返回 2 个模型、火山方舟返回 126 个模型、千问返回 229 个模型；页面明确提示本次目录不保存，只有最终选择的分析模型会持久化。
- 表单绑定：AI 平台表格分列显示接口参数与当前模型，平台弹窗只编辑当前模型；分析模型通过内部 `noStyle Form.Item` 绑定选择控件，页面重新加载后能正确显示已保存模型。
- 真实结构化入口：`/admin/settings` 使用已保存的 DeepSeek `deepseek-v4-pro` 对三品牌示例完成 v2 测试，模型显式返回 `target_entity_name: "上海广拓"`，程序派生提及 1 次、明确推荐和第 3 名；原始 JSON 未返回次数、排名数字、比例或分数。
