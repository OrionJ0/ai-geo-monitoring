---
title: 问题集运行与调度可靠性加固技术方案
date: 2026-07-26
status: closed
source: docs/closed-2026-07-26-001-question-set-run-reliability/prd.md
scope: deep
---

# 问题集运行与调度可靠性加固技术方案

## 1. 背景与目标

本方案解决问题集手动运行、定时执行、失败恢复、暂停恢复、历史证据和报告导入之间的可靠性断点。

目标不是引入一套覆盖所有业务的通用状态机，而是在现有 `ProjectRunService`、`SchedulerService` 和 `QuestionSetRunService` 边界内建立五个可验证不变量：

1. 同一调度时槽只有一个有效执行所有者。
2. 同一初始运行幂等键只创建一个 run、一次配额预留和一批任务。
3. 只有持有当前租约令牌的 worker 可以写任务终态和指标。
4. 一个 native run 没有 pending 后必定收敛为带 `completed_at` 和快照的终态。
5. 历史运行证据不随当前项目分析缓存一起删除。

## 2. 范围与非目标

- 范围：
  - 修复 SQLite PRAGMA 初始化并增加 readiness。
  - 给 scheduler 增加进程内 single-flight 和数据库级时槽账本。
  - 初始问题集运行事务化并增加强制幂等键。
  - 执行租约增加过期时间、续租和终态 fencing。
  - 增加统一、幂等的父运行 reconcile。
  - 以 `question_set_run_id + run_slot_index` 替换 JSON `record_ids` 作为正式关联。
  - 保护 run-owned `QuestionRecord`、`ResultDetail` 和 `VisibilityMetric`。
  - 持久化重试执行模式与 retry batch 归属。
  - 收紧 CSV 状态和数值边界。
  - 报告返回操作 capabilities，补 partial 解释和 PDF 验收。
- 非目标：
  - 改变 soft pause。
  - 改变指标计算口径。
  - 把项目级定时监测强行包装成 `QuestionSetRun`。
  - 引入消息队列、分布式事务或跨区域 exactly-once。
  - 自动重算、伪造或回填已经丢失的历史原始回答。
  - 解决问题集成员多对多、同名、空集和跨集迁移语义。
- 延后事项：
  - 时区、DST 和停机错过计划的完整产品策略。
  - 历史报告自动对比。
  - `question_set_runs.record_ids` 物理列的最终清理可随本需求迁移完成；若生产数据库无法在当前发布窗口安全删列，则必须登记为迁移未完成，代码不得继续读取或写入该列。

## 3. 改造前系统认知（历史）

### 3.1 改造前正式入口（历史）

- 手动问题集运行：`backend/routes/geoProjects.js`
  - 当前先创建空 `QuestionSetRun`，再调用 `ProjectRunService.enqueueProjectRun()`。
- 任务执行与重试：`backend/services/ProjectRunService.js`
  - 当前初始运行先扣配额，再逐条创建 `QuestionRecord`。
  - 当前只有失败重试具有持久幂等批次。
- 定时调度：`backend/services/SchedulerService.js`
  - 当前 30 秒 interval 可重入。
  - `next_run_at` 在长任务结束后更新。
  - 启动 recovery 失败不会阻止 HTTP 服务 ready。
- 父运行报告：`backend/services/QuestionSetRunService.js`
  - 当前 native run 依靠 `record_ids` JSON 关联任务。
  - `finalizeNativeRun()` 是唯一固化快照与 `completed_at` 的路径，但 recovery 未调用。
- 清理：`backend/services/PromptAnalysisCleanupService.js`
  - 当前会物理删除 run 仍引用的任务和指标。
- CSV：`backend/services/QuestionSetRunCsvService.js`
  - 当前接受 `pending`，数字字段只验证 `Number.isFinite`。
- 前端报告：`nextjs-frontend/src/app/geo/question-set-reports/page.tsx`
  - 当前根据 source/status 自行决定暂停、继续和重试。
  - PDF 模式使用固定像素列宽。

### 3.2 改造前数据模型（历史）

- `QuestionSetRun`
  - `record_ids`：当前任务指针的 JSON 数组。
  - `imported_rows`：导入报告和 finalized native run 的快照。
  - `completed_at`、`paused_at`、`revision`。
- `QuestionRecord`
  - `status`、`execution_token`、`execution_started_at`。
  - 没有租约过期时间、run 归属、稳定槽位、执行模式或 retry batch 外键。
- `QuestionSetRetryBatch`
  - 已有 `(question_set_run_id, idempotency_key)` 唯一约束，可沿用其幂等响应模式。
- `DetectionSchedule` / `BrandProject.monitoring_next_run_at`
  - 没有单次到期时槽的持久执行账本。

### 3.3 改造前测试基线（历史）

- `backend/tests/SchedulerService.test.js`
- `backend/tests/ProjectRunService.test.js`
- `backend/tests/QuestionSetRunService.test.js`
- `backend/tests/QuestionSetRunApi.test.js`
- `backend/tests/QuestionSetsApi.test.js`
- `nextjs-frontend/src/utils/questionSetReportPage.test.cjs`
- `nextjs-frontend/src/utils/questionSetReportPdf.test.cjs`
- `nextjs-frontend/src/utils/projectSelection.test.cjs`

现有测试覆盖正常运行和部分恢复，但未证明调度重入、迟到 worker fencing、初始运行事务回滚、父运行恢复收敛、清理保护、analysis-only 暂停恢复和真实 PDF 右边界。

### 3.4 已接入的正式路径

- 手动问题集运行只由 `geoProjects.js` 调用 `ProjectRunService.startQuestionSetRun()`，要求幂等键并在一个事务内创建 run、预留配额和任务；旧空 run 创建链已删除。
- 定时执行先由 `SchedulerService.claimScheduledOccurrence()` 领取唯一持久时槽，再执行配额、任务和平台副作用；进程内 tick 同时保持 single-flight。
- native run 只通过 `question_records.question_set_run_id + run_slot_index` 读取任务事实；`question_set_runs.record_ids` 已从模型和数据库删除，仅一次性迁移代码保留对旧 schema 的读取能力。
- worker 通过带到期时间的执行租约领取任务，终态写入使用 token fencing；正常执行、暂停、恢复和 recovery 均调用统一 reconcile 收敛父 run。
- `/api/ready` 是正式接流门禁；`/api/health` 仅表示进程存活。

## 4. 需求、约束与规则

- REQ-001：同一 `schedule_kind + schedule_id + due_at` 只允许一个执行实例。
- REQ-002：同一初始运行幂等键只允许一个 run。
- REQ-003：配额、run、全部任务和任务槽位必须在同一事务提交。
- REQ-004：终态任务写入必须使用当前 `execution_token` 做 CAS。
- REQ-005：租约必须有明确过期时间并允许执行中续租。
- REQ-006：所有 executor 出口和 recovery 都必须调用统一 reconcile。
- REQ-007：native run 的正式任务关联必须是关系字段，不再以 JSON ID 数组为事实源。
- REQ-008：run-owned 记录不能被常规项目分析清理删除。
- REQ-009：执行模式和 retry batch 必须持久化，可由 resume 重建。
- REQ-010：imported 报告只能包含终态行。
- REQ-011：报告操作由后端 capabilities 决定。
- REQ-012：readiness 必须覆盖数据库、scheduler 初始化和最近 recovery。
- CON-001：SQLite 和 Postgres 必须使用相同业务不变量。
- CON-002：第三方请求不放在数据库事务内。
- CON-003：外部平台调用完成但本地租约已失效时，不自动再次调用平台。
- CON-004：保留 soft pause；已领取任务允许完成。
- CON-005：新执行入口正式切换后删除旧调用链，不保留隐藏 fallback。
- PAT-001：接口变更优先增加字段；已有报告和合法 CSV v1 保持可读。
- PAT-002：错误继续沿用现有 HTTP 状态和响应外层，只增加稳定 `error_code` 与 details。
- PAT-003：所有外部输入在路由或解析器边界验证，内部服务依赖已验证数据。

## 5. 接口与数据契约

### 5.1 初始运行命令

接口保持：

`POST /api/geo-projects/:projectId/question-sets/:questionSetId/run`

请求要求：

- `Idempotency-Key`：8–128 字符，字符集沿用失败重试规则。
- 同时兼容现有 body `idempotency_key` 一个发布周期；两者同时存在时必须相等。
- 服务端保存 key 的 SHA-256，不在日志中输出原文。
- 同一 key 再次用于不同项目、问题集或不同运行请求指纹时返回 409。

成功响应保持现有外层结构，在 `data` 中增加：

```json
{
  "question_set_run_id": 123,
  "accepted_count": 60,
  "planned_platforms": ["deepseek", "qwen", "doubao"],
  "skipped_platforms": [
    {
      "platform": "hunyuan",
      "reason_code": "PLATFORM_UNAVAILABLE",
      "message": "平台当前不可用，已跳过"
    }
  ],
  "idempotent_replay": false
}
```

该响应是“命令已持久化”的提交回执，不表示任务已经完成。幂等回放返回同一 run ID 和原提交计划，前端继续重新读取报告。

错误：

- 400 `INVALID_IDEMPOTENCY_KEY`
- 409 `IDEMPOTENCY_KEY_REUSED`
- 409 `RUN_ALREADY_ACTIVE`，仅用于现有业务明确禁止的并发情况
- 422 `QUESTION_SET_NOT_RUNNABLE`
- 500 `RUN_START_TRANSACTION_FAILED`

### 5.2 报告输出

`GET .../question-set-runs/:runId` 增加可选字段：

```json
{
  "analysis_contract_version": "ai_structured_v2",
  "planned_platforms": [],
  "skipped_platforms": [],
  "execution_summary": {
    "total": 60,
    "completed": 55,
    "failed": 5,
    "pending": 0,
    "failure_stages": {
      "monitoring_request": 3,
      "analysis_validation": 2
    }
  },
  "capabilities": {
    "can_pause": false,
    "can_resume": false,
    "can_retry": true,
    "retry_disabled_reason": null
  },
  "integrity": {
    "status": "complete",
    "missing_record_count": 0
  }
}
```

规则：

- `source=imported` 时所有执行 capability 为 false。
- snapshot-only 旧报告保持可读，但 `can_retry=false`。
- native run 存在 pending 才能 pause；paused 且存在 pending 才能 resume。
- 无 pending 时必须由 reconcile 写入终态，不通过 GET 修改状态。

### 5.3 Readiness

保留 `GET /api/health` 作为进程存活检查，新增 `GET /api/ready`：

```json
{
  "status": "ready",
  "checks": {
    "database": "ok",
    "sqlite_journal_mode": "wal",
    "sqlite_busy_timeout_ms": 5000,
    "scheduler_started": true,
    "last_tick_at": "2026-07-26T10:00:00.000Z",
    "last_recovery_at": "2026-07-26T10:00:00.000Z",
    "last_error": null
  }
}
```

SQLite 专属字段在 Postgres 下省略。任何必需检查失败返回 503。

### 5.4 CSV 导入

保持 `question_set_run_v1` 可读，不改变现有列含义。解析边界增加：

- `status` 只允许终态。
- ID：正整数。
- 次数：非负整数。
- 百分比：0–100 或空值。
- 排名：正数或空值。
- 时间：合法且 `completed_at >= started_at`。
- 错误详情包含 `row`、`column`、`error_code`。

可逆性增强字段采用向后兼容的尾部可选列；旧文件缺少这些列仍可导入：

- `analysis_contract_version`
- `legacy_citation_count`
- `legacy_citation_sources_json`
- `owned_citation_count`
- `competitor_citation_count`
- `competitor_baseline_json`

### 5.5 内部执行契约

所有 worker entry 从数据库重建，不依赖仅存在于内存的字段：

- `execution_mode`: `full_monitoring | analysis_only`
- `retry_batch_id`: nullable
- `question_set_run_id`: nullable
- `run_slot_index`: nullable
- `execution_token`
- `lease_owner`
- `lease_expires_at`

`analysis_only` 必须从当前记录关联的 `ResultDetail` 读取原回答与 provider citations；数据缺失时以稳定失败阶段结束，不允许自动降级为 `full_monitoring`。

## 6. 数据模型与迁移

### 6.1 `QuestionSetRun`

新增：

- `idempotency_key_hash STRING(64) NULL`
- `request_fingerprint STRING(64) NULL`
- `planned_platforms JSON NOT NULL DEFAULT []`
- `skipped_platforms JSON NOT NULL DEFAULT []`
- `competitor_snapshot JSON NOT NULL DEFAULT []`
- `analysis_contract_version STRING(40) NULL`

索引：

- UNIQUE `(user_id, project_id, idempotency_key_hash)`

`NULL` 幂等键只允许存量记录和 imported 报告。新 native run 必须非空。

### 6.2 `QuestionRecord`

新增：

- `question_set_run_id INTEGER NULL`
- `run_slot_index INTEGER NULL`
- `execution_mode STRING(24) NOT NULL DEFAULT 'full_monitoring'`
- `retry_batch_id INTEGER NULL`
- `lease_owner STRING(120) NULL`
- `lease_expires_at DATE NULL`

保留 `execution_token`，将其正式定义为 fencing token。

索引：

- `(question_set_run_id)`
- `(question_set_run_id, status)`
- UNIQUE `(question_set_run_id, run_slot_index)`
- `(lease_expires_at, status)`
- `(retry_batch_id)`

SQLite 和 Postgres 都允许唯一索引中存在多条 `run_slot_index=NULL`。重试事务先把旧 current record 的 `run_slot_index` 置空，再创建同槽位的新记录；旧记录仍保留 `question_set_run_id`，用于审计和清理保护。

### 6.3 `ScheduledExecution`

新增模型 `backend/models/ScheduledExecution.js`：

- `id`
- `schedule_kind`: `detection_schedule | project_monitoring`
- `schedule_id`
- `project_id`
- `due_at`
- `status`: `claimed | running | completed | failed`
- `execution_token`
- `lease_owner`
- `lease_expires_at`
- `attempt`
- `error_code`
- `error_message`
- `started_at`
- `completed_at`

唯一索引：

- UNIQUE `(schedule_kind, schedule_id, due_at)`

该表只表达“一次调度时槽”，不取代 `QuestionSetRun`，也不改变项目级监测的报告模型。

### 6.4 关联迁移

迁移按以下顺序执行：

1. 备份数据库并输出只读完整性统计。
2. 添加 nullable 新列和新表。
3. 对每个 native `QuestionSetRun.record_ids` 按数组位置回填：
   - 存在记录：写 `question_set_run_id` 和 `run_slot_index`。
   - 记录缺失、已有 finalized snapshot：标记报告为 snapshot-only，不创建伪记录。
   - 记录缺失、没有 finalized snapshot：标记完整性失败，交由 reconcile 固化诊断终态。
4. 校验不存在重复 current slot。
5. 报告、重试、暂停、恢复和清理全部切到关系字段。
6. 用入口级测试证明没有生产代码读写 `record_ids`。
7. 在数据库能力允许时删除 `record_ids`；若当前发布不删，必须在模型中移除并建立后续迁移事项，不能继续作为 fallback。

### 6.5 SQLite 初始化

- 不再直接 `await connection.run(...)`。
- 使用与 sqlite driver callback 语义一致的 Promise 封装，或使用 Sequelize 能返回 Promise 的查询接口。
- `journal_mode` 是文件级配置，初始化后读取并验证结果。
- `busy_timeout` 是连接级配置，每个新连接都设置并验证。
- 不再静默吞掉异常；记录安全错误并让 readiness 失败。
- Postgres 分支不执行任何 SQLite PRAGMA。

## 7. 关键技术决策

- KTD-001：不建立通用 `QuestionSetRunStateService`。
  - 状态仍由任务事实派生；只新增一个幂等 `reconcileQuestionSetRun()` 负责父运行终态。
- KTD-002：调度采用“进程内 single-flight + 持久化时槽账本”。
  - 只提前更新 `next_run_at` 能防重但会在进程崩溃时吞掉任务；账本同时提供去重、恢复和审计。
- KTD-003：初始运行使用 plan/commit/dispatch 三段式。
  - plan 只读外部配置；commit 只做数据库原子写入；dispatch 发生在提交后。
- KTD-004：第三方调用不放入事务，终态产物在短事务内以 token CAS 提交。
  - 防止长事务锁库，同时保证迟到执行器无法写入。
- KTD-005：租约 TTL 来自完整执行预算并支持 heartbeat。
  - 不再使用固定 15 分钟代表所有平台和分析组合。
- KTD-006：未领取 pending 可以在启动后重新 dispatch；已过期且可能调用过平台的任务进入可重试失败，不自动再次调用外部平台。
  - 优先防止重复成本。
- KTD-007：`question_set_run_id + run_slot_index` 是 native run 当前槽位事实源。
  - `record_ids` JSON 退出正式调用链。
- KTD-008：历史证据与当前分析缓存分离生命周期。
  - 清理服务可以清当前缓存，但不得删除 `question_set_run_id IS NOT NULL` 的证据，除非用户明确删除整个项目。
- KTD-009：soft pause 保持。
  - pause 只阻止新租约领取，不中止已发生的平台调用。
- KTD-010：CSV 使用兼容追加列，不在本需求制造两个长期并行的 CSV 版本。

## 8. 实现切片

### U1. SQLite 配置与 readiness

**目标：** 让本地数据库并发配置真实生效，并阻止 scheduler/recovery 失效时假健康。

**依赖：** 无。

**涉及文件：**

- `backend/config/database.js`
- `backend/app.js`
- `backend/services/SchedulerService.js`
- `backend/tests/DatabaseConfig.test.js`
- `backend/tests/SchedulerService.test.js`

**方案：**

- 正确 Promise 化 PRAGMA。
- 启动读取实际配置并保存 readiness 状态。
- scheduler 只有 refresh、recovery 和 timer 安装全部成功后才设置 started。
- 初始化失败重置 started，并允许显式重试。
- 新增 `/api/ready`；`/api/health` 保持 liveness。

**测试场景：**

- SQLite 三项 PRAGMA 成功。
- PRAGMA 任一失败时 readiness=503。
- Postgres 不执行 PRAGMA。
- scheduler recovery 抛错后 started=false，可再次启动。

**验收方式：** 真实连接读取 PRAGMA 与 readiness 返回一致，不接受只检查源码。

### U2. 调度 single-flight 与时槽账本

**目标：** 同一到期时槽只产生一次执行和一次副作用。

**依赖：** U1。

**涉及文件：**

- `backend/models/ScheduledExecution.js`
- `backend/models/index.js`
- `backend/services/SchedulerService.js`
- `backend/services/ProjectRunService.js`
- `backend/app.js`
- `backend/tests/SchedulerService.test.js`
- `backend/tests/ProjectRunService.test.js`

**方案：**

- `_tickPromise` 阻止进程内 tick 重入。
- 对到期计划在事务内创建唯一 `ScheduledExecution` 并推进 `next_run_at`。
- 唯一约束冲突表示其他进程已领取，不是错误。
- 执行成功或失败回写账本；恢复器处理过期账本。
- 配额与任务创建在取得时槽后执行，并关联 execution ID。

**测试场景：**

- 两个 tick 并发。
- 两个 service 实例并发领取同一时槽。
- 长任务跨越多个 interval。
- claim 后进程退出。
- 唯一冲突不重复扣配额。

**验收方式：** 并发压测中，同一时槽的执行实例、配额变化和平台调用次数均为 1。

### U3. 初始问题集运行原子化与幂等

**目标：** 消除空 run、孤儿任务、配额泄漏和重复提交。

**依赖：** U1。

**涉及文件：**

- `backend/models/QuestionSetRun.js`
- `backend/models/QuestionRecord.js`
- `backend/routes/geoProjects.js`
- `backend/services/ProjectRunService.js`
- `backend/services/QuestionSetRunService.js`
- `backend/middleware/quota.js`
- `backend/tests/QuestionSetsApi.test.js`
- `backend/tests/ProjectRunService.test.js`
- `backend/tests/QuestionSetRunApi.test.js`

**方案：**

- 新增 `startQuestionSetRun()` 唯一入口。
- 事务外构建稳定 plan 和请求 fingerprint。
- 事务内幂等查重、创建 run、预留配额、批量建任务并写稳定 slot。
- 提交后 dispatch；未领取 pending 由启动/周期 dispatcher 补发。
- 删除 route 直接创建空 run 和二次更新 `record_ids` 的旧路径。

**测试场景：**

- 相同 key 顺序与并发重放。
- 相同 key 不同 question set。
- 配额后、任务中部、run 关联阶段故障注入。
- dispatch 同步失败后持久任务仍可补发。
- 不可用平台被持久化并出现在终态报告。

**验收方式：** 入口级测试和数据库检查共同证明一次请求只有一个聚合、失败零残留。

### U4. 执行租约 fencing 与父运行 reconcile

**目标：** 阻止迟到 worker 污染状态，并让所有运行最终收敛。

**依赖：** U3 的关系字段；调度任务可并行接入。

**涉及文件：**

- `backend/models/QuestionRecord.js`
- `backend/services/ProjectRunService.js`
- `backend/services/QuestionSetRunService.js`
- `backend/services/SchedulerService.js`
- `backend/tests/ProjectRunService.test.js`
- `backend/tests/QuestionSetRunService.test.js`
- `backend/tests/SchedulerService.test.js`

**方案：**

- claim 同时写 token、owner、expires_at。
- 外部请求期间按 TTL/3 或更短周期续租。
- ResultDetail、VisibilityMetric 和 QuestionRecord 终态在一个短事务内提交；record 更新条件包含 token。
- token CAS 失败时回滚本次终态产物并记录 `stale_worker_write_rejected`。
- 成功路径清空 error。
- recovery 仅回收过期租约，并对受影响 run 调 reconcile。
- executor finally、pause drain、resume-zero-pending 和 retry batch 结束都调 reconcile。
- reconcile 以 run revision 防止旧完成器覆盖新重试。

**测试场景：**

- 恢复器先回收、旧 worker 后提交。
- heartbeat 保持活租约不被回收。
- 成功清旧错误。
- recovery 后父 run 完成。
- pause 后最后一个在途任务结束。
- retry 增加 revision 时旧 reconcile 迟到。

**验收方式：** 真实重启 E2E 证明子状态、父状态、快照、revision 和错误字段一致。

### U5. 历史证据归属与清理保护

**目标：** 后续项目编辑不再破坏历史报告和重试入口。

**依赖：** U3。

**涉及文件：**

- `backend/models/QuestionRecord.js`
- `backend/models/QuestionSetRun.js`
- `backend/models/index.js`
- `backend/services/PromptAnalysisCleanupService.js`
- `backend/services/QuestionSetRunService.js`
- `backend/services/ProjectRunService.js`
- `backend/services/ProjectDeletionService.js`
- `backend/app.js`
- `backend/tests/QuestionSetRunService.test.js`
- `backend/tests/ProjectRunService.test.js`
- `backend/tests/PromptAnalysisCleanupService.test.js`

**方案：**

- 回填 run 归属和 slot。
- 清理服务排除 run-owned 记录及其 detail/metric。
- 项目明确删除仍可按现有授权级联删除整个聚合。
- 报告返回 integrity/capabilities。
- 存量 snapshot-only 报告保持可读但不可重试。
- 活跃缺失记录的 run 写入稳定完整性失败并 finalize。
- 删除正式代码对 `record_ids` 的依赖。

**测试场景：**

- 编辑问题、竞品、当前分析数据清理。
- 完整历史仍可重试。
- 缺记录旧报告只读。
- 活跃缺记录收敛失败。
- 明确删除项目仍完整清理。

**验收方式：** 数据完整性审计输出“新运行悬空引用 0”；旧损坏运行均有明确分类。

### U6. 重试模式、导入边界与报告操作

**目标：** 消除暂停恢复后的执行模式漂移和 imported 假运行状态。

**依赖：** U4、U5。

**涉及文件：**

- `backend/models/QuestionRecord.js`
- `backend/models/QuestionSetRetryBatch.js`
- `backend/services/ProjectRunService.js`
- `backend/services/QuestionSetRunCsvService.js`
- `backend/services/QuestionSetRunService.js`
- `backend/routes/geoProjects.js`
- `backend/tests/ProjectRunService.test.js`
- `backend/tests/QuestionSetRunService.test.js`
- `backend/tests/QuestionSetRunApi.test.js`

**方案：**

- 持久化 `execution_mode` 和 `retry_batch_id`。
- resume 从数据库重建原回答、引用和批次上下文。
- 缺失 analysis-only 原始材料时失败，不自动转 full monitoring。
- CSV 状态和数字字段使用列级 schema。
- imported source 只能派生终态。
- report capabilities 由服务端统一计算。

**测试场景：**

- analysis-only 暂停、重启、恢复。
- 原回答缺失。
- retry batch 终态。
- pending CSV、负数、小数、超范围 SOV、非法时间。
- imported 报告 capabilities 全 false。

**验收方式：** 通过平台调用 spy 和配额前后值证明 analysis-only 未发起监测调用。

### U7. partial 交互与 PDF 验收

**目标：** 让半成品报告可解释、可操作，并消除当前 PDF 列宽风险。

**依赖：** U6 的 capabilities 和 execution summary。

**涉及文件：**

- `nextjs-frontend/src/app/geo/question-set-reports/page.tsx`
- `nextjs-frontend/src/app/geo/question-set-reports/question-set-reports.module.css`
- `nextjs-frontend/src/components/QuestionSetRunHistoryDrawer.tsx`
- `nextjs-frontend/src/utils/questionSetReportPage.test.cjs`
- `nextjs-frontend/src/utils/questionSetReportPdf.test.cjs`

**方案：**

- 顶部状态展示完成、失败、待处理和失败阶段。
- 操作按钮完全依赖 capabilities。
- 不可重试显示原因，不发送必然 409 的请求。
- PDF 模式隐藏交互型展开列，显式列宽总和不得超过内容宽度。
- 原始回答和诊断使用 PDF 专用静态块，不依赖表格展开控件。

**测试场景：**

- partial 可重试、不可重试、snapshot-only、imported。
- 运行中、暂停、终态切换。
- 长中文问题、长平台名、全部列、两页以上 PDF。

**验收方式：** Chrome 真实导出 A4 PDF，渲染每页并检查右边界、最后一列、分页和操作区隐藏。

## 9. 验收标准

实现必须逐项满足 PRD AC-001 至 AC-025。以下为正式切换的额外技术门禁：

- AC-T01：代码搜索不存在生产路径读取或写入 `QuestionSetRun.record_ids`。
- AC-T02：所有 `QuestionRecord` 终态写入都包含 execution token 条件，或明确属于不经过 worker 的迁移/人工终止路径。
- AC-T03：所有会让 pending 数量减少的路径最终都会调用 reconcile。
- AC-T04：scheduler 同一时槽唯一约束在 SQLite 和 Postgres 均生效。
- AC-T05：启动日志和 readiness 不包含密钥、平台原始响应或幂等键原文。
- AC-T06：旧实现没有 feature flag、隐藏 fallback 或推荐文档入口。

## 10. 测试与验证计划

### 单元测试

- 幂等键规范化、请求 fingerprint。
- 租约 claim、renew、terminal CAS、stale rejection。
- reconcile 状态矩阵与 revision。
- CSV 字段 schema。
- capabilities 与 integrity 派生。
- PDF 列宽预算。

### 集成测试

- SQLite 真实事务故障注入与回滚。
- 两个 service 实例竞争 scheduler 时槽。
- 两个请求竞争初始运行幂等键。
- 清理服务与 run-owned 记录。
- analysis-only 跨 pause/resume。
- Postgres 方言下唯一约束和事务语义；若 CI 无 Postgres，至少使用独立集成环境作为发布门禁。

### 重启与故障测试

- 平台调用前退出：未领取 pending 可重新 dispatch。
- 平台调用中退出：租约过期后标记中断，不自动重复外部调用。
- recovery 后父 run finalize。
- scheduler 初始化失败、恢复后重试。
- SQLite 锁竞争下 busy timeout 行为。

### 真实入口验证

- 通过正式 `POST /question-sets/:id/run` 创建运行。
- 对同一 idempotency key 重放并核对数据库和配额。
- 从报告执行暂停、继续和 analysis-only retry。
- 操作项目问题编辑后重新打开、重试历史报告。
- 导入非法 CSV 和合法终态 CSV。
- Chrome 导出 PDF 并保存渲染截图。

### 证据

- 自动化测试结果。
- 数据库不变量查询结果。
- scheduler occurrence、租约拒绝和 reconcile 日志。
- readiness JSON。
- PDF 文件信息和逐页截图。
- 代码搜索证明旧入口、`record_ids` 正式引用和 fallback 已清理。

## 11. 可观测性

新增结构化指标或日志：

- `scheduler_tick_skipped_inflight`
- `scheduler_occurrence_claimed`
- `scheduler_occurrence_duplicate_rejected`
- `execution_lease_claimed`
- `execution_lease_renew_failed`
- `stale_worker_write_rejected`
- `question_set_run_reconciled`
- `question_set_run_reconcile_failed`
- `question_set_run_integrity_missing_records`
- `question_set_run_idempotent_replay`
- `sqlite_pragma_verification_failed`

所有日志包含内部 ID、阶段和稳定错误码，不输出 API Key、JWT、完整平台响应、完整问题文本或幂等键原文。

readiness 至少暴露：

- 数据库可用性。
- SQLite 实际 PRAGMA。
- scheduler started。
- 最近 tick/recovery 时间。
- 最近错误的安全摘要。

## 12. Rollout 与回滚

### Rollout

1. 在隔离数据库运行关联迁移和完整性审计。
2. 备份生产数据库。
3. 先部署 additive schema、SQLite readiness 和观测。
4. 部署 scheduler 时槽账本与租约 fencing。
5. 前后端同一发布切片切换初始运行幂等入口。
6. 回填 run 关系并切换报告、重试、暂停、恢复和清理。
7. 删除旧正式入口和 `record_ids` 生产引用。
8. 完成并发、重启、真实入口和 PDF 门禁后才宣布完成。

### 回滚

- additive 列和新表在回滚版本中可保留，不做破坏性逆迁移。
- 如果尚未接受新入口流量，可回滚整个发布产物。
- 一旦新 schema 已承载正式运行，不通过重新启用旧空 run 路径止血；默认 fix forward。
- 若必须回滚，必须记录当前正式路径、受影响 run、配额影响和再次切回新路径的条件。
- 数据迁移前快照只用于灾难恢复，不用来覆盖迁移后已经产生的新业务数据。

## 13. 风险与缓解

- 风险：SQLite 与 Postgres 对唯一索引、锁和日期精度行为不同。
  - 缓解：两种方言运行相同竞争测试；due_at 统一归一到持久计划时槽。
- 风险：租约 TTL 过短误杀，过长延迟恢复。
  - 缓解：TTL 来自平台请求、重试和分析预算；heartbeat；记录实际耗时分布。
- 风险：终态产物跨表写入部分成功。
  - 缓解：终态 ResultDetail、VisibilityMetric、QuestionRecord 在同一短事务提交并以 token CAS 收口。
- 风险：存量 `record_ids` 已经悬空，关系回填不完整。
  - 缓解：保留 finalized snapshot，分类 snapshot-only；不伪造任务。
- 风险：强制 Idempotency-Key 破坏旧前端或脚本。
  - 缓解：前后端同切片发布；body/header 短期双读；文档同步更新。
- 风险：保护历史记录增加数据库体积。
  - 缓解：先保证审计正确性；后续制定 run 级保留与用户明确删除策略，不复用当前缓存清理。
- 风险：scheduler 账本增长。
  - 缓解：默认保留至少 90 天；只清理终态账本且保留聚合计数，具体周期可配置。
- 风险：PDF 单一固定宽度在长内容下仍换行异常。
  - 缓解：PDF 专用布局、列宽预算测试、真实多页像素验收。

## 14. 假设与开放问题

- 假设当前问题集运行和失败重试仍属于同一 run revision 体系。
- 假设用户明确删除整个项目时允许删除其报告与证据；常规编辑和缓存清理不允许。
- 假设单机 SQLite 是正式支持路径，因此 PRAGMA 和进程内 single-flight 不是仅开发环境优化。
- 假设生产 Postgres 未来可能出现多进程实例，因此数据库唯一 claim 和 fencing 是正式要求。

开放问题均不阻塞实现：

- scheduler 账本默认保留 90 天是否满足实际审计周期。
- snapshot-only 旧报告是在历史列表直接展示标签，还是只在详情提示；默认两处都展示。

## 15. 后续衔接

- 可拆 issue：
  - U1 SQLite 与 readiness
  - U2 调度时槽账本
  - U3 初始运行原子化与幂等
  - U4 租约 fencing 与 reconcile
  - U5 历史证据归属迁移
  - U6 重试与导入边界
  - U7 partial 与 PDF
- 建议第一个 issue：U1，随后立即实施 U2；U3 与 U4 在数据字段确定后顺序完成。
- 是否适合 TDD：适合。U2、U3、U4、U6 必须先写并发、故障注入和状态不变量失败测试，再实现。
- 推荐下一步：使用 `$to-issues` 按 U1–U7 拆分，并用 `$prd-issue-tdd` 从 P0 发布门禁开始执行。
