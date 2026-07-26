---
title: "持久化 Analysis-only 重试上下文"
status: closed
type: AFK
blocked_by:
  - "005-execution-lease-fencing"
  - "006-run-reconciliation"
---

# 持久化 Analysis-only 重试上下文

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-2、US-5

## What to build

把重试执行模式和 retry batch 归属保存到数据库，使暂停、进程重启和 resume 后能够完整重建执行上下文。`analysis_only` 必须复用已保存的原回答与供应商引用，不允许因为内存字段丢失而退化为完整监测。

原始材料缺失时应产生明确、可诊断的分析重试失败，而不是重新调用平台或静默改变配额语义。

## Acceptance criteria

- [x] 每个重试任务持久化 `full_monitoring` 或 `analysis_only` 执行模式及 retry batch 归属。
- [x] resume 和进程重启后从数据库重建执行模式、原回答、provider citations 和批次上下文。
- [x] analysis-only 暂停恢复后不调用监测平台、不消耗监测配额。
- [x] analysis-only 使用当前重试记录关联的原回答和供应商引用快照。
- [x] 原回答或必要引用快照缺失时，以稳定失败阶段结束，不自动切换为 full monitoring。
- [x] full-monitoring 重试保持现有平台调用和配额规则。
- [x] retry batch 在任务结束后进入 completed 或 failed，不永久停留 queued。
- [x] 平台调用 spy、配额前后值和数据库批次状态共同证明执行模式没有漂移。

## Verification

- `buildPersistedQuestionSetRunContext` 统一用于 startup redispatch 和 resume，从 `question_records.execution_mode/retry_batch_id`、`result_details.ai_response_original/provider_citations` 及 run 快照重建完整上下文。
- 进程重启路径会补发 retry-owned pending 记录；analysis-only 平台调用 spy 为 0、原回答和引用与数据库快照一致、`UsageCounter.used_count` 前后均为 7，批次最终为 `completed`。
- full-monitoring 重启补发的平台调用 spy 为 1、配额前后不重复增加，批次最终为 `completed`。
- analysis-only 缺原回答时以 `analysis_retry_context / analysis_retry_context_missing` 失败，平台调用 spy 为 0，父运行和批次均收敛为失败终态。
- 同步调度失败以 `retry_dispatch / retry_dispatch_failed` 原子标记重试记录，随后 reconcile 父运行并把 retry batch 标记为 `failed`，不遗留 `queued`。
- 新增专项测试：5/5 通过；关联恢复、重试、租约、调度和 schema 回归：68/68 通过；后端完整回归：655/655 通过。

## Blocked by

- [005 增加执行租约续期与终态 Fencing](005-execution-lease-fencing.md)
- [006 统一 Reconcile 让恢复暂停和重试收敛](006-run-reconciliation.md)
