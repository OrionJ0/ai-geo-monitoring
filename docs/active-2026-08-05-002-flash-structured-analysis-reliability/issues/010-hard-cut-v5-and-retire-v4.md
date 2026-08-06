---
title: "硬切 v5、退役 v4 并完成生产入口验收"
status: in_progress
type: HITL
note: "2026-08-06 数据所有者发布合同裁决：015 按冻结门槛（推荐/关系 95%）确实 FAIL，历史不改写；改为产品目标导向切换——核心事实必须准确（硬门槛）、开放语义最佳努力（公布实测，不宣称 95%）。015 新硬门槛全部通过；两个确定性问题（S53 法律主体冲突、排名 0/6 链路）已修复并通过 21 次定向回归。v5 硬切获方向授权，实施中。"
blocked_by:
  - "015-v51-41x3-comparison-gate.md"
---

# 硬切 v5、退役 v4 并完成生产入口验收

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- [验证报告](../validation-report.md)

## What to build

009 已作出“不批准硬切”的冻结结论，本 issue 不得通过改写 009 解锁。**2026-08-06 数据所有者发布合同裁决（产品目标导向）**：保留 015 的 FAIL 历史、不篡改门槛——完成率、目标事实、grounding、证据、成本为 v5 上线**硬门槛**（015 实测全部通过）；推荐与开放竞品关系明确标为 **AI 最佳努力指标**（公布实测水平：推荐 F1 83.69%、关系 precision 92.39%、情绪 accuracy 100%，不宣称达到 95%）；竞品遗漏不得导致整条失败（与最初需求一致）。排名按发布口径"排名能力证据不足"（NOT_EVALUABLE，6 条真值；确定性链路已修复 S49/S50/S02 提取，S01/S46 梯队型暂时 unavailable）。两个确定性问题（S53 法律主体冲突识别、排名 0/6 链路）已修复并通过 21 次定向回归。数据所有者授权修改发布合同并硬切 v5。单问题、问题集、自动监测和 analysis-only 必须统一写入 v5，并通过请求审计证明实际使用固定 Flash 两阶段合同。

切换完成后退役 v4 运行时及其专属提示、修复分支、默认值、隐藏开关、fallback、测试和现役文档；只保留读取历史 v4 数据所需的明确版本化校验器。发布使用项目正式流程，生产问题默认修复 v5，不恢复静默旧路径。

## Acceptance criteria（2026-08-06 发布合同修订版）

- [x] 015 按冻结门槛（推荐 F1≥0.95、关系 precision≥0.95）确实 FAIL，历史不改写；发布合同经数据所有者裁决修订——**v5 上线硬门槛**（完成率 100%、target_fact 100%/FP=0、grounding/证据合法性 0、Token 中位≤A×1.5/P95≤A×2）015 实测全部 PASS；**最佳努力指标**（推荐 F1 83.69%、关系 precision 92.39%、情绪 100%、排名证据不足）公布实测水平不宣称达标；数据所有者（OrionJ0）已给出硬切方向授权。
- [x] 两个确定性问题已修复并通过定向回归（21 次真实调用）：S53 target_mapping=conflicting_identity 3/3（法律主体冲突不映射为目标，语义轨 unavailable 与 truth 对齐）；排名链路中文数字名次/首选提取/梯队 unavailable（S49/S50/S02 rank=1 正确提取，S01/S46 诚实 unavailable）。
- [ ] 正式 v5 写入 `three_track_partial_v2 / semantic_evidence_v2`，目标映射歧义不清空 `target_fact`，语义证据区分程序 occurrence 与模型 semantic context。
- [ ] 所有新记录和运行默认写 `ai_structured_v5 / geo_metric_input_v5`，模型固定为 `deepseek-v4-flash`，不存在 Pro 或其他模型 fallback。
- [ ] 单问题、问题集、自动监测和 analysis-only 四类公开入口均产生可审计 v5 记录，并证明阶段 1、阶段 2和最终请求策略实际生效。
- [ ] v5 失败路径的 v4、Pro 和隐藏备用提示调用数均为 0；analysis-only 不重新访问监测平台。
- [ ] v4 运行时、专属 adapter、repair 分支、默认配置、feature flag、fallback 和误导性当前文档全部删除；历史 v4 报告与 CSV 仍可只读。
- [ ] 代码搜索、调用链检查和入口回归证明不存在仍指向 v4 的生产引用或默认值。
- [ ] 按正式发布流程完成部署，并验证生产 revision、systemd、公开就绪检查和登录后报告；服务器源码没有被直接编辑。
- [ ] 需求目录只有在生产入口验收、旧路径清理和文档收敛全部完成后才改为 `closed`；需要版本级回滚时使用显式发布回滚并记录重新切回条件。
- [ ] 正式 v5 写入 `three_track_partial_v2 / semantic_evidence_v2`，目标映射歧义不清空 `target_fact`，语义证据区分程序 occurrence 与模型 semantic context。
- [ ] 所有新记录和运行默认写 `ai_structured_v5 / geo_metric_input_v5`，模型固定为 `deepseek-v4-flash`，不存在 Pro 或其他模型 fallback。
- [ ] 单问题、问题集、自动监测和 analysis-only 四类公开入口均产生可审计 v5 记录，并证明阶段 1、阶段 2和最终请求策略实际生效。
- [ ] v5 失败路径的 v4、Pro 和隐藏备用提示调用数均为 0；analysis-only 不重新访问监测平台。
- [ ] v4 运行时、专属 adapter、repair 分支、默认配置、feature flag、fallback 和误导性当前文档全部删除；历史 v4 报告与 CSV 仍可只读。
- [ ] 代码搜索、调用链检查和入口回归证明不存在仍指向 v4 的生产引用或默认值。
- [ ] 按正式发布流程完成部署，并验证生产 revision、systemd、公开就绪检查和登录后报告；服务器源码没有被直接编辑。
- [ ] 需求目录只有在生产入口验收、旧路径清理和文档收敛全部完成后才改为 `closed`；需要版本级回滚时使用显式发布回滚并记录重新切回条件。

## Blocked by

- [015-v51-41x3-comparison-gate.md](015-v51-41x3-comparison-gate.md)

历史失败证据：[009-flash-41x3-comparison-gate.md](009-flash-41x3-comparison-gate.md)。009 不作为可事后改写的通过门禁。
