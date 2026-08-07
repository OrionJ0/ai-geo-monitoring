---
title: "实现字段级语义降级与 scoped SOV"
status: closed
type: AFK
blocked_by:
  - "002-deterministic-target-fact-and-remove-self-repair.md"
  - "003-competitor-registry-resolver-and-request-invariance.md"
---

# 实现字段级语义降级与 scoped SOV

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## What to build

完成 v5 的闭集语义判断和最终结构：模型只能引用 grounded 实体 ID 与 source ID，关系遗漏进入未解决集合，坏关系或坏证据被隔离；推荐、排名和情绪分别拥有独立状态，单字段失败不清空其他已证明事实。

开放竞品结果使用 scoped SOV，只表达本次已发现、已锚定且已证明为竞品的实体范围。开放召回允许遗漏，但保留的关系、推荐、排序和情绪必须有精确证据，程序不得补造语义结论。

## Acceptance criteria

- [x] 阶段 2 返回未知、重复或无效实体 ID 时，仅拒绝受影响项，不新增实体，也不清空目标事实。真实服务测试用 `E999` 未知实体触发 repair，最终 `target_fact.status=complete` 且不新增实体。
- [x] 缺失竞品关系写入 `unresolved_entity_ids`；关系证据无效且修复失败时进入隔离，两者都不触发整条分析失败。三轨测试证明 `competition_analysis.status=partial` 且 `unresolved_entity_ids` 记录未覆盖实体，阶段 2 失败时 `unavailable`。
- [x] 推荐、排名和情绪分别支持 `assessed / not_applicable / unresolved / invalid`，只有 `assessed` 可进入对应业务分母。`target_semantics.{recommendation,rank,sentiment}` 均带独立 status/value/evidence_source_ids，目标未出现为 `not_applicable`，目标出现且阶段 2 失败为 `unresolved`。
- [x] 并列候选不产生排名，只有原回答明确表达的组内顺序可以形成排名；明确推荐必须引用真正支持推荐的原文片段。`ordered=false` 候选组返回 `rank.value=null`；`isGroundedTargetRecommendation` 只接受带推荐词的证据片段。
- [x] 开放 SOV 输出 `observed_only / open_discovery / not_proven`，matched 与 unmatched 的已证明竞品按相同规则进入分子和分母，且不与历史 v1 混算。`SCOPED_METRIC_SEMANTICS=contextual_competitor_mentions_sov_v2_scoped`，`presentScopedSov` 校验 `observed_only` 且版本不匹配即拒绝。
- [x] 正常、阶段 1 修复、阶段 2 修复和双阶段修复分别最多调用模型 2、3、3、4 次；第二次仍无效时按字段降级，不回退 v4 或 Pro。真实服务调用计数测试覆盖 2/3/3/4 四档，`analysis_attempts` 一致，`analysis_method` 恒为 `ai_structured_v5`。
- [x] 最终 v5 结构中的每个实体、提及、关系和语义证据都能回溯到完整原回答及对应状态。`target_fact.mentions`、`competition_analysis.relation_evidence_source_ids`、`target_semantics.*.evidence_source_ids` 均引用 `source_id`，由 source map 反查原文。

## Implementation notes

- `GeoMetricSemanticsService.js`：新增 `SCOPED_METRIC_SEMANTICS` 与 `presentScopedSov`（`observed_only/open_discovery/not_proven` 强校验，与 v1 版本隔离）。
- `AIResponseAnalysisV5Service.js`：`calculate` 输出 `target_fact`/`target_semantics`/`competition_analysis`/`sov` 四组权威结构，字段级状态派生；`buildDegradedSemantic` 在阶段 2 达到上限后按字段降级（目标出现 unresolved / 目标未出现 not_applicable / 竞品轨 unavailable），不回退 v4/Pro。
- `AIResponseEntityExtractionService.js`：`extract` 的隔离诊断携带有界 `quarantined_items`。
- 新增 `backend/tests/AIResponseAnalysisV5Tracks.test.js`（9 用例，含 2/3/3/4 调用预算）。全量 1068 后端测试通过。

## Blocked by

- [002-deterministic-target-fact-and-remove-self-repair.md](002-deterministic-target-fact-and-remove-self-repair.md)
- [003-competitor-registry-resolver-and-request-invariance.md](003-competitor-registry-resolver-and-request-invariance.md)
