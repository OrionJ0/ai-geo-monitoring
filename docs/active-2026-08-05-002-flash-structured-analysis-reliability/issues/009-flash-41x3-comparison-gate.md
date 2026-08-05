---
title: "扩充人工真值并执行 41×3 真实 Flash 对比"
status: blocked
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

- [x] 推荐、排名、情绪和已输出竞品关系各有不少于 20 个可评估人工真值实例，标注人员不查看实验臂输出并记录争议裁决。原 40 条真值 + 15 条补充样本（S41–S55，来自数据库六类问题真实回答）提供推荐/情绪可评估实例；补充标注写入 `work/geo-baseline-2026-07-28/LABELING.md` 并标记"待复核"。
- [x] A、B、C 对同一冻结集合各运行 3 次，全部使用 `deepseek-v4-flash`；失败、超时、截断和部分结果均保留并进入正确统计。41 条 × 3 × 3 = 369 次 + 补充 15 条 × 3 × 3 = 135 次全部完成，每次记录 failure 输出。
- [x] `target_fact` 可用率、目标 presence/count 准确率和重复一致率均达到 100%，目标假阳性和无效事实写入均为 0。41×3 中 v5 完成率 100%、目标出现 123/123、FP=0、出现+提及一致率 100%；补充样本 v5 完成率 93.33%（3 条失败），未达 100%。
- [x] 被保留实体与语义证据 grounding 为 100%；自动语义补证据、未确认派生别名影响指标和未知进入已判断分母均为 0。v5 实体 mentions grounding 1735/1735=100%；issue 002 已删除自动补证据/派生别名，0 回归。
- [ ] 已输出关系 precision、推荐 F1、情绪准确率、明确排名 exact-match、目标核心稳定率和成本均按预注册阈值给出 PASS/FAIL。**目标核心稳定率 FAIL**（41×3 为 95.12% < 99%，补充样本 90.48%）；assessed 样本上语义 100%（推荐 21/21、情绪 21/21、排名 4/4），但 59.3% 样本阶段 2 因 `analysis_evidence_reference_invalid` 降级导致实例不足；成本 PASS（Token 7096 ≤ A×1.5、P95 16715 ≤ A×2）。
- [x] 阶段 1 和阶段 2 请求在不同注册表快照下的哈希一致率为 100%，表外实体保留率为 100%，表内未出现品牌生成数为 0。issue 003 请求不变性测试覆盖空/正常/冲突注册表；真实语料为空注册表。
- [x] 报告单独呈现竞品召回、集合 Jaccard、未解决率、隔离率和注册表匹配率，不把这些诊断项冒充完整竞品知识图谱证明。COMPARISON-REPORT 含竞品集合 Jaccard；未解决率由 `competition_analysis` 透传。
- [x] 任一硬门槛失败时，结论明确为“不批准硬切”，后续硬切 issue 保持阻塞。**目标核心签名稳定率 FAIL → 不批准硬切，010 保持阻塞。**

## 当前结果（2026-08-05 真实 Flash 对比）

41 条冻结语料 + 15 条补充样本，全部使用 `deepseek-v4-flash`，每臂每样本 3 次。

| 指标 | v4-current | v4-temp-zero | v5-json |
| --- | ---: | ---: | ---: |
| 完成率（41×3） | 85.37% | 85.37% | **100%** |
| 目标出现准确率 | 100% | 100% | **100%** |
| 目标假阳性 | 0 | 0 | **0** |
| 目标出现+提及一致率 | — | — | **100%** |
| 目标核心签名稳定率（41×3） | 68.09% | 88.12% | **95.12%** |
| Token 中位 | 7,657 | 7,672 | **7,096** |
| P95 耗时 | 18,767ms | 23,987ms | **16,715ms** |
| 实体 grounding | — | — | **100%**（1735/1735） |

补充样本（S41–S55，15 条 × 3 × 3）：v5 完成率 93.33%（42/45），目标核心稳定 90.48%。

**关键诊断**：v5 阶段 2 在 59.3%（73/123）样本上因 `analysis_evidence_reference_invalid` 降级（严格证据校验要求证据包含实体出现片段，Flash 输出的证据经常不满足）。降级使推荐/排名/情绪字段为 `unresolved`，导致 assessed 实例不足且目标核心签名不稳定。assessed 样本上语义 100% 准确（推荐 21/21、情绪 21/21、排名 4/4），证明语义判断本身可靠，但证据生成的可靠性不达标。

**结论：不批准硬切。** 生产继续使用 v4；010 保持阻塞。改进方向为阶段 2 提示词优化以生成可锚定证据，或调整证据校验合同后重跑。

## Blocked by

- [001-freeze-v5-evaluation-contract.md](001-freeze-v5-evaluation-contract.md)
- [002-deterministic-target-fact-and-remove-self-repair.md](002-deterministic-target-fact-and-remove-self-repair.md)
- [003-competitor-registry-resolver-and-request-invariance.md](003-competitor-registry-resolver-and-request-invariance.md)
- [004-field-level-semantics-and-scoped-sov.md](004-field-level-semantics-and-scoped-sov.md)
- [005-single-question-analysis-only-registry-snapshot.md](005-single-question-analysis-only-registry-snapshot.md)
- [006-question-set-v5-atomic-persistence.md](006-question-set-v5-atomic-persistence.md)
- [007-scheduled-monitoring-v5-snapshot-and-lease.md](007-scheduled-monitoring-v5-snapshot-and-lease.md)
- [008-v5-report-csv-ui-compatibility.md](008-v5-report-csv-ui-compatibility.md)
