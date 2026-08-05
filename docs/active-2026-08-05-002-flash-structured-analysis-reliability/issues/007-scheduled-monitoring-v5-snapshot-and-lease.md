---
title: "接入自动监测的 v5 快照与租约预算"
status: open
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

- [ ] 自动监测创建的候选记录冻结稳定 v5 合同和竞品注册表快照，配置变化只影响下一次新运行。
- [ ] 正常 2 次及合法的最多 4 次 Flash 调用均处于更新后的租约预算内，不会被错误 fencing。
- [ ] 过期租约、并发恢复或重复调度不能产生重复指标、快照漂移或迟到写入。
- [ ] 采集有效但语义部分失败时保留原回答、引用和目标事实，受影响字段按 `partial / unavailable / unresolved` 保存。
- [ ] 自动监测分析失败不重新排队网页采集，也不调用 v4、Pro 或第二套分析实现。
- [ ] 调度器级测试可证明使用固定 Flash 策略，并记录实际调用次数、Token、耗时和失败阶段。

## Blocked by

- [005-single-question-analysis-only-registry-snapshot.md](005-single-question-analysis-only-registry-snapshot.md)
