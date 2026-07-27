---
title: 市场部虚拟机共享运行与 DeepSeek Web 排队状态技术方案
date: 2026-07-27
status: draft
source: docs/draft-2026-07-27-001-market-team-vm-web-queue/prd.md
scope: deep
---

# 市场部虚拟机共享运行与 DeepSeek Web 排队状态技术方案

## 1. 背景与目标

`ai-geo-monitoring` 将部署在公司虚拟机中，市场部多人通过个人电脑浏览器访问。所有市场部同事统一使用现有 `admin` 系统账号，共同操作同一批品牌项目、问题库和运行报告。DeepSeek Web 则继续使用虚拟机上的一个公司服务账号、一个持久 Chrome profile 和一个活动页面。

现有实现已经具备：

- 单问题和问题集的原子运行、持久任务记录、运行报告与失败重试。
- `deepseek-web` 与 `deepseek` 的严格样本隔离。
- 单进程级 Web FIFO、单页面采集、浏览器成功复用和异常回收。
- profile 独占锁、执行租约、服务重启后的待处理任务恢复和优雅关闭。

本方案不重写这些能力。目标是补齐多人共享使用时缺失的可观测契约和正式部署约束：

1. 市场部用户能看见 DeepSeek Web 是空闲、繁忙、需要登录、需要验证、不可用还是正在关闭。
2. 用户能看见全局等待的 Web 问题数量，不把正常排队误认为故障。
3. 状态查询不启动 Chrome、不读取页面、不泄漏问题内容、路径、PID 或会话凭据。
4. 正式运行明确使用单虚拟机、单后端实例和持久桌面会话。
5. 所有人共用现有 `admin` 账号，不新增用户、团队、成员、角色或权限模型。

## 2. 范围与非目标

### 2.1 范围

- 为 `WebPlatformService` 增加只读、无副作用的进程内运行快照。
- 根据持久 `QuestionRecord` 与运行快照生成稳定的 DeepSeek Web 公共状态。
- 新增认证后的只读运行状态 API。
- 在问题库和运行报告页展示统一的 Web 通道状态与等待数量。
- 页面隐藏或切到后台时暂停轮询，降低内部共享代理下的请求压力。
- 复用现有错误码、运行报告、重试入口、profile 锁和生产进程管理。
- 明确共享 `admin`、虚拟机桌面、人工登录、账号切换和单实例运维流程。
- 增加后端、前端、并发和真实虚拟机入口验收。

### 2.2 非目标

- 不新增数据库表、字段或迁移。
- 不实现个人系统账号、共享工作区、成员关系、角色权限或人员级审计。
- 不裁剪现有 `admin` 权限；共享账号继续拥有当前完整管理员能力。
- 不增加多个 DeepSeek 账号、多 profile、多浏览器或多标签页采集。
- 不引入 Redis、BullMQ、ClickHouse、独立 Web Worker 或多实例协调。
- 不提供精确队列位置或预计完成时间。
- 不允许用户通过 Web 页面启动、关闭或远程控制虚拟机 Chrome。
- 不把 DeepSeek Web 状态纳入全局 `/api/ready` 的必需条件。
- 不自动输入密码、自动处理验证码或自动切换 DeepSeek 账号。
- 不改变 Web 失败不回退 API 的既有规则。

### 2.3 延后事项

- 个人账号和共享项目工作区。
- 操作人审计、SSO 和离职人员自动撤权。
- 多个独立 DeepSeek 服务账号的容量扩展。
- 多后端实例和外部队列。
- 基于历史耗时的 ETA。

## 3. 当前系统认知

### 3.1 认证与项目所有权

- `backend/routes/user.js` 使用用户名或邮箱登录并签发 JWT。
- `backend/middleware/auth.js` 从 JWT 恢复 `userId`、`username` 和 `role`。
- `admin` 具有现有完整管理员权限；本需求不改变权限判断。
- 所有市场部浏览器使用同一 `admin` 凭据，因此业务记录、项目所有权和配额均归属同一个用户 ID。
- 前端把 JWT 和用户信息保存在各自浏览器的 `localStorage`；多个浏览器会产生独立 JWT，但身份相同。

### 3.2 正式运行入口

- 手动运行只从问题库发起：
  - 单问题：`POST /api/geo-projects/:projectId/prompts/:promptId/run`
  - 问题集：`POST /api/geo-projects/:projectId/question-sets/:questionSetId/run`
- 两个入口都通过 `ProjectRunService.startQuestionSetRun()` 原子创建父运行、配额和全部 `QuestionRecord`。
- 请求通过幂等键防止同一次操作的网络重放；不同浏览器生成不同幂等键，因此两次主动提交仍是独立样本。
- 运行完成情况由 `/question-set-runs` 报告接口读取，前端运行中每 4 秒刷新当前报告。

### 3.3 Web FIFO 与浏览器生命周期

- `backend/services/AIPlatformService.js` 只把受管 `deepseek-web` Adapter 路由到 `WebPlatformService`。
- `backend/services/WebPlatformService.js` 是进程级单例。
- `runExclusive()` 通过 Promise tail 保证所有 Web 页面工作串行。
- `preflight()` 和 `queryPlatform()` 共享同一排他链，但当前没有公开队列深度或活动采集快照。
- 成功任务保留浏览器会话；浏览器连接、命令、无响应或生成超时会回收会话。
- 登录、验证和选择器失败会打开进程内熔断，后续排队任务快速返回同一稳定错误。
- `ApplicationShutdownService` 在后端关闭时等待当前 Web 工作、关闭浏览器并释放 profile 锁。

### 3.4 持久任务状态

- `QuestionRecord.status` 使用 `pending`、`completed`、`failed`。
- `deepseek-web` 的所有待执行、已领取但未终态和正在等待 FIFO 的记录都仍为 `pending`。
- `execution_token`、`lease_owner`、`lease_expires_at` 和 `execution_started_at` 用于防止重复执行和迟到写入。
- 因为 Web FIFO 只存在于单进程内，而完整待处理任务存在数据库中，公共等待数量应以数据库 pending 数量为主，并用进程活动采集数区分“正在运行”和“等待中”。

### 3.5 生产进程与虚拟机

- `scripts/production.mjs` 与 `scripts/processManager.mjs` 已提供单机 backend/frontend PID 记录、启动幂等和已知进程校验。
- 同一端口阻止同配置后端重复监听。
- DeepSeek profile lock 阻止第二个进程同时取得相同浏览器 profile。
- 当前浏览器是 headed Chrome，继承后端进程的图形会话环境。
- `DEEPSEEK_WEB_PROFILE_DIR` 和 `DEEPSEEK_WEB_EVIDENCE_DIR` 已支持指定持久目录。

### 3.6 现有测试

- `backend/tests/WebPlatformService.test.js` 已覆盖 FIFO 最大并发 1、熔断、profile 锁、浏览器异常回收和 shutdown。
- `backend/tests/AIPlatformService.test.js` 已覆盖 Web Adapter 分流及无 API fallback。
- `backend/tests/QuestionSetRunStart.test.js` 与 `QuestionSetsApi.test.js` 已覆盖单问题/问题集原子运行。
- `nextjs-frontend/src/utils/questionSetReportPage.test.cjs` 已覆盖运行报告轮询和状态展示。
- `nextjs-frontend/src/utils/runResultMessage.test.mjs` 已覆盖“已加入队列”提示。

## 4. 需求、约束与规则

### 4.1 功能需求

- REQ-001：所有市场部用户继续使用现有 `admin` 系统账号，本需求不得新增认证、用户、团队或权限数据模型。
- REQ-002：`deepseek-web` 页面采集最大活动并发数必须始终为 1。
- REQ-003：不同浏览器的主动运行请求分别创建独立运行；只有相同幂等请求返回原运行。
- REQ-004：系统必须提供认证后的 DeepSeek Web 公共运行状态。
- REQ-005：公共状态必须包含通道状态、运行数量、等待数量、待处理总数、是否需要人工处理和稳定原因码。
- REQ-006：状态查询必须只读且无副作用，不得启动 Chrome、执行 preflight、打开页面或改变熔断状态。
- REQ-007：等待总数必须覆盖数据库中尚未终态的全部 `deepseek-web` 任务，而不仅是已经进入内存 FIFO 的 Promise。
- REQ-008：运行数量只能是 0 或 1，并来自当前进程真实活动采集快照。
- REQ-009：状态不得返回问题正文、项目名、运行 ID、记录 ID、Chrome 路径、profile 路径、PID、Cookie 或 Authorization。
- REQ-010：问题库和运行报告页必须展示一致的状态文案和等待数量。
- REQ-011：通道被停用时不展示持续警告；页面仍沿用平台目录的停用行为。
- REQ-012：登录或验证失效时，页面提示联系虚拟机运维负责人，不提示市场部用户输入 DeepSeek 密码。
- REQ-013：状态接口失败不能阻止问题库和报告页使用，也不能把未知状态伪装成“可用”。
- REQ-014：前端轮询必须在页面隐藏时暂停，并在重新可见后立即刷新。
- REQ-015：第一版不显示 ETA 和精确排队位置。
- REQ-016：Web 失败继续写入原运行报告并由用户确认重试，不进行同问题自动重发。
- REQ-017：状态 API 不替代每次运行前的真实 preflight；创建任务和消费配额前仍按现有流程检查通道。
- REQ-018：正式运维只使用一套受管后端进程，DeepSeek profile 和证据目录位于持久磁盘。

### 4.2 约束

- CON-001：单虚拟机、单 Node.js 后端、单 DeepSeek 账号、单 profile、单活动页面。
- CON-002：虚拟机必须有持续存在的图形桌面会话，且不能休眠。
- CON-003：所有市场部操作归属于同一个 `admin` 用户 ID，无法实现人员级审计。
- CON-004：共享 `admin` 保留现有完整管理员权限；本期不增加限制层。
- CON-005：状态是一个短时快照，数据库计数与进程状态之间允许一个请求周期内的最终一致性。
- CON-006：不得为了状态接口把不稳定的页面 DOM、Chrome DevTools 响应或第三方内容直接暴露给前端。
- CON-007：当前通用 API 有频率限制，状态轮询不能使用高频 4 秒轮询。
- CON-008：平台被停用或没有任何项目使用时，状态能力不能影响其他 GEO/SEO 功能。

### 4.3 沿用模式

- PAT-001：API 使用现有 `{ success, message?, data? }` 响应外壳。
- PAT-002：外部可见状态和错误使用稳定英文枚举/错误码，中文文案在前端集中映射。
- PAT-003：接口 additive，不改变 `/api/ai-platforms` 和运行报告现有字段含义。
- PAT-004：第三方页面状态只在 `WebPlatformService` 内归一化，路由不得识别原始 DOM 或 renderer 错误。
- PAT-005：前端使用独立 hook 和展示组件，问题库与运行报告共用。
- PAT-006：不为低量计数提前增加索引或迁移；若真实查询证明需要，再单独增加 `(platform, status)` 索引。

## 5. 架构与数据流

### 5.1 运行链路

```text
多个市场部浏览器（同一 admin 身份）
                │
                ├─ 单问题运行
                └─ 问题集运行
                         │
                         ▼
             ProjectRunService 原子建档
                         │
          ┌──────────────┴──────────────┐
          │                             │
          ▼                             ▼
    API 平台并发执行             deepseek-web pending 记录
                                        │
                                        ▼
                              WebPlatformService FIFO
                                        │
                                        ▼
                              虚拟机专用 Chrome 页面
```

### 5.2 状态链路

```text
QuestionRecord.count(
  platform = deepseek-web,
  status = pending
)                                WebPlatformService
          │                       getRuntimeSnapshot()
          └──────────┬────────────────────┘
                     ▼
          WebPlatformRuntimeStatusService
                     │
                     ▼
GET /api/ai-platforms/deepseek-web/runtime-status
                     │
                     ▼
问题库 / 运行报告统一状态组件
```

### 5.3 数量口径

- `pending_count`：数据库中 `platform = deepseek-web AND status = pending` 的记录数。
- `running_count`：当前进程正在执行页面采集时为 1，否则为 0。
- `queued_count`：`max(pending_count - running_count, 0)`。

该口径覆盖：

- 尚未被 ProjectRunService worker 领取的记录。
- 已取得执行租约但正在等待 Web FIFO 的记录。
- 当前正在页面交互的记录。

它不承诺：

- 某条具体记录的精确队列位置。
- 固定的任务完成顺序跨越数据库恢复边界完全不变。
- 预计完成时间。

## 6. 接口与数据契约

### 6.1 只读运行状态接口

```text
GET /api/ai-platforms/deepseek-web/runtime-status
Authorization: Bearer <admin JWT>
```

该接口挂载在现有已认证的 `aiPlatforms` 路由下。虽然当前调用者都是 `admin`，接口只要求有效登录，不重复增加新的管理员判断。

成功响应：

```json
{
  "success": true,
  "data": {
    "schema_version": "deepseek-web-runtime-v1",
    "platform": "deepseek-web",
    "enabled": true,
    "state": "busy",
    "running_count": 1,
    "queued_count": 4,
    "pending_count": 5,
    "needs_action": false,
    "action_code": null,
    "reason_code": null,
    "observed_at": "2026-07-27T02:00:00.000Z"
  }
}
```

### 6.2 字段约束

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `schema_version` | string | 固定 `deepseek-web-runtime-v1` |
| `platform` | string | 固定 `deepseek-web` |
| `enabled` | boolean | 受管平台当前启用状态 |
| `state` | enum | `idle`、`busy`、`login_required`、`verification_required`、`unavailable`、`shutting_down` |
| `running_count` | integer | 只能为 0 或 1 |
| `queued_count` | integer | 非负整数 |
| `pending_count` | integer | 等于或大于 `running_count` |
| `needs_action` | boolean | 是否需要虚拟机运维负责人介入 |
| `action_code` | string/null | `contact_vm_operator` 或 `null` |
| `reason_code` | string/null | 稳定平台错误码、`disabled` 或 `null` |
| `observed_at` | ISO string | 状态快照生成时间 |

### 6.3 状态派生优先级

按以下顺序选择唯一 `state`：

1. 服务正在关闭：`shutting_down`。
2. 平台被停用：`unavailable`，`enabled=false`，`reason_code=disabled`。
3. 熔断原因为 `web_login_required`：`login_required`。
4. 熔断原因为 `web_verification_required`：`verification_required`。
5. 选择器、配置、Chrome、profile 或稳定连接处于已知阻塞状态：`unavailable`。
6. `pending_count > 0` 或 `running_count = 1`：`busy`。
7. 其他情况：`idle`。

`idle` 只表示“当前没有待处理任务且没有已知阻塞错误”，不等同于刚刚完成了实时页面 preflight。真正运行仍执行现有 preflight。

### 6.4 人工处理语义

- `login_required`、`verification_required`：
  - `needs_action=true`
  - `action_code=contact_vm_operator`
- `unavailable`：
  - 若是 `disabled`，前端不展示全局警告。
  - 若是 Chrome、profile、选择器或连接阻塞，`needs_action=true`。
- `idle`、`busy`：
  - `needs_action=false`
- `shutting_down`：
  - `needs_action=false`

### 6.5 失败响应

- 未认证：沿用 `401`。
- 数据库状态读取失败：`500`，正文为通用“读取 DeepSeek Web 运行状态失败”，不返回内部错误。
- 受管平台记录异常缺失：仍返回成功契约，`enabled=false`、`state=unavailable`、`reason_code=config_unavailable`，方便前端稳定渲染。

### 6.6 兼容性

- 不修改现有 `/api/ai-platforms` 列表字段。
- 不修改运行创建、报告和重试接口。
- 不修改 `QuestionRecord` 和 `QuestionSetRun` schema。
- 新接口和新前端组件可以独立回滚，不影响实际 Web FIFO。
- 状态枚举和字段一旦发布视为公共契约；后续只新增可选字段，不更改现有字段类型和语义。

## 7. 模块设计

### 7.1 `WebPlatformService` 进程快照

在 `backend/services/WebPlatformService.js` 增加无副作用的 `getRuntimeSnapshot()`：

- 读取当前 lifecycle state、熔断错误、是否正在执行页面采集和是否正在关闭。
- 不调用 `ensureSession()`、`preflight()` 或任何 CDP 方法。
- 不返回 Promise tail、问题内容、capture owner、profile 路径或浏览器对象。

为区分 preflight 与真实页面采集，在 `queryPlatform()` 真正开始 Adapter capture 前后维护 `activeCaptureCount`：

- 初始为 0。
- 进入 capture 前设为 1。
- 在 `finally` 中恢复为 0。
- 即使 Adapter 抛错、回收浏览器或服务关闭，也必须恢复。
- 通过断言或归一化确保公共值只能是 0 或 1。

现有 `runExclusive()` 串行实现保持不变，避免为状态功能重写队列。

### 7.2 公共状态服务

新增 `backend/services/WebPlatformRuntimeStatusService.js`：

- 依赖注入 `QuestionRecord`、`AIPlatformConfigService` 和 `WebPlatformService`，便于单元测试。
- 读取 `deepseek-web` 受管平台启用状态。
- 统计全局 pending 记录。
- 读取进程快照并按第 6 节派生公共契约。
- 对外只输出白名单字段。

该服务不缓存真实页面状态，不访问证据文件，不启动浏览器。

### 7.3 API 路由

在 `backend/routes/aiPlatforms.js` 增加固定路径：

```text
GET /deepseek-web/runtime-status
```

必须声明在任何潜在动态平台路径之前。路由：

- 复用已有 `authRequired`。
- 设置 `Cache-Control: private, no-store`。
- 调用公共状态服务。
- 捕获异常并返回稳定 500。

### 7.4 前端 hook 与展示组件

新增：

- `nextjs-frontend/src/lib/useDeepSeekWebRuntimeStatus.ts`
- `nextjs-frontend/src/components/DeepSeekWebRuntimeStatus.tsx`
- 对应纯函数展示映射与测试。

轮询规则：

- 进入问题库或运行报告页后立即请求一次。
- 页面可见时每 30 秒刷新。
- `document.visibilityState !== 'visible'` 时停止定时请求。
- 页面重新可见后立即刷新并重建定时器。
- 组件卸载或路由切换时取消旧请求结果写入。
- 一个页面只创建一个轮询实例。

展示规则：

- `enabled=false` 且 `reason_code=disabled`：不渲染。
- `idle`：低强调度显示“DeepSeek Web 当前空闲”。
- `busy`：信息提示“正在运行 1 条，等待 N 条”；`running_count=0` 时显示“已有 N 条等待处理”。
- `login_required`：警告“DeepSeek Web 登录已失效，请联系虚拟机运维负责人处理”。
- `verification_required`：警告“DeepSeek Web 需要人工验证，请联系虚拟机运维负责人处理”。
- 其他 `unavailable`：错误提示稳定的用户可读原因，不显示内部异常。
- `shutting_down`：信息提示“服务正在关闭，暂不接受新的 Web 页面工作”。
- 状态接口首次失败：显示低强调度“DeepSeek Web 状态暂时无法读取”，但不禁用运行按钮。

组件放置：

- 问题库：项目与问题操作区上方，帮助用户提交前理解通道。
- 运行报告：报告状态区上方，解释 Web 等待与其他 API 结果先完成的差异。

不放在整个 GEO Layout 全局轮询，避免用户浏览看板、SEO 或设置页时产生无关状态请求。

### 7.5 运行报告关系

- 公共状态是全局通道状态，不代表当前报告独占的队列位置。
- 当前报告仍以自身 `execution_summary.pending`、`status` 和逐条记录为事实。
- 公共状态组件不得把全局 `queued_count` 写成“你前面还有 N 条”。
- 当当前报告已完成但全局状态仍 busy，界面不得暗示当前报告尚未完成。

### 7.6 虚拟机与共享 admin

不修改认证代码。正式约束通过部署和文档落实：

- 所有市场部同事使用现有 `admin` 用户名和密码。
- 每个浏览器独立登录并持有自己的 JWT；所有 JWT 指向同一用户 ID。
- 共享账号现有完整管理员权限不做裁剪。
- 不在应用内记录实际操作人。
- `admin` 密码只通过公司认可的密码管理方式分发，不写入仓库、PRD 示例或脚本。
- DeepSeek 服务账号密码不进入应用；仅保存在 Chrome 自身登录会话中。

正式启动只使用：

```text
npm run prod:start
```

人工恢复 DeepSeek 登录使用：

```text
npm run prod:stop
npm run web:login -- deepseek-web
npm run prod:start
```

部署文档必须说明：

- 后端进程必须从持久桌面会话环境启动。
- VM 不得休眠。
- profile/evidence/database 位于持久磁盘。
- 远程桌面断开不能销毁图形会话。
- 禁止并行执行第二套 `node backend/app.js`。
- `/api/ready` 只表示主应用、数据库与调度器就绪；DeepSeek Web 状态以新接口为准。

## 8. 关键技术决策

- KTD-001：保留单进程 FIFO，不增加外部队列。
  - 理由：当前问题是多人可见性，不是任务持久性或跨机器吞吐；`QuestionRecord` 已提供持久记录和恢复。

- KTD-002：等待数量以数据库 pending 记录为主。
  - 理由：只统计 Promise tail 会漏掉尚未进入 WebPlatformService 的任务，也无法跨重启恢复。

- KTD-003：活动运行数使用进程快照，而不是 `execution_token` 数量。
  - 理由：多个 ProjectRunService worker 可以同时持有租约并等待同一个 Web FIFO，租约数不等于页面活动并发。

- KTD-004：状态查询不执行 preflight。
  - 理由：只读 UI 轮询不应启动浏览器、占用 FIFO、改变熔断或制造第三方访问。

- KTD-005：不把 Web 状态加入 `/api/ready`。
  - 理由：DeepSeek Web 不可用不应让 API 平台、历史、报告、SEO 和管理功能整体变为 503。

- KTD-006：状态接口挂在认证后的公共平台路由。
  - 理由：问题库和报告是普通业务页面；虽然当前共享 admin，契约不需要耦合管理员专属设置路由。

- KTD-007：不显示精确位置和 ETA。
  - 理由：worker 领取、重试、恢复、API/Web 混合运行和外部页面耗时会让这些值不稳定并形成错误承诺。

- KTD-008：状态组件只出现在问题库和运行报告。
  - 理由：这两个页面是提交与等待决策点，可以减少轮询压力和无关告警。

- KTD-009：共享 `admin` 是部署约束，不新增代码级单用户模式。
  - 理由：现有认证和项目所有权已经满足同一账号多会话；额外强制会增加无价值分支并影响未来扩展。

- KTD-010：不新增数据库索引。
  - 理由：内部低量场景下现有 `platform` 索引足以支持 pending 计数；先用真实查询证据决定是否增加复合索引。

## 9. 实现切片

### U1. Web 空闲/繁忙状态纵向闭环

**目标：**

从进程快照和数据库 pending 记录生成 `idle`/`busy` 状态，经认证 API 展示到问题库与运行报告，覆盖多人同时提交的正常排队路径。

**依赖：**

无。

**涉及文件：**

- `backend/services/WebPlatformService.js`
- `backend/services/WebPlatformRuntimeStatusService.js`
- `backend/routes/aiPlatforms.js`
- `backend/tests/WebPlatformService.test.js`
- `backend/tests/WebPlatformRuntimeStatusService.test.js`
- `backend/tests/AIPlatformsApi.test.js`
- `nextjs-frontend/src/lib/useDeepSeekWebRuntimeStatus.ts`
- `nextjs-frontend/src/components/DeepSeekWebRuntimeStatus.tsx`
- `nextjs-frontend/src/app/geo/prompts/page.tsx`
- `nextjs-frontend/src/app/geo/question-set-reports/page.tsx`
- `nextjs-frontend/src/utils/deepSeekWebRuntimeStatus.cjs`
- `nextjs-frontend/src/utils/deepSeekWebRuntimeStatus.test.cjs`

**方案：**

- 增加无副作用进程快照和活动采集计数。
- 增加公共状态服务和固定 GET 路由。
- 实现 30 秒可见页轮询。
- 先支持 `idle`、`busy`、`disabled` 隐藏和接口未知状态。
- 页面文案只表达全局通道，不声称当前报告的精确位置。

**测试场景：**

- 无 pending、无活动采集时返回 idle。
- 1 条活动、4 条等待时返回 running 1、queued 4。
- 多个租约等待 FIFO 时 running 仍最多 1。
- 状态查询不触发 launcher、probe 或 CDP。
- 两个页面使用同一展示映射。
- 页面隐藏后停止轮询，恢复可见后立即刷新。

**验收方式：**

两个浏览器同时提交 Web 问题后，两个页面都能看到全局繁忙和等待数量；实际页面采集并发仍为 1。

### U2. 登录、验证与不可用状态闭环

**目标：**

把既有熔断和浏览器错误转换为市场部可理解、运维可执行的状态，且不泄漏内部信息或要求市场部输入 DeepSeek 凭据。

**依赖：**

U1。

**涉及文件：**

- `backend/services/WebPlatformService.js`
- `backend/services/WebPlatformRuntimeStatusService.js`
- `backend/tests/WebPlatformService.test.js`
- `backend/tests/WebPlatformRuntimeStatusService.test.js`
- `nextjs-frontend/src/components/DeepSeekWebRuntimeStatus.tsx`
- `nextjs-frontend/src/utils/deepSeekWebRuntimeStatus.cjs`
- `nextjs-frontend/src/utils/deepSeekWebRuntimeStatus.test.cjs`

**方案：**

- 补齐 lifecycle、circuit 和最后已知阻塞原因的安全快照。
- 按契约派生 login、verification、unavailable、shutting_down。
- 页面统一提示联系虚拟机运维负责人。
- 平台 disabled 时不渲染告警。
- 状态读取失败不禁用现有运行入口。

**测试场景：**

- 登录失效、验证、选择器、Chrome 缺失、profile 冲突和 shutdown 映射正确。
- transient 浏览器错误回收后不永久保留错误状态。
- 公共响应不含路径、问题、记录 ID、PID 或内部 Error。
- 熔断后排队任务仍按既有规则进入失败报告，可在恢复后重试。

**验收方式：**

模拟登录失效时，问题库和报告页显示同一人工处理提示；恢复登录后状态回到 idle/busy，原报告保留重试入口。

### U3. 虚拟机单实例与共享 admin 运行约束

**目标：**

把单虚拟机、持久桌面、单进程、共享 admin 和人工登录流程变成可重复执行的正式运维路径。

**依赖：**

U1。

**涉及文件：**

- `README.md`
- `docs/ENVIRONMENT.md`
- `docs/SINGLE_HOST_DEPLOYMENT.md`
- `docs/API.md`
- `backend/.env.example`
- `tests/deployCli.test.mjs`
- 必要时仅小幅调整 `scripts/production.mjs` 或 `scripts/processManager.mjs`

**方案：**

- 文档明确正式命令、桌面会话、持久目录、禁止休眠和单实例。
- 说明所有市场部用户统一使用现有 admin，接受完整权限和无人员审计。
- 说明 DeepSeek 账号与系统 admin 完全独立。
- 复用现有 PID 记录、端口冲突和 profile lock；只有验证发现缺口时才小幅补强进程检查。
- 新状态接口加入 API 文档，但不加入 `/ready`。

**测试场景：**

- 重复 `prod:start` 不产生第二个受管后端。
- 命令不匹配的 PID 不被覆盖或终止。
- 第二个 Web 会话无法占用同一 profile。
- prod stop 后 Chrome 与 profile lock 被释放。
- 文档和环境示例不含真实账号、密码、Token 或路径凭据。

**验收方式：**

在目标 VM 按文档完成停止、人工登录、启动和状态检查；两个市场部浏览器可用同一 admin 登录并访问同一项目。

### U4. 多浏览器真实入口发布验收

**目标：**

从市场部实际入口证明多人共享使用不会丢任务、并发操作页面或混淆报告，并形成发布/回滚证据。

**依赖：**

U1、U2、U3。

**涉及文件：**

- `backend/tests/QuestionSetsApi.test.js`
- `backend/tests/QuestionSetRunStart.test.js`
- `backend/tests/WebPlatformService.test.js`
- `nextjs-frontend/src/utils/promptRunEntry.test.cjs`
- `nextjs-frontend/src/utils/questionSetReportPage.test.cjs`
- 本需求目录中的验收记录或对应 issue

**方案：**

- 自动化模拟两个不同幂等键同时提交。
- 证明两次运行各自建档、进入同一 Web FIFO、最大页面并发 1。
- 证明 API 任务不被 Web FIFO 串行化。
- 在目标 VM 使用两个真实浏览器会话执行最小问题。
- 记录状态接口、运行报告、后端日志和 profile lock 证据。
- 发布失败时只回滚状态 API/组件；既有 FIFO 和运行报告保持不变。

**测试场景：**

- 两个浏览器分别运行不同问题。
- 两个浏览器主动运行相同问题。
- 一个问题集与一个单问题同时提交。
- Web 登录失效时已有任务失败、新任务 preflight 拒绝。
- Chrome 异常回收后下一任务启动新会话。
- 用户关闭个人浏览器后任务继续完成。

**验收方式：**

目标 VM 入口级证据同时证明：两次运行均可追踪、Web 最大并发 1、API 不受阻塞、报告不混合、失败无 API fallback。

## 10. 验收标准

- AC-001：Given 两个浏览器使用同一 admin，When 同时提交两个不同问题，Then 返回两个不同运行报告。
- AC-002：Given 多个 pending Web 记录，When 查询运行状态，Then `pending_count` 覆盖全部记录且 `running_count <= 1`。
- AC-003：Given 一个 Web 问题正在采集，When 第二个问题到达，Then 第二个进入等待且页面采集最大并发为 1。
- AC-004：Given API 与 Web 任务同时提交，When Web 正在等待页面回答，Then API 任务不等待 Web FIFO。
- AC-005：Given 没有 pending 记录和已知阻塞，When 查询状态，Then 返回 `idle` 且不启动 Chrome。
- AC-006：Given 1 条正在采集和 4 条其他 pending，When 查询状态，Then 返回 `busy`、`running_count=1`、`queued_count=4`。
- AC-007：Given DeepSeek 登录失效，When 查询状态，Then 返回 `login_required`、`needs_action=true`，前端提示联系虚拟机运维负责人。
- AC-008：Given DeepSeek 需要验证，When 查询状态，Then 返回 `verification_required`，不返回页面内容或会话数据。
- AC-009：Given Chrome 缺失或 profile 被占用，When 查询已知状态，Then 返回 `unavailable` 和稳定原因码。
- AC-010：Given 平台被停用，When 页面读取状态，Then 组件不显示持续警告且其他平台仍可运行。
- AC-011：Given 页面进入后台，When 超过一个轮询周期，Then 不继续请求状态接口；重新可见后立即刷新。
- AC-012：Given 状态接口失败，When 用户运行问题，Then 现有运行入口仍可执行自己的 preflight，不被状态组件禁用。
- AC-013：Given 浏览器异常被回收，When 没有永久熔断，Then 公共状态不继续显示旧 transient 错误。
- AC-014：Given 后端正在关闭，When 读取进程快照，Then 状态为 `shutting_down` 且新 Web 工作返回 `web_shutdown`。
- AC-015：Given 两次请求使用同一幂等键，When 并发提交，Then 只创建一次运行；不同幂等键各自创建运行。
- AC-016：Given 当前报告已经完成但其他运行仍在 Web 队列，When 查看当前报告，Then 报告显示完成，公共组件只说明全局通道繁忙。
- AC-017：Given 正式 VM 启动，When 重复执行 `prod:start`，Then 不产生第二个受管 backend。
- AC-018：Given 运维负责人完成 web:login 并关闭登录浏览器，When 启动后端并执行 preflight，Then 同一持久 profile 恢复登录态。
- AC-019：Given 任意 Web 失败，When 检查记录，Then 不调用 DeepSeek API、不生成替代回答。
- AC-020：Given 共享 admin，When 多个浏览器操作，Then 所有业务记录归属同一个 admin 用户 ID，系统不宣称具备人员级审计。

## 11. 测试与验证计划

### 11.1 单元测试

- `WebPlatformService`：
  - active capture 计数生命周期。
  - snapshot 无副作用。
  - FIFO 最大并发 1。
  - error、recycle、circuit、shutdown 状态。
- `WebPlatformRuntimeStatusService`：
  - 平台 enabled/disabled。
  - pending/running/queued 数量。
  - 状态优先级。
  - 输出白名单。
- 前端展示映射：
  - 每个状态的标题、级别和下一步。
  - disabled 隐藏。
  - 不显示 ETA/精确位置。

### 11.2 API 集成测试

- 有效 JWT 读取状态。
- 缺失 JWT 返回 401。
- 数据库错误返回稳定 500。
- 接口设置 `private, no-store`。
- 调用接口不触发 Web launcher/probe。
- 响应不包含敏感和内部字段。

### 11.3 前端契约测试

- 问题库和运行报告使用同一组件。
- 30 秒轮询和 visibility 控制。
- 旧请求不会覆盖新页面状态。
- 状态失败不影响运行按钮。
- 当前报告状态与全局通道状态不混淆。

### 11.4 并发集成测试

- 两个不同幂等键同时创建两次运行。
- 多条 Web 记录经过同一个 FIFO。
- 最大 Adapter capture 并发为 1。
- API Promise 与 Web Promise 并行。
- 服务重启后 pending 记录恢复并重新进入 FIFO。

### 11.5 真实 VM 手工验收

1. 通过远程桌面进入持续桌面会话。
2. 停止生产后端，执行人工 DeepSeek 登录。
3. 启动生产前后端，确认主应用 `/api/ready` 正常。
4. 以两个个人电脑浏览器使用同一 admin 登录。
5. 同时提交一个单问题和一个问题集。
6. 确认公共状态显示 busy 与等待数量。
7. 确认 Chrome 只在 VM 中运行，页面采集最大并发 1。
8. 确认 API 平台结果可以先返回。
9. 关闭其中一个个人浏览器，确认任务继续。
10. 人工退出 DeepSeek，确认状态、失败报告和恢复重试。
11. 停止后端，确认 Chrome 关闭且 profile lock 释放。

### 11.6 发布证据

- 后端完整测试摘要。
- 前端工具测试、lint 和生产构建摘要。
- 两个运行报告 URL/ID。
- 状态 API 的脱敏响应。
- 最大 Web capture 并发日志或测试断言。
- 浏览器只存在于 VM 的进程证据。
- shutdown 后 profile lock 清理证据。

## 12. 发布、回滚与运维

### 12.1 发布顺序

1. 合并并部署后端进程快照、状态服务和接口。
2. 验证旧前端和运行入口不受影响。
3. 部署前端状态组件。
4. 更新 VM 运行文档。
5. 在目标 VM 完成双浏览器验收。

### 12.2 回滚

- 若状态接口存在问题，回滚新路由和状态服务；现有运行、FIFO、报告和重试不变。
- 若前端轮询影响请求负载，先移除状态组件或提高轮询间隔，不回滚 Web Adapter。
- 不得通过回滚重新启用项目级手动运行入口、API fallback 或多页面并发。

### 12.3 观测

状态接口本身不记录每次成功轮询日志，避免噪声。只记录：

- 公共状态服务读取失败。
- impossible state，例如 `running_count > 1`。
- profile 冲突、登录/验证熔断和浏览器回收。
- shutdown 开始与完成。

日志不得包含问题正文、账号密码、Token、Cookie、Authorization 或 profile 内文件。

## 13. 风险与缓解

### 风险 1：共享 admin 权限过大

- 影响：任何市场部同事都能执行现有管理员操作，且无法区分真实操作人。
- 缓解：作为用户明确接受的第一版边界写入 PRD和部署说明；凭据只通过内部密码管理流程分发和轮换。
- 退出条件：需要人员级审计、最小权限或离职自动撤权时，另立共享工作区需求。

### 风险 2：状态计数短时不一致

- 影响：任务刚完成时，数据库和进程快照可能在极短窗口内显示不同数量。
- 缓解：定义为快照和最终一致；使用非负归一化，不显示精确位置和 ETA。

### 风险 3：轮询叠加通用频率限制

- 影响：多人同时停留在报告页时，现有报告轮询和状态轮询可能增加同源代理请求量。
- 缓解：状态只在两个相关页面启用、30 秒轮询、隐藏页暂停；真实 VM 验收检查 429。如仍不足，单独评估可信代理与只读轮询限流，不在本期盲目放宽全局限制。

### 风险 4：VM 图形会话消失

- 影响：Chrome 无法启动或页面停止渲染。
- 缓解：使用持久桌面会话、禁止休眠、通过远程桌面维护；状态显示 unavailable 并保留失败报告。

### 风险 5：浏览器熔断导致排队任务快速失败

- 影响：登录失效时，同一队列中已开始调度的多个记录可能进入失败。
- 缓解：失败保留在各自报告中，恢复登录后统一重试；不自动重发，避免重复样本。

### 风险 6：多实例误启动

- 影响：内存 FIFO 不再全局唯一。
- 缓解：正式只使用生产进程管理命令、固定端口和 profile lock；真实验收重复启动行为。

## 14. 假设与开放问题

- 假设市场部已接受共享 `admin` 的完整权限与无人员审计风险。
- 假设目标 VM 可提供持续图形桌面会话和远程维护方式。
- 假设内部峰值任务量仍适合单账号串行，等待数量提示足以解决当前使用问题。
- 开放问题：目标 VM 的操作系统、桌面会话守护和远程桌面产品由部署实施时确认。
- 开放问题：若真实环境出现 429，需要基于代理链路证据决定限流键和可信代理配置，不在当前方案中预设。

## 15. 后续衔接

- 可拆 issue：4 个纵向切片。
- 建议第一个 issue：Web 空闲/繁忙状态纵向闭环。
- 适合 TDD：是。状态派生、无副作用快照、API 契约、轮询生命周期和并发上限都可以先写失败测试。
- 下一步：使用 `$to-issues` 确认切片粒度后写入本目录 `issues/`。
