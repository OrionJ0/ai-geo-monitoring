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
- [x] 目标事实可用率及 presence/count 准确率为 100%（v5-json 0 不一致），S55 不再整条失败（3/3），目标假阳性和无效事实写入为 0。
- [x] 机械性 `analysis_evidence_reference_invalid` 为 0；程序自动生成 semantic context 为 0；真实无支持语义允许诚实 unresolved（S07 r3 阶段 2 修复仍无效后按字段降级，不污染 target_fact）。
- [ ] 目标核心签名重复一致率不低于 99%——**v5-json 实测 88.9%（32/36），成功路径 94.1%（32/34），未达门槛**；Token 中位 6054.5 ≤ 基线 1.5 倍 ✓，P95 11185 ≤ 基线 2 倍 ✓。
- [ ] 报告按冻结门槛选择最终候选或明确判定“无候选通过”——**v5-json 未通过稳定性门槛，015 不解锁**；稳定性缺口证据见下方探针结果。

## 探针结果（2026-08-06，72 次真实 deepseek-v4-flash 调用）

运行目录：`work/geo-flash-probe-014-2026-08-06/`（runs/ 保留全部原始输出，0 命中缓存，全部真实调用）。

| 检查项 | v5-json（候选） | v4-current（基线） |
| --- | ---: | ---: |
| 整条完成率 | **100%**（36/36） | 97.2%（35/36，S09 r2 `invalid_analysis_output` 失败） |
| target_fact 与确定性扫描一致 | **0 不一致**（36/36） | **5 处不一致**：S07 ×3（true/2 vs true/3）、S08 r1（false/0 vs true/3）、S32 r1（false/0 vs true/2）——v4 连确定性目标事实都不可靠 |
| S55 整条失败 | **0/3**（不再失败） | 0/3 |
| `analysis_evidence_reference_invalid` | **0** | 0（v4 无该检查，0 不构成证据） |
| unresolved/降级率 | unresolved 0/0；降级 1/36（2.8%，S07 r3） | 0 降级（但伴随 target_fact 漏检） |
| 重复稳定性（核心签名） | **88.9%**（32/36）<99% 门槛；成功路径 94.1% | 58.8% |
| Token / 延迟 | 中位 6054.5 / p95 11185；延迟中位 9.8s / p95 18.6s | 中位 7521 / p95 17499；延迟中位 10.2s / p95 18.3s |

稳定性缺口拆解（v5-json 4 对不一致全部来自两个样本）：

1. **S07 r3（降级路径）**：阶段 2 第 2 次修复仍 `analysis_semantic_output_invalid` → 按合同字段降级（recommendation/sentiment 落为 false/neutral 占位），target_fact 不受影响。这是诚实降级，但签名把"降级"伪装成"判断"，使稳定性被拉低。
2. **S12 r2（真实模型分歧）**：两阶段均成功（无降级），但推荐 true→false、情绪 positive→neutral。相同输入下模型判断翻转，属于成功路径上的真实不稳定。

**结论：v5-json 在确定性轨道全部达标（target_fact 100% 一致、S55 修复、evidence 0 错误、成本优于基线），但目标核心签名稳定性未达 99%（88.9%）——候选未通过探针预筛，015 不解锁。** 是否需要修改阶段 2 提示词或调整修复策略，由探针证据决定（用户裁决：探针结果出来后决定）。S07 的重复输出无效与 S12 的判断翻转是主要追查对象。

## Blocked by

- [011-target-mapping-ambiguity-isolation.md](011-target-mapping-ambiguity-isolation.md)
- [012-semantic-evidence-v2.md](012-semantic-evidence-v2.md)
- ~~[013-audit-truth-and-evaluation-contract.md](013-audit-truth-and-evaluation-contract.md)~~（2026-08-06 解除：探针用确定性扫描验证 target_fact，不需要完整人工真值；013 认证未就绪只阻塞 015）
