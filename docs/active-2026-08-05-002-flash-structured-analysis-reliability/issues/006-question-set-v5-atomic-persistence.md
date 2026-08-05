---
title: "接入问题集运行的 v5 快照与原子写入"
status: open
type: AFK
blocked_by:
  - "005-single-question-analysis-only-registry-snapshot.md"
---

# 接入问题集运行的 v5 快照与原子写入

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## What to build

让一次问题集候选运行冻结统一的分析合同与竞品注册表快照，并让该运行下的每条问题记录使用相同快照身份完成 v5 分析、状态持久化、失败隔离和统计汇总。单条开放竞品或语义字段失败不能把整批记录归为结构化失败，也不能污染已经完成的目标事实指标。

问题集的恢复、重试和 CSV 所需运行身份必须保持稳定；配置在运行开始后变化，只能影响下一次新运行。

## Acceptance criteria

- [ ] 问题集创建时冻结唯一 v5 合同和注册表快照，运行内所有问题记录引用同一版本与哈希。
- [ ] 运行开始后修改竞品表，不改变当前运行待处理记录的快照；下一次新运行读取新快照。
- [ ] 单条关系遗漏、实体隔离或目标语义未解决按三轨状态保存，不被汇总为目标事实失败。
- [ ] 问题集统计仅把对应字段 `assessed` 的记录纳入推荐、排名和情绪分母，目标提及统计只读取完成的目标事实轨。
- [ ] 中断恢复、失败项重试和运行对账不会重复写指标、切换快照或重新采集已经存在的完整回答。
- [ ] 任一记录的持久化失败保持原子性，且不会触发 v4、Pro 或隐藏提示词 fallback。

## Blocked by

- [005-single-question-analysis-only-registry-snapshot.md](005-single-question-analysis-only-registry-snapshot.md)
