---
title: "执行 v5.1 独立 41×3 真实 Flash 硬门禁"
status: in_progress
type: HITL
note: "2026-08-06 数据所有者裁决：014 结构探针已通过，015 不再被 S12 单样本完全锁死——可开始补齐评测器与全量门禁；rev2 为提示词最后一轮定向回归，结果仅决定候选冻结为 rev2 或基线，不再有 rev3/rev4、不引入多数表决。最终门禁拆为硬门槛/语义门槛/诚实降级/重复运行四组。2026-08-06 rev2 全部验收通过（S12 false+positive 3/3），已冻结 v5-json-rev2 作为 015 语义提示词版本。"
blocked_by:
  - "014-targeted-flash-evidence-probe.md"
  - "013-audit-truth-and-evaluation-contract.md"
---

# 执行 v5.1 独立 41×3 真实 Flash 硬门禁

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- [009 历史失败门禁](009-flash-41x3-comparison-gate.md)
- [014 定向探针](014-targeted-flash-evidence-probe.md)

## What to build

014 结构探针已通过（完成率 100%、target_fact 确定性稳定性 36/36、证据引用错误 0、S55 不再整条失败、成本低于基线），语义校准唯一真实问题 S12 由 rev2 定向回归（最后一轮）收尾——结果仅决定候选冻结为 rev2 或回退基线，不再有 rev3/rev4。**015 不等待 S12 单样本完全稳定即可推进**：开始补齐评测器（排名真值、推荐 F1/情绪/排名/Token 门禁、target_mapping 评分、`recommendation=null` 兼容），然后冻结候选，对相同 41 条主语料、已复核补充真值集和候选臂执行独立真实 Flash 全量对比。每臂每样本重复 3 次，使用新的缓存键、运行目录和报告；009 的原始请求、输出、统计和“不批准硬切”结论保持只读。

最终门禁拆为四组：**硬门槛**（结构正确性）、**语义门槛**（assessed 字段准确率）、**诚实降级**（单独统计，不算错误、不伪装成 assessed）、**重复运行**（只测方差，不通过多数投票改写单次预测）。报告必须同时给出目标事实、目标映射、语义证据双角色、整体字段可用率、实体质量、开放竞品诊断、重复稳定性、成本和注册表不变性。全部硬门槛与语义门槛通过后仍需人工明确批准，才能解锁 010。

## Acceptance criteria

### 硬门槛（结构正确性）

- [ ] 运行前冻结语料版本、已复核真值、答案哈希、实验臂、候选修订、指标公式和门槛；全部调用固定 `deepseek-v4-flash`。
- [ ] 整条完成率 100%（无新增整条失败；S55 目标映射歧义导致的整条失败为 0）。
- [ ] `target_fact` 可用率与目标 presence/count 准确率均为 100%，目标假阳性和无效事实写入为 0。
- [ ] occurrence grounding 为 100%，程序自动生成 semantic context 为 0，机械性证据引用错误为 0；真实语义无支持时按字段 unresolved，不连带失败。
- [ ] 已输出竞品关系 precision≥0.95（≥20 已复核可评估实例）；实体 grounding、precision、recall、micro-F1 和 canonicalization 均报告，grounding 不替代实体正确性结论。
- [ ] Token 中位≤A×1.5、P95≤A×2；阶段 1/2 请求不受竞品注册表内容影响，表外实体保留且表内未出现品牌生成数为 0。

### 语义门槛（assessed 字段准确率）

- [ ] 推荐 F1≥0.95、情绪准确率≥0.90、明确排名 exact-match≥0.95，每项至少 20 个已复核可评估实例；排名真值仅 6 条，按 NOT_EVALUABLE 合同处理——**发布口径：最终报告必须写明"排名能力证据不足"，不得描述为排名门禁通过**；由 010 决策它是非阻塞观察项还是暂不对外承诺（见 TECH-SPEC 7.5.1 发布口径）。
- [ ] `target_mapping` 接入评分与门禁（truth v3 已有 S53 conflicting_identity 真值），预测映射状态准确率报告。
- [ ] 整体 assessed/unresolved/unavailable/not_applicable 字段分布单独报告，assessed 覆盖率作为语义可用性证据而非硬性门槛。

### 诚实降级（单独统计）

- [ ] unresolved/unavailable 单独统计：不算语义错误，也不得伪装成 assessed——降级占位（false/neutral 兼容值）不得进入语义准确率分母；`recommendation=null` 不得被 loader 转成 false 掩盖 unavailable 与明确不推荐的差异（与第三轮 confirmed 完整性合同对齐）。

### 重复运行（测量方差）

- [ ] 重复运行只用于测量重复一致率（方差），不得通过多数投票改写单次预测；重复一致率按 014 修正口径报告（确定性稳定性与 assessed 语义一致性分开，降级重复排除）。
- [ ] 任一硬门槛失败时明确“不批准硬切”并保持 010 阻塞；全部通过时仍需记录明确人工批准，不能由脚本自动切换生产默认值。

## 认证前置待办（状态 2026-08-06 评测器补全完成）

用户与独立 Claude 审查（2026-08-06）确认以下缺口；1–4 已由评测器代码补全完成（issue 015 评测器 commit 已就绪，待人工签字后冻结）：

1. **排名真值不足（已按新合同处理，不伪造）**：55 条真值中明确排名仅 6 条（S01/S02/S46/S49/S50/S55），不足 20。**拒绝人为扩充或伪造排名样本**——按真实可评估样本计算排名 exact accuracy，始终展示分子、分母与样本 ID；样本不足时该指标输出 NOT_EVALUABLE（不判 PASS、不阻塞其他指标）。后续可补充真实回答，但不得改变冻结答案或把编号列表当排名。
2. ✅ **推荐 F1、情绪准确率、排名准确率、Token 比例已接入门禁**：`recommendationQualityStats`（precision/recall/F1/assessed coverage）、`sentimentQualityStats`（逐次准确率 + 3×3 混淆矩阵）、`rankQualityStats`（exact accuracy）、Token 中位≤基线×1.5 / P95≤基线×2，全部进入 buildReport 四组门禁；语义门槛仅对 EVALUATED 判定，NOT_EVALUABLE 不判 PASS。
3. ✅ **`target_mapping` 已接入评分**：`targetMappingQualityStats` 分别统计状态判断准确率（status 精确一致，含 conflicting_identity）与成功映射准确率（预测 resolved+非空 entity_id vs 真值 target_mapped）；真值仅 S53 一条 → 报告分母与样本，NOT_EVALUABLE 不设 PASS 门槛。
4. ✅ **`recommendation=null` 不再转 false**：labels 合并保留 null；`addComparison` 对 null 跳过 recommended 混淆；新指标直接从 truth 读取，null 不进入评估分母。
5. ⏳ 013 最终签字（reviewer/reviewed_at + confirmed + 更名 truth.jsonl + truth preflight）——**唯一剩余人工前置条件**，完成后冻结评测器 commit、独立运行 41×3。

## 评测器补全（2026-08-06，代码完成，暂未运行全量 Flash）

按已冻结的四组门禁合同实现，未修改 v5-json-rev2 提示词、未调用真实 Flash、未修改生产入口（正式入口仍 v4）：

- `backend/services/GeoFlashStructuredBenchmarkService.js`：新增 `recommendationQualityStats`（precision/recall/F1/assessed coverage，truth=null 不评估、预测 unresolved 计诚实降级）、`sentimentQualityStats`（逐次准确率 + 3×3 混淆矩阵）、`rankQualityStats`（仅真值 rank 非空样本，exact accuracy，<20 时 NOT_EVALUABLE 并报告分母与样本 ID）、`targetMappingQualityStats`（状态判断与成功映射分别计分）、`groundingEvidenceStats`（evidence 错误码 + mention span 与原文逐字校验）、`groupByRepeat`/`spread`（逐次计分与方差）；`precisionRecallF1` 改为等价公式 `2TP/(2TP+FP+FN)`（tp=0 时 F1=0 而非 null，门禁可判、方差可算）。
- `backend/scripts/geoFlashStructuredBenchmark.js`：labels 合并 `recommended: truth.recommendation === null ? null : ...`（不再 Boolean(null)→false）；buildReport 新增"语义指标"段（每臂推荐/情绪/排名/target_mapping/证据/方差）与四组门禁说明（硬门槛含完成率/目标事实/grounding/证据/关系 precision/Token；语义门槛仅 EVALUATED 判定；诚实降级单独计数；重复运行只测方差禁止多数投票）；`targetMappingTruthCount` 报告 target_mapping 真值数。
- `backend/scripts/geoBaselineEvaluate.js`：`addComparison` 对 `label.recommended === null` 跳过 recommended 混淆（unavailable 不得当 false 计 FP/FN）。
- 测试：新增 17 个构造反例测试（正例/反例/缺失值/诚实降级/防投机/逐次计分方差/混淆矩阵/NOT_EVALUABLE 分子分母样本 ID/grounding span 校验），后端全量 1134/1134 通过。

## 真值冻结（2026-08-06，数据所有者授权）

数据所有者（OrionJ0）批准 truth v3 当前裁决内容，reviewer=OrionJ0，允许完成 confirmed 冻结并运行 41×3；排名因仅 6 条真值作为**非阻塞观察指标**，不代表能力已认证。

- `work/geo-baseline-2026-07-28/truth.jsonl`：55 条全部 `confirmed`（reviewer=OrionJ0，reviewed_at=2026-08-06T05:09:23Z）。
- truth preflight PASS（0 错误）：`validateTruthEntry` 严格校验、manifest 哈希一致、S18/S19/S20 dup1 重复簇完整。
- 重复簇处理：41×3 运行排除 S19/S20（dup1 只保留代表 S18，簇权重 1），通过 `--exclude-sample-ids` 运行设施实现。
- 运行范围：55 条 samples.json（40 主语料 + 15 补充，去重后 53 条）+ C01 challenge（动态加入）= 54 条 × 3 次 × 2 臂（v5-json-rev2 / v4-current）= 324 次真实调用，0 缓存，新输出目录。

## Blocked by

- [014-targeted-flash-evidence-probe.md](014-targeted-flash-evidence-probe.md)（结构探针已通过 2026-08-06；rev2 最后一轮定向回归仅决定候选冻结为 rev2 或回退基线——不再有 rev3/rev4，不引入多数表决）
- [013-audit-truth-and-evaluation-contract.md](013-audit-truth-and-evaluation-contract.md)（最终签字与评测器补全；评测器补全可与 rev2 回归并行推进）
