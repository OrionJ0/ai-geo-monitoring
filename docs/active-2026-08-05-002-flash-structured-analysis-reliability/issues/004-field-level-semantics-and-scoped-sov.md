---
title: "实现字段级语义降级与 scoped SOV"
status: open
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

- [ ] 阶段 2 返回未知、重复或无效实体 ID 时，仅拒绝受影响项，不新增实体，也不清空目标事实。
- [ ] 缺失竞品关系写入 `unresolved_entity_ids`；关系证据无效且修复失败时进入隔离，两者都不触发整条分析失败。
- [ ] 推荐、排名和情绪分别支持 `assessed / not_applicable / unresolved / invalid`，只有 `assessed` 可进入对应业务分母。
- [ ] 并列候选不产生排名，只有原回答明确表达的组内顺序可以形成排名；明确推荐必须引用真正支持推荐的原文片段。
- [ ] 开放 SOV 输出 `observed_only / open_discovery / not_proven`，matched 与 unmatched 的已证明竞品按相同规则进入分子和分母，且不与历史 v1 混算。
- [ ] 正常、阶段 1 修复、阶段 2 修复和双阶段修复分别最多调用模型 2、3、3、4 次；第二次仍无效时按字段降级，不回退 v4 或 Pro。
- [ ] 最终 v5 结构中的每个实体、提及、关系和语义证据都能回溯到完整原回答及对应状态。

## Blocked by

- [002-deterministic-target-fact-and-remove-self-repair.md](002-deterministic-target-fact-and-remove-self-repair.md)
- [003-competitor-registry-resolver-and-request-invariance.md](003-competitor-registry-resolver-and-request-invariance.md)
