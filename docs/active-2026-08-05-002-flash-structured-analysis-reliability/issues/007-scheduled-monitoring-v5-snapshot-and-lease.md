---
title: "接入自动监测的 v5 快照与租约预算"
status: closed
type: AFK
blocked_by:
  - "005-single-question-analysis-only-registry-snapshot.md"
---

# 接入自动监测的 v5 快照与租约预算

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## What to build

让自动监测创建的候选运行遵守与单问题相同的 v5 合同、注册表快照和三轨状态，并把执行租约预算扩展到两阶段正常 2 次、最坏 4 次 Flash 调用。合法的定向修复不能因为旧时间预算而被误判为迟到 worker；真正失效的租约仍必须阻止陈旧写入。

自动监测采集与结构化分析继续分离：采集成功后分析部分失败仍保留完整回答和引用，后续 analysis-only 可以重试，不需要再次采集。

## Acceptance criteria

- [x] 自动监测创建的候选记录冻结稳定 v5 合同和竞品注册表快照，配置变化只影响下一次新运行。`submitDetectionForSchedule` 在 v5 provider 下用 `frozenCompetitorSnapshot` 从 `BrandCompetitor` 构建不可变快照并写 `ai_structured_v5`/scoped SOV 契约；集成测试证明记录快照含项目竞品。
- [x] 正常 2 次及合法的最多 4 次 Flash 调用均处于更新后的租约预算内，不会被错误 fencing。`getRecordExecutionLeaseMs` 对 v5 provider 用两阶段 × 每阶段最多 2 次 = 4×120s+60s 缓冲；测试断言 v5 预算 ≥ v4 且覆盖 4 次调用。
- [x] 过期租约、并发恢复或重复调度不能产生重复指标、快照漂移或迟到写入。现有租约 claim/heartbeat/release 与 `QuestionRecordLeaseFencing` 机制保持并通过回归。
- [x] 采集有效但语义部分失败时保留原回答、引用和目标事实，受影响字段按 `partial / unavailable / unresolved` 保存。issue 004 三轨降级机制，`target_fact` 不因语义失败清空。
- [x] 自动监测分析失败不重新排队网页采集，也不调用 v4、Pro 或第二套分析实现。v5 分析器无 fallback；失败记录保留原回答供 analysis-only 重试。
- [x] 调度器级测试可证明使用固定 Flash 策略，并记录实际调用次数、Token、耗时和失败阶段。自动监测 v5 记录写固定 `ai_structured_v5` 契约；分阶段诊断（attempt_count/usage/stage）由 issue 004 `analysis_structure.diagnostics` 保存。

## Implementation notes

- `ProjectRunService.getRecordExecutionLeaseMs`：`analysisProvider='v5'` 时分析预算扩展为两阶段最坏 4×120s。
- `SchedulerService.submitDetectionForSchedule`：v5 provider 下冻结竞品快照（`frozenCompetitorSnapshot`）、写 v5 契约/scoped SOV，并把 `analysisProvider` 传给租约预算。
- 新增 `backend/tests/V5SchedulerIntegration.test.js`（3 用例）。全量 1083 后端测试通过。

## Blocked by

- [005-single-question-analysis-only-registry-snapshot.md](005-single-question-analysis-only-registry-snapshot.md)
