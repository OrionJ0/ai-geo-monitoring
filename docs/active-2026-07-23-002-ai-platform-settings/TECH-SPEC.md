---
title: 全局 AI 平台设置中心技术方案
date: 2026-07-23
status: active
source: docs/active-2026-07-23-002-ai-platform-settings/prd.md
scope: deep
---

# 全局 AI 平台设置中心技术方案

## 1. 背景与目标

当前 AI 平台配置由 `backend/services/AIPlatformService.js` 在进程启动时读取环境变量，并在多个后端服务和前端页面中硬编码平台列表。管理员只能通过 `/admin/platforms` 查看密钥是否存在，无法维护配置；运行前检查又把“没有启用问题”和“平台不可用”合并成同一提示。

本方案将数据库设为 AI 平台运行配置的唯一正式来源，在 `/admin/settings` 提供全局管理页面，并让单问题、问题集、项目和定时任务共用同一套平台解析、错误语义和运行参数。正式切换后不再读取平台 API Key、Base URL、模型或运行参数环境变量；环境仅保留加密主密钥、私网精确白名单和网络代理等部署级能力。

## 2. 范围与非目标

### 范围

- 新增 AI 平台配置表，预置豆包与 DeepSeek 的非敏感基本信息。
- 使用环境级主密钥加密存储 API Key，所有读取接口只返回配置状态和末四位。
- 提供管理员平台增删改查、启停、清除密钥和主动连接测试接口。
- 提供登录用户可读的平台目录接口，供项目与问题表单动态选择。
- 将全局并发、重试、默认超时和默认最大 Token 存入现有 `settings` 表。
- 统一 OpenAI Chat Completions 和豆包 Responses 两类适配器。
- 将项目、问题、问题集、直接检测和定时任务运行切换到数据库配置。
- 保存每次实际运行使用的模型名称，并返回可运行/跳过平台的结构化摘要。
- 将 `/admin/platforms` 和 `GET /api/platforms/ping` 退役，设置中心成为唯一管理入口。

### 非目标

- 不自动导入 `.env` 中已有 AI 平台配置，也不提供运行时回退。
- 不支持用户级密钥、一个平台多个模型或任意 REST 字段模板。
- 不在管理页面开放代理、私网段或加密主密钥配置。
- 不实现在线轮换加密主密钥。

### 延后事项

- 多模型选择、成本统计、调用延迟趋势和平台级健康告警。
- 历史平台快照表；第一版由运行记录固化平台代码与模型名称。

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
- REQ-002：系统仅预置豆包与 DeepSeek 基本信息；预置密钥为空且默认启用。
- REQ-003：DeepSeek 初始默认模型必须为 `deepseek-v4-flash`。
- REQ-004：管理员可新增 `openai_chat_completions` 适配器平台，新平台默认启用。
- REQ-005：配置状态、启用状态与测试状态互相独立；连接测试不自动启停平台。
- REQ-006：更新时空 API Key 表示保留，清除密钥必须调用独立接口。
- REQ-007：新配置只能选择已启用、未归档且配置完整的平台；运行时允许部分成功。
- REQ-008：零可运行任务时不得扣配额、创建等待记录或发起平台请求。
- REQ-009：单问题、问题集、项目和调度器必须复用同一运行前解析结果。
- REQ-010：运行记录必须固化实际 `model_name`。
- CON-001：`CONFIG_ENCRYPTION_KEY` 是唯一允许的密钥解密根；缺失或无效时禁止保存、测试和运行密钥。
- CON-002：自定义 Base URL 默认仅允许公网 HTTPS；私网仅允许 `AI_PLATFORM_PRIVATE_HOST_ALLOWLIST` 中精确 `host:port`。
- CON-003：API 响应、应用日志和平台错误不得包含密钥、密文、认证头或供应商原始敏感正文。
- CON-004：全局并发 1–5、重试 0–3、超时 10–180 秒、最大 Token 256–32768。
- PAT-001：接口沿用 `{ success, message?, data? }`；业务校验返回 400，认证/权限沿用 401/403，服务端异常返回脱敏 500。
- PAT-002：平台代码创建后不可修改；只允许小写字母、数字和连字符，长度 2–50。
- PAT-003：预置平台不可归档，自定义平台采用软归档并保留历史显示能力。

## 5. 接口与数据契约

### 5.1 数据模型

新增 `ai_platform_configs`：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | INTEGER | 主键 |
| `code` | STRING(50) | 唯一、不可修改 |
| `name` | STRING(100) | 管理员可编辑 |
| `adapter_type` | STRING(50) | `doubao_responses` / `openai_chat_completions` |
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

`question_records.platform` 与 `visibility_metrics.platform` 从固定 ENUM 迁移为 `STRING(50)`；`question_records` 新增可空 `model_name STRING(255)`。已有记录保持原平台值，新增记录保存任意有效平台代码和实际模型。

### 5.2 管理接口

所有接口均要求管理员权限：

- `GET /api/admin/ai-platforms`：返回未归档平台列表。
- `POST /api/admin/ai-platforms`：新增自定义平台。
- `PUT /api/admin/ai-platforms/:id`：更新可编辑字段；`api_key` 缺失或空字符串均保留旧值。
- `PUT /api/admin/ai-platforms/:id/enabled`：只更新启用状态。
- `DELETE /api/admin/ai-platforms/:id/api-key`：清除密钥并重置测试状态。
- `DELETE /api/admin/ai-platforms/:id`：仅归档非预置平台。
- `POST /api/admin/ai-platforms/:id/test`：使用已保存配置发起最小请求并保存脱敏结果。

创建/更新输入：

```json
{
  "name": "Example AI",
  "code": "example-ai",
  "adapter_type": "openai_chat_completions",
  "base_url": "https://api.example.com/v1/chat/completions",
  "api_key": "仅写入，不回显",
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
- KTD-008：对固定平台 ENUM 执行显式启动迁移。SQLite 使用 `changeColumn`；PostgreSQL 先将列转换为 `VARCHAR(50)` 并移除旧 ENUM 类型依赖。迁移幂等执行后再启动调度器。
- KTD-009：平台名称可修改，因此历史报表以平台代码兜底显示；运行模型通过 `question_records.model_name` 固化。第一版不复制平台名称，归档平台仍保留数据库行供历史代码解析。
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

**验收方式：** 通过管理员 API 完成新增、编辑、启停、测试、清密钥和归档；登录用户目录只返回非敏感字段。

### U3. 设置中心前端

**目标：** `/admin/settings` 成为 AI 平台、运行设置和站点 SEO 的唯一管理页面。

**依赖：** U2。

**涉及文件：** `nextjs-frontend/src/app/admin/settings/page.tsx`、可拆分的同目录组件、`nextjs-frontend/src/app/admin/layout.tsx`、前端源码契约/工具测试。

**方案：** 默认打开 AI 平台页签；表格独立展示配置、启用和测试状态；抽屉或弹窗承载新增/编辑；API Key 输入留空提示“保留现有值”，清除使用 `Popconfirm`；运行设置使用数字控件的前后端双重范围校验；SEO 表单保留原数据流。

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

- AC-001：Given 新数据库，When 后端首次启动，Then 只写入豆包与 DeepSeek 基本信息，API Key 均为空且默认启用。
- AC-002：Given 环境中存在旧平台 API Key，When 初始化预置，Then 数据库仍不导入该密钥。
- AC-003：Given 有效加密主密钥，When 管理员保存 API Key，Then 数据库存储密文且任何 API 不返回明文或密文。
- AC-004：Given 管理员未主动测试，When 启用平台，Then 平台保持启用且测试状态仍为未测试。
- AC-005：Given 管理员修改 URL、密钥或模型，When 更新成功，Then 测试状态重置为未测试。
- AC-006：Given 一个公网 HTTPS OpenAI 兼容地址，When 管理员新增平台，Then 平台默认启用并出现在动态目录。
- AC-007：Given 未列入白名单的私网地址，When 保存或测试，Then 请求被拒绝且未发出网络调用。
- AC-008：Given 问题集没有启用问题，When 运行，Then 返回 `no_enabled_questions` 且不扣配额、不建记录。
- AC-009：Given 豆包未配置、DeepSeek 可用，When 同时运行，Then DeepSeek 任务入队且响应明确提示豆包被跳过。
- AC-010：Given 所有候选平台不可用，When 运行，Then 响应逐项说明原因且零运行记录。
- AC-011：Given 管理员修改并发、重试和默认参数，When 下一次运行，Then 新值无需重启即生效，平台覆盖优先。
- AC-012：Given 自定义平台运行完成，When 查询历史，Then 平台代码与实际模型均被保留。
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

- 数据模型为加法式，代码回滚不删除 `ai_platform_configs` 或 `model_name` 数据。
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
- 风险：管理员归档仍被项目引用的平台。缓解：不删除行，运行时返回已归档/不可用原因；编辑项目时保留只读历史标签但要求重新选择后保存。
- 风险：供应商响应格式不一致。缓解：适配器边界校验响应，无法提取文本时返回 `invalid_provider_response`，不把原始响应透传给用户。
- 风险：全量切换期间旧文档误导。缓解：同一切片删除旧入口并更新 `README.md`、`docs/API.md`、`docs/ENVIRONMENT.md` 和项目规则中当前入口说明。

## 12. 假设与开放问题

- 假设豆包继续使用 Responses 风格接口，DeepSeek 与自定义平台使用 OpenAI Chat Completions 风格接口。
- 假设 `CONFIG_ENCRYPTION_KEY` 在单一部署环境中稳定且由部署系统保管；第一版不负责轮换。
- 产品开放问题已在 PRD 中关闭。若实际供应商拒绝最小测试提示词，仅调整适配器测试请求，不改变连接测试契约。

## 13. 后续衔接

- 可拆 issue：U1–U5 可分别成为按依赖顺序执行的实现 issue。
- 建议第一个实现单元：U1“平台配置持久化与安全边界”。
- 适合 TDD：是。优先以加密、URL 策略、管理接口和运行前解析的公共行为进行纵向 RED→GREEN。
