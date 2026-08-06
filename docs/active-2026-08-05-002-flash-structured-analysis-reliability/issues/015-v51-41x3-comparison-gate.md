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
- [x] **2026-08-06 全量执行结论：不批准硬切，010 保持阻塞。** 硬门槛已输出关系 precision 92.39% < 95% 失败；语义门槛推荐 F1 83.69% < 95% 失败；其余硬门槛（完成率 100%、target_fact 100%、假阳性 0、evidence/grounding 0、Token）与情绪准确率 100% 通过；排名 NOT_EVALUABLE（6 条真值，证据不足，非阻塞观察项）；target_mapping 0/3 报告。全部通过时仍需记录明确人工批准，不能由脚本自动切换生产默认值。

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

## 41×3 全量结果（2026-08-06，324 次真实 deepseek-v4-flash 调用，0 缓存）

运行目录：`work/geo-flash-015-2026-08-06/`。样本 54 条（55 samples.json 去重 S19/S20 + C01 challenge）× 3 次 × 2 臂（v5-json-rev2 / v4-current）。逐次计分、无多数投票。

### v5-json-rev2（候选，rev2 冻结版提示词）

| 组 | 指标 | 结果 | 判定 |
| --- | --- | ---: | ---: |
| 硬门槛 | 完成率 | 162/162（100%） | **PASS** |
| 硬门槛 | target_fact presence/count 准确率、假阳性 | 162/162（100%）、FP=0 | **PASS** |
| 硬门槛 | 证据合法性（evidence_reference_invalid / grounding 错误） | 0 / 0 | **PASS** |
| 硬门槛 | 已输出竞品关系 precision≥0.95 | 92.39%（TP=995，FP=82，FN=478，覆盖 55） | **FAIL** |
| 硬门槛 | Token/延迟（vs v4-current） | 中位 5510 ≤ 11303 ✓；p95 8960 ≤ 37167 ✓ | **PASS** |
| 语义门槛 | 推荐 F1≥0.95 | 83.69%（precision 77.63%，recall 90.77%，TP=59，FP=17，FN=6，coverage 95.83%，降级 4） | **FAIL** |
| 语义门槛 | 情绪准确率≥0.90 | 100.00%（92/92，32 唯一样本，混淆矩阵对角线，降级 4） | **PASS** |
| 语义门槛 | 明确排名 exact-match≥0.95 | **NOT EVALUABLE**（0/6；真值仅 6 条 S01/S02/S46/S49/S50/S55；coverage 83.33%，降级 3）——**排名能力证据不足**，非阻塞观察指标 | — |
| 语义门槛 | target_mapping | NOT EVALUABLE（状态判断 0/3、成功映射 0/3，真值仅 S53）——S53 预测 resolved，truth conflicting_identity | 报告 |
| 诚实降级 | 推荐/情绪/排名 degraded | 4 / 4 / 3 条（unresolved/unavailable 单独计数，不算错误、不伪装 assessed） | — |
| 重复运行 | repeat_variance | 推荐 F1 mean 0.837（std 0.013）；情绪 mean 0.958（std 0.018）；排名 [0,0,0] | 只测方差 |

### v4-current（生产基线对照）

- 完成率 142/162（87.65%）——20 次 `invalid_analysis_output`（S01/S02/S03/S05/S06/S09/S10/S16/S26/S34/S37/S38/C01 等，证据定位/短实体词失败）。
- target presence 141/142（99.30%）、假阳性 0。
- 实体/关系指标对 v4 不适用（v4 无 v5 `analysis_structure` span 结构，span 对齐计分全部 FP）——不作横向对比。

### 推荐失败链路（真实语义缺口，非评测器问题）

26 条错误中 3 条为 S53（truth=null，评测器已排除），真实 23 条 = **FP 17（误推荐）+ FN 6（漏推荐）**。FP 集中在 S46（3 次）、S29（3）、S54（3）、S16（3）、S27（3）、S49（2）——均为"场景适配列表/列举/综合描述"被模型判为推荐，而 truth 裁决明确不推荐（S46 即数据所有者裁决样本："场景适配列表不足以构成明确推荐"）。FN：S33（3）、S30（3）——truth 明确推荐而模型漏报。rev2 提示词的推荐规则未消除该类误判。

### 010 决策：不批准硬切

按四组门禁合同：**任一硬门槛失败 → "不批准硬切"，010 保持阻塞**。本次硬门槛关系 precision 92.39% < 95% 失败；语义门槛推荐 F1 83.69% < 95% 失败。排名按 NOT_EVALUABLE 发布口径标注"排名能力证据不足"（非阻塞观察项，不代表能力已认证）。v5-json-rev2 结构轨道全绿（完成率 100%、target_fact 100%、evidence/grounding 0、成本 PASS），真实缺口定位在推荐口径（过宽）与竞品关系判定——按用户裁决不重开提示词（无 rev3/rev4）、不引入多数投票。正式入口仍 v4，v5 未默认，010 继续阻塞。

## 确定性问题修复与定向回归（2026-08-06，数据所有者指令，非 rev3/rev4）

数据所有者裁决：v5 实际明显优于 v4（完成率 100% vs 87.65%、核心稳定率 97.53% vs 67.18%、Token 5510 vs 7535、延迟 7.0s vs 10.2s、v4 20 条结构化失败 vs v5 0），"015 未过"不等于"v4 更好"。停止提示词调优，改产品目标导向切换；处理两个确定性问题（不修改语义提示词、不引入多数投票）：

1. **S53 法律主体冲突识别**（`AIEntityCatalogService.buildEntityCatalog`）：不同法律主体不得映射为目标品牌——命中实体 canonical_name 不含完整目标别名（如"上海广拓"）且呈公司法律主体形态（公司/集团/股份/科技/技术/有限/实业）时 `target_mapping=conflicting_identity`、`target_entity_id=null`；V5 服务把 conflicting_identity 并入语义轨 unavailable。目标自身全称（含完整别名）不受影响。**定向回归：S53 3/3 conflicting_identity + 语义轨 unavailable，与 truth 完全对齐（target_mapping 状态判断/成功映射 0/3 → 3/3）。**
2. **排名 0/6 数据链路**（`AIResponseAnalysisV5Service`）：名次支持中文数字（"排名第一"，S49）；显式名次扫描扩展至目标 mention 行（行文本必须含目标 surface，防独立声明误纳入；空格与 markdown 加粗连接容忍，S50"首选 **上海广拓**"）；梯队/排序声明无法确定性提取名次时排名输出 **unavailable**（诚实关闭，不伪装 assessed null；不含首选类——"首选"提取失败=修饰其他实体=明确无排名）。**定向回归：S49/S50/S02 rank=1 正确提取（3/3），S01/S46 诚实 unavailable，S55 保持 unavailable——0/6 全错 → 3/6 正确 + 3/6 诚实关闭。**

定向回归：S53/S01/S02/S46/S49/S50/S55 × 3 = 21 次真实调用（`work/geo-flash-015-fix-regression-2026-08-06/`），无整条失败、无降级。后端全量测试 1142/1142。发布合同修订见 [010 硬切与发布合同](010-hard-cut-v5-and-retire-v4.md)（核心事实硬门槛 + 最佳努力指标）。

## Blocked by

- [014-targeted-flash-evidence-probe.md](014-targeted-flash-evidence-probe.md)（结构探针已通过 2026-08-06；rev2 最后一轮定向回归仅决定候选冻结为 rev2 或回退基线——不再有 rev3/rev4，不引入多数表决）
- [013-audit-truth-and-evaluation-contract.md](013-audit-truth-and-evaluation-contract.md)（最终签字与评测器补全；评测器补全可与 rev2 回归并行推进）
