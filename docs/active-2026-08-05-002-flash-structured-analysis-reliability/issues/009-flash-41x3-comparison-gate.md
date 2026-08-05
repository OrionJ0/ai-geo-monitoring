---
title: "扩充人工真值并执行 41×3 真实 Flash 对比"
status: open
type: HITL
blocked_by:
  - "001-freeze-v5-evaluation-contract.md"
  - "002-deterministic-target-fact-and-remove-self-repair.md"
  - "003-competitor-registry-resolver-and-request-invariance.md"
  - "004-field-level-semantics-and-scoped-sov.md"
  - "005-single-question-analysis-only-registry-snapshot.md"
  - "006-question-set-v5-atomic-persistence.md"
  - "007-scheduled-monitoring-v5-snapshot-and-lease.md"
  - "008-v5-report-csv-ui-compatibility.md"
---

# 扩充人工真值并执行 41×3 真实 Flash 对比

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- [现有验证报告](../validation-report.md)

## What to build

在不修改预注册门槛的前提下，补齐推荐、排名、情绪和已输出竞品关系的盲标真值，并使用相同冻结回答、相同 `deepseek-v4-flash` 和相同重复次数重新执行 A/B/C 配对实验。严格工具调用 D 仅在能力探针通过时作为独立对照，不影响 JSON mode 候选 C 的判定。

报告必须同时评价目标事实确定性、语义真实性、注册表不变性、开放竞品诊断、重复稳定性、调用次数、Token 和延迟。任何硬门槛失败都要形成“不批准硬切”的明确结论，不得只重跑候选失败项或事后降低门槛。

## Acceptance criteria

- [ ] 推荐、排名、情绪和已输出竞品关系各有不少于 20 个可评估人工真值实例，标注人员不查看实验臂输出并记录争议裁决。
- [ ] A、B、C 对同一冻结集合各运行 3 次，全部使用 `deepseek-v4-flash`；失败、超时、截断和部分结果均保留并进入正确统计。
- [ ] `target_fact` 可用率、目标 presence/count 准确率和重复一致率均达到 100%，目标假阳性和无效事实写入均为 0。
- [ ] 被保留实体与语义证据 grounding 为 100%；自动语义补证据、未确认派生别名影响指标和未知进入已判断分母均为 0。
- [ ] 已输出关系 precision、推荐 F1、情绪准确率、明确排名 exact-match、目标核心稳定率和成本均按预注册阈值给出 PASS/FAIL。
- [ ] 阶段 1 和阶段 2 请求在不同注册表快照下的哈希一致率为 100%，表外实体保留率为 100%，表内未出现品牌生成数为 0。
- [ ] 报告单独呈现竞品召回、集合 Jaccard、未解决率、隔离率和注册表匹配率，不把这些诊断项冒充完整竞品知识图谱证明。
- [ ] 任一硬门槛失败时，结论明确为“不批准硬切”，后续硬切 issue 保持阻塞。

## Blocked by

- [001-freeze-v5-evaluation-contract.md](001-freeze-v5-evaluation-contract.md)
- [002-deterministic-target-fact-and-remove-self-repair.md](002-deterministic-target-fact-and-remove-self-repair.md)
- [003-competitor-registry-resolver-and-request-invariance.md](003-competitor-registry-resolver-and-request-invariance.md)
- [004-field-level-semantics-and-scoped-sov.md](004-field-level-semantics-and-scoped-sov.md)
- [005-single-question-analysis-only-registry-snapshot.md](005-single-question-analysis-only-registry-snapshot.md)
- [006-question-set-v5-atomic-persistence.md](006-question-set-v5-atomic-persistence.md)
- [007-scheduled-monitoring-v5-snapshot-and-lease.md](007-scheduled-monitoring-v5-snapshot-and-lease.md)
- [008-v5-report-csv-ui-compatibility.md](008-v5-report-csv-ui-compatibility.md)
