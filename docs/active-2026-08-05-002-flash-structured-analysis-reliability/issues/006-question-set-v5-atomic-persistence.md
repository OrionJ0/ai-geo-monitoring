---
title: "接入问题集运行的 v5 快照与原子写入"
status: closed
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

- [x] 问题集创建时冻结唯一 v5 合同和注册表快照，运行内所有问题记录引用同一版本与哈希。`startQuestionSetRun` 用 `analysisProvider` 写 v5 契约与 scoped SOV；`createRunEntries` 把同一 `competitorSnapshot` 传给每条 `createTargetRecord`，集成测试证明两条记录契约/快照深度相等。
- [x] 运行开始后修改竞品表，不改变当前运行待处理记录的快照；下一次新运行读取新快照。`run.competitor_snapshot` 在创建时冻结，`resolveFrozenSnapshot` 优先记录/运行快照（issue 005 测试覆盖）。
- [x] 单条关系遗漏、实体隔离或目标语义未解决按三轨状态保存，不被汇总为目标事实失败。issue 004 三轨结构 + `summarize` 按状态隔离；`target_fact` 未完成/未提及不计为品牌提及。
- [x] 问题集统计仅把对应字段 `assessed` 的记录纳入推荐、排名和情绪分母，目标提及统计只读取完成的目标事实轨。`V5QuestionSetStats.test.js` 证明 unresolved 记录不计入推荐/排名分母，SOV 只统计 `observed_only` 且分母>0 的 scoped SOV。
- [x] 中断恢复、失败项重试和运行对账不会重复写指标、切换快照或重新采集已经存在的完整回答。现有事务、租约与 `retryFailedQuestionSetRun` 复用原记录契约/快照机制保持。
- [x] 任一记录的持久化失败保持原子性，且不会触发 v4、Pro 或隐藏提示词 fallback。`runInTransaction`/`persistVisibilityMetric` 原子边界保持；v5 无 fallback。

## Implementation notes

- `ProjectRunService.startQuestionSetRun` 支持 `options.analysisProvider`：run 与记录统一写 v5 契约/scoped SOV/冻结快照；`createRunEntries` 增加 `analysisProvider`/`competitorSnapshot` 参数。
- `QuestionSetRunService.summarize`：识别 v5 记录，推荐/排名/情绪分母只纳入 `assessed`；品牌提及读取 `target_fact.status=complete`；scoped SOV 只统计 `observed_only` 且分母>0，`sov_summary` 输出 `open_discovery/not_proven`；`STRUCTURED_ANALYSIS_METHODS` 加入 v5。
- 新增 `backend/tests/V5QuestionSetStats.test.js`（3 用例）；`V5ProjectRunIntegration.test.js` 增加 createRunEntries 同快照测试。全量 1080 后端测试通过。

## Blocked by

- [005-single-question-analysis-only-registry-snapshot.md](005-single-question-analysis-only-registry-snapshot.md)
