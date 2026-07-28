---
title: 豆包 Web 可信监测技术方案
date: 2026-07-27
status: blocked
source: docs/active-2026-07-27-002-doubao-web-monitoring/prd.md
scope: deep
---

# 豆包 Web 可信监测技术方案

> 实施状态（2026-07-27）：注册表、隔离运行时、豆包 Adapter、统一登录命令、设置页账号管理、动态状态 API、正式项目/问题集/自动监测入口、多 Store 证据、平台默认值与双 FIFO 自动化验收已完成。登录验证已覆盖“深入研究”能力，匿名 Profile 会返回需要登录；设置页已区分“重新加载”与“验证登录”。`doubao-web` 仍默认关闭；目标 VM 的真实引用 DOM、人工登录恢复、双 Chrome 资源基线和正式入口验收未完成。

## 1. 背景与目标

本方案为市场部现有 GEO 监测流程新增托管平台 `doubao-web`，在目标虚拟机的真实豆包网页中完成新会话、强制联网搜索、回答与引用采集、截图留证，并复用现有单问题、问题集、失败重试、自动监测、分析、历史、报告和导出链路。

当前 DeepSeek Web 已具备可运行的网页采集链路，但浏览器生命周期、平台路由、证据存储、运行状态和登录脚本都直接绑定 `deepseek-web`。直接复制整套服务会形成两份难以同步的运行时、清理和关机逻辑，也会让正式调用方继续依赖 DeepSeek 单例。

技术目标：

- 将现有 Web 浏览器生命周期抽成可按平台实例化的受管运行内核。
- DeepSeek Web 和豆包 Web 各自拥有独立账号、Profile、浏览器、FIFO、熔断状态和证据目录。
- 使用平台注册表统一解析受管 Web 平台，消除正式调用链中的平台判断分支。
- 豆包页面行为由独立 Adapter 和版本化页面规则实现。
- 联网搜索状态无法验证时失败关闭，并保证问题尚未发送。
- 保持现有 `deepseek-web` 外部接口、配置身份、历史数据和运行语义兼容。
- 通过真实用户入口证明 `doubao-web` 走网页采集路径，任何失败均不调用 `doubao` API。

## 2. 范围与非目标

### 范围

- 受管 Web 平台注册表和可实例化运行内核。
- `doubao-web` 内置平台、能力声明、默认关闭和配置保护。
- 豆包专用环境变量、Profile、证据目录、Chrome 会话和 Profile 锁。
- 豆包页面登录预检、新会话、联网搜索、回答完成、引用和截图采集。
- 单问题、问题集、失败重试、项目自动监测的正式接入。
- 双 Web 独立 FIFO、跨平台并行、状态 API 和前端状态展示。
- 多证据目录的访问、删除、启动恢复和异常证据回收。
- 兼容现有分析、历史、报告、CSV/PDF 与引用 KPI 语义。
- 单元、集成、构建和目标虚拟机真实入口验收。
- 运行说明、环境变量和当前正式入口文档更新。

### 非目标

- 多豆包账号、账号池或单平台多浏览器并发。
- 自动输入账号密码、自动处理验证码或规避人工验证。
- 调用豆包网页未公开接口作为执行或取数路径。
- 保存或重放 Cookie、Authorization、完整响应体和完整请求头。
- 建设任意网站可配置的通用插件系统。
- 引入 Redis、BullMQ、独立 Worker、多后端实例或跨机器调度。
- 修改引用 KPI 的现有内部数据角色。
- 推断豆包网页背后的真实模型版本。
- 承诺精确队列位置或预计完成时间。

### 延后事项

- 跨 Web 平台的全局 CPU/内存资源调度。
- 豆包多账号和多实例容量扩展。
- 第三个 Web 平台出现后的公开插件契约。
- 页面版本、采集成功率和选择器故障趋势看板。

## 3. 当前系统认知

### 3.1 正式入口与数据流

当前正式运行链路为：

```text
问题库单问题 / 问题集 / 项目自动监测
  → ProjectRunService
  → AIPlatformService
  → WebPlatformService（DeepSeek 单例）
  → DeepSeekWebAdapter
  → WebCaptureStore
  → QuestionRecord / 分析 / 报告 / 历史 / 导出
```

相关入口：

- `backend/services/ProjectRunService.js`：统一任务执行、结果终态、分析重试及过期 Worker 证据回收。
- `backend/services/AIPlatformService.js`：按 `deepseek-web` 或 `deepseek_web` 路由到 Web 单例。
- `backend/services/AIPlatformConfigService.js`：内置平台、能力、启停和配置保护。
- `backend/services/QuestionSetRunService.js`：问题集报告、平台字段和引用证据语义。
- `backend/services/SchedulerService.js`：项目自动监测调度入口。

### 3.2 现有 Web 运行时

- `backend/services/WebPlatformService.js` 同时负责配置解析、Chrome 启动、Profile 锁、FIFO、预检缓存、熔断、Adapter 创建、证据目录和关闭回收。
- 该文件内部写死 DeepSeek URL、环境变量、选择器、文案、结果平台和 capture schema。
- `backend/services/DeepSeekWebAdapter.js` 同时包含通用采集状态机和 DeepSeek 页面交互实现。
- `backend/config/deepseekWebSelectors.js` 保存 DeepSeek 页面规则版本。
- `backend/scripts/deepseekWebLogin.js` 只接受 `deepseek-web`。

### 3.3 状态与前端

- `GET /api/ai-platforms/deepseek-web/runtime-status` 返回 DeepSeek 单平台状态。
- `backend/services/WebPlatformRuntimeStatusService.js` 写死平台代码、schema 和 Web 单例。
- `nextjs-frontend/src/components/DeepSeekWebRuntimeStatus.tsx`、对应 hook 和 presentation utility 写死 DeepSeek。
- 问题页和问题集报告页分别挂载同一个 DeepSeek 状态条。

### 3.4 证据生命周期

- `WebCaptureAccessService` 和 `WebCaptureDeletionService` 默认从 DeepSeek Web 单例取得唯一 `WebCaptureStore`。
- `ProjectRunService` 在终态栅栏拒绝或异常时直接调用 DeepSeek Web 单例清理新证据。
- `backend/app.js` 启动时只恢复一个 Web 证据目录。
- `ApplicationShutdownService` 关闭时只等待一个 Web 单例。

这些调用点若不迁移，豆包证据可能被读取、删除或恢复到错误目录，豆包浏览器也可能在应用关闭后残留。

### 3.5 数据与兼容基础

- `AIPlatformConfig.adapter_type` 为字符串，不需要数据库结构迁移即可增加 `doubao_web`。
- `QuestionRecord.platform`、运行报告和 CSV 已按平台代码保存，可自然容纳 `doubao-web`。
- `result_summary.web_capture` 为 JSON，可新增豆包 capture schema，无需新增业务表。
- 引用内部角色继续使用：
  - `explicit_citation`：平台引用，进入引用 KPI。
  - `response_link`：回答正文链接，不进入引用 KPI。
  - `retrieval_candidate`：检索候选，不进入引用 KPI。
- 用户可见文案统一显示“引用”或“引用源”，内部兼容字段不暴露为用户术语。

### 3.6 现有测试

主要回归入口：

- `backend/tests/WebPlatformService.test.js`
- `backend/tests/DeepSeekWebAdapter.test.js`
- `backend/tests/WebPlatformRuntimeStatusService.test.js`
- `backend/tests/WebPlatformRuntimeStatusDatabase.test.js`
- `backend/tests/AIPlatformConfigService.test.js`
- `backend/tests/AIPlatformService.test.js`
- `backend/tests/ProjectRunService.test.js`
- `backend/tests/QuestionSetRunStart.test.js`
- `backend/tests/QuestionSetRunService.test.js`
- `backend/tests/WebCaptureAccessService.test.js`
- `backend/tests/WebCaptureDeletionService.test.js`
- `backend/tests/ApplicationShutdownService.test.js`
- `nextjs-frontend/src/utils/deepSeekWebRuntimeStatus.test.cjs`

## 4. 需求、约束与规则

### 4.1 需求

- REQ-001：注册内置平台 `doubao-web`，与 `doubao` API 永久分离。
- REQ-002：`doubao-web` 默认关闭，不配置 API Key，不具备分析、模型目录、连接测试和旧入口能力。
- REQ-003：每条豆包 Web 问题必须创建新会话。
- REQ-004：每次发送前必须主动启用并读取页面状态确认联网搜索已开启。
- REQ-005：联网搜索状态不确定时必须在发送前失败。
- REQ-006：成功结果必须包含最终正文、联网状态证据、最终截图和有界采集信息。
- REQ-007：页面平台引用进入引用 KPI；普通正文链接和检索候选不进入。
- REQ-008：无平台引用是合法成功结果，引用数量为 `0`。
- REQ-009：豆包 Web 使用独立 Profile、证据目录、Chrome、FIFO、预检缓存和熔断状态。
- REQ-010：豆包 Web 与 DeepSeek Web 可以并行，各平台内部页面采集并发数为 1。
- REQ-011：单问题、问题集、重试和自动监测必须走同一个豆包 Web Adapter。
- REQ-012：豆包 Web 失败时 `doubao` API 调用次数必须为 0。
- REQ-013：豆包证据支持现有权限访问、删除、项目删除、启动恢复和过期 Worker 回收。
- REQ-014：已登录用户可以读取豆包 Web 独立运行状态。
- REQ-015：应用正常关闭时等待两个 Web 队列收敛并关闭两个浏览器。
- REQ-016：管理员可以在设置页读取两个受管 Web 平台的安全会话快照，并打开专用 Chrome、切换账号和主动验证；接口不得返回凭据、账号身份或服务器路径。
- REQ-017：千问 API 新预置默认强制联网检索，DeepSeek API 新预置默认关闭；预置同步不得覆盖管理员已经保存的自定义值。

### 4.2 约束

- CON-001：正式环境为单个 Node.js 后端进程和持续存在的图形桌面会话。
- CON-002：不自动处理登录凭据、验证码或人工验证。
- CON-003：豆包页面属于不可信外部输入，DOM 文本、URL、属性和页面状态均需在 Adapter 边界验证。
- CON-004：不将未公开网络接口作为回答、引用或完成状态的必要依赖。
- CON-005：保留现有 `deepseek-web` adapter type、状态 URL、状态 schema 和历史 capture schema。
- CON-006：不增加业务数据库表；平台配置使用现有 `AIPlatformConfig`。
- CON-007：所有浏览器目录必须通过专用目录和互斥校验，不能指向日常 Chrome、仓库普通目录或另一平台目录。
- CON-008：目标虚拟机真实验收前，`doubao-web.enabled` 必须保持 `false`。

### 4.3 沿用模式

- PAT-001：沿用 `ProjectRunService` 的幂等启动、执行租约、终态栅栏和只重做分析语义。
- PAT-002：沿用 `WebCaptureStore` 的 stage、原子 promote、不透明 artifact id、隔离删除与恢复。
- PAT-003：沿用现有 `web_*` 稳定错误码；仅在确有新失败语义时增量添加。
- PAT-004：沿用 30 秒前端状态轮询，并在页面不可见时暂停。
- PAT-005：沿用认证状态接口、同源 `/api/*` 请求和现有权限边界。
- PAT-006：沿用失败关闭原则；不得以默认状态、点击成功或按钮消失替代可验证状态。

## 5. 接口与数据契约

### 5.1 受管 Web 平台定义

新增内部只读平台注册表。每个平台定义至少包含：

| 字段 | 含义 |
| --- | --- |
| `code` | 平台代码，如 `deepseek-web`、`doubao-web` |
| `adapterType` | 配置类型；保留 `deepseek_web`，新增 `doubao_web` |
| `displayName` | 用户可见平台名 |
| `defaultModel` | 稳定界面标识 |
| `officialUrl` | 受控浏览器初始页面 |
| `allowedOrigins` | 页面导航和证据 URL 的平台源站白名单 |
| `captureSchemaVersion` | 平台 capture schema |
| `runtimeSchemaVersion` | 平台状态 schema |
| `selectorVersion` | 页面规则版本 |
| `envPrefix` | 平台运行环境变量前缀 |
| `createPage` | 创建平台页面对象 |
| `createAdapter` | 创建平台采集 Adapter |

注册表只包含内置、受代码保护的平台，不从数据库动态创建任意 Web 平台。

注册表提供以下内部能力：

- 按平台代码取得定义和运行实例。
- 校验平台代码与 `adapter_type` 是否严格匹配。
- 列出全部受管 Web 平台。
- 按平台取得证据存储。
- 对全部平台执行启动证据恢复。
- 对全部运行实例执行有界关闭。

未知平台、代码与 adapter type 不匹配、数据库中的受管配置被篡改时，返回 `managed_config_invalid`，不得落入 API Request Service。

### 5.2 运行内核契约

`WebPlatformService` 改为可实例化的通用运行内核，不再导出默认 DeepSeek 单例。构造输入来自已验证的平台定义和运行配置：

- 平台身份与用户可见名称。
- 官方入口与允许源站。
- Profile、证据目录、Chrome 和超时配置。
- 页面与 Adapter 工厂。
- 页面预检函数和错误文案上下文。

每个平台实例独立维护：

- `tail` FIFO。
- 当前任务。
- Chrome session。
- Profile lock。
- 预检缓存。
- circuit error。
- blocking error。
- active capture count。
- closing state。

两个平台实例之间不得共享上述可变状态。

`queryPlatform(question, options)` 输入：

- `question`：非空字符串。
- `capture_owner.record_id`：正整数。
- `capture_owner.user_id`：正整数。
- `capture_owner.project_id`：空或正整数。
- `capture_owner.execution_token`：继续传给现有终态栅栏链路，不写入证据文件。

输出保持现有 AIPlatformService 结果外形：

```text
success
platform
model_name
text
data
provider_citations
web_capture
responseTime
```

失败结果必须包含：

```text
success = false
platform = 当前 Web 平台
error_code
error
web_capture.status = failed
web_capture.failure.stage
web_capture.failure.error_code
responseTime
```

运行内核只管理生命周期和串行，不理解豆包或 DeepSeek 的具体 DOM。

### 5.3 平台 Adapter 契约

新增通用采集状态机，平台页面对象实现以下行为：

- `assertReady`
- `startNewConversation`
- `getConversationSnapshot`
- `ensureSearchEnabled`
- `captureScreenshot`
- `insertPrompt`
- `sendPrompt`
- `extractCitations`
- `collectRetrievalCandidates`（可选，只能使用页面可见且可验证的候选）
- `getMetadata`

通用状态机固定执行：

```text
capture_started
→ session_ready_checked
→ new_conversation_verified
→ search_enabled_verified
→ search_evidence_saved
→ prompt_inserted
→ prompt_sent
→ generation_finished
→ content_extracted
→ final_evidence_saved
→ promoted
```

阶段顺序是内部证据和错误契约。`prompt_sent` 之前允许恢复浏览器导航；进入 `prompt_sent` 后不得自动重发问题。

豆包页面对象只返回经过边界校验的数据：

- 当前页面必须位于 `allowedOrigins`。
- 新会话必须没有旧回答区域。
- 搜索控件必须唯一，并能读取确定的开启状态。
- 当前回答必须是发送后唯一新增的回答。
- 回答必须非空、生成停止、页面非 busy 且连续稳定。
- 引用 URL 只允许 HTTP/HTTPS，去除 fragment 并限制长度和数量。
- 截图必须是有界 PNG。
- 页面文本、metadata 和 capture JSON 必须满足现有字节上限。

DeepSeek Adapter 迁移到同一状态机后，现有 DeepSeek 行为和测试必须保持通过，不能保留第二套旧采集状态机。

### 5.4 豆包采集结果

豆包成功结果：

- `platform`: `doubao-web`
- `model_name`: `doubao-web-ui`
- `web_capture.schema_version`: `doubao-web-capture-v1`
- `web_capture.selector_version`: 由技术侦察确认后的版本化值
- `web_capture.status`: `completed`
- `web_capture.page_url`: 豆包允许源站内的当前会话 URL
- `web_capture.search.requested`: `true`
- `web_capture.search.observed`: `true`
- `web_capture.search.evidence_type`: 有界状态证明类型
- `web_capture.completion.state`: `stable`
- `web_capture.artifacts.search_state`: 联网状态截图引用
- `web_capture.artifacts.final_answer`: 最终回答截图引用

`provider_citations` 只包含：

- 平台引用：内部 `source_role = explicit_citation`，`source_origin = doubao_web_dom`。
- 页面可见检索候选：内部 `source_role = retrieval_candidate`，`source_origin = doubao_web_dom`。

回答正文中的普通 URL 继续由 `CitationAnalysisService` 从 `text` 提取为 `response_link`，不得在 Adapter 中伪装成平台引用。

没有平台引用时，`provider_citations` 可以为空；只要其他成功条件满足，记录仍成功。

### 5.5 平台配置契约

`AIPlatformConfigService` 增加内置配置：

- `code`: `doubao-web`
- `name`: `豆包网页版`
- `adapter_type`: `doubao_web`
- `base_url`: 使用技术侦察确认的官方源站
- `default_model`: `doubao-web-ui`
- `enabled`: `false`
- `builtin`: `true`

受管 Web 能力统一为：

- `monitoring: true`
- `interactive_login: true`
- 其余 API、分析、模型目录、连接测试、问题生成、direct stream、legacy schedule 能力为 `false`

`deepseek-web` 和 `doubao-web` 都属于保留代码。启动时发现保留代码已被自定义平台占用，必须返回 `reserved_platform_code_conflict`，不得静默转换。

启动 `ensurePresets` 可以修复内置平台的非敏感固定字段和清空 API Key，但不得把 `doubao-web.enabled` 从用户显式值改成 `true`。

其他 API 平台的新预置默认值：

- `qwen.request_options.search_options.forced_search = true`；`AIPlatformRequestService` 在正式 Responses 请求中继续添加 `tools: [{ type: "web_search" }]`。
- `deepseek.enabled = false`，仅表示新建预置的默认状态；DeepSeek 网页版仍是独立的 `deepseek-web` 平台。
- `ensurePresets` 只在记录首次创建时写入上述默认值，不覆盖管理员已经保存的启停状态或请求参数。

### 5.6 AIPlatformService 路由

路由规则：

1. 根据平台代码读取已验证的 `AIPlatformConfig`。
2. 如果平台注册表包含该平台，严格校验平台代码和 adapter type。
3. 校验 `purpose === project_monitoring` 和 capture owner。
4. 调用该平台的独立 Web 实例。
5. 未注册平台继续交给 `AIPlatformRequestService`。

不得出现“豆包 Web 失败后调用 `doubao`”的分支。测试需要注入 API Request Service spy，证明所有豆包 Web 失败场景调用次数为 0。

平台可用性检查同样按注册表选择对应实例执行 `preflight`，不能始终探测 DeepSeek 单例。

### 5.7 运行状态 API

将现有固定路由泛化为：

```text
GET /api/ai-platforms/:platformCode/runtime-status
```

仅允许平台注册表中的受管 Web 平台。未知或非 Web 平台返回 404，不进行动态服务实例化。

兼容性要求：

- 现有 `GET /api/ai-platforms/deepseek-web/runtime-status` URL 不变。
- DeepSeek 响应的 `schema_version` 继续为 `deepseek-web-runtime-v1`。
- 豆包响应的 `schema_version` 为 `doubao-web-runtime-v1`。
- 响应继续使用 `{ success: true, data }`。
- 认证、`private, no-store` 和专用轮询限流保持不变。

状态字段：

```text
schema_version
platform
enabled
state
running_count
queued_count
pending_count
needs_action
action_code
reason_code
observed_at
```

`state` 继续限制为：

- `idle`
- `busy`
- `login_required`
- `verification_required`
- `unavailable`
- `shutting_down`

数据库 pending 数量必须按请求的平台代码统计，运行数量来自对应平台实例，不能混合两个 Web 队列。

### 5.8 登录 CLI

保留用户命令：

```text
npm run web:login -- <platformCode>
```

后端脚本改为通用 `webLogin.js`：

- 只接受平台注册表中的 `interactive_login` 平台。
- 按平台取得独立实例和 Profile 锁。
- 输出平台对应的人类可读状态。
- 登录完成后有界关闭浏览器并释放 Profile 锁。
- 非受管平台返回 `web_platform_unsupported`。

旧的 DeepSeek 专用脚本在 npm 入口切换并测试通过后删除，不保留第二套登录逻辑。

### 5.9 设置页 Web 会话管理 API

管理员设置页使用以下接口：

```text
GET  /api/admin/ai-platforms/:id/web-session
POST /api/admin/ai-platforms/:id/web-session/open
POST /api/admin/ai-platforms/:id/web-session/verify
```

接口只允许能力包含 `interactive_login` 且平台代码与 adapter type 匹配的内置受管 Web 平台。API 平台和被篡改的配置在启动浏览器前拒绝。

安全会话快照固定为：

```text
schema_version = managed-web-session-v1
platform
browser_configured
profile_initialized
login_state = unchecked | ready | login_required | verification_required | selector_mismatch | unavailable
reason_code
last_verified_at
```

- `GET` 是无副作用、`private, no-store` 的状态读取，不启动 Chrome。
- `open` 只回收并打开目标平台的专用 Chrome，立即将该平台标为 `web_login_required`，在管理员完成验证前拒绝该平台新的页面采集。
- `verify` 强制执行目标平台预检，只有允许源站内存在唯一可用输入区时才返回 `ready`。
- DeepSeek Web 和豆包 Web 的 Chrome、Profile、FIFO、熔断与会话快照相互隔离。
- 响应不返回账号密码、Cookie、Authorization、账号身份、Chrome 路径或 Profile 路径。
- `/admin/settings` 是首选登录与切换入口；CLI 是后端或设置页不可用时的备用入口。

### 5.10 环境变量

保留现有 DeepSeek 环境变量不变。新增：

- `DOUBAO_WEB_CHROME_EXECUTABLE`
- `DOUBAO_WEB_PROFILE_DIR`
- `DOUBAO_WEB_EVIDENCE_DIR`
- `DOUBAO_WEB_TIMEOUT_SECONDS`

默认目录：

- `backend/.runtime/doubao-web/profile`
- `backend/.runtime/doubao-web/evidence`

规则：

- Chrome 可执行文件可以相同。
- Profile 和证据目录必须不同。
- 两个平台的 Profile、证据目录不能相等、互相包含或指向日常 Chrome。
- 豆包变量不得读取 `DEEPSEEK_WEB_*` 作为 fallback。
- 超时继续限制为 30–600 秒。

### 5.11 多证据目录协调

新增证据协调服务，按 `QuestionRecord.platform` 选择平台 Store：

- 读取证据时先校验记录平台、artifact owner 和用户权限，再访问对应 Store。
- 重试记录引用原记录证据时，owner 记录必须存在且平台一致。
- 删除多个记录时先按平台分组，在所有相关 Store 中完成 quarantine；任一 Store 失败则恢复已经隔离的目录，数据库工作不得提交。
- 数据库提交后依次 commit quarantine；任一物理清理失败继续使用现有 `web_capture_cleanup_incomplete` 语义并记录平台上下文。
- 应用启动时遍历全部注册 Store 执行 trash reconciliation。
- 终态栅栏拒绝或 Worker 异常时，根据当前记录平台丢弃刚生成的证据。

历史 DeepSeek 记录继续按 `QuestionRecord.platform = deepseek-web` 路由，不要求改写旧 `web_capture` JSON。

### 5.12 前端状态与设置组件

将 DeepSeek 专用状态 hook、presentation utility 和组件改为受管 Web 平台数据驱动版本：

- 页面一次挂载一个 `ManagedWebRuntimeStatuses` 容器。
- 容器从平台目录中选择已启用或需要展示操作状态的受管 Web 平台。
- 每个平台独立轮询自己的状态 URL；页面隐藏时统一暂停。
- 每个平台分别展示名称、空闲、运行、等待、登录、验证和不可用说明。
- 关闭且无操作需要的平台不显示状态条。
- 两个平台同时 busy 时显示两条独立状态，不合并等待数。

现有问题页和问题集报告页替换为通用容器。样式复用当前状态条。

`/admin/settings` 的平台表格按受管 Web 能力识别 `deepseek_web` 与 `doubao_web`，不使用单个平台的硬编码判断：

- 两个平台统一展示“真实网页 · 专用 Chrome”。
- 配置列展示浏览器、Profile、登录验证、原因和最近验证时间。
- 操作列提供登录或打开 Chrome、切换账号、验证登录和重新加载；“重新加载”只读取后端当前状态快照。
- Web 平台不展示 API 请求参数、API Key、连接测试、模型目录或 API 编辑入口。

### 5.13 错误语义

继续复用以下通用错误码：

- `web_browser_not_configured`
- `web_browser_launch_failed`
- `web_profile_in_use`
- `web_runtime_config_invalid`
- `web_login_required`
- `web_verification_required`
- `web_selector_mismatch`
- `web_search_state_unverified`
- `web_generation_timeout`
- `web_browser_unresponsive`
- `web_browser_command_failed`
- `web_browser_connection_failed`
- `web_browser_closed`
- `web_capture_failed`
- `web_capture_owner_missing`
- `web_shutdown`

错误码保持平台无关，用户可读消息包含当前平台名。不得把 DeepSeek 文案返回给豆包任务。

第三方页面原始错误、DOM、响应体、账号信息、浏览器路径和 CDP 细节不得进入 API 错误消息。

### 5.14 兼容性

- 不修改 `deepseek-web` 平台代码、adapter type、默认模型或现有状态 URL。
- 不改写已有 DeepSeek 历史记录和 capture schema。
- 不修改现有引用内部角色；前端只调整用户可见术语。
- 不增加数据库表或强制数据迁移。
- API 平台行为、并发和错误语义保持不变。
- 通用运行内核接管 DeepSeek 正式调用方后，删除旧默认单例和 DeepSeek 专用登录脚本；不得保留隐藏 fallback。

## 6. 关键技术决策

- KTD-001：采用“共享运行内核 + 平台实例隔离”。共享 Chrome 生命周期、FIFO、熔断和 capture 状态机，平台 DOM 与配置保持独立。这样可以复用稳定机制，同时避免账号、队列和证据串扰。
- KTD-002：使用代码内平台注册表，不建设数据库驱动的任意 Web 插件。受管平台涉及浏览器权限和页面代码执行，必须是显式允许的内置定义。
- KTD-003：保留 `deepseek_web`，新增 `doubao_web`。不迁移现有 adapter type，降低历史配置和前端兼容风险。
- KTD-004：使用参数化状态 URL，但保持 DeepSeek 原 URL 和 schema。新能力是增量扩展，不要求现有消费者升级。
- KTD-005：页面 DOM 和可见状态是豆包采集主证据。不依赖未公开接口；第一版检索候选只来自页面可验证内容。
- KTD-006：联网搜索采用失败关闭。点击动作不是成功证据，只有点击后读取到唯一、确定的开启状态才能发送问题。
- KTD-007：通用采集状态机只依赖页面接口。DeepSeek 和豆包 Page 分别实现 DOM 细节，禁止在通用内核中出现平台选择器。
- KTD-008：证据根据记录平台路由，删除操作跨 Store 协调。不能继续把所有 artifact id 交给 DeepSeek 单例。
- KTD-009：跨平台允许并行，单平台保持串行。每个实例有自己的 Promise tail 和 Profile lock，不增加全局 Web 锁。
- KTD-010：默认关闭并分阶段启用。自动化测试通过只代表模块和入口具备能力，目标虚拟机登录、资源与真实页面验收通过后才修改正式启用状态。

## 7. 实现切片

### U1. 豆包页面契约与资源基线

**目标：**

在目标虚拟机已授权账号中确认豆包官方入口、允许源站、新会话、输入区、联网搜索、回答完成、引用区域和登录/验证状态，并测量双有头 Chrome 的基础资源占用。

**依赖：**

无。需要虚拟机运维负责人完成人工登录和必要验证。

**涉及文件：**

- `docs/active-2026-07-27-002-doubao-web-monitoring/TECH-SPEC.md`
- 后续测试夹具目录，具体位置在实现时按现有测试结构确定

**方案：**

- 仅记录脱敏后的页面语义、属性组合、URL 范围和状态截图，不记录 Cookie、Token、账号标识或完整页面存档。
- 覆盖搜索关闭、搜索开启、有引用、无引用、长回答、登录失效和人工验证。
- 确认引用 href 是目标 URL 还是重定向 URL，并定义规范化规则。
- 同时启动 DeepSeek 与豆包专用 Chrome，记录空闲和各自运行时 CPU、内存及交互稳定性。
- 侦察结论回填正式 `doubaoWebSelectors` 和目标虚拟机资源验收阈值，不扩大产品范围。

**测试场景：**

- 新会话为空。
- 搜索状态可读并能从关闭切换为开启。
- 搜索已开启但回答没有引用。
- 页面展示一个及多个引用。
- 回答生成中与生成结束可区分。
- 登录页、验证页和正常对话页可区分。

**验收方式：**

形成可实现、可复核且不含敏感信息的页面契约；核心搜索状态或当前回答无法可靠识别时停止后续正式接入。

### U2. 受管 Web 注册表与隔离运行内核

**目标：**

将 DeepSeek 单例重构为平台注册表管理的独立实例，并注册默认关闭的 `doubao-web`。

**依赖：**

U1 提供豆包官方 URL 和允许源站。

**涉及文件：**

- `backend/services/WebPlatformService.js`
- `backend/services/WebPlatformRegistry.js`
- `backend/services/AIPlatformConfigService.js`
- `backend/services/AIPlatformService.js`
- `backend/services/ApplicationShutdownService.js`
- `backend/app.js`
- `backend/tests/WebPlatformService.test.js`
- `backend/tests/AIPlatformConfigService.test.js`
- `backend/tests/AIPlatformService.test.js`
- `backend/tests/ApplicationShutdownService.test.js`

**方案：**

- 参数化运行内核的平台身份、URL、规则、环境变量、工厂和文案。
- 注册表创建 DeepSeek 与豆包两个独立实例。
- 正式平台路由、可用性预检、关机和启动恢复全部改走注册表。
- 保留 DeepSeek 外部契约，删除默认 DeepSeek 单例依赖。
- 添加目录冲突检测，阻止两个平台复用 Profile 或证据目录。

**测试场景：**

- 两个平台实例状态互不影响。
- 同平台严格 FIFO，跨平台任务可以重叠。
- 代码与 adapter type 不匹配时拒绝。
- 豆包默认关闭且不需要 API Key。
- 一个实例关闭或熔断不改变另一个实例。
- 应用关闭会等待并回收两个实例。

**验收方式：**

平台目录可看到默认关闭的豆包网页版；DeepSeek 既有测试保持通过；正式路由不再直接引用 DeepSeek 单例。

### U3. 豆包人工登录、预检与运行状态

**目标：**

提供豆包专用人工登录、登录恢复、预检和用户可见运行状态。

**依赖：**

U1、U2。

**涉及文件：**

- `backend/config/doubaoWebSelectors.js`
- `backend/scripts/webLogin.js`
- `backend/package.json`
- `backend/services/WebPlatformRuntimeStatusService.js`
- `backend/routes/adminAIPlatforms.js`
- `backend/routes/aiPlatforms.js`
- `backend/config/apiRateLimitPolicy.js`
- `backend/tests/WebPlatformRuntimeStatusService.test.js`
- `backend/tests/WebPlatformRuntimeStatusDatabase.test.js`
- `backend/tests/AIPlatformsApi.test.js`
- `nextjs-frontend/src/app/admin/settings/AIPlatformSettings.tsx`
- `nextjs-frontend/src/components/WebPlatformRuntimeStatus.tsx`
- `nextjs-frontend/src/lib/useWebPlatformRuntimeStatus.ts`
- `nextjs-frontend/src/utils/webPlatformAdminSession.cjs`
- `nextjs-frontend/src/utils/webPlatformRuntimeStatus.cjs`
- `nextjs-frontend/src/app/geo/prompts/page.tsx`
- `nextjs-frontend/src/app/geo/question-set-reports/page.tsx`

**方案：**

- 登录命令按平台代码选择注册实例。
- 设置页通过管理员 Web 会话 API 查看浏览器、Profile 和验证状态，并打开专用 Chrome、切换账号或主动验证。
- 豆包预检只在允许源站、唯一输入区和正常登录态下成功。
- 状态服务按平台分别统计数据库 pending 和实例 running。
- 前端通用状态容器独立展示两个 Web 平台。
- 删除 DeepSeek 专用登录脚本、hook、组件和 presentation utility，更新调用方。

**测试场景：**

- 豆包未登录、需要验证、页面不匹配和正常可用。
- 打开登录或切换账号只阻塞目标平台；浏览器启动失败在后续状态快照中保持为不可用。
- 设置页不为任一受管 Web 平台展示 API 参数或编辑操作，且响应不暴露凭据、账号身份和服务器路径。
- DeepSeek 原状态 URL 与 schema 不变。
- 豆包状态计数不包含 DeepSeek 任务。
- 平台关闭时不显示普通空闲条。
- 轮询失败不阻塞正式提交预检。

**验收方式：**

运维负责人可以从设置页选择豆包执行人工登录、切换和验证，并可在 CLI 备用入口完成同一流程；问题页和报告页能分别展示豆包与 DeepSeek 状态。

### U4. 豆包单问题可信采集

**目标：**

从问题库单问题正式入口完成一次豆包新会话、强制联网搜索、最终回答、引用和截图采集。

**依赖：**

U1、U2、U3。

**涉及文件：**

- `backend/services/ManagedWebCaptureAdapter.js`
- `backend/services/DeepSeekWebAdapter.js`
- `backend/services/DoubaoWebAdapter.js`
- `backend/config/deepseekWebSelectors.js`
- `backend/config/doubaoWebSelectors.js`
- `backend/services/AIPlatformService.js`
- `backend/services/ProjectRunService.js`
- `backend/tests/ManagedWebCaptureAdapter.test.js`
- `backend/tests/DeepSeekWebAdapter.test.js`
- `backend/tests/DoubaoWebAdapter.test.js`
- `backend/tests/ProjectRunService.test.js`

**方案：**

- 抽取唯一通用采集状态机，DeepSeek 和豆包页面对象实现相同接口。
- 豆包每次验证空白新会话。
- 搜索状态确认成功且搜索截图写入 stage 后才插入并发送问题。
- 通过“唯一新回答 + 非空 + generation inactive + non-busy + 稳定窗口”判断完成。
- 从当前回答范围提取平台引用；正文普通链接留给现有分析服务。
- 任何失败返回豆包 Web 结果，不调用 API Request Service。

**测试场景：**

- 搜索关闭后成功开启并读取到开启状态。
- 搜索状态无法读取时发送次数为 0。
- 新会话仍有旧回答时失败。
- 多个新增回答无法唯一识别时失败。
- 无引用回答成功且引用为空。
- 截图失败、回答过大、生成超时和浏览器关闭均丢弃 staged evidence。
- 豆包所有失败路径中豆包 API spy 调用次数为 0。
- DeepSeek 回归行为不变。

**验收方式：**

问题库单问题生成平台为 `doubao-web` 的独立运行记录，包含最终正文、搜索截图、最终截图和可核验 capture 信息。

### U5. 多平台证据、引用、历史与报告

**目标：**

让豆包证据在访问、删除、分析、历史、报告和导出中完整可用，并与豆包 API、DeepSeek Web 保持隔离。

**依赖：**

U4。

**涉及文件：**

- `backend/services/WebCaptureAccessService.js`
- `backend/services/WebCaptureDeletionService.js`
- `backend/services/WebCaptureCoordinator.js`
- `backend/services/ProjectRunService.js`
- `backend/services/QuestionSetRunService.js`
- `backend/services/QuestionSetRunCsvService.js`
- `backend/app.js`
- `backend/tests/WebCaptureAccessService.test.js`
- `backend/tests/WebCaptureDeletionService.test.js`
- `backend/tests/ProjectDeletionService.test.js`
- `backend/tests/PromptAnalysisCleanupService.test.js`
- `backend/tests/QuestionSetRunService.test.js`
- `nextjs-frontend/src/components/WebCaptureEvidence.tsx`
- 相关历史与报告测试

**方案：**

- 证据协调服务按记录平台路由 Store。
- 多平台删除使用跨 Store quarantine/restore/commit。
- 过期 Worker 和异常终态按记录平台丢弃新证据。
- 豆包平台引用使用既有内部角色进入 KPI；正文链接和检索候选保持非 KPI。
- 报告、历史、筛选和导出保留 `doubao-web` 与 `doubao-web-ui`。
- 用户可见术语统一为“引用”或“引用源”。

**测试场景：**

- 豆包证据只能从豆包 Store 读取。
- 跨平台 artifact owner 被拒绝。
- 多 Store 删除中途失败会恢复已隔离证据。
- 删除项目同步清理豆包与 DeepSeek 证据。
- 分析失败后仅重做分析，不再次访问豆包页面。
- 无引用样本进入可验证分母但引用数为 0。
- 普通正文链接和检索候选不进入引用 KPI。
- CSV/PDF/历史筛选不合并 `doubao` 与 `doubao-web`。

**验收方式：**

从正式报告可查看豆包回答和截图，删除后物理证据同步消失，引用指标符合现有角色语义。

### U6. 问题集、重试与自动监测

**目标：**

将豆包 Web 接入全部正式运行入口，并保持现有幂等、配额、租约和失败重试语义。

**依赖：**

U4、U5。

**涉及文件：**

- `backend/services/QuestionSetRunService.js`
- `backend/services/ProjectRunService.js`
- `backend/services/SchedulerService.js`
- `backend/tests/QuestionSetRunStart.test.js`
- `backend/tests/QuestionSetRetryPersistence.test.js`
- `backend/tests/QuestionSetRunService.test.js`
- `backend/tests/ProjectRunService.test.js`
- 调度入口相关测试

**方案：**

- 平台能力目录允许 `doubao-web` 进入 monitoring 规划。
- 单问题、问题集和自动监测复用 `ProjectRunService → AIPlatformService → 注册实例`。
- Web 采集已成功但分析失败时，重试只重做分析。
- 采集失败时由用户从原报告明确重试，系统不自动重复发送。
- pending、暂停、租约和终态栅栏继续使用现有持久任务模型。

**测试场景：**

- 问题集包含豆包 API、豆包 Web 和 DeepSeek Web 时各自保存平台身份。
- 豆包 Web 不可用时其他平台继续运行。
- 同一幂等键不重复创建记录和扣配额。
- 分析重试不产生第二次豆包 Web 页面发送。
- 自动监测实际调用豆包 Adapter。
- 旧 direct stream 和 legacy schedule 不会调用豆包 Web。

**验收方式：**

问题集、失败重试和项目自动监测均产生可追踪的豆包 Web 记录，并与单问题使用同一采集实现。

### U7. 双 Web 并行与生命周期验收

**目标：**

从正式入口证明两个 Web 平台队列独立、可以跨平台并行，且关闭、熔断和证据恢复互不串扰。

**依赖：**

U3、U4、U5、U6。

**涉及文件：**

- `backend/tests/WebPlatformService.test.js`
- `backend/tests/WebPlatformRuntimeStatusService.test.js`
- `backend/tests/ApplicationShutdownService.test.js`
- `backend/tests/ProjectRunService.test.js`
- 双平台入口级测试文件

**方案：**

- 同时提交 DeepSeek Web 与豆包 Web 任务，记录两个 Adapter 的开始和结束区间。
- 证明每个平台最大并发为 1，但两个平台的执行区间可以重叠。
- 分别触发登录、验证、选择器和浏览器故障，验证另一平台保持可用。
- 验证 shutdown 等待两个 tail，并关闭两个 Chrome、释放两个锁。
- 验证启动 trash reconciliation 遍历两个 Store。

**测试场景：**

- 豆包两任务串行，DeepSeek 两任务串行。
- 一条豆包和一条 DeepSeek 同时运行。
- 豆包熔断时 DeepSeek 继续完成。
- 关闭中两个平台均拒绝新页面工作。
- 一个 Store 恢复失败不会被报告成全部恢复成功。

**验收方式：**

自动化证据证明双平台隔离与并行契约成立，没有全局锁、共享可变状态或错误 Store 路由。

### U8. 目标虚拟机发布验收与正式切换

**目标：**

在目标虚拟机从真实用户入口完成登录、单问题、问题集、重试、自动监测和双 Web 并行验收，并在验收通过后启用豆包网页版。

**依赖：**

U1–U7。

**涉及文件：**

- `README.md`
- `CONTEXT.md`
- `docs/README.md`
- `docs/ENVIRONMENT.md`
- `docs/SINGLE_HOST_DEPLOYMENT.md`
- 本需求 PRD、Tech Spec 和 issues 状态

**方案：**

- 按 `prod:stop → web:login -- doubao-web → prod:start` 完成人工登录。
- 从问题库单问题、问题集和项目自动监测入口执行真实任务。
- 覆盖有引用、无引用、登录失效和人工恢复。
- 同时运行 DeepSeek Web 和豆包 Web，记录 CPU、内存、队列与结果证据。
- 验收失败时保持 `doubao-web` 关闭，直接修复新实现，不启用 API fallback。
- 全部通过后由管理员启用平台，更新当前正式路径文档并关闭需求。

**测试场景：**

- 服务重启后登录状态恢复。
- 搜索状态截图和最终截图可从报告访问。
- 双 Web 并行时虚拟机桌面和应用保持稳定。
- 豆包失败时数据库和日志中不存在豆包 API 替代结果。
- 关闭和重启后无残留 Chrome 或 Profile 锁。

**验收方式：**

以真实报告、状态页面、截图、运行日志和进程证据证明正式入口走豆包 Web；只有通过后才将平台设为启用并将需求目录转为 `closed`。

## 8. 验收标准

- AC-001：Given 数据库初始化，When 执行内置平台同步，Then 存在默认关闭的 `doubao-web`，且不需要 API Key。
- AC-002：Given `doubao-web` 与 `doubao` 同时存在，When 查询平台目录和历史，Then 两个平台代码和名称始终分离。
- AC-003：Given 豆包运行配置，When 解析目录，Then Profile 和证据目录与 DeepSeek 及日常 Chrome 均不冲突。
- AC-004：Given 豆包未登录或需要验证，When 预检，Then 返回对应稳定错误，DeepSeek 实例状态不变。
- AC-005：Given 搜索处于关闭状态，When 采集问题，Then 系统开启并读取到确定状态后才发送。
- AC-006：Given 搜索状态无法确认，When 采集问题，Then 任务失败且发送次数为 0。
- AC-007：Given 两个连续豆包问题，When 运行完成，Then 每题使用新会话且不存在上下文串扰。
- AC-008：Given 页面生成最终回答，When 记录成功，Then 正文非空、生成结束、内容稳定、搜索截图和最终截图均存在。
- AC-009：Given 豆包回答没有平台引用，When 其他成功条件满足，Then 记录成功且引用数为 0。
- AC-010：Given 页面包含平台引用、正文链接和检索候选，When 计算 KPI，Then 只有平台引用进入引用次数和引用率。
- AC-011：Given 豆包采集失败，When AIPlatformService 返回结果，Then 豆包 API Request Service 调用次数为 0。
- AC-012：Given 豆包 Web 与 DeepSeek Web 同时有任务，When 执行，Then 各平台最大并发为 1，且跨平台执行区间可以重叠。
- AC-013：Given 豆包 Web 熔断，When DeepSeek Web 继续执行，Then DeepSeek 队列、会话和状态不受影响。
- AC-014：Given 豆包证据记录，When 用户访问或删除，Then 系统使用豆包 Store，并遵守现有权限和物理删除语义。
- AC-015：Given 包含豆包 Web 的问题集和自动监测，When 运行，Then 都通过同一个豆包 Adapter 产生独立记录。
- AC-016：Given Web 采集完成但分析失败，When 从报告重试，Then 只重做分析，不再次发送网页问题。
- AC-017：Given 现有 DeepSeek Web 客户端，When 读取原状态 URL，Then URL、schema 和字段保持兼容。
- AC-018：Given 应用关闭，When shutdown 收敛，Then 两个平台浏览器和 Profile 锁均被释放。
- AC-019：Given 目标虚拟机尚未完成真实验收，When 启动或同步配置，Then `doubao-web` 不会被自动启用。
- AC-020：Given 目标虚拟机真实验收通过，When 管理员启用平台，Then 市场部正式入口可以选择并运行豆包网页版。
- AC-021：Given 管理员打开设置页，When 查看 `deepseek_web` 与 `doubao_web`，Then 两个平台均显示为受管真实网页，不出现 API 参数、密钥、连接测试或 API 编辑操作。
- AC-022：Given 受管 Web 平台存在，When 管理员读取状态、打开专用 Chrome、切换账号或验证，Then 只操作目标平台并返回不含凭据、账号身份和服务器路径的安全快照。
- AC-023：Given 新建平台预置，When 执行同步，Then 千问请求参数默认强制搜索、DeepSeek API 默认关闭，且已有管理员配置不被覆盖。

## 9. 测试与验证计划

### 9.1 单元测试

- 注册表的平台解析、adapter 匹配和未知平台拒绝。
- 平台化运行配置、目录冲突和环境变量边界。
- 独立 FIFO、预检缓存、熔断、session recycle 和 shutdown。
- 通用采集状态机的阶段顺序、发送边界和证据清理。
- 豆包页面探针的唯一性、可见性、状态读取和 URL 校验。
- 引用去重、redirect 规范化、数量和字节边界。
- 状态 presentation 和前端状态 schema 校验。
- 设置页 Web 会话状态 presentation、受管 adapter 分类和操作按钮校验。

### 9.2 集成测试

- `AIPlatformConfigService` 初始化与受管配置保护。
- `AIPlatformService` 正式路由及零 API fallback。
- `ProjectRunService` 单问题、终态栅栏和仅分析重试。
- `QuestionSetRunService` 问题集、失败重试、报告和 CSV。
- `SchedulerService` 自动监测入口。
- 状态 API 认证、限流、平台参数和数据库 pending 统计。
- 管理员 Web 会话状态、打开、切换与验证 API 的权限、平台能力和敏感字段边界。
- 跨 Store 证据访问、删除、项目删除和启动恢复。
- 两个 Web 实例并行、单实例串行和故障隔离。

### 9.3 前端验证

- 状态 utility 的所有状态和错误文案测试。
- 问题页和问题集报告页同时展示两个 Web 通道。
- 豆包 API 与豆包 Web 在选择、筛选、历史和报告中分离。
- 设置页将两个受管 Web 平台显示为专用 Chrome，并覆盖未验证、未登录、人工验证、页面变化和浏览器不可用状态。
- 设置页不为受管 Web 平台显示 API 请求参数或 API 编辑操作。
- 运行 `npm run lint` 和 `npm run build`。

### 9.4 真实入口验证

- 目标虚拟机人工登录和服务重启。
- 问题库单问题。
- 问题集运行。
- 失败项重试。
- 项目自动监测。
- 有引用与无引用回答。
- 登录失效和人工恢复。
- DeepSeek Web 与豆包 Web 同时执行。

### 9.5 验收证据

- 自动化测试输出。
- 前端生产构建结果。
- 真实运行报告 ID 和平台字段。
- 联网状态及最终回答截图。
- 两个队列的运行时间区间和状态 API 快照。
- 目标虚拟机 CPU、内存和 Chrome 进程记录。
- 代码搜索证明不存在豆包 Web → 豆包 API fallback、旧单例正式引用和旧登录脚本。

## 10. 风险与缓解

- 风险：豆包页面 DOM 或文案变化导致选择器失效。
  缓解：使用版本化页面规则、语义与属性组合、唯一性检查和失败关闭；不使用宽泛文本匹配猜测。

- 风险：点击搜索控件后 UI 尚未完成状态切换。
  缓解：点击与观测分离，轮询读取确定状态；超时返回 `web_search_state_unverified`，不得发送问题。

- 风险：回答区域包含旧会话、多个新回答或流式残片。
  缓解：创建空白新会话、记录发送前基线、只接受唯一新增回答，并联合生成状态、busy 状态和稳定窗口判定。

- 风险：豆包引用使用跳转链接或延迟展开卡片。
  缓解：U1 确认链接合同；仅处理可见、可校验的 HTTP/HTTPS 地址，并保留平台 URL 与规范化结果的有界证据。

- 风险：多证据目录导致访问或删除路由错误。
  缓解：以数据库记录平台为唯一 Store 路由依据；owner 记录平台必须一致；跨 Store 删除具备统一恢复。

- 风险：抽取通用内核回归 DeepSeek 正式流程。
  缓解：先用现有 DeepSeek 测试锁定契约，迁移后从原登录、状态和项目入口回归；不保留旧单例 fallback。

- 风险：两个 headed Chrome 超出虚拟机资源。
  缓解：U1 先建立资源基线，U8 再做真实并行验收；未通过时保持豆包默认关闭，不偷偷改为共享浏览器。

- 风险：应用关闭时一个平台长任务阻塞另一个平台回收。
  缓解：注册表对实例并行执行有界 shutdown，每个实例独立等待 tail 和释放锁，汇总失败而不跳过其他实例。

- 风险：状态 API 泛化破坏现有 DeepSeek 前端。
  缓解：保留原 URL、schema、字段和状态枚举，只对豆包增加新平台值。

- 风险：运营误把自动化测试通过当作正式上线。
  缓解：豆包预置保持关闭；只有 U8 真实入口证据完整后才能启用并关闭需求。

## 11. 假设与开放问题

以下技术问题由 U1 在实现前确认：

- 豆包正式会话入口和允许源站的精确值。
- 新会话、输入区、联网搜索开关、当前回答、生成结束和引用区域的稳定页面语义。
- 搜索开启状态是否在新会话间继承，以及每次重置后的实际行为。
- 引用 href 是否直接指向来源，还是需要处理豆包安全跳转。
- 页面是否提供可验证的检索候选；若没有，第一版返回空候选，不使用未公开接口补齐。
- 目标虚拟机同时运行两个有头 Chrome 时的资源阈值。

若无法可靠验证联网搜索状态、无法隔离新会话，或无法唯一识别当前最终回答，则保持需求为 `blocked`，不进入正式接入。

## 12. 后续衔接

- 可拆 issue：U1–U8 各自形成一个依赖明确的本地 issue。
- 建议第一个 issue：豆包页面契约与双浏览器资源基线。
- 是否适合 TDD：U2–U7 适合严格 Red-Green-Refactor；U1、U8 为需要虚拟机人工参与的 HITL 验收。
- 推荐执行方式：确认 issue 粒度后写入 `issues/`，再使用 `$prd-issue-tdd` 按依赖顺序实施。
