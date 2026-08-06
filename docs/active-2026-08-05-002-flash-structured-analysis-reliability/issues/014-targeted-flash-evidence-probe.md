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

- [ ] 样本清单、答案哈希、候选修订、请求策略、重复次数和预计 API 调用量在运行前冻结；不重新访问监测平台采集回答。
- [ ] 所有候选固定 `deepseek-v4-flash`、关闭思考与搜索、显式确定性参数，失败、修复和部分结果全部进入统计。
- [ ] 目标事实可用率及 presence/count 准确率为 100%，S55 不再整条失败，目标假阳性和无效事实写入为 0。
- [ ] 机械性 `analysis_evidence_reference_invalid` 为 0；程序自动生成 semantic context 为 0；真实无支持语义允许诚实 unresolved。
- [ ] 目标核心签名重复一致率不低于 99%，Token 中位不超过基线 1.5 倍，P95 不超过基线 2 倍。
- [ ] 报告按冻结门槛选择一个最终候选或明确判定“无候选通过”；只有最终候选通过才解锁 015。

## Blocked by

- [011-target-mapping-ambiguity-isolation.md](011-target-mapping-ambiguity-isolation.md)
- [012-semantic-evidence-v2.md](012-semantic-evidence-v2.md)
- ~~[013-audit-truth-and-evaluation-contract.md](013-audit-truth-and-evaluation-contract.md)~~（2026-08-06 解除：探针用确定性扫描验证 target_fact，不需要完整人工真值；013 认证未就绪只阻塞 015）
