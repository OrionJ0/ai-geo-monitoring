---
title: "执行 v5.1 独立 41×3 真实 Flash 硬门禁"
status: open
type: HITL
blocked_by:
  - "014-targeted-flash-evidence-probe.md"
---

# 执行 v5.1 独立 41×3 真实 Flash 硬门禁

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- [009 历史失败门禁](009-flash-41x3-comparison-gate.md)
- [014 定向探针](014-targeted-flash-evidence-probe.md)

## What to build

仅在 014 选出通过预筛的最终候选后，冻结 `three_track_partial_v2 / semantic_evidence_v2`，对相同 41 条主语料、已复核补充真值集和 A/B/C 三臂执行独立真实 Flash 全量对比。每臂每样本重复 3 次，使用新的缓存键、运行目录和报告；009 的原始请求、输出、统计和“不批准硬切”结论保持只读。

报告必须同时给出目标事实、目标映射、语义证据双角色、整体字段可用率、实体质量、开放竞品诊断、重复稳定性、成本和注册表不变性。全部硬门槛通过后仍需人工明确批准，才能解锁 010。

## Acceptance criteria

- [ ] 运行前冻结语料版本、已复核真值、答案哈希、实验臂、候选修订、指标公式和门槛；全部调用固定 `deepseek-v4-flash`。
- [ ] `target_fact` 可用率、目标 presence/count 准确率与重复一致率均为 100%，目标映射歧义导致的整条失败为 0，目标假阳性和无效事实写入为 0。
- [ ] occurrence grounding 为 100%，程序自动生成 semantic context 为 0，机械性证据引用错误为 0；真实语义无支持时按字段 unresolved，不连带失败。
- [ ] 已输出竞品关系 precision≥0.95、推荐 F1≥0.95、情绪准确率≥0.90、明确排名 exact-match≥0.95，且每项至少 20 个已复核可评估实例；同时报告整体 assessed/unresolved 分布。
- [ ] 目标核心签名重复一致率≥99%，目标出现与提及次数一致率为 100%；开放竞品 Jaccard、未解决率、隔离率和 scoped SOV 波动单独报告。
- [ ] 实体 grounding、precision、recall、micro-F1 和 canonicalization 均报告，grounding 不替代实体正确性结论。
- [ ] Token 中位≤A×1.5、P95≤A×2；阶段 1/2 请求不受竞品注册表内容影响，表外实体保留且表内未出现品牌生成数为 0。
- [ ] 任一硬门槛失败时明确“不批准硬切”并保持 010 阻塞；全部通过时仍需记录明确人工批准，不能由脚本自动切换生产默认值。

## 认证前置待办（015 启动前必须完成，不阻塞 014 探针）

用户与独立 Claude 审查（2026-08-06）确认以下缺口必须在 015 前解决：

1. **排名真值不足**：55 条真值中明确排名仅 6 条，门槛要求 ≥20 条，算术上无法满足——需扩充已复核排名真值或修订门槛合同。
2. **推荐 F1、情绪准确率、排名准确率、Token 比例未接入硬门禁**：009/当前评测器尚未把这三项与成本比接入 PASS/FAIL 判定。
3. **`target_mapping` 未被评分**：truth v3 已新增 target_mapping 真值（S53 conflicting_identity），但评测器还没有对预测 target_mapping 的计分与门禁。
4. **`recommendation=null` 被旧 loader 转成 `false`**：`Boolean(null) === false` 会掩盖语义 unavailable 与明确不推荐的差异，需与第三轮 confirmed 完整性合同对齐。
5. 013 最终签字（reviewer/reviewed_at + confirmed + 更名 truth.jsonl + truth preflight）。

## Blocked by

- [014-targeted-flash-evidence-probe.md](014-targeted-flash-evidence-probe.md)（探针通过）
- [013-audit-truth-and-evaluation-contract.md](013-audit-truth-and-evaluation-contract.md)（最终签字与评测器补全）
