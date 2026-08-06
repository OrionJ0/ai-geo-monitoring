---
title: "执行 v5.1 定向真实 Flash 证据探针"
status: in_progress
type: AFK
note: "2026-08-06 用户裁决：探针就绪不依赖 013 签字；013 认证未就绪只阻塞 015。候选冻结为 v5-json + v4-current"
blocked_by:
  - "011-target-mapping-ambiguity-isolation.md"
  - "012-semantic-evidence-v2.md"
---

## 运行前冻结（2026-08-06）

- 样本：12 条高风险样本（见下方清单），答案哈希与 `samples.json` 冻结回答一致。
- 候选（用户确认）：`v5-json`（被验证候选，`three_track_partial_v2 / semantic_evidence_v2` 双角色证据合同）+ `v4-current`（009 同款生产基线对照）。不再实现 014 原 A 臂（只增强提示词）——用户裁决停止修改阶段 2 提示词，防止探针基线漂移。
- 重复次数：每臂每样本 3 次；共 12 × 2 × 3 = **72 次真实 `deepseek-v4-flash` 调用**（concurrency=3）。
- 固定参数：`deepseek-v4-flash`、思考关闭、Web 关闭、显式确定性参数；失败/修复/部分结果全部进入统计。
- 不重新访问监测平台采集回答；009 输入/输出/结论保持只读。
- 探针只检查：整条完成率、target_fact 与确定性扫描一致性、S55 整条失败、`analysis_evidence_reference_invalid` 计数、unresolved/降级率、重复稳定性、Token 与延迟。不替代全量门禁；任一硬门槛失败即停止，不直接开始 41×3。

### 冻结样本清单（12 条，覆盖目标映射歧义/跨片段推荐/竞品关系/情绪/长回答/多实体）

| 样本 | answer_sha256 | 高风险原因 |
| --- | --- | --- |
| S55 | `de73c511…dc79f06` | 009 中 3 次整条失败（目标映射歧义）；补充样本 |
| S43 | `1e5738e3…b1177b2013` | 跨片段推荐（012 冒烟验证样本）；补充样本 |
| S07 | `fde87347…d573380692` | 推荐 evidence 跨片段失败 ×3（`analysis_evidence_reference_invalid`） |
| S18 | `c1be61a8…e75354601` | 竞品关系 evidence 失败 ×3；S18/S19/S20 重复簇代表 |
| S28 | `0550243f…b98144e2` | 推荐 evidence 失败 ×3 |
| S31 | `0c601620…a571578c5` | 推荐 evidence 失败 ×3；多实体（E010） |
| S06 | `56d211d2…b05914b633` | grounding 失败 ×3（`analysis_entity_grounding_invalid`） |
| S12 | `082fb07b…af9e13` | grounding 失败 ×3；长回答（9 mentions） |
| S08 | `246e2904…e06456f` | grounding 失败 ×2；长回答 |
| S32 | `da290e0f…b00685de6` | evidence 失败；多实体（E015） |
| S09 | `a45baff2…a9155ac46` | 推荐 evidence 失败 ×3 |
| S27 | `34720ffe…c0d081a3` | 情绪/推荐/排名重复不一致（v6 复核发现） |

# 执行 v5.1 定向真实 Flash 证据探针

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- [011](011-target-mapping-ambiguity-isolation.md)
- [012](012-semantic-evidence-v2.md)
- [013](013-audit-truth-and-evaluation-contract.md)

## What to build

从 009 冻结运行中选择 12 条已知失败/高风险样本，覆盖 S55 目标映射歧义、跨片段推荐、竞品关系、情绪、长回答和多实体回答。保持相同问题、原回答、目标配置和 `deepseek-v4-flash`，每个候选每条运行 3 次，对比：`v5-json`（`three_track_partial_v2 / semantic_evidence_v2` 双角色证据合同，被验证候选）与 `v4-current`（009 同款生产基线对照）。原 A 臂（只增强提示词）按用户裁决不再实现——停止修改阶段 2 提示词，防止探针基线漂移。

探针只用于淘汰不可行候选，不改写 009，不替代全量门禁。任一硬门槛失败即停止，不直接开始 41×3 全量调用。

## Acceptance criteria

- [x] 样本清单、答案哈希、候选修订、请求策略、重复次数和预计 API 调用量在运行前冻结；不重新访问监测平台采集回答。
- [x] 所有候选固定 `deepseek-v4-flash`、关闭思考与搜索、显式确定性参数，失败、修复和部分结果全部进入统计。
- [x] 目标事实可用率及 presence/count 准确率为 100%（v5-json 0 不一致，确定性稳定性 36/36 = 100%），S55 不再整条失败（3/3，target_fact 正常；语义轨 3/3 诚实 unavailable——mapping=ambiguous，非降级、非失败），目标假阳性和无效事实写入为 0。
- [x] 机械性 `analysis_evidence_reference_invalid` 为 0；程序自动生成 semantic context 为 0；真实无支持语义允许诚实 unresolved（S07 r3 阶段 2 修复仍无效后按字段降级，不污染 target_fact）；S55 目标映射歧义时语义轨按合同诚实 unavailable。
- [x] **确定性稳定性（target_fact）36/36 = 100%**；assessed 语义一致性按字段报告（rank 100%、recommendation 91.3%、sentiment 91.3%，唯一不一致源为 S12 真实分歧）；Token 中位 6054.5 ≤ 基线 1.5 倍 ✓，P95 11185 ≤ 基线 2 倍 ✓。
- [x] **探针结论修正：结构通过、语义校准待完成**（2026-08-06 用户裁决）。v1 报告以 36 对全配对判 99% 门槛在小样本下不成立（任何一次差异即降到 94.4% 以下），且把降级占位（null→false/neutral 强转）混入语义签名、漏计字段级 unresolved——见下方“探针结果修正”。

## 探针结果（2026-08-06，72 次真实 deepseek-v4-flash 调用）

运行目录：`work/geo-flash-probe-014-2026-08-06/`（runs/ 保留全部原始输出，0 命中缓存，全部真实调用）。

| 检查项 | v5-json（候选） | v4-current（基线） |
| --- | ---: | ---: |
| 整条完成率 | **100%**（36/36） | 97.2%（35/36，S09 r2 `invalid_analysis_output` 失败） |
| target_fact 与确定性扫描一致 | **0 不一致**（36/36） | **5 处不一致**：S07 ×3（true/2 vs true/3）、S08 r1（false/0 vs true/3）、S32 r1（false/0 vs true/2）——v4 连确定性目标事实都不可靠 |
| 确定性稳定性（target_fact 跨重复） | **100%**（36/36 对） | 88.2%（30/34 对） |
| S55 整条失败 | **0/3**（target_fact 正常；语义轨 3/3 unavailable，mapping=ambiguous 诚实不可用） | 0/3 |
| `analysis_evidence_reference_invalid` | **0** | 0（v4 无该检查，0 不构成证据） |
| 字段级语义状态（v5 结构） | assessed 23、unresolved 1（S07 r3 降级）、unavailable 3（S55×3）、not_applicable 9（S06/S09/S18） | v4 无该结构 |
| 降级 | 1/36（2.8%，S07 r3 阶段 2 第 2 次修复仍无效，诚实按字段降级） | 0（但伴随 target_fact 漏检） |
| assessed 语义一致性（仅 assessed 重复） | recommendation **91.3%**、rank **100%**、sentiment **91.3%**——唯一不一致源为 S12 | recommendation 51.9%、rank 37.5%、sentiment 48.9%（顶层口径） |
| Token / 延迟 | 中位 6054.5 / p95 11185；延迟中位 9.8s / p95 18.6s | 中位 7521 / p95 17499；延迟中位 10.2s / p95 18.3s |

## 探针结果修正（2026-08-06，数据所有者核对真实运行文件）

v1 报告以 88.9% 判“未达 99% 门槛 → 方案未通过”，数据所有者核对 `runs/` 原始文件后指出三个统计问题，本探针按修正口径重新判读：

1. **字段级 unresolved 漏计**：S07 r3 的 `target_semantics` 三个字段（recommendation/rank/sentiment）全部 `unresolved`，v1 只检查 track 级 `status === 'unresolved'`（实为 `partial`），报告却统计 unresolved=0。
2. **降级占位被强转为语义判断**：稳定性签名用顶层 `brand_recommended`/`sentiment` 字段，而 `AIResponseAnalysisV5Service` 在降级时把 unresolved 强转成 `false`/`neutral` 占位（见服务注释“程序不得覆盖模型语义判断”的兼容分支）。S07 r3 的“不一致”是占位值 vs 真实判断，不是语义翻转。修正：降级重复排除出 assessed 一致性，只对 `status === 'assessed'` 的重复计语义稳定性。
3. **小样本 99% 门槛不成立**：36 对配对下 99% 实际等于 36/36 零波动，任何一次差异直接降到 94.4% 以下。修正：拆开确定性稳定性（target_fact 跨重复，36/36 = 100%）与 assessed 语义一致性（按字段报告，不设不合理的单一门槛）。

修正后判定：

- **结构探针：通过。** 完成率 100%、target_fact 与确定性扫描 100% 一致（确定性稳定性 36/36）、证据引用错误 0、S55 不再整条失败、成本低于基线。v4 基线在确定性轨道自身不可靠（5 处 target_fact 不一致），佐证 v5 确定性轨道的改进。
- **语义校准：未完成。** 唯一真实问题是 S12 的成功路径分歧（两个阶段均成功、无降级）：r1 推荐 true（错）/情绪 positive（对）、r2 推荐 false（对）/情绪 neutral（错）、r3 推荐 true（错）/情绪 positive（对），真值 false/positive。S07 r3 是合同允许的诚实降级，不构成语义问题。S12 证明阶段 2 混淆了两个概念：(a) 正面描述不等于明确推荐；(b) 是否判断情绪不取决于问题是否询问情绪，而取决于回答如何描述目标品牌。

**结论：v5-json 结构探针通过、语义校准待完成。015 仍不解锁；语义校准问题交由定向 A/B（24 次真实调用）验证阶段 2 提示词修订（见下方 A/B 计划）。**

## 第 2 轮定向 A/B（运行前冻结 2026-08-06）

- 动机：结构探针已通过；语义校准唯一真实问题是 S12。证据指向阶段 2 混淆两个概念：(a) 正面描述 ≠ 明确推荐；(b) 情绪判断对象是回答对品牌的描述方式，不是问题是否询问情绪。
- 修订范围：阶段 2 提示词仅补三条规则并附正反例（推荐语义：对比/列举/"综合性较强"不等于推荐；情绪口径：情绪判断不依赖问题是否问情绪；repair prompt 明确写出 `target_entity_id`，非空目标不得返回 `sentiment=not_applicable`）。**不改阶段 1、实体结构、竞品表、确定性目标事实。**
- 样本：S07（诚实降级对照）、S12（真实分歧）、S43（跨片段推荐回归）、S55（mapping 歧义回归）。
- 臂：`v5-json`（当前提示词）+ `v5-json-rev1`（修订提示词）；每条 3 次；共 4 × 2 × 3 = **24 次真实 `deepseek-v4-flash` 调用**（concurrency=3，0 缓存，输出 `work/geo-flash-probe-014-2026-08-06/ab-rev1/`）。
- 验收重点：S12 推荐应为 false 且情绪应为 positive；S07 成功判断或诚实 unresolved 均可接受、不得整条失败；S43/S55 不得回归；target_fact 仍保持 100% 一致；evidence 引用错误仍为 0。
- 通过后：修 015 评测器与排名门槛，然后执行全量门禁。当前正式入口继续走 v4，v5 尚未设为默认。

## 第 2 轮定向 A/B 结果（2026-08-06，24 次真实 deepseek-v4-flash 调用）

运行目录：`work/geo-flash-probe-014-2026-08-06/ab-rev1/`（两臂各 12 次，`from_cache` 全 0，全部真实调用）。

| 检查项 | v5-json（当前提示词） | v5-json-rev1（修订提示词） |
| --- | ---: | ---: |
| 整条完成率 | 100%（12/12） | 100%（12/12） |
| target_fact 与确定性扫描一致（确定性稳定性） | **0 不一致（12/12 对 = 100%）** | **0 不一致（12/12 对 = 100%）** |
| `analysis_evidence_reference_invalid` | **0** | **0** |
| 降级 | 0 | 0 |
| 字段级语义状态 | assessed 9 / unresolved 0 / unavailable 3（S55×3，mapping 歧义）/ not_applicable 0 | 同左 |
| S07 推荐/情绪 | assessed 3/3，rec=true、positive（与真值一致） | assessed 3/3，rec=true、positive（与真值一致） |
| S43 推荐/情绪 | assessed 3/3，rec=true、positive（与真值一致） | assessed 3/3，rec=true、positive（与真值一致） |
| S55 | 3/3 target_fact 正常、语义轨诚实 unavailable（不回归） | 同左 |
| S12 推荐（真值 false） | **3/3 false ✓** | **3/3 false ✓** |
| S12 情绪（真值 positive） | **2/3**（r3 neutral） | **1/3**（r2、r3 neutral） |
| assessed 语义一致性（仅 assessed 重复） | recommendation 50%（36 对中 18 一致，唯一分歧源 S12 推荐已消失→0） | 同左 |
| Token 中位 | 7490.5 | 5234.5 |

> 注：表中 recommendation 一致性 50% 是 4 样本×3 次的小样本口径（S07 与 S12 真值相反，两两比较天然半数不一致），无诊断意义；以逐样本验收对照为准。

### A/B 验收对照与结论

1. **S12 推荐应为 false：两臂 3/3 通过 ✓，但对照臂（v5-json 未改提示词）同样 3/3**——014 主探针中该臂 S12 推荐为 true/false/true（2 错），本次批次 3/3 对，证明推荐分歧主要是模型固有随机性，本次未再现，**不能归功于规则 1**。
2. **S12 情绪应为 positive：两臂均未通过（v5-json 2/3、rev1 1/3）✗**。neutral 理由拆解：
   - v5-json r3："回答对 Goodie AI 的描述客观，无明确褒贬"。
   - rev1 r2/r3："描述为'综合性较强'，属于中性评价，**未表达明确推荐或偏好**"。
   - 后者证明 rev1 的规则 1 示例（"综合性较强"≠推荐）被模型串线到情绪判级：把"不推荐"误解为"情绪中性"。而真值裁决"综合性较强、两环节都有覆盖"是正面评价（positive）。**情绪问题的根源不是"问题是否询问情绪"（规则 2 已覆盖），而是"综合性较强"这类评价性表述的判级口径（positive vs neutral）不稳定，且 rev1 的推荐示例反向加剧了这一串线。**
3. **S07：两臂 3/3 assessed 且与真值一致，无整条失败 ✓**（本批未再现阶段 2 输出无效降级）。
4. **S43/S55 不得回归：通过 ✓**（S55 语义轨 unavailable 为合同行为，target_fact 正常）。
5. **target_fact 100% 一致、evidence 引用错误 0：两臂通过 ✓**。

**结论：修订提示词（rev1）未通过 S12 情绪验收，且情绪维度比对照臂更差（1/3 vs 2/3）。推荐口径（规则 1）与 target_fact/evidence 全部保持，但情绪判级需要修正规则 2 的表述（明确评价性表述按描述方向判级、不与推荐判断联动）或调整修复策略——由数据所有者裁决后再进入下一轮验证；015 仍不解锁。**

## Blocked by

- [011-target-mapping-ambiguity-isolation.md](011-target-mapping-ambiguity-isolation.md)
- [012-semantic-evidence-v2.md](012-semantic-evidence-v2.md)
- ~~[013-audit-truth-and-evaluation-contract.md](013-audit-truth-and-evaluation-contract.md)~~（2026-08-06 解除：探针用确定性扫描验证 target_fact，不需要完整人工真值；013 认证未就绪只阻塞 015）
