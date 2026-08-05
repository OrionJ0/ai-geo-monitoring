---
title: "完成 API、CSV、报告页面与历史 v4 兼容"
status: open
type: AFK
blocked_by:
  - "004-field-level-semantics-and-scoped-sov.md"
  - "005-single-question-analysis-only-registry-snapshot.md"
  - "006-question-set-v5-atomic-persistence.md"
  - "007-scheduled-monitoring-v5-snapshot-and-lease.md"
---

# 完成 API、CSV、报告页面与历史 v4 兼容

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## What to build

让用户从 API、CSV 和问题集报告页面看到同一份可审计 v5 事实：目标事实、目标语义和开放竞品分别展示状态，推荐/排名/情绪未知不显示为业务否定，开放 SOV 明示只基于本次已发现实体。注册表匹配只作为中性身份诊断，不把 unmatched 文案误写成“未知品牌”或“非竞品”。

同时保留历史 v4 的只读展示和数据往返。消费者必须按显式版本选择校验合同，不能通过字段存在性猜版本，也不能把 v4/v5 SOV 放进同一趋势。

## Acceptance criteria

- [ ] API 同时正确返回 v4 历史记录和 v5 完整、部分、不适用、不可用、目标事实失败等状态，不丢失 source ID 或诊断。
- [ ] 推荐、排名和情绪只有 `assessed` 才进入对应聚合分母；`unresolved / invalid / not_applicable` 不显示成未推荐、中性或无排名。
- [ ] 页面明确展示 `observed_only / open_discovery / not_proven`、未解决数和隔离数，不把开放 SOV 描述为完整市场份额。
- [ ] matched、unmatched、ambiguous 使用中性身份文案并保持相同关系展示资格，不改变推荐、排名或排序。
- [ ] v5 CSV 导出再导入结构相等，完整保留实体 ID、source ID、快照版本/哈希、匹配状态和有界诊断；表外实体不会在往返中丢失。
- [ ] 未知实体 ID、证据哈希或快照身份不一致的 v5 CSV 被明确拒绝；历史 v4 CSV 仍可读取。
- [ ] 报告页面在桌面和移动端可读，长诊断有界，不暴露密钥、完整无效模型输出或服务器绝对路径。

## Blocked by

- [004-field-level-semantics-and-scoped-sov.md](004-field-level-semantics-and-scoped-sov.md)
- [005-single-question-analysis-only-registry-snapshot.md](005-single-question-analysis-only-registry-snapshot.md)
- [006-question-set-v5-atomic-persistence.md](006-question-set-v5-atomic-persistence.md)
- [007-scheduled-monitoring-v5-snapshot-and-lease.md](007-scheduled-monitoring-v5-snapshot-and-lease.md)
