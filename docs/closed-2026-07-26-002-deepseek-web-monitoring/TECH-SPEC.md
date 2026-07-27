---
title: DeepSeek Web 真实页面监测技术方案
date: 2026-07-26
status: closed
source: docs/closed-2026-07-26-002-deepseek-web-monitoring/prd.md
scope: deep
---

# DeepSeek Web 真实页面监测技术方案

## 0. 2026-07-27 正式入口与故障恢复修订

- 品牌项目页不再提供项目级手动运行；手动运行统一从问题库发起，单问题与问题集都使用 `QuestionSetRun` 形成独立报告和重试所有权。
- `POST /api/geo-projects/:projectId/run` 已退役；正式手动接口为单问题 `/prompts/:promptId/run` 和问题集 `/question-sets/:questionSetId/run`。
- 成功采集后保留浏览器会话供下一条 FIFO 任务复用。`renderer_timeout`、连接中断、命令失败和生成超时会映射为明确的 `web_browser_*`/`web_generation_timeout` 错误并回收会话；下一条任务启动新 Chrome。单条 CDP 命令超时为 30 秒，整次回答仍受 `DEEPSEEK_WEB_TIMEOUT_SECONDS` 控制。
- 运行失败后不自动再次发送同一问题；用户从该次运行报告触发重试。平台暂不可用时失败项仍保留，接口明确返回“当前无法重新提交”。

## 1. 背景与目标

本方案在现有 `ai-geo-monitoring` 后端内增加一个最小的 DeepSeek Web UI 采集通道。正式项目仍使用现有项目、问题集、调度、历史、分析和报表链路；Web Adapter 只负责取得真实页面中可见的回答、明确引用和页面证据。

需要建立以下技术不变量：

1. `deepseek` 只表示 DeepSeek API，`deepseek-web` 只表示 DeepSeek 官方网页样本。
2. DeepSeek Web 通过真实 Chrome 页面交互采集，不读取、保存或重放浏览器会话凭据，不调用网页私有接口。
3. 每个问题使用新对话，发送前必须确认联网搜索已开启，发送后不自动提交第二次。
4. DOM 可见正文和页面截图是最终事实；Network 事件只能补充完成判断和检索候选。
5. 同一 Node.js 后端进程内，所有 Web 页面任务进入一个全局 FIFO 串行队列；API 平台不进入该队列。
6. Web 失败不调用 DeepSeek API，不生成替代回答，不把页面旧回答或部分回答写成成功结果。
7. 原回答、明确引用和证据元数据进入现有记录；截图以记录归属的本地文件保存，不在数据库中保存绝对路径。
8. 登录、人工验证、选择器变化、超时和证据失败均有稳定错误码，并保留可审计的失败阶段。

## 2. 范围与非目标

### 2.1 本期范围

- 注册内置平台 `deepseek-web`，显示名“DeepSeek 网页版”。
- 使用本机已安装的 Chrome、专用持久用户目录和现有 `CdpConnection`。
- 增加 `npm run web:login -- deepseek-web` 人工登录命令。
- 支持问题库单问题运行、问题集运行和项目自动监测。
- 增加 Web 平台能力描述、运行前检查、全局 FIFO、熔断状态和优雅关闭。
- 实现新对话、联网搜索验证、问题提交、回答完成判断、正文和引用提取。
- 保存联网状态截图、最终回答截图和有界采集元数据。
- 把 Web 采集结果接入 `ProjectRunService`、`ResultDetail`、`QuestionRecord` 和现有分析链路。
- 在现有历史详情中显示 Web 证据，并提供有鉴权的证据文件读取接口。
- 在普通历史删除、提示词分析清理和项目永久删除时清理证据文件。
- 增加自动化契约测试、集成测试和真实入口人工验收清单。

### 2.2 非目标

- 其他平台的 Web Adapter。
- Playwright、Camoufox、Redis、BullMQ、ClickHouse、代理池或多账号。
- 自动登录、自动输入密码、自动处理验证码或规避平台风控。
- 使用页面会话凭据主动发请求，或将网页私有接口包装成正式 Adapter。
- 多浏览器、多标签并发、多 Node.js 实例协调或独立 Worker。
- 新建 Web 监测管理前端或新的业务数据库表。
- 将 `deepseek-web` 用作结构化分析平台、问题建议生成平台、模型目录来源、API 连接测试、直接 SSE 检测或旧独立定时任务。
- 保证无桌面环境、系统休眠、系统锁屏或无人值守服务器上的可用性。

## 3. 当前系统认知

### 3.1 正式运行链路

- `backend/services/AIPlatformService.js`
  - 是平台查询和平台可用性检查的统一入口。
  - 当前所有查询直接委托给 `AIPlatformRequestService`。
- `backend/services/ProjectRunService.js`
  - 是问题库单问题运行、问题集运行和项目自动监测共用的任务执行链路。
  - `runTarget()` 在记录创建并取得执行租约后调用 `AIPlatformService.queryPlatform()`。
  - 现有 worker 并发最大为 5，适用于 API 平台，但不能直接用于单账号页面交互。
- `backend/services/ProjectRecordFinalizationService.js`
  - 统一处理直接检测与项目记录的最终持久化。
- `backend/services/SchedulerService.js`
  - 项目自动监测最终调用 `ProjectRunService.runProject()`，不需要新建 Web 调度器。
- `backend/services/CdpConnection.js`
  - 已提供 CDP 命令、事件、超时和关闭能力，可作为 Web Adapter 唯一浏览器协议依赖。
- `backend/services/SeoCdpBrowser.js`
  - 使用无头 Chrome 和临时 profile，只可参考 Chrome 启动与 CDP 连接方式。
  - DeepSeek Web 不得复用其临时目录、无头模式、页面状态或 SEO 业务逻辑。

### 3.2 现有数据与分析链路

- `QuestionRecord.result_summary` 可以保存 `web_capture` 有界 JSON 元数据。
- `ResultDetail.ai_response_original` 保存页面最终可见正文。
- `ResultDetail.provider_citations` 保存明确引用和检索候选。
- `CitationAnalysisService` 已区分 `explicit_citation` 与 `retrieval_candidate`，只有明确引用进入引用 KPI。
- `ProjectRunService.persistResultDetail()` 已支持原回答与引用，但成功终态当前会重建 `result_summary`，需要增加显式 merge 契约。
- `ProjectRunService.runTarget()` 当前只从 `aiResult.data` 解析正文与引用，会忽略统一结果中的 `text` 和采集证据，需要改为优先消费标准化字段。
- 结构化分析失败时现有链路可保存原回答；本期必须把 `web_capture` 一并保留。

### 3.3 当前平台配置断点

- `AIPlatformConfigService.ADAPTER_TYPES` 只有两个 OpenAI 兼容 API Adapter。
- `isConfigured()` 和 `getUnavailableReason()` 固定要求 API Key，不适用于人工登录的 Web Adapter。
- 管理页默认展示 API Key、模型刷新、连接测试和联网测试操作。
- AI 结构化分析设置只按 `enabled && configured` 过滤，可能误选新增 Web 平台。
- 平台目录当前没有能力字段，调用方无法区分监测、分析、模型列表和直接检测能力。

### 3.4 当前生命周期与清理断点

- `backend/app.js` 当前没有统一 `SIGINT` / `SIGTERM` 关闭处理。
- 历史单条和批量删除只删除数据库记录。
- `ProjectDeletionService` 和 `PromptAnalysisCleanupService` 不知道本地证据文件。
- 数据库事务不能直接覆盖文件系统操作，需要可补偿的证据删除协议。

### 3.5 测试基线

本期优先扩展：

- `backend/tests/AIPlatformConfigService.test.js`
- `backend/tests/AIPlatformService.test.js`
- `backend/tests/ProjectRunService.test.js`
- `backend/tests/ProjectRecordFinalizationService.test.js`
- `backend/tests/QuestionRecordLeaseFencing.test.js`
- `backend/tests/DetectionHistoryEvidence.test.js`
- `backend/tests/ProjectDeletionService.test.js`
- `backend/tests/AIPlatformsApi.test.js`
- `backend/tests/AIAnalysisSettingsApi.test.js`
- `backend/tests/SchedulerService.test.js`
- `nextjs-frontend/src/utils/aiPlatformCatalogUsage.test.cjs`
- `nextjs-frontend/src/utils/historyCitationSources.test.cjs`
- `nextjs-frontend/src/utils/reportCsv.test.cjs`

新增 Web 专属测试时必须使用 fake CDP、临时目录和合成 DOM，不允许 CI 依赖真实账号或外部 DeepSeek 页面。

## 4. 需求、约束与规则

### 4.1 功能需求

- REQ-001：平台代码固定为 `deepseek-web`，不得归一化、别名映射或回退为 `deepseek`。
- REQ-002：`deepseek-web` 是内置受管平台，不要求 API Key，只允许修改启用状态。
- REQ-003：平台目录和管理接口返回服务端生成的能力描述。
- REQ-004：项目规划阶段必须在创建任务和消费配额前完成 Web 运行前检查。
- REQ-005：所有 DeepSeek Web 查询必须经过同一进程级 FIFO，页面采集最大并发为 1。
- REQ-006：每次查询必须创建并验证新对话，不得以清空输入框或复用当前对话替代。
- REQ-007：发送问题前必须由 DOM 状态确认联网搜索已开启；无法确认时不得发送。
- REQ-008：发送后必须锁定新出现的 assistant turn，旧回答不得成为当前结果。
- REQ-009：成功要求正文非空、生成结束、正文稳定 3 秒、联网状态已证实且最终截图已保存。
- REQ-010：发送后不进行整次自动重试；只有发送前的浏览器启动和导航可以做一次受控恢复。
- REQ-011：正文以当前 assistant turn 的可见 `innerText` 为准，禁止使用整页文本兜底。
- REQ-012：只有当前回答可见引用、关联来源卡片或可见 HTTP/HTTPS 链接记为 `explicit_citation`。
- REQ-013：Network 中无法与可见引用关联的来源最多记为 `retrieval_candidate`，不得进入引用 KPI。
- REQ-014：成功和允许保留证据的失败均可保存 `web_capture`，终态更新必须合并而非覆盖。
- REQ-015：结构化分析失败时保存完整原回答、引用和 Web 证据，并支持现有 analysis-only 重试。
- REQ-016：证据读取必须同时校验记录归属、artifact ID 是否在该记录元数据中以及文件是否存在。
- REQ-017：所有删除 `QuestionRecord` 的正式路径必须同步处理其证据目录。
- REQ-018：应用关闭时停止接收新 Web 任务、有限等待当前任务并关闭 CDP 与 Chrome 子进程。
- REQ-019：登录失效、人工验证和选择器不匹配进入熔断状态，当前及排队任务快速失败。
- REQ-020：Web 失败结果中不存在 API fallback 指令、替代回答或 API Adapter 调用。

### 4.2 约束

- CON-001：第一版只支持单 Node.js 后端进程、单 Chrome、单 profile 和单活动页面。
- CON-002：沿用当前 Node.js 运行时与 `CdpConnection` 使用的原生 WebSocket，不新增浏览器自动化框架、CDP 客户端、队列或数据库依赖。
- CON-003：专用 Chrome 必须有桌面图形会话并以 headed 模式运行。
- CON-004：页面 DOM 与 Network 都属于不稳定外部接口，所有探针必须版本化并默认失败关闭。
- CON-005：API 平台的调用、重试、并发和结果格式保持兼容。
- CON-006：`QuestionRecord`、`ResultDetail` 和 `VisibilityMetric` 不新增字段或新表。
- CON-007：Web 采集最长执行时间计入现有执行租约预算，租约 heartbeat 继续生效。
- CON-008：证据文件只保存在本机，当前版本不承诺跨机器读取。
- CON-009：真实 DeepSeek UI 的选择器只能在实现阶段通过人工登录后的实际页面确认，规格不硬编码未经验证的 CSS 类名。

### 4.3 安全规则

- SEC-001：代码、环境变量、数据库、日志、错误响应和测试 fixture 均不得保存页面认证令牌、Cookie 或完整请求头。
- SEC-002：Network 监听不得调用 `fetch`、`axios` 或 CDP `Network.replayXHR` 重放页面请求。
- SEC-003：允许读取响应体时，只能读取当前页面自然产生、来源在白名单内且已完成的 Fetch/XHR；内存上限 2 MiB，白名单提取后立即丢弃原文。
- SEC-004：页面 URL 只允许 `https://chat.deepseek.com` 精确 origin；重定向到其他 origin 立即失败。
- SEC-005：引用 URL 只接受 `http:` 与 `https:`，长度上限 2048 字符。
- SEC-006：提示词必须作为 CDP 参数或输入事件传递，不得拼接进可执行 JavaScript 源码。
- SEC-007：profile 目录权限为 `0700`，证据文件为 `0600`；不得使用日常 Chrome 用户目录。
- SEC-008：对外只返回随机 artifact ID，不返回 profile、staging、证据根目录或文件绝对路径。
- SEC-009：错误日志采用字段白名单，只允许记录 `record_id`、平台代码、阶段、错误码、选择器版本、耗时和有界计数。

### 4.4 兼容与实现规则

- PAT-001：平台目录和统一查询结果只增加可选字段，API 平台调用方保持可读。
- PAT-002：能力由 Adapter 类型映射生成，不在数据库复制一份可漂移配置。
- PAT-003：Web Adapter 只产生采集结果，不直接写业务数据库或调用分析服务。
- PAT-004：`ProjectRunService` 是项目监测唯一持久化入口；不新建 Web 任务表和旁路 executor。
- PAT-005：错误继续使用现有 `{ success, message, error }` 外层；机器可读值放在 `error.code` 或内部查询结果 `error_code`。
- PAT-006：选择器、采集元数据和错误码均使用稳定版本号或枚举，页面原始错误不直接透传。
- PAT-007：静态平台可配置性与动态 Web 运行时可用性分开：平台可以出现在选择列表，但运行规划必须再次 preflight。

## 5. 接口与数据契约

### 5.1 平台注册与能力

新增受管 Adapter 类型：

```text
adapter_type = deepseek_web
platform code = deepseek-web
platform name = DeepSeek 网页版
base_url = https://chat.deepseek.com
default_model = deepseek-web-ui
```

`default_model` 是网页样本标识，不声称 DeepSeek 内部实际模型版本。

`AIPlatformConfigService` 将 Adapter 分成两组：

- 可由管理员新增的 API Adapter：`openai_responses`、`openai_chat_completions`。
- 仅供内置预设使用的受管 Adapter：`deepseek_web`。

若已有非内置平台占用保留代码 `deepseek-web`，启动时返回 `reserved_platform_code_conflict` 并停止平台初始化，不静默改写用户配置。

平台目录和管理接口增加：

```json
{
  "code": "deepseek-web",
  "name": "DeepSeek 网页版",
  "adapter_type": "deepseek_web",
  "configured": true,
  "selectable": true,
  "unavailable_reason": null,
  "capabilities": {
    "monitoring": true,
    "analysis": false,
    "prompt_generation": false,
    "model_listing": false,
    "api_key_management": false,
    "connection_test": false,
    "api_web_search_test": false,
    "direct_stream": false,
    "legacy_schedule": false,
    "interactive_login": true
  }
}
```

规则：

- Web 平台的 `configured` 表示受管配置完整，不表示当前已登录。
- `selectable` 表示可加入项目；真正运行前由动态 preflight 决定本次是否可运行。
- API 平台缺少 `capabilities` 的旧客户端仍按原字段工作；新服务端始终返回完整能力。
- Web 平台在管理页只显示平台类型、固定网址、网页样本标识、启用状态和“需人工登录”状态，不展示密钥、模型刷新或 API 测试按钮。

### 5.2 统一平台查询结果

`AIPlatformService.queryPlatform(platform, question, options)` 保持方法签名，增加 Web 路由和以下可选字段。

成功：

```json
{
  "success": true,
  "platform": "deepseek-web",
  "model_name": "deepseek-web-ui",
  "text": "页面当前回答的可见正文",
  "data": {},
  "responseTime": 12345,
  "provider_citations": [
    {
      "url": "https://example.com/source",
      "domain": "example.com",
      "title": "页面可见来源标题",
      "source_origin": "deepseek_web_dom",
      "source_role": "explicit_citation"
    }
  ],
  "web_capture": {}
}
```

失败：

```json
{
  "success": false,
  "platform": "deepseek-web",
  "error_code": "web_login_required",
  "error": "DeepSeek 网页登录已失效，请重新执行人工登录命令",
  "web_capture": {
    "schema_version": "deepseek-web-capture-v1",
    "status": "failed",
    "failure": {
      "stage": "preflight",
      "error_code": "web_login_required"
    }
  }
}
```

规则：

- `ProjectRunService` 优先使用 `aiResult.text`，为空时才沿用现有 API `ResultParserService`。
- `provider_citations` 存在时直接使用；不存在时才从 API `data` 生成快照。
- `web_capture` 不放入 `data`，避免现有引用递归扫描把页面 URL 或证据字段误判为引用。
- API Adapter 不需要生成 `web_capture`，现有结果保持不变。
- `AIPlatformService` 只能按精确 Adapter 类型分派，Web 分支中不得导入或调用 DeepSeek API Adapter。

平台选择方法增加可选能力参数：

```text
getAvailablePlatforms({ capability = "monitoring" })
getPlatformAvailability(codes, { capability = "monitoring", runtimeProbe = true })
```

- 单问题、问题集和项目自动监测使用 `monitoring`。
- AI 结构化分析使用 `analysis`。
- 问题建议生成使用 `prompt_generation`。
- 直接检测与 SSE 使用 `direct_stream`。
- 旧独立定时任务使用 `legacy_schedule`。
- 模型和连接测试在对应管理接口分别检查 `model_listing`、`connection_test` 和 `api_web_search_test`。
- `runtimeProbe=false` 只返回静态配置能力；`runtimeProbe=true` 时才对 Web 平台执行登录和页面 preflight。

### 5.3 查询上下文

项目运行调用 Web Adapter 时，`options` 增加仅供内部使用的有界上下文：

```json
{
  "purpose": "project_monitoring",
  "capture_owner": {
    "record_id": 123,
    "user_id": 7,
    "project_id": 42,
    "execution_token": "opaque-runtime-value"
  }
}
```

规则：

- `capture_owner` 不进入日志或前端响应。
- Web 查询必须有正整数 `record_id` 与 `user_id`；缺失时返回 `web_capture_owner_missing`。
- `execution_token` 只用于本地迟到 worker 清理，不写入证据元数据。
- `deepseek_web` 只接受 `purpose=project_monitoring`；缺失或其他 purpose 返回 `unsupported_platform_capability`。
- 直接 SSE、问题建议、AI 结构化分析与旧独立任务即使伪造 `capture_owner`，也会先被 capability/purpose 检查拒绝。

### 5.4 `QuestionRecord.result_summary.web_capture`

成功记录：

```json
{
  "web_capture": {
    "schema_version": "deepseek-web-capture-v1",
    "selector_version": "deepseek-web-selectors-v1",
    "status": "completed",
    "artifact_owner_record_id": 123,
    "page_origin": "https://chat.deepseek.com",
    "page_url": "https://chat.deepseek.com/a/chat/s/opaque-conversation-id",
    "started_at": "2026-07-26T10:00:00.000Z",
    "completed_at": "2026-07-26T10:00:20.000Z",
    "captured_at": "2026-07-26T10:00:21.000Z",
    "response_sha256": "64-char-lowercase-hex",
    "search": {
      "requested": true,
      "observed": true,
      "evidence_type": "dom_selected_state"
    },
    "completion": {
      "state": "stable",
      "stable_ms": 3000,
      "new_assistant_turn": true,
      "generation_control_absent": true
    },
    "browser": {
      "product": "Chrome",
      "version": "major.minor.build.patch",
      "user_agent": "bounded user agent",
      "locale": "zh-CN",
      "timezone_offset_minutes": 480,
      "viewport": {
        "width": 1440,
        "height": 900,
        "device_scale_factor": 2
      }
    },
    "client": {
      "platform": "web",
      "version": "bounded observed version",
      "bundle_id": "bounded observed bundle id"
    },
    "artifacts": {
      "search_state": {
        "id": "random-uuid",
        "sha256": "64-char-lowercase-hex",
        "mime_type": "image/png",
        "bytes": 123456,
        "width": 800,
        "height": 400
      },
      "final_answer": {
        "id": "random-uuid",
        "sha256": "64-char-lowercase-hex",
        "mime_type": "image/png",
        "bytes": 456789,
        "width": 1000,
        "height": 1400
      }
    }
  }
}
```

边界：

- `web_capture` 序列化后最大 32 KiB。
- 回答正文最大 1 MiB；超过时失败为 `web_response_too_large`，不得截断后标记成功。
- 明确引用与检索候选合计最多 200 项，沿用现有标准化上限。
- `page_url` 最大 2048 字符且必须保持 DeepSeek 精确 origin。
- `user_agent` 最大 512 字符；client 字段各最大 80 字符。
- 截图单文件最大 10 MiB；超限先缩小截图范围或改用质量受控格式，仍超限则失败。
- 最终截图用于证明当前回答页面状态，不承诺单张图片覆盖任意长度的完整回答；完整正文和 SHA-256 才是文本事实。
- 失败元数据只保存已完成的有界阶段、错误码和可用证据，不保存部分正文。

analysis-only 重试不复制截图文件。新记录复制 `web_capture` 元数据并保留原始 `artifact_owner_record_id`；证据读取仍对该原始记录做所有者检查。当前问题集历史记录受现有保护规则约束，不允许单独删除，因此不会产生悬空引用。

### 5.5 证据文件存储

默认根目录：

```text
<repository>/.runtime/deepseek-web/evidence
```

内部布局：

```text
evidence/
  .staging/<capture-id>/<artifact-id>.png
  records/<record-id>/<artifact-id>.png
  .trash/<delete-operation-id>/<record-id>/<artifact-id>.png
```

`WebCaptureStore` 契约：

- `beginCapture(owner)`：创建隔离 staging 目录。
- `writeArtifact(capture, kind, buffer, metadata)`：校验格式、尺寸、大小并以 `0600` 原子写入。
- `promoteCapture(capture)`：回答和必需证据完成后，原子移动到 `records/<record-id>`，返回不透明 artifact 元数据。
- `discardCapture(capture)`：任务发送前失败、迟到 worker 或持久化失败时幂等删除 staging/final 文件。
- `openArtifact(recordId, artifactId)`：只接受已验证正整数和 UUID，解析后仍检查最终路径位于证据根目录内。
- `quarantineRecords(recordIds, operationId)`：删除数据库记录前，把记录目录原子移入 `.trash`。
- `restoreQuarantine(operationId)`：数据库回滚时恢复目录。
- `commitQuarantine(operationId)`：数据库提交后物理删除隔离目录。
- `reconcileTrash()`：启动时清理已隔离但未删除的目录，不扫描或读取 Chrome profile。

文件与数据库没有跨介质事务。正式删除路径采用“先隔离、数据库事务、提交后清理、回滚时恢复”的补偿协议；只有 `commitQuarantine()` 成功后接口才返回删除成功。提交后清理失败返回 `web_capture_cleanup_incomplete`，隔离证据已经无法经 API 访问，下一次启动继续清理。

### 5.6 证据读取接口

新增：

```text
GET /api/detection/record/:recordId/web-captures/:artifactId
```

处理顺序：

1. 通过现有 `authRequired`。
2. 读取 `QuestionRecord`，检查当前用户是记录所有者或管理员。
3. 从 `result_summary.web_capture.artifacts` 中确认 artifact ID，并解析 `artifact_owner_record_id`。
4. analysis-only 引用原证据时，再读取原始所有者记录并验证同一用户或管理员。
5. 调用 `WebCaptureStore.openArtifact()`。
6. 流式返回文件。

响应头：

```text
Content-Type: image/png
Content-Disposition: inline
Cache-Control: private, no-store
X-Content-Type-Options: nosniff
```

错误：

- 400 `invalid_web_capture_reference`
- 403 `web_capture_forbidden`
- 404 `web_capture_not_found`
- 410 `web_capture_missing`

接口不提供目录列表、文件上传、路径参数或公开分享链接。

### 5.7 Web 错误码

| 错误码 | 阶段 | 行为 |
| --- | --- | --- |
| `web_browser_not_configured` | preflight | 本次平台不可用，不创建该平台任务 |
| `web_browser_launch_failed` | preflight/request | 失败；允许发送前一次受控恢复 |
| `web_profile_in_use` | preflight | 平台不可用，提示关闭其他专用会话 |
| `web_login_required` | preflight/request | 熔断，要求重新人工登录 |
| `web_verification_required` | preflight/request | 熔断，不自动处理 |
| `web_selector_mismatch` | preflight/request | 熔断，要求更新选择器版本 |
| `web_new_conversation_failed` | request | 未发送问题，记录失败 |
| `web_search_unverified` | request | 不发送问题，记录失败 |
| `web_prompt_input_failed` | request | 未确认发送，记录失败 |
| `web_prompt_send_failed` | request | 不自动重发，记录失败 |
| `web_generation_timeout` | response | 不保存部分正文，不自动重发 |
| `web_response_incomplete` | response | 不保存部分正文 |
| `web_response_too_large` | response | 不截断为成功 |
| `web_capture_failed` | evidence | 不标记成功 |
| `web_browser_closed` | request/response | 失败并重置浏览器会话 |
| `web_capture_owner_missing` | integration | 拒绝旁路调用 |
| `web_shutdown` | lifecycle | 排队任务快速失败 |

映射到 `QuestionRecord.result_summary.failure.stage`：

- preflight 失败在规划阶段进入 `skipped_platforms`，不创建记录。
- 已创建记录的页面请求失败使用 `monitoring_request`。
- 回答完成或正文失败使用 `monitoring_response`。
- 截图和证据失败使用 `monitoring_evidence`。
- 结构化分析仍沿用 `analysis_request` / `analysis_validation`。

### 5.8 本地命令与环境变量

`backend/package.json` 增加：

```text
npm run web:login -- deepseek-web
```

命令行为：

1. 加载 `backend/.env` 和 Web 运行时配置。
2. 获取专用 profile 排他锁。
3. 以 headed 模式启动本机 Chrome 并打开 DeepSeek 官方页面。
4. 用户完全人工完成登录和验证。
5. 检测到唯一可用的对话输入区后显示登录成功。
6. 正常关闭 CDP 与 Chrome，但保留 profile。
7. Ctrl+C 或超时只关闭进程，不删除 profile。

若后端正在持有专用 profile，命令返回 `web_profile_in_use`；不尝试连接用户日常 Chrome。

新增环境变量：

- `DEEPSEEK_WEB_CHROME_EXECUTABLE`：可选；未设置时只检查受支持的本机 Chrome 路径。
- `DEEPSEEK_WEB_PROFILE_DIR`：可选；默认 `.runtime/deepseek-web/profile`。
- `DEEPSEEK_WEB_EVIDENCE_DIR`：可选；默认 `.runtime/deepseek-web/evidence`。
- `DEEPSEEK_WEB_TIMEOUT_SECONDS`：可选，30–600，默认 180。

不增加 Token、Cookie、认证头或网页私有接口 URL 环境变量。

## 6. 组件与运行流程

### 6.1 组件边界

```text
ProjectRunService
  └─ AIPlatformService
      ├─ AIPlatformRequestService        # 现有 API Adapter
      └─ WebPlatformService              # Web preflight、FIFO、浏览器生命周期
          └─ DeepSeekWebAdapter           # 页面语义流程与提取
              ├─ CdpConnection            # 现有底层 CDP
              ├─ deepseekWebSelectors     # 版本化语义探针
              └─ WebCaptureStore          # staging、证据、读取与清理
```

边界：

- `AIPlatformService` 只负责按 Adapter 类型分派和统一结果。
- `WebPlatformService` 只负责单会话、全局串行、preflight、熔断和关闭。
- `DeepSeekWebAdapter` 不知道 Sequelize 模型，也不调用分析服务。
- `WebCaptureStore` 不决定用户权限；路由先鉴权，Store 只做安全文件操作。
- `ProjectRunService` 是采集结果进入数据库和指标链路的唯一入口。

### 6.2 运行前检查

项目规划调用 `AIPlatformService.getPlatformAvailability()` 时：

1. API 平台沿用现有配置检查。
2. `deepseek-web` 调用 `WebPlatformService.preflight()`。
3. preflight 通过 FIFO/single-flight 执行，结果缓存最多 30 秒，错误熔断状态不缓存为成功。
4. 检查 Chrome 可执行文件、目录权限、profile 锁、页面 origin、登录标记和选择器契约。
5. 不发送问题，不创建新对话，不截图，不消费配额。
6. 不可用时返回稳定 reason，现有项目规划把平台放入 `skipped_platforms`。

平台目录 GET 不启动 Chrome，只返回静态 `configured/selectable/capabilities`。

### 6.3 页面会话

`WebPlatformService`：

- 为整个进程维护一个 Promise tail FIFO，前一个任务失败后队列仍继续结算。
- 维护状态：`stopped | starting | ready | login_required | verification_required | selector_mismatch | closing`。
- Chrome 使用专用 profile、随机本机调试端口和 `127.0.0.1` 调试地址。
- 只保留一个受控页面 target；多余 DeepSeek 页面关闭，扩展页或内部页不作为采集目标。
- profile 使用应用排他锁；第二后端实例或登录命令不能同时取得锁。
- `login_required`、`verification_required`、`selector_mismatch` 状态下，新任务不再导航或刷新，直接返回对应错误。
- 成功执行 `web:login` 或后端重启后重新 preflight 才可解除熔断。

应用关闭时：

1. 将状态改为 `closing`，拒绝新任务。
2. 最多等待当前 Web 任务 10 秒。
3. 未完成任务返回 `web_shutdown`，不能写成功终态。
4. 关闭 CDP，向本进程启动的 Chrome 发送终止信号，2 秒后仍未退出才强制终止。
5. 释放 profile 锁。
6. 调用 `SchedulerService.stop()` 并关闭 HTTP server。

`backend/app.js` 必须保存 `app.listen()` 返回值，并为 `SIGINT` / `SIGTERM` 注册幂等关闭函数。

### 6.4 版本化页面探针

新增 `backend/config/deepseekWebSelectors.js`，导出：

- `selectorVersion`
- `allowedOrigins`
- `loginMarkers`
- `verificationMarkers`
- `composer`
- `newConversationControl`
- `searchToggle`
- `assistantTurns`
- `generationControls`
- `citationAnchors`
- `citationCards`

每个探针由“候选选择器 + 语义断言”组成。语义断言至少检查可见性、唯一性、控件角色、关联区域和状态属性。不得使用以下兜底：

- 整页 `body.innerText` 作为回答。
- 页面最后一个任意链接作为引用。
- 单独以按钮文案消失判断完成。
- 找不到新对话控件时继续复用当前对话。
- 找不到联网开关时假定已开启。

任一必需探针无匹配或多义匹配均返回 `web_selector_mismatch`。

### 6.5 单问题采集状态机

```text
queued
  → session_ready
  → new_conversation_verified
  → search_enabled_verified
  → search_evidence_saved
  → prompt_inserted
  → prompt_sent
  → new_assistant_turn_seen
  → generation_finished
  → text_stable_3000ms
  → content_extracted
  → final_evidence_saved
  → completed
```

规则：

- 在 `prompt_sent` 前允许重新启动一次本进程 Chrome 或重新导航一次官方页面。
- 从 `prompt_sent` 起禁止整次自动重试和第二次 Enter。
- 发送前记录现有 assistant turn 的稳定标识或数量；发送后只接受新出现且位于当前对话的 turn。
- 正文每 500 ms 采样一次，连续 3 秒相同且生成控件结束才进入提取。
- 生成控件结束需要“停止生成控件不存在或不可用”以及页面没有忙碌状态；它不是唯一成功条件。
- 超过 `DEEPSEEK_WEB_TIMEOUT_SECONDS` 返回 `web_generation_timeout`。
- 截图在发送前、联网状态已确认后保存 search state；最终正文稳定后保存 final answer。
- 截图裁剪当前主会话区域，避免侧栏中的历史对话标题进入证据。

### 6.6 Network 辅助观测

Adapter 只调用 CDP `Network.enable` 并监听当前页面自然产生的事件。

允许用途：

- 观察页面请求是否仍有当前回答关联的流式活动。
- 从白名单字段提取客户端版本、平台标识和检索候选。
- 在 DOM 状态之外增加完成证据，但不能单独决定成功。

禁止用途：

- 读取或持久化请求认证头。
- 使用请求头或响应内容构造新的 HTTP 请求。
- 将完整响应体、SSE 流或未知字段写入日志/数据库。
- 用 Network 正文替代 DOM 可见正文。
- 把没有页面关联证据的候选提升为明确引用。

响应体读取只接受精确 DeepSeek origin、Fetch/XHR、2 MiB 以内和已知 content type；解析器只返回白名单字段，原始 buffer 随任务结束释放。

### 6.7 持久化与终态

`ProjectRunService.runTarget()` 调整：

1. 创建/领取 `QuestionRecord` 后，把 owner 上下文传入平台查询。
2. Web 成功时使用 `aiResult.text`、`aiResult.provider_citations`、`aiResult.web_capture`。
3. Web 失败时把允许保留的 `web_capture` 合并到失败摘要。
4. `ProjectRecordFinalizationService.finalize()` 和 `finalizeSuccessfulRecord()` 增加 `resultSummaryPatch`。
5. 所有终态摘要使用：

```text
retry metadata
  + existing bounded summary
  + resultSummaryPatch
  + keyword_counts / failure / analysis
```

6. 在同一数据库事务中保存 `ResultDetail`、指标和终态记录。
7. 结构化分析失败走现有 `failRecord()`，但仍传递 `persistResponseDetail` 和 `resultSummaryPatch`。
8. 执行租约已失效时拒绝终态写入，并调用 `WebCaptureStore.discardCapture()` 清理当前迟到 worker 新产生的证据。

不允许成功终态覆盖已有 `web_capture`。`resultSummaryPatch` 只能包含服务端生成、已通过 32 KiB 校验的对象。

## 7. 关键技术决策

- KTD-001：在 `AIPlatformService` 内按 Adapter 类型分流，不新建任务系统。
  - 理由：单问题、问题集和项目自动监测已经收敛到 `ProjectRunService`，旁路任务会复制配额、租约、历史和重试语义。
- KTD-002：只复用 `CdpConnection`，DeepSeek 会话不复用 `SeoCdpBrowser`。
  - 理由：SEO 浏览器的无头模式、临时 profile 和自动删除生命周期与人工登录相冲突。
- KTD-003：DOM 可见内容和截图是最终事实，Network 只是受限补充。
  - 理由：目标是监测用户看到的页面结果，而不是复刻网页内部接口。
- KTD-004：Web 串行使用单进程 Promise FIFO，不引入 Redis/BullMQ。
  - 理由：第一版明确是本机单进程；Promise tail 足以保证本进程并发为 1，并且不影响 API worker 并发。
- KTD-005：页面不可恢复状态使用熔断而不是反复刷新。
  - 理由：登录失效、验证码和选择器变化无法由自动刷新可靠解决，重复访问会增加风控。
- KTD-006：发送后不自动重试。
  - 理由：无法可靠证明第一次提交是否已经被服务端接收，重试会制造重复样本。
- KTD-007：平台能力由 Adapter 类型派生，不新增数据库列。
  - 理由：能力是代码契约，不是管理员可编辑数据；派生可以防止配置漂移。
- KTD-008：截图采用记录归属的本地文件存储，数据库只保存不透明 ID、哈希和有界元数据。
  - 理由：避免数据库膨胀、路径泄露和未鉴权静态文件访问。
- KTD-009：证据写入使用 staging→promote，删除使用 quarantine→DB transaction→commit/restore。
  - 理由：数据库与文件系统没有共同事务，需要原子重命名和补偿操作约束不一致窗口。
- KTD-010：不新增业务表。
  - 理由：现有 `ResultDetail` 与 `QuestionRecord.result_summary` 已能表达正文、引用和有界采集证据。
- KTD-011：运行规划执行动态 preflight，目录读取不启动浏览器。
  - 理由：选择列表必须快速稳定，但创建任务和消费配额前必须知道本次登录与页面状态。
- KTD-012：`deepseek-web` 是受管内置平台，第一版只允许启停。
  - 理由：开放编辑 origin、Adapter 或网页样本标识会破坏安全边界和样本身份。
- KTD-013：真实选择器不写死在本规格中，而由版本化语义探针和真实入口验收共同确认。
  - 理由：未经实际页面验证的类名会制造假确定性；默认失败比宽泛 DOM 兜底更可信。

## 8. 实现切片

### U-001 平台注册与能力边界

- 目标：让 `deepseek-web` 成为可选择但不能被 API 专属功能误用的受管平台。
- 依赖：无。
- 修改文件：
  - `backend/services/AIPlatformConfigService.js`
  - `backend/services/AIAnalysisConfigService.js`
  - `backend/services/PromptSuggestionService.js`
  - `backend/routes/adminAIPlatforms.js`
  - `backend/routes/detection.js`
  - `backend/routes/geoProjects.js`
  - `backend/services/SchedulerService.js`
  - `backend/tests/AIPlatformConfigService.test.js`
  - `backend/tests/AIPlatformsApi.test.js`
  - `backend/tests/AIAnalysisSettingsApi.test.js`
  - `backend/tests/PromptSuggestionService.test.js`
- 实施：
  - 增加受管 Adapter、预设、保留代码冲突检查和 Adapter 感知的配置判断。
  - 给 catalog/admin view 增加 capabilities。
  - 给平台选择与可用性方法增加 capability 参数，所有调用方传入明确用途。
  - 所有 API 专属服务端入口按 capability 拒绝 Web 平台。
  - 保持 `deepseek` 原预设和历史不变。
- 测试：
  - Web 无 API Key 仍为静态 configured/selectable。
  - 受管字段不可编辑，API Key/模型/测试接口返回稳定 capability 错误。
  - 分析、提示词生成、SSE 和旧定时入口均拒绝 Web。
  - 保留代码冲突不静默覆盖。
- 切片验收：平台目录能同时返回 `deepseek` 与 `deepseek-web`，能力互不混淆。

### U-002 本地证据存储与鉴权读取

- 目标：建立不暴露路径、可校验、可清理的截图证据生命周期。
- 依赖：U-001 的平台代码约定。
- 新增文件：
  - `backend/services/WebCaptureStore.js`
  - `backend/routes/webCaptures.js`
  - `backend/tests/WebCaptureStore.test.js`
  - `backend/tests/WebCaptureRoute.test.js`
- 修改文件：
  - `backend/app.js`
  - `backend/routes/detection.js`
  - `backend/services/ProjectDeletionService.js`
  - `backend/services/PromptAnalysisCleanupService.js`
  - `backend/tests/DetectionHistoryEvidence.test.js`
  - `backend/tests/ProjectDeletionService.test.js`
- 实施：
  - 实现 staging、promote、discard、open、quarantine、restore、commit 和启动清理。
  - 增加 owner/admin 鉴权的流式证据接口。
  - 把所有正式 `QuestionRecord` 删除路径接到补偿协议。
- 测试：
  - 路径穿越、非 UUID、跨用户、未引用 artifact 均拒绝。
  - 文件哈希、大小、权限和响应头正确。
  - DB 回滚恢复 quarantine；提交后删除文件；清理失败不可通过 API 访问。
- 切片验收：合成记录可以保存、授权读取并在删除后清理证据。

### U-003 专用 Chrome 会话与人工登录

- 目标：使用固定 profile 建立可跨服务重启复用的 headed Chrome 会话。
- 依赖：U-002 的运行时目录约定。
- 新增文件：
  - `backend/services/WebPlatformService.js`
  - `backend/scripts/deepseekWebLogin.js`
  - `backend/tests/WebPlatformService.test.js`
- 修改文件：
  - `backend/package.json`
  - `backend/app.js`
  - `backend/.env.example`
  - `docs/ENVIRONMENT.md`
- 实施：
  - 实现 Chrome 可执行文件发现、目录校验、profile 排他锁、随机本机 CDP 端口和单页面生命周期。
  - 实现 FIFO、preflight、熔断、登录命令和优雅关闭。
  - 不导入 `SeoCdpBrowser`，只使用 `CdpConnection`。
- 测试：
  - fake Chrome/CDP 验证 FIFO 最大活动数为 1，失败不毒化队列。
  - profile 冲突、非法目录、浏览器关闭和 shutdown 返回稳定错误。
  - API Promise 不进入 Web 队列。
- 切片验收：人工登录后关闭命令、重启后端，preflight 能在同一 profile 识别已登录状态。

### U-004 DeepSeek 页面 Adapter

- 目标：完成单问题真实页面采集，不接触业务数据库。
- 依赖：U-002、U-003。
- 新增文件：
  - `backend/services/DeepSeekWebAdapter.js`
  - `backend/config/deepseekWebSelectors.js`
  - `backend/tests/DeepSeekWebAdapter.test.js`
  - `backend/tests/fixtures/deepseek-web/`
- 实施：
  - 实现版本化探针、新对话、联网验证、截图、输入、发送、新 turn 锁定、稳定判断和提取。
  - 实现严格 origin 的 Network 白名单解析和 retrieval candidate。
  - 生成统一成功/失败查询结果。
- 测试：
  - 两个连续问题必须选择不同的新 turn。
  - 联网状态未确认时没有 Input/Enter 发送事件。
  - 发送后超时只发送一次。
  - 旧回答、部分回答、选择器多义、截图失败均不能成功。
  - DOM 明确引用进入 KPI 角色，Network-only 候选保持 retrieval。
  - 合成敏感头不会进入返回值、日志或 fixture 快照。
- 切片验收：合成 CDP 页面脚本可完整走通状态机并生成正文、引用和两项证据。

### U-005 统一平台分流与动态可用性

- 目标：把 Web Adapter 接入正式平台门面，并在配额前完成 preflight。
- 依赖：U-001、U-003、U-004。
- 修改文件：
  - `backend/services/AIPlatformService.js`
  - `backend/services/ProjectRunService.js`
  - `backend/services/PlatformSelectionService.js`
  - `backend/tests/AIPlatformService.test.js`
  - `backend/tests/ProjectRunService.test.js`
- 实施：
  - 按 `config.adapter_type` 精确路由 API 或 Web。
  - `getPlatformAvailability()` 增加 Web 动态检查和 30 秒 single-flight cache。
  - 项目规划把不可用 Web 放入 skipped platforms，且不为其建记录或扣配额。
  - 禁止任何 Web→API fallback 分支。
- 测试：
  - API Adapter 结果和并发语义不变。
  - Web 只调用 Web service；失败时 API request service 调用次数为 0。
  - Web 不可用且无其他平台时无任务、无配额；有其他平台时其余平台继续。
- 切片验收：现有项目入口选择 Web 后，正式 query 确实进入 Web Adapter。

### U-006 原回答、引用、证据与分析终态

- 目标：让 Web 结果通过现有持久化和分析链路完成闭环。
- 依赖：U-002、U-005。
- 修改文件：
  - `backend/services/ProjectRunService.js`
  - `backend/services/ProjectRecordFinalizationService.js`
  - `backend/services/CitationAnalysisService.js`
  - `backend/tests/ProjectRunService.test.js`
  - `backend/tests/ProjectRecordFinalizationService.test.js`
  - `backend/tests/QuestionRecordLeaseFencing.test.js`
  - `backend/tests/CitationAnalysisService.test.js`
- 实施：
  - 消费 `text`、`provider_citations` 和 `web_capture`。
  - 增加 `resultSummaryPatch` 的有界 merge。
  - 成功、分析失败、采集失败和迟到 worker 路径分别处理证据保留或清理。
  - analysis-only 重试保留原 artifact owner 引用。
- 测试：
  - 成功记录写入原回答、明确引用、retrieval candidate、指标和 web_capture。
  - 无明确引用是成功且 citation_count 为 0。
  - 分析失败仍保存原回答、引用和证据，不保存成功指标。
  - 终态 merge 不覆盖 web_capture。
  - 迟到 worker 不能写终态且新证据被清理。
- 切片验收：现有品牌、竞品、情绪、排名和引用分析可消费 Web 正文且不改变计算口径。

### U-007 现有前端中的能力过滤与证据展示

- 目标：不新建管理页面，只在现有设置、项目选择、历史详情和报告中正确展示 Web 平台。
- 依赖：U-001、U-002、U-006。
- 修改文件：
  - `nextjs-frontend/src/lib/useAIPlatformCatalog.ts`
  - `nextjs-frontend/src/app/admin/settings/AIPlatformSettings.tsx`
  - `nextjs-frontend/src/app/admin/settings/AIAnalysisSettings.tsx`
  - `nextjs-frontend/src/app/admin/history/page.tsx`
  - `nextjs-frontend/src/app/geo/prompts/page.tsx`
  - `nextjs-frontend/src/app/geo/question-set-reports/page.tsx`
  - `nextjs-frontend/src/utils/reportCsv.cjs`
  - 对应 `nextjs-frontend/src/utils/*.test.*`
- 实施：
  - 扩展平台类型与 capabilities。
  - 设置页对 Web 隐藏 API 专属操作，只允许启停并显示人工登录说明。
  - 分析设置只显示 `capabilities.analysis=true`。
  - 项目选择显示 Web；直接检测入口只显示 `direct_stream=true`。
  - 历史详情显示搜索状态、采集时间、选择器版本和两张证据图链接。
  - 平台筛选、报告与 CSV 保留 `deepseek-web` 原代码和“DeepSeek 网页版”名称。
  - 被修改的 API 请求统一使用 `@/lib/axiosConfig`。
- 测试：
  - Web 不出现在分析/model/API test/direct stream 控件。
  - Web 出现在项目监测选择。
  - 历史证据链接使用记录 ID 与 artifact ID，不包含本机路径。
  - 报告和 CSV 不把 Web 合并为 API。
- 切片验收：用户可以从现有页面选择 Web 并在历史详情复核证据。

### U-008 文档、真实入口验收与正式生效

- 目标：从真实入口证明会话复用、三类运行入口、样本隔离和无 fallback。
- 依赖：U-001 至 U-007。
- 修改文件：
  - `README.md`
  - `CONTEXT.md`
  - `docs/README.md`
  - `docs/ENVIRONMENT.md`
  - `backend/.env.example`
  - 本需求目录中的 PRD、Tech Spec 与 issues 状态
- 实施：
  - 记录本机配置、人工登录、重登录、运行、错误处理和证据读取方法。
  - 真实执行人工登录、后端重启、问题库单问题运行、问题集运行和项目自动监测。
  - 验收通过后把需求目录改为 `closed-...`；未通过真实页面验收不得宣称正式完成。
- 验证：
  - 保存脱敏运行日志、数据库记录断言和页面证据。
  - 代码搜索证明无 Web→API fallback、认证 Token 配置或私有接口直连。
  - 全量后端测试、前端 lint/build/test 通过。
- 切片验收：正式入口默认走新 Web Adapter，且 API/Web 历史、错误和证据均可独立核验。

## 9. 验收追踪

| PRD AC | 实现切片 | 主要证据 |
| --- | --- | --- |
| AC-001、AC-002、AC-027、AC-028 | U-001、U-007 | 平台目录、能力过滤、历史/CSV 测试 |
| AC-003、AC-004、AC-005 | U-003、U-008 | 人工登录、服务重启、profile 路径与权限检查 |
| AC-006、AC-007 | U-005、U-008 | 单问题、问题集、自动监测真实入口 |
| AC-008、AC-009 | U-004 | 新对话和联网状态机测试、页面证据 |
| AC-010、AC-011 | U-002、U-004、U-006 | 正文、元数据、两项 artifact 与完成条件 |
| AC-012、AC-013、AC-014 | U-004、U-006 | 引用角色与现有指标集成测试 |
| AC-015 | U-006 | 分析失败保留证据、analysis-only 测试 |
| AC-016、AC-017 | U-003、U-005 | FIFO 最大活动数和 API 并发测试 |
| AC-018、AC-019 | U-003、U-004 | 错误码矩阵与熔断测试 |
| AC-020、AC-021、AC-022 | U-004、U-005、U-006 | 单次发送、API 调用次数 0、无成功指标 |
| AC-023、AC-024 | U-004、U-008 | Network 白名单测试与敏感字段代码搜索 |
| AC-025、AC-026 | U-002 | owner/admin 鉴权、quarantine 删除测试 |
| AC-029、AC-030 | U-008 | 真实入口报告、全量测试和代码搜索 |

## 10. 测试与验证计划

### 10.1 单元测试

- 平台：
  - Adapter 感知的 `configured/unavailable_reason/capabilities`。
  - 受管平台不可变字段和保留代码冲突。
- 队列与生命周期：
  - FIFO 顺序、最大并发 1、任务拒绝后队列继续。
  - 熔断、关闭、profile 冲突和 Chrome 异常退出。
- Adapter：
  - 状态机所有成功与失败分支。
  - DOM 与 Network 来源角色。
  - 回答稳定、大小上限、URL 协议和选择器多义。
- Store：
  - 原子写、哈希、路径边界、权限、补偿删除和幂等。
- 持久化：
  - result summary merge、分析失败保留、租约 fencing 和迟到证据清理。

### 10.2 服务集成测试

- 使用 SQLite 临时数据库、临时 evidence/profile 目录、fake Web service。
- 从 `ProjectRunService.runProject()` 创建 Web 记录并完成分析。
- 同一项目同时运行 API 与 Web，证明 API 不等待 Web FIFO。
- preflight 失败时验证任务数和配额不增加。
- 证据 API 验证 owner、管理员和其他用户。
- 单条历史、批量历史、提示词清理和项目永久删除验证证据生命周期。
- 问题集 analysis-only 重试验证原 artifact owner 可读。

### 10.3 前端验证

- 运行现有 CJS/MJS 测试。
- `npm --prefix nextjs-frontend run lint`。
- `npm --prefix nextjs-frontend run build`。
- 手工检查桌面与窄屏历史详情，证据图片不溢出且失败信息可读。

### 10.4 真实页面验收

真实验收不能由 fake CDP 代替，按以下顺序执行：

1. 停止后端，执行 `npm --prefix backend run web:login -- deepseek-web`，人工登录并正常关闭。
2. 启动后端，运行 preflight，证明无需再次登录。
3. 正常重启后端，再次运行 preflight。
4. 从现有项目入口同时选择 `deepseek` 与 `deepseek-web`，运行同一问题。
5. 检查两条历史的平台代码、模型标识、原回答和证据互相独立。
6. 连续运行两个 Web 问题，确认新对话 URL/turn 证据不同。
7. 运行一个问题集。
8. 触发一次项目自动监测。
9. 人工退出 DeepSeek 登录，确认后续 Web 任务返回 `web_login_required` 且 API 平台继续。
10. 删除普通历史和永久删除测试项目，确认对应证据文件被清理。

真实验收记录必须脱敏，不保存认证头、Cookie、页面账号标识或 profile 路径。

### 10.5 负向代码搜索

实现完成时至少执行：

- 搜索 `deepseek-web` 到 API Adapter 的依赖与 fallback 分支。
- 搜索新增 Token/Cookie/认证头环境变量或日志字段。
- 搜索对 DeepSeek 页面 origin 的主动 `axios/fetch` 请求。
- 搜索证据根路径或 profile 路径是否进入 API 响应。
- 搜索平台归一化和静态标签映射是否把 `deepseek-web` 合并成 `deepseek`。
- 搜索正式调用方是否仍绕过 capabilities。

## 11. 可观测性

允许的结构化日志字段：

- `event`
- `platform`
- `record_id`
- `stage`
- `error_code`
- `selector_version`
- `queue_depth`
- `queue_wait_ms`
- `capture_duration_ms`
- `response_text_bytes`
- `explicit_citation_count`
- `retrieval_candidate_count`
- `artifact_count`

禁止日志字段：

- 请求头、响应头、认证令牌、Cookie。
- 页面完整 URL query/hash。
- profile 和 evidence 绝对路径。
- 完整问题、完整回答、完整 Network 响应。

事件：

- `deepseek_web_preflight_started/completed/failed`
- `deepseek_web_queue_entered/started/completed`
- `deepseek_web_circuit_opened`
- `deepseek_web_capture_promoted/discarded`
- `deepseek_web_evidence_quarantined/deleted/restored`
- `deepseek_web_shutdown_started/completed`

第一版不新增监控看板；日志用于本机诊断和验收证据。

## 12. 发布、正式生效与回滚

### 12.1 发布顺序

1. 先合入能力、受管平台和服务端拒绝规则，默认 `deepseek-web.enabled=false`。
2. 合入证据 Store、Chrome 会话、Adapter 和测试。
3. 合入 `ProjectRunService` 正式分流与持久化。
4. 合入前端展示和文档。
5. 在本机执行人工登录和真实页面验收。
6. 验收通过后由管理员启用 `deepseek-web`，使其出现在正式项目选择中。

### 12.2 正式生效判定

只有同时满足以下条件才可声明完成：

- `AIPlatformService` 正式按 `deepseek_web` 路由到 `WebPlatformService`。
- 项目手动、问题集和项目自动监测均通过 `ProjectRunService` 实际调用该路径。
- `deepseek-web` 已启用并在现有项目选择中可见。
- 真实页面验收通过，历史证据可读取。
- 不存在 Web→API fallback 或未受 capability 约束的正式入口。

仅完成 Adapter 单元测试或人工运行脚本，不代表已接入正式流程。

### 12.3 回滚

- 运行异常时把内置平台 `enabled=false`，现有项目规划将其列为 skipped；`deepseek` 与其他 API 平台继续运行。
- 回滚不得把 `deepseek-web` 静默映射为 `deepseek`。
- 历史 `deepseek-web` 记录和证据保留可读，除非用户执行正式删除。
- 修复后重新运行 preflight 和真实入口验收再启用。
- 若回滚代码，必须保留历史平台标签与证据读取兼容，避免已有记录失去可解释性。

## 13. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| DeepSeek DOM 改版 | 选择器失效或误采集 | 版本化语义探针、唯一性断言、默认失败、真实验收 |
| 页面风控或验证码 | 队列堆积、账号风险 | 熔断、排队任务快速失败、只人工处理、不循环刷新 |
| Chrome/profile 被其他进程占用 | 无法启动或 profile 损坏 | 专用目录、排他锁、清晰错误、不共用日常 profile |
| 回答极长或截图过大 | 内存与磁盘增长 | 正文/截图硬上限、裁剪主区域、失败而非静默截断 |
| 数据库提交与文件操作不原子 | 悬空或丢失证据 | staging/promote、quarantine/restore、启动补偿清理 |
| 结构化分析失败覆盖证据 | 无法复核或 analysis-only | `resultSummaryPatch` merge，失败路径持久化原回答和证据 |
| 迟到 worker 写入 | 错误记录或孤儿证据 | 现有 execution token fencing，加幂等 discard |
| Network 观测泄露会话 | 严重安全事件 | 不读认证头、不重放、响应 2 MiB 上限、字段白名单 |
| 多后端实例同时运行 | 串行保证失效 | profile 排他锁，第二实例 Web preflight 明确失败 |
| 本机休眠或桌面锁定 | 定时任务失败 | 第一版明确不承诺，返回可诊断错误，不伪造结果 |

## 14. 假设与开放问题

### 14.1 已确认假设

- 运行机器是 macOS 或受支持的桌面环境，已安装可由当前用户启动的 Chrome。
- 后端以单进程运行，且运行用户拥有专用 profile 与 evidence 目录权限。
- DeepSeek 官方页面允许用户用自己的账号正常登录并进行人工验证。
- 当前 `QuestionRecord` 执行租约 heartbeat 足以覆盖默认 180 秒 Web 采集预算。
- 第一版页面证据为本地文件，不要求远程对象存储或跨机共享。

### 14.2 实现阶段必须实测但不改变产品边界的事项

- 当前 DeepSeek 页面中新对话、联网开关、assistant turn、生成状态和引用卡片的稳定语义属性。
- Chrome CDP 截图对当前主会话区域的最大可靠尺寸。
- 页面自然请求中是否存在可安全白名单提取的客户端版本和检索候选；不存在时对应字段留空，不降级为保存原始响应。
- 系统锁屏后 headed Chrome 的实际行为；失败仍按已定义错误处理，不扩展为无人值守支持。

这些事项通过 selector 版本和真实入口验收解决，不授权增加私有接口直连、认证凭据复制、自动验证码或新的浏览器框架。

## 15. 完成状态

- PRD：`docs/closed-2026-07-26-002-deepseek-web-monitoring/prd.md`
- Tech Spec：`docs/closed-2026-07-26-002-deepseek-web-monitoring/TECH-SPEC.md`
- 9 个实施 issue 已关闭，问题库单问题、问题集和项目自动监测均通过正式入口验收；历史项目级手动入口已退役。
- `deepseek-web` 已启用，正式路径为
  `ProjectRunService → AIPlatformService → WebPlatformService → DeepSeekWebAdapter`。
- `deepseek` 继续作为独立 API 样本；Web 失败没有 API fallback。
- 后端 734 项、前端工具 189 项测试及 production build 已通过；完整真实验收记录见 Issue 009。
