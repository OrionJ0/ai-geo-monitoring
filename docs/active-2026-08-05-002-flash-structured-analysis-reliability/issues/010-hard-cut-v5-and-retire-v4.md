---
title: "硬切 v5、退役 v4 并完成生产入口验收"
status: blocked
type: HITL
blocked_by:
  - "015-v51-41x3-comparison-gate.md"
---

# 硬切 v5、退役 v4 并完成生产入口验收

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- [验证报告](../validation-report.md)

## What to build

009 已作出“不批准硬切”的冻结结论，本 issue 不得通过改写 009 解锁。仅在 011–014 修复与定向探针完成、015 的 `three_track_partial_v2 / semantic_evidence_v2` 真实 Flash 全量门禁全部通过并取得明确人工批准后，才把 v5 设为所有新分析的唯一正式路径。单问题、问题集、自动监测和 analysis-only 必须统一写入 v5，并通过请求审计证明实际使用固定 Flash 两阶段合同。

切换完成后退役 v4 运行时及其专属提示、修复分支、默认值、隐藏开关、fallback、测试和现役文档；只保留读取历史 v4 数据所需的明确版本化校验器。发布使用项目正式流程，生产问题默认修复 v5，不恢复静默旧路径。

## Acceptance criteria

- [ ] 015 的全部硬门槛均为 PASS，并有明确的人工作出上线批准；009 保持原始失败记录且未被覆盖，否则本 issue 不得开始实施。
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
