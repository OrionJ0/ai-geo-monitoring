---
title: "审计人工真值与评测合同"
status: blocked
type: HITL
blocked_by:
  - "评测合同 P0/P1 修复（见 TRUTH-REVIEW-QUEUE.md）"
  - "人工复核与争议裁决（见 TRUTH-REVIEW-QUEUE.md）"
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

- [x] 每个真值数据集记录独立的版本、答案哈希、复核人/复核状态和争议裁决；补充语料从“待复核”变为已确认前不能进入 PASS 门禁。**已修复：`validateTruthEntry` 严格校验逐记录 `review_status`、`answer_sha256`（与冻结回答一致）、唯一 ID 与完整复核元数据；`loadTruth` fail-closed；`loadCorpus` 删除补充样本的 LABELING 全局确认标签，目标标签只从 truth v3 的 `confirmed` 记录合并。**
- [ ] 推荐、排名、情绪和已输出竞品关系各有至少 20 个已复核、标注时未查看候选输出的可评估实例；不足时 benchmark 输出 `NOT EVALUABLE`。**关系真实 TP/FP/FN 计分已实现并接入 precision≥0.95 门禁；真值实例仍待人工裁决（AI 草案 504 条关系全部 `pending_review`）。**
- [x] benchmark 同时报告 assessed 准确率、全体可用率、unresolved/invalid/not_applicable 分布和阶段 2 降级率，不把幸存样本 100% 表述为整体可靠。`fieldStatusDistribution` 已实现并接入报告“字段状态与阶段 2 降级率”部分。
- [x] 实体指标包含 grounding、precision、recall、micro-F1 和 canonicalization；组合实体与无依据拆分有明确计分规则和回归样本。**已修复：`entityQualityStats` 改为 mention span 对齐计分，组合/拆分计错，canonicalization 只评估 span 对齐实体；新增 7 个回归测试覆盖。**
- [x] 009 中过早勾选的 target_fact、真值和 grounding 验收项保持纠正状态，旧实验数字不被重算或覆盖。009 AC-1/2/3/4 已改回未勾选并注明待复核/降级问题。

## 2026-08-05 评测合同返工记录

多 agent 盲审发现 5 项 P0/P1 合同缺口后，本次已全部修复：

1. **P0 全局确认泄漏**：`loadCorpus` 不再让 LABELING.md 的全局 `human_review_confirmed` 覆盖 S41–S55；补充样本标签只由 truth v3 `confirmed` 记录提供。
2. **P0 关系假门禁**：`relationQualityStats` 计算预测对真值的 TP/FP/FN 与 micro precision/recall/F1，门禁要求 precision≥0.95；关系全错时 precision=0，不因覆盖数达标 PASS。
3. **P1 canonicalization 恒 100%**：`entityQualityStats` 改为按 mention span 对齐后计分；组合实体/无依据拆分计错，canonicalization 只评估对齐实体。
4. **P1 loader 不 fail-closed**：`validateTruthEntry` 校验 schema、唯一 ID、answer_sha256、span 可定位、relation 引用、复核元数据；`loadTruth` 任一错误终止评测。
5. **P1 模板缺字段**：发布 `manifest.json`（55 条 + answer_sha256 + S18/S19/S20 重复簇）与 `truth.v3-template.jsonl`（55 条 pending_review，541 实体/504 关系/1259 span 全部通过严格校验）。

回归：新增 7 个 benchmark 服务测试 + 全量相关测试 198 个全部通过。

## 阻塞说明

按用户约定，缺少真实人工确认时不得冒充人工签字、不得关闭本 issue。评测合同已修复，当前阻塞只剩人工裁决：

1. ⏳ 人工在 `truth.v3-template.jsonl` 上逐条裁决 S46/S50/S53 等 5 处盲审分歧与逐样本实体/关系边界，填写 reviewer/reviewed_at/dispute 并改为 `review_status=confirmed`，更名 `truth.jsonl`。
2. ⏳ S18/S19/S20 重复回答按预注册规则处理（去重或簇权重 1）。
3. 人工复核完成并确认后，由人工将本 issue 改为 closed；在此之前 014 不启动。

## Blocked by

人工真值裁决（TRUTH-REVIEW-QUEUE.md）。AI 草案可以供人审参考，但不得直接改名启用。
