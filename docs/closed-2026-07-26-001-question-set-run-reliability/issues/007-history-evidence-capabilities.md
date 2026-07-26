---
title: "保护历史证据并返回操作 Capabilities"
status: closed
type: AFK
blocked_by:
  - "003-run-record-ownership-migration"
  - "006-run-reconciliation"
---

# 保护历史证据并返回操作 Capabilities

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-4、US-5

## What to build

把问题集运行证据从当前项目分析缓存的清理生命周期中隔离。常规问题、竞品和指标清理不得删除 run-owned 任务、原回答或指标；用户明确删除整个项目时仍沿用现有授权和级联语义。

报告服务根据来源、状态和完整性返回统一 capabilities 与 integrity。前端使用这些能力决定按钮和提示，不再展示必然返回 409 的重试操作。

## Acceptance criteria

- [x] 常规问题编辑、竞品编辑和当前分析缓存清理不会删除 run-owned 任务、原回答和指标。
- [x] 用户明确删除整个项目时，仍按现有权限删除其完整聚合，不产生不可达残留。
- [x] 底层数据完整的历史报告保持可查看、可导出，并在有失败项时可重试。
- [x] snapshot-only 旧报告保持可查看和可导出，但返回 `can_retry=false` 及稳定原因。
- [x] 活跃运行缺少底层记录时进入可诊断失败并收敛，不无限显示 running。
- [x] 报告返回 pause、resume、retry 的服务端 capabilities 和 integrity 摘要。
- [x] imported 报告所有执行型 capability 均为 false。
- [x] 前端完全依据 capabilities 显示或禁用操作，不发送已知必然失败的请求。
- [x] 数据完整性审计证明新运行悬空引用为 0，并对每个存量损坏运行给出分类。

## Verification

- 新增检测历史删除保护：单条删除 run-owned 记录返回 `409 / RUN_EVIDENCE_PROTECTED`；批量删除只清理非运行缓存并返回 `deleted`、`protected` 数量，相关原回答和指标保持存在。
- 既有 `PromptAnalysisCleanupService` 回归证明问题、竞品和项目语义清理保留 run-owned 记录、原回答与指标；`ProjectDeletionService` 回归证明明确永久删除已归档项目时仍完整删除聚合。
- 报告接口统一返回 `integrity` 与 pause/resume/retry capabilities；`snapshot_only_report`、`run_records_missing`、`imported_report_read_only` 为稳定禁用原因，前端操作入口和处理函数均只消费 capabilities。
- Issue 相关后端回归：47/47 通过；前端 Node 回归：179/179 通过；前端 lint 无错误，TypeScript 检查通过，生产构建通过。
- 后端完整回归：650/650 通过。沙箱内首次运行有 5 个回环端口测试因 `EPERM` 失败；在允许绑定本机回环端口的环境重跑后全部通过。
- 对真实 `backend/database.sqlite` 执行只读 `npm run audit:run-ownership`：15 个原生运行中 run #15/#16 为 `complete`；run #1–#12、#14 共 13 个均分类为 `snapshot_only`；`dangling_owned_record_count=0`、`new_run_dangling_reference_count=0`、`new_run_integrity_issue_count=0`。

## Blocked by

- [003 建立运行任务归属并迁移存量数据](003-run-record-ownership-migration.md)
- [006 统一 Reconcile 让恢复暂停和重试收敛](006-run-reconciliation.md)
