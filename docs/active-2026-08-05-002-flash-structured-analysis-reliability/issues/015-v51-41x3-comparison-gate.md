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

- [ ] 推荐 F1≥0.95、情绪准确率≥0.90、明确排名 exact-match≥0.95，每项至少 20 个已复核可评估实例；排名真值不足时（当前 55 条中仅 6 条）先扩充已复核真值或按合同修订门槛，不得用不足样本宣称通过。
- [ ] `target_mapping` 接入评分与门禁（truth v3 已有 S53 conflicting_identity 真值），预测映射状态准确率报告。
- [ ] 整体 assessed/unresolved/unavailable/not_applicable 字段分布单独报告，assessed 覆盖率作为语义可用性证据而非硬性门槛。

### 诚实降级（单独统计）

- [ ] unresolved/unavailable 单独统计：不算语义错误，也不得伪装成 assessed——降级占位（false/neutral 兼容值）不得进入语义准确率分母；`recommendation=null` 不得被 loader 转成 false 掩盖 unavailable 与明确不推荐的差异（与第三轮 confirmed 完整性合同对齐）。

### 重复运行（测量方差）

- [ ] 重复运行只用于测量重复一致率（方差），不得通过多数投票改写单次预测；重复一致率按 014 修正口径报告（确定性稳定性与 assessed 语义一致性分开，降级重复排除）。
- [ ] 任一硬门槛失败时明确“不批准硬切”并保持 010 阻塞；全部通过时仍需记录明确人工批准，不能由脚本自动切换生产默认值。

## 认证前置待办（015 启动前必须完成，不阻塞 014 探针）

用户与独立 Claude 审查（2026-08-06）确认以下缺口必须在 015 前解决：

1. **排名真值不足**：55 条真值中明确排名仅 6 条，门槛要求 ≥20 条，算术上无法满足——需扩充已复核排名真值或修订门槛合同。
2. **推荐 F1、情绪准确率、排名准确率、Token 比例未接入硬门禁**：009/当前评测器尚未把这三项与成本比接入 PASS/FAIL 判定。
3. **`target_mapping` 未被评分**：truth v3 已新增 target_mapping 真值（S53 conflicting_identity），但评测器还没有对预测 target_mapping 的计分与门禁。
4. **`recommendation=null` 被旧 loader 转成 `false`**：`Boolean(null) === false` 会掩盖语义 unavailable 与明确不推荐的差异，需与第三轮 confirmed 完整性合同对齐。
5. 013 最终签字（reviewer/reviewed_at + confirmed + 更名 truth.jsonl + truth preflight）。

## Blocked by

- [014-targeted-flash-evidence-probe.md](014-targeted-flash-evidence-probe.md)（结构探针已通过 2026-08-06；rev2 最后一轮定向回归仅决定候选冻结为 rev2 或回退基线——不再有 rev3/rev4，不引入多数表决）
- [013-audit-truth-and-evaluation-contract.md](013-audit-truth-and-evaluation-contract.md)（最终签字与评测器补全；评测器补全可与 rev2 回归并行推进）
