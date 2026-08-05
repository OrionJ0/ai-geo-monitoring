---
title: "审计人工真值与评测合同"
status: blocked
type: HITL
blocked_by:
  - "人工复核队列（见 TRUTH-REVIEW-QUEUE.md）"
---

# 审计人工真值与评测合同

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- [009 失败门禁](009-flash-41x3-comparison-gate.md)

## What to build

修正 009 暴露的评测可信度缺口：补充样本必须按数据集版本完成独立人工复核，不能继承旧语料的全局确认标记；推荐、排名、情绪和已输出竞品关系分别达到至少 20 个可评估真值；整体报告必须包含 unresolved 和降级率，不能只评价 assessed 幸存样本。

实体评测除逐字 grounding 外，还需评价实体 precision、recall 和 canonicalization，识别“字符串存在但把多个品牌合成一个实体”或“同一品牌无依据拆分”的错误。原始回答、旧 009 输出和缓存保持只读。

## Acceptance criteria

- [ ] 每个真值数据集记录独立的版本、答案哈希、复核人/复核状态和争议裁决；补充语料从“待复核”变为已确认前不能进入 PASS 门禁。**代码合同已就绪（truth.jsonl 模板 55 条全部 `pending_review`），等待人工复核填写；补充样本 S41–S55 仍标记“待复核”。**
- [ ] 推荐、排名、情绪和已输出竞品关系各有至少 20 个已复核、标注时未查看候选输出的可评估实例；不足时 benchmark 输出 `NOT EVALUABLE`。**`semanticTruthCoverage` 已实现并输出 NOT EVALUABLE；已输出竞品关系真值缺失（0 条），需人工在 truth.jsonl 标注 relations 至少 20 个实例。**
- [x] benchmark 同时报告 assessed 准确率、全体可用率、unresolved/invalid/not_applicable 分布和阶段 2 降级率，不把幸存样本 100% 表述为整体可靠。`fieldStatusDistribution` 已实现并接入报告“字段状态与阶段 2 降级率”部分。
- [x] 实体指标包含 grounding、precision、recall、micro-F1 和 canonicalization；组合实体与无依据拆分有明确计分规则和回归样本。`entityQualityStats` 已实现（组合实体/拆分检测），真值不足时 NOT_EVALUABLE；回归测试覆盖组合实体计错。
- [x] 009 中过早勾选的 target_fact、真值和 grounding 验收项保持纠正状态，旧实验数字不被重算或覆盖。009 AC-1/2/3/4 已改回未勾选并注明待复核/降级问题。

## 阻塞说明

按用户约定，缺少真实人工确认时不得冒充人工签字、不得关闭本 issue。当前阻塞项与具体复核条目见 [TRUTH-REVIEW-QUEUE.md](../TRUTH-REVIEW-QUEUE.md)：

1. 补充样本 S41–S55 目标级标注待人工复核（`work/geo-baseline-2026-07-28/LABELING.md` 尾部）。
2. 已输出竞品关系真值缺失：需在 `truth.jsonl` 中为至少 20 条样本标注 relations。
3. 实体级真值缺失：`truth.template.jsonl`（55 条，全部 `pending_review`）需人工填写 entities[] 并改 `review_status=confirmed` 后更名为 `truth.jsonl`。

复核完成并确认后，由人工将本 issue 改为 closed；在此之前 014 不启动。

## Blocked by

人工复核队列（TRUTH-REVIEW-QUEUE.md）——human review can start immediately.
