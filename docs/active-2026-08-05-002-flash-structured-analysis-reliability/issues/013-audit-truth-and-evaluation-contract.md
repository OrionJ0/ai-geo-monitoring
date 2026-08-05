---
title: "审计人工真值与评测合同"
status: blocked
type: HITL
blocked_by:
  - "评测合同新增 P0/P1 补修（见 AI-TRUTH-ADJUDICATION.md）"
  - "数据所有者确认与真实复核人签字（见 TRUTH-REVIEW-QUEUE.md）"
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

- [x] 每个真值数据集记录独立的版本、答案哈希、复核人/复核状态和争议裁决；补充语料从“待复核”变为已确认前不能进入 PASS 门禁。**已修复：`validateTruthEntry` 严格校验 truth_version、dispute、目标字段类型/范围/跨字段不变量（字符串 `"false"`、负 mentions、非法 sentiment/rank 均拒绝）与 entity type enum；`loadTruth` fail-closed。**
- [ ] 推荐、排名、情绪和已输出竞品关系各有至少 20 个已复核、标注时未查看候选输出的可评估实例；不足时 benchmark 输出 `NOT EVALUABLE`。**关系真实 TP/FP/FN 计分已实现并接入 precision≥0.95 门禁；AI 内容裁决已写入模板（55 条目标 + 17 条实体/关系修正），但 55 条仍为 `pending_review`，等待数据所有者签字后才有 confirmed 实例。**
- [x] benchmark 同时报告 assessed 准确率、全体可用率、unresolved/invalid/not_applicable 分布和阶段 2 降级率，不把幸存样本 100% 表述为整体可靠。`fieldStatusDistribution` 已实现并接入报告“字段状态与阶段 2 降级率”部分。
- [x] 实体指标包含 grounding、precision、recall、micro-F1 和 canonicalization；组合实体与无依据拆分有明确计分规则和回归样本。**`entityQualityStats` 已改为 mention span 对齐计分，组合/拆分计错，canonicalization 只评估 span 对齐实体；entity type enum 校验已补。**
- [x] 关系质量按 span 对齐后的 truth entity ID 计算，不把 canonical name 字符串一致性混入关系 correctness。**已修复：`relationQualityStats` 先按 mention span 对齐预测实体与 truth 实体，再用对齐后的 truth canonical_name 比较关系；“杭州海康威视 vs 海康威视”同一 span 反例已通过回归测试。**
- [x] 009 中过早勾选的 target_fact、真值和 grounding 验收项保持纠正状态，旧实验数字不被重算或覆盖。009 AC-1/2/3/4 已改回未勾选并注明待复核/降级问题。

## 2026-08-05 评测合同返工记录（两轮）

### 第一轮（db097ef）：5 项 P0/P1

1. **P0 全局确认泄漏**：`loadCorpus` 不再让 LABELING.md 的全局 `human_review_confirmed` 覆盖 S41–S55。
2. **P0 关系假门禁**：`relationQualityStats` 计算预测对真值的 TP/FP/FN 与 micro precision/recall/F1，门禁要求 precision≥0.95。
3. **P1 canonicalization 恒 100%**：`entityQualityStats` 改为按 mention span 对齐后计分；组合实体/无依据拆分计错。
4. **P1 loader 不 fail-closed**：`validateTruthEntry` 校验 schema、唯一 ID、answer_sha256、span 可定位、relation 引用、复核元数据。
5. **P1 模板缺字段**：发布 `manifest.json`（55 条 + answer_sha256 + S18/S19/S20 重复簇）与 `truth.v3-template.jsonl`。

### 第二轮（反例补修）：1 个 P0 + 2 个 P1 + 确定性代码

两名独立 agent 内容裁决完成后，实现反例暴露 db097ef 遗漏的缺口，本次全部修复：

1. **P0 confirmed 目标字段未严格校验**：`validateTruthEntry` 现在拒绝字符串 `"false"`（原会被 `Boolean()` 强转 true）、负/非整数 mentions、非法 rank/sentiment、`mentioned=false` 时 mentions≠0 或 rank/sentiment 非 null、缺 truth_version/dispute；新增反例回归测试。
2. **P1 关系未按对齐实体计分**：`relationQualityStats` 先按 mention span 对齐预测实体与 truth 实体，再用对齐后的 truth canonical_name 比较关系；新增“杭州海康威视 vs 海康威视”同一 span 反例测试（TP=1、FP=0、FN=0）。
3. **P1 实体 type enum 未校验**：`validateTruthEntry` 拒绝非 `brand/company/other_organization` 的 type；模板 46 处 `organization` 已归一化为 `other_organization`。
4. **确定性代码错误**（独立 Claude CLI 审查）：阶段 1 失败不再抛整条错误（`buildDegradedCatalog` 保留确定性 target_fact，目标语义/竞品轨 unavailable）；数字编号列表不再推导品牌排名（`EXPLICIT_RANK_RE` 只认“排名第X/第X名/首选”等明确排序表达）；竞品提及改为按真实 occurrence 计数（与目标轨一致，修复 SOV 分母扭曲）；被错误固定的“编号列表=排名”测试已纠正。

### 裁决应用

按 [AI-TRUTH-ADJUDICATION.md](../AI-TRUTH-ADJUDICATION.md) 将 55 条目标字段最终建议、17 条实体/关系修正与 type 归一化写入 `truth.v3-template.jsonl`：S07/S08/S23/S28/S30/S32 rank→null、S33 recommendation→true、S46 rec=false rank=5、S47/S48/S53 未出现、S50 rank=1 等；实体/关系 17 条修正（TLEA 并入、Wuhan FiberHome 迁移、公安部/中国信科新增、生态/地点实体删除等）。模板 55 条全部保持 `pending_review` 并通过严格校验（0 错误），answer_sha256/span 一致。

回归：新增 10 个测试（P0 目标字段、P1 type、P1 关系 span、阶段 1 降级、编号列表排名、occurrence 计数），全量相关测试 177 个全部通过。

## 阻塞说明

按用户约定，缺少真实人工确认时不得冒充人工签字、不得关闭本 issue。评测合同与确定性代码已修复，AI 内容裁决已应用，当前阻塞只剩**数据所有者确认签字**：

1. ⏳ 数据所有者确认 [AI-TRUTH-ADJUDICATION.md](../AI-TRUTH-ADJUDICATION.md) 的裁决（重点 S03 同位归并、S21 采购范围、S46 推荐口径、S50 并列第一、S53 法律主体隔离）。
2. ⏳ 由真实复核人在 `truth.v3-template.jsonl` 填写 reviewer/reviewed_at 并将 55 条改为 `review_status=confirmed`（更名 `truth.jsonl`）。
3. ⏳ S18/S19/S20 按 manifest 重复簇规则（去重或簇权重 1）处理；运行 truth preflight。
4. 数据所有者确认完成后，由人工将本 issue 改为 closed；在此之前 014 不启动。

## Blocked by

数据所有者确认签字（TRUTH-REVIEW-QUEUE.md、AI-TRUTH-ADJUDICATION.md）。AI 草案与裁决已应用为 pending_review，不得直接改名启用。
