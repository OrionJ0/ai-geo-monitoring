---
title: "持久化 Analysis-only 重试上下文"
status: open
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

- [ ] 每个重试任务持久化 `full_monitoring` 或 `analysis_only` 执行模式及 retry batch 归属。
- [ ] resume 和进程重启后从数据库重建执行模式、原回答、provider citations 和批次上下文。
- [ ] analysis-only 暂停恢复后不调用监测平台、不消耗监测配额。
- [ ] analysis-only 使用当前重试记录关联的原回答和供应商引用快照。
- [ ] 原回答或必要引用快照缺失时，以稳定失败阶段结束，不自动切换为 full monitoring。
- [ ] full-monitoring 重试保持现有平台调用和配额规则。
- [ ] retry batch 在任务结束后进入 completed 或 failed，不永久停留 queued。
- [ ] 平台调用 spy、配额前后值和数据库批次状态共同证明执行模式没有漂移。

## Blocked by

- [005 增加执行租约续期与终态 Fencing](005-execution-lease-fencing.md)
- [006 统一 Reconcile 让恢复暂停和重试收敛](006-run-reconciliation.md)
