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

- [ ] 推荐、排名、情绪和已输出竞品关系各有不少于 20 个**已复核**可评估人工真值实例，标注人员不查看实验臂输出并记录争议裁决。原 40 条真值 + 15 条补充样本（S41–S55，来自数据库六类问题真实回答）已经写入 `work/geo-baseline-2026-07-28/LABELING.md`，但补充标注仍标记“待复核”；排名 assessed 仅 4 个，不能按本门槛判定通过。
- [x] A、B、C 对同一冻结集合各运行 3 次，全部使用 `deepseek-v4-flash`；失败、超时、截断和部分结果均保留并进入正确统计。41 条 × 3 × 3 = 369 次 + 补充 15 条 × 3 × 3 = 135 次全部完成，每次记录 failure 输出。
- [ ] `target_fact` 可用率、目标 presence/count 准确率和重复一致率均达到 100%，目标假阳性和无效事实写入均为 0。41×3 主语料达到 100%，但补充样本 v5 完成率为 93.33%（S55 三次均因目标映射歧义整条失败），所以整体未达 100%。
- [ ] 被保留实体与语义证据 grounding 为 100%；自动语义补证据、未确认派生别名影响指标和未知进入已判断分母均为 0。实体 mentions grounding 为 1735/1735，且自我修复回归数为 0；但 73/123 主语料在阶段 2 因证据引用合同降级，不能把“实体字符串可定位”表述成全部语义证据有效或实体切分正确。
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

**关键诊断**：v5 阶段 2 在 59.3%（73/123）样本上因 `analysis_evidence_reference_invalid` 降级。当前单一证据数组被同时要求证明实体出现和语义结论，而真实回答常先列出实体、再在后续片段表达推荐、关系或情绪；要求语义片段自身重复实体表面词会机械性拒绝一部分可组合审计的证据。降级使 assessed 实例不足且目标核心签名不稳定。assessed 幸存样本上推荐 21/21、情绪 21/21、排名 4/4 只能说明这些幸存项未发现错误，不能证明整体语义可靠。

补充样本的 3 次整条失败均为 S55：回答同时出现“广拓（Gato）”和“上海广拓信息技术有限公司”，多个 grounded 实体命中目标别名后触发 `analysis_target_mapping_ambiguous`。这属于目标事实与目标实体映射未隔离的确定性代码缺陷，不应通过提示词或猜选实体处理。

**结论：不批准硬切。** 正式入口继续使用 v4，010 保持阻塞。009 的输入、结果、门槛和失败判定作为历史实验记录冻结；后续由 011–015 使用 `three_track_partial_v2 / semantic_evidence_v2` 修复、定向探针和新全量门禁，不回写本次实验为 PASS。

## 后续承接

- [011-target-mapping-ambiguity-isolation.md](011-target-mapping-ambiguity-isolation.md)：目标映射歧义只降级目标语义。
- [012-semantic-evidence-v2.md](012-semantic-evidence-v2.md)：分离实体 occurrence 与语义上下文证据。
- [013-audit-truth-and-evaluation-contract.md](013-audit-truth-and-evaluation-contract.md)：完成盲标复核并修正评测偏差。
- [014-targeted-flash-evidence-probe.md](014-targeted-flash-evidence-probe.md)：小样本真实 Flash 候选对比。
- [015-v51-41x3-comparison-gate.md](015-v51-41x3-comparison-gate.md)：新修订独立全量门禁。

## Blocked by

- [001-freeze-v5-evaluation-contract.md](001-freeze-v5-evaluation-contract.md)
- [002-deterministic-target-fact-and-remove-self-repair.md](002-deterministic-target-fact-and-remove-self-repair.md)
- [003-competitor-registry-resolver-and-request-invariance.md](003-competitor-registry-resolver-and-request-invariance.md)
- [004-field-level-semantics-and-scoped-sov.md](004-field-level-semantics-and-scoped-sov.md)
- [005-single-question-analysis-only-registry-snapshot.md](005-single-question-analysis-only-registry-snapshot.md)
- [006-question-set-v5-atomic-persistence.md](006-question-set-v5-atomic-persistence.md)
- [007-scheduled-monitoring-v5-snapshot-and-lease.md](007-scheduled-monitoring-v5-snapshot-and-lease.md)
- [008-v5-report-csv-ui-compatibility.md](008-v5-report-csv-ui-compatibility.md)
