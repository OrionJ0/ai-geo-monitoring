---
title: "正式切换并完成生产级可靠性验收"
status: closed
type: HITL
blocked_by:
  - "001-sqlite-readiness"
  - "002-scheduled-occurrence-deduplication"
  - "003-run-record-ownership-migration"
  - "004-atomic-idempotent-run-start"
  - "005-execution-lease-fencing"
  - "006-run-reconciliation"
  - "007-history-evidence-capabilities"
  - "008-persist-analysis-only-retry"
  - "009-csv-terminal-import-validation"
  - "010-partial-report-pdf-verification"
---

# 正式切换并完成生产级可靠性验收

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-1 至 US-7

## What to build

在人工确认备份、迁移窗口和生产影响后，把正式入口硬切到新的调度时槽、原子启动、租约 fencing、关系归属和 reconcile 路径。删除旧空 run 启动链、旧任务关联事实源和隐藏 fallback，并从真实公开入口完成并发、故障、重启、历史清理、导入和 PDF 验收。

这个 issue 不重新实现前置能力，只负责生产迁移、正式切换、证据闭环和发布决策。任何未达到的门禁都必须保留 open，不得仅凭单元测试宣称完成。

## Acceptance criteria

- [x] 人工确认生产数据库备份、迁移窗口、回滚边界和当前影响范围。
- [x] 存量完整性审计列出完整、snapshot-only 和活跃损坏运行，不修改或伪造历史指标。
- [x] 正式问题集运行入口只走原子幂等路径，默认配置不再指向旧实现。
- [x] 定时执行只走持久时槽领取，旧重复调度入口和 fallback 已删除。
- [x] 生产代码不再读写 JSON `record_ids` 作为运行事实源。
- [x] 入口级测试证明新实现被调用、旧实现未被调用。
- [x] 同一调度时槽并发领取实测只有一个执行、一次配额变化和一组任务。
- [x] 相同初始运行幂等键并发提交实测只有一个 run 和一次配额预留。
- [x] 真实进程重启证明租约恢复、迟到写入拒绝和父 run 收敛。
- [x] 编辑项目数据后，完整历史仍可查看和重试；snapshot-only 报告正确禁用重试。
- [x] 非法 CSV、合法终态 CSV、analysis-only 暂停恢复和 partial 操作均从真实 API/UI 通过验收。
- [x] Chrome 真实导出 A4 PDF，并保存逐页无裁切证据。
- [x] readiness、结构化日志和数据库不变量查询能够证明运行状态。
- [x] README、API、部署说明和当前需求文档只推荐新正式路径；旧描述被删除或明确标记为历史退役。
- [x] 若任一外部消费者、迁移或验证尚未完成，需求目录不得改为 closed，且必须记录剩余项、移除条件和负责人。

## Blocked by

- [001 修复 SQLite 并暴露真实 Readiness](001-sqlite-readiness.md)
- [002 实现定时计划时槽唯一领取与防重](002-scheduled-occurrence-deduplication.md)
- [003 建立运行任务归属并迁移存量数据](003-run-record-ownership-migration.md)
- [004 原子且幂等地提交问题集运行](004-atomic-idempotent-run-start.md)
- [005 增加执行租约续期与终态 Fencing](005-execution-lease-fencing.md)
- [006 统一 Reconcile 让恢复暂停和重试收敛](006-run-reconciliation.md)
- [007 保护历史证据并返回操作 Capabilities](007-history-evidence-capabilities.md)
- [008 持久化 Analysis-only 重试上下文](008-persist-analysis-only-retry.md)
- [009 收紧 CSV 导入并阻断伪运行态](009-csv-terminal-import-validation.md)
- [010 完成 Partial 交互与 PDF 像素验收](010-partial-report-pdf-verification.md)

## Verification

### 自动化门禁

- 后端完整回归：`cd backend && npm test`，663/663 通过。
- 前端完整 Node 回归：`node --test src/utils/*.test.cjs src/utils/*.test.mjs`，203/203 通过。
- 前端 lint：0 error、1 个既有未使用变量 warning；`npx tsc --noEmit` 通过。
- Next.js 生产构建在允许 Turbopack 创建本机子进程的环境通过，28/28 静态页面生成成功。受限沙箱中的首次构建因临时端口 `EPERM` 失败，不计为源码失败。
- `GeoProjectsRoutePolicy.test.js` 证明问题集路由只调用 `startQuestionSetRun()`，不调用旧 `createNativeRun()` 或通用 `enqueueProjectRun()`。
- `QuestionSetRunStart.test.js` 的并发同键用例证明只有 1 个 run、2 个计划任务、1 次共计 2 的配额预留和 1 次 dispatch。
- `ScheduledExecutionClaim.test.js` 使用真实临时 SQLite 双实例竞争，证明同一时槽只有 1 条账本、1 次平台副作用、1 次配额变化和 1 组任务；同进程长任务重入同样不会重复执行。
- 租约、迟到写入和父运行收敛分别由 `QuestionRecordLeaseFencing.test.js`、`QuestionSetRunReconciliation.test.js` 和 Issue 005 的真实过期租约重启验收覆盖。
- 清理保护、snapshot-only capabilities、CSV 边界和 analysis-only 持久化分别由 `PromptAnalysisCleanupService.test.js`、报告 API/Service、`QuestionSetRunCsvValidation.test.js` 和 `QuestionSetRetryPersistence.test.js` 覆盖。

### 真实入口与数据证据

- 本地正式后端从 PID 52516 停止后，通过 `cd backend && npm start` 重启为 PID 54647；重启后的 `/api/health` 返回 200，`/api/ready` 返回 `ready`，其中 SQLite 为 WAL、busy timeout 5000、synchronous normal，scheduler 已启动，首次 recovery 无错误。
- 只读归属审计：15 个 native run 中 run #15/#16 为 `complete`，run #1–#12/#14 共 13 个为 `snapshot_only`；活跃损坏运行 0、悬空归属 0、新运行完整性错误 0、重复槽位 0。历史缺失引用只作为 snapshot-only 分类，不重算历史指标。
- 真实 API 从 run #16 导出合法终态 CSV 后回导：export=200、import=201、source=imported，pause/resume/retry capabilities 全部为 false；把第 2 行改为 pending 后返回 `422 / NON_TERMINAL_STATUS`，包含 `row=2`、`column=status`。合成导入 run 已删除，数据库恢复为 15 个 run，`quick_check=ok`。
- 真实 API 创建一条不会调用外部平台的合成 `analysis_only` 任务：pause=200、resume=200、执行模式保持 `analysis_only`，缺少原回答时以 `analysis_retry_context_missing` 收敛为 failed，retry batch=failed，配额 153→153。合成 run、batch 和 record 均已删除，`quick_check=ok`。
- Issue 010 的真实 Chrome 验收覆盖 partial run #15、snapshot-only run #14 和 run #16 A4 PDF；11 页逐页右边缘像素检查均为 0，证据位于 `output/playwright/` 和 `output/pdf/`。
- 最新本地 SQLite 在线备份：`backend/backups/question-set-run-release-2026-07-26.sqlite`，40,054,784 字节，权限 0600，SHA-256 `afc8c773831649375060b061fdadd2b8019f3065b64dd0db066b706d58b4329b`，`PRAGMA quick_check=ok`，含 15 个 run。

## Production closeout

- 用户已确认当前 `backend/database.sqlite` 为本次待处理数据库，并授权使用上述备份完成生产收口。
- 修复前精确复核 `question_records.id IN (236, 237)`：两条均为 run #15 的 `completed` 记录，任务表和 `imported_rows` 快照均残留 `error_message='分析任务中断，请重新运行'`。
- 在 SQLite IMMEDIATE 事务中按 record ID、run ID、status 和旧错误文本做前置条件保护；任务表更新 2 条、run #15 快照更新 2 条。只把旧 `error_message` 置空，未修改回答、指标、状态、槽位或其他快照字段。
- 修复后真实报告 API 返回两条记录均为 `completed + error_message=null`，CSV 中旧错误出现次数为 0。
- 发布后 `PRAGMA quick_check=ok`；completed/error、completed snapshot/error、终态租约、悬空归属、重复 run 槽位、无 pending 却未完成的 native run、重复调度时槽均为 0。
- 归属审计仍为 2 个 complete、13 个 snapshot-only、0 个活跃损坏、0 个新运行完整性错误；`/api/health` 返回 200，`/api/ready` 返回 ready，数据库与 scheduler 均无错误。

负责人：生产发布负责人。回滚点：`backend/backups/question-set-run-release-2026-07-26.sqlite`。
