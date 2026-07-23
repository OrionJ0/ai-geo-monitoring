# AI 平台设置中心设计方案

## 1. 背景

当前 AI 平台名称、接口地址、模型和 API Key 由后端环境变量与静态代码共同决定。管理员只能在“平台自检”页查看是否配置，不能在页面中新增、修改或测试平台。运行失败时，平台未配置、平台停用、问题未启用等不同原因还可能共用同一条提示，难以定位问题。

本方案将 AI 平台配置迁移到管理员设置中心，由数据库成为唯一正式配置来源，并支持预设平台和 OpenAI 兼容自定义平台。

## 2. 目标

- 管理员可在 `/admin/settings` 管理全局 AI 平台。
- 预设豆包和 DeepSeek 的基本信息，但 API Key 必须由管理员手动填写。
- 支持新增 OpenAI Chat Completions 兼容平台。
- 新增平台默认启用；连接测试保留，但是否测试由管理员决定。
- API Key 加密存储，任何读取接口均不返回明文。
- 项目、单问题、问题集和定时任务统一读取数据库平台配置。
- 运行时准确区分无启用问题、平台范围冲突、平台未配置、平台停用和平台调用失败。
- 自定义接口默认只允许公网 HTTPS；本机或私网地址必须由部署环境显式加入白名单。

## 3. 非目标

- 第一版不支持每个用户保存自己的 API Key。
- 不自动导入 `.env` 中已有的 AI API Key。
- 不保留 `.env` AI API Key 作为运行时 fallback。
- 第一版不支持一个平台同时维护多个可选模型；每个平台只有一个默认模型。
- 第一版不开放 Temperature、Top P 等高级采样参数。
- 第一版不设计任意 REST 请求字段映射，只支持已实现的适配器类型。

## 4. 已确认产品决策

- 平台配置为管理员全局配置。
- 设置中心位于管理员后台 `/admin/settings`。
- 设置中心包含“AI 平台”“运行设置”“站点 SEO”三个页签；站点 SEO 仅承接现有功能。
- 预设平台只包含名称、标识、接口类型、Base URL 和默认模型，不包含密钥。
- DeepSeek 预设默认模型为 `deepseek-v4-flash`。
- 新增平台保存后默认启用，不强制先测试连接。
- 平台启用状态和连接测试状态相互独立。
- 全局管理并发数和重试次数；平台可覆盖请求超时和最大 Token。
- 可运行的平台继续执行，不可运行的平台明确跳过；不能静默丢弃。

## 5. 页面信息架构

### 5.1 AI 平台页签

列表字段：

- 平台名称
- 唯一标识
- 接口类型
- Base URL
- 默认模型
- 配置状态：`未配置`、`已配置`
- 启用状态：`已启用`、`已停用`
- 测试状态：`未测试`、`测试成功`、`测试失败`
- 最近测试时间
- 操作：编辑、测试连接、启停、清除密钥、归档

预设平台不可删除或归档，但允许编辑 Base URL、默认模型、API Key、超时、最大 Token 和启用状态。自定义平台允许归档；被项目或历史任务引用的平台不得物理删除。

### 5.2 新增与编辑表单

- 平台名称：必填，最长 120 字符。
- 唯一标识：必填，长度 2–50，只允许小写字母、数字、短横线和下划线，创建后不可修改。
- 接口类型：`ark_responses` 或 `openai_chat_completions`。
- Base URL：必填，由适配器补充最终请求路径。
- API Key：新增时可留空；编辑时留空代表保留原值。
- 默认模型：必填。
- 请求超时：可选，未填使用全局默认值。
- 最大 Token：可选，未填使用全局默认值。
- 是否启用：新增时默认为启用。

“清除密钥”使用独立操作并二次确认，避免把空输入误解为删除密钥。

连接测试不受启用状态限制，但要求 Base URL、API Key 和默认模型完整。修改 Base URL、API Key 或默认模型后，测试状态自动重置为“未测试”，避免继续展示已经失效的成功结论。

### 5.3 运行设置页签

- 并发问题数：范围 1–5，默认 2。
- 失败重试次数：范围 0–3，默认 3。
- 默认请求超时：范围 10–180 秒，默认 90 秒。
- 默认最大 Token：范围 256–32768，默认 4096。

平台级请求超时和最大 Token 优先于全局默认值。

### 5.4 站点 SEO 页签

保留当前站点标题、Meta Description、Meta Keywords 和 Robots 配置，不在本需求中改变其业务含义。

原 `/admin/platforms` 页面在正式切换后删除，菜单“平台自检”同步移除。

## 6. 数据模型

新增 `ai_platform_configs` 表：

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `code` | 平台唯一标识，创建后不可修改，唯一索引 |
| `name` | 平台显示名称 |
| `adapter_type` | `ark_responses` 或 `openai_chat_completions` |
| `base_url` | 平台接口基础地址 |
| `encrypted_api_key` | 加密后的 API Key，可为空 |
| `api_key_last4` | 密钥末 4 位，仅用于管理员辨识 |
| `default_model` | 当前默认模型 |
| `enabled` | 是否允许进入运行解析流程，默认 `true` |
| `timeout_ms` | 平台级超时覆盖，可为空 |
| `max_tokens` | 平台级 Token 上限覆盖，可为空 |
| `last_test_status` | `untested`、`passed`、`failed` |
| `last_test_message` | 脱敏后的最近测试结论 |
| `last_tested_at` | 最近测试时间 |
| `is_preset` | 是否为系统预设平台 |
| `archived_at` | 自定义平台归档时间 |
| `created_by` / `updated_by` | 管理员用户 ID |
| `created_at` / `updated_at` | 时间戳 |

运行设置继续存储在现有 `settings` 表，新增受白名单和类型校验保护的键：

- `ai_run_concurrency`
- `ai_retry_count`
- `ai_default_timeout_ms`
- `ai_default_max_tokens`

新产生的运行记录应保存 `platform` 平台标识和 `model_name` 快照。平台或模型后来被修改时，历史结果仍能说明当时实际使用的模型。

## 7. 预设平台

数据库迁移只写入非敏感元数据：

### 豆包

- `code`: `doubao`
- `adapter_type`: `ark_responses`
- `base_url`: `https://ark.cn-beijing.volces.com/api/v3`
- `default_model`: `doubao-seed-1-6-250615`
- `enabled`: `true`
- API Key：空

### DeepSeek

- `code`: `deepseek`
- `adapter_type`: `openai_chat_completions`
- `base_url`: `https://api.deepseek.com/v1`
- `default_model`: `deepseek-v4-flash`
- `enabled`: `true`
- API Key：空

迁移不读取 `DOUBAO_API_KEY`、`DEEPSEEK_API_KEY` 或其他 AI 平台环境变量。升级完成后，管理员必须在页面中人工填写密钥。

## 8. API 契约

### 8.1 管理接口

- `GET /api/admin/ai-platforms`
- `POST /api/admin/ai-platforms`
- `PATCH /api/admin/ai-platforms/:id`
- `DELETE /api/admin/ai-platforms/:id`：归档自定义平台
- `POST /api/admin/ai-platforms/:id/test`
- `POST /api/admin/ai-platforms/:id/clear-secret`
- `GET /api/admin/runtime-settings`
- `PATCH /api/admin/runtime-settings`

以上接口全部使用 `adminRequired`。平台读取响应只返回：

- `has_api_key`
- `api_key_last4`
- 配置、启用和测试状态

不得返回 `encrypted_api_key`、解密后的密钥或 Authorization 请求头。

`PATCH` 请求中不提供 `api_key` 表示保留原密钥；提供非空 `api_key` 表示替换。清除密钥只能调用独立接口。

连接测试是一次主动操作。测试请求完成但供应商不可用时，接口仍返回成功处理的测试结果，`data.status` 为 `failed`；只有本系统无法执行测试时才返回 4xx/5xx。

### 8.2 业务只读接口

- `GET /api/ai-platforms`

返回已启用、未归档平台的：

- `code`
- `name`
- `runnable`
- `unavailable_reason`

项目和问题表单由该接口动态生成平台选项。未配置密钥的平台可显示但不可选择，并标记“管理员尚未配置”。

### 8.3 错误响应

保持现有响应兼容，同时新增机器可读错误码：

```json
{
  "success": false,
  "code": "NO_RUNNABLE_PLATFORMS",
  "message": "豆包、DeepSeek 均未配置 API Key，当前没有可运行的监测平台。",
  "details": {
    "platforms": ["doubao", "deepseek"]
  }
}
```

已有消费者仍可读取 `message`，新界面优先根据 `code` 展示操作建议。

## 9. 运行时架构

将当前静态 `AIPlatformService.platforms` 拆为三个边界：

1. `AIPlatformConfigRepository`：读取、校验和解密数据库配置。
2. `AIPlatformAdapterRegistry`：按 `adapter_type` 构造豆包 Responses 或 OpenAI Chat Completions 请求。
3. `AIPlatformRuntimeService`：解析可运行目标、执行重试、调用适配器并输出统一结果。

单问题、问题集、整个项目和定时任务必须走同一个目标解析流程：

1. 筛选启用问题。
2. 计算项目与问题的平台交集。
3. 加载对应数据库配置。
4. 分类已停用、已归档、未配置密钥和配置不完整的平台。
5. 为可用的问题 × 平台生成运行目标。
6. 可运行目标入队；不可运行目标以结构化警告返回。

部分成功时返回 `202 Accepted`：

```json
{
  "success": true,
  "message": "已加入 2 个运行任务；豆包未配置 API Key，已跳过。",
  "data": {
    "queued": 2,
    "skipped_platforms": [
      {
        "platform": "doubao",
        "code": "PLATFORM_NOT_CONFIGURED",
        "message": "豆包未配置 API Key"
      }
    ]
  }
}
```

没有任何可运行目标时不消费配额、不创建 pending 记录。

## 10. 错误语义

| 错误码 | 用户提示 |
| --- | --- |
| `NO_ENABLED_QUESTIONS` | 问题集中没有启用的问题。 |
| `PLATFORM_SCOPE_MISMATCH` | 问题选择的平台不在当前项目的监测范围内。 |
| `NO_RUNNABLE_PLATFORMS` | 列出所有未配置或不可用平台，说明当前无法运行。 |
| `PLATFORM_NOT_CONFIGURED` | 明确指出平台尚未配置 API Key。 |
| `PLATFORM_DISABLED` | 问题选择的监测平台已被管理员停用。 |
| `PLATFORM_CONFIG_INVALID` | 明确指出平台缺少接口地址或默认模型。 |
| `CREDENTIAL_DECRYPTION_FAILED` | 监测平台配置暂不可用，请联系管理员。 |
| `PLATFORM_AUTH_FAILED` | 平台认证失败，请管理员检查 API Key。 |
| `PLATFORM_RATE_LIMITED` | 平台请求过于频繁，请稍后重试。 |
| `PLATFORM_TIMEOUT` | 平台请求超时，请稍后重试或调整超时设置。 |
| `PLATFORM_NETWORK_ERROR` | 无法连接监测平台，请检查网络或代理设置。 |
| `PLATFORM_PROVIDER_ERROR` | 平台服务暂时异常，请稍后重试。 |

供应商原始响应只用于服务端脱敏分类，不直接返回浏览器或写入运行记录。

## 11. 密钥安全

- `CONFIG_ENCRYPTION_KEY` 为唯一环境级加密主密钥，使用 Base64 编码的 32 字节随机值。
- API Key 使用 AES-256-GCM 加密，每次写入生成独立随机 IV，并保存密文版本、IV 和认证标签。
- 服务启动时校验加密主密钥格式；缺失或非法时，AI 平台配置和运行能力标记为不可用。
- 主密钥丢失时不能恢复已有 API Key，管理员必须重新填写；第一版不提供在线主密钥轮换。
- 密钥不写入日志、错误响应、测试报告、审计文本或前端状态。
- 管理员修改和清除密钥后，旧密文立即被覆盖或删除。

## 12. 自定义接口网络安全

- 默认只允许公网 HTTPS Base URL。
- 拒绝带用户名或密码的 URL。
- DNS 解析后拒绝本机、私网、链路本地、组播及保留地址。
- 每次重定向重新验证目标；限制重定向次数、响应体大小和超时时间。
- 连接测试与正式运行共用同一套安全客户端，不能只保护测试接口。
- 需要连接本地模型时，通过 `AI_PLATFORM_PRIVATE_HOST_ALLOWLIST` 配置精确的 `host:port` 白名单；只有命中白名单的目标才允许使用 HTTP。
- 白名单属于部署配置，不允许管理员在页面中自行放宽。

## 13. 迁移与正式切换

1. 创建平台配置表和运行记录模型快照字段。
2. 写入豆包、DeepSeek 非敏感预设元数据。
3. 上线管理员平台配置与连接测试。
4. 将项目和问题的平台选择改为动态接口。
5. 将单问题、问题集、项目批量运行和定时任务全部切换到数据库配置解析器。
6. 删除静态平台凭证读取、硬编码平台列表、旧 `/api/platforms/ping` 路由和旧管理员“平台自检”页面。
7. 更新 README、API、环境变量、部署和安全文档，删除把 AI API Key 写入 `.env` 作为当前正式流程的说明。
8. 使用代码搜索和入口级回归证明正式调用方不再读取 AI 平台环境变量。

切换期间不自动导入密钥，也不增加环境变量 fallback。管理员尚未人工配置密钥时，系统应明确显示“当前没有可运行的监测平台”。

## 14. 测试与验收

### 后端

- 预设平台迁移不包含 API Key。
- API Key 加密写入、解密使用、替换和清除测试。
- 管理接口认证与管理员权限测试。
- API 响应不泄露密文、明文或 Authorization 请求头。
- 平台字段、运行设置范围和唯一标识校验测试。
- 连接测试通过、认证失败、超时和供应商异常分类测试。
- 公网 URL、私网 URL、DNS 解析和重定向 SSRF 测试。
- 单问题、问题集、项目运行和定时任务使用同一动态配置解析器。
- 无可运行目标时不消费配额、不创建记录。
- 部分平台可用时继续入队并返回 `skipped_platforms`。

### 前端

- 管理员可新增、编辑、启停、测试和归档平台。
- 密钥字段不回显；留空保留，清除必须二次确认。
- 配置状态、启用状态和测试状态分别显示。
- 项目和问题的平台选项来自动态接口。
- 运行失败按错误码显示准确提示和管理员处理建议。
- 非管理员不能看到或访问平台管理功能。

### 正式入口验收

- 从 `/admin/settings` 人工配置 DeepSeek，并验证刷新后仍为已配置状态。
- 从设置页主动测试连接，验证成功与失败提示均脱敏。
- 从 `/geo/prompts` 分别运行单问题和问题集，证明使用数据库中的平台、Base URL、模型和密钥。
- 测试必须证明旧环境变量平台路径未被调用。
- 修改默认模型后，新记录保存新模型快照，旧历史记录保持原模型。

## 15. 建议实施切片

1. 平台表、加密服务、预设迁移与管理 API。
2. `/admin/settings` AI 平台与运行设置界面、连接测试。
3. 动态平台只读接口及项目、问题选择器迁移。
4. 单问题、问题集、项目和调度运行入口硬切。
5. 旧实现清理、完整回归、部署文档和入口级验收。

每个切片完成验证后独立提交；只有第 4、5 个切片完成，才能宣称数据库平台配置已经成为正式默认路径。
