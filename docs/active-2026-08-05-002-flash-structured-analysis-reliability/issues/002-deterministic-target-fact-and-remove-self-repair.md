---
title: "完成确定性目标事实轨并删除自我修复"
status: open
type: AFK
blocked_by:
  - "001-freeze-v5-evaluation-contract.md"
---

# 完成确定性目标事实轨并删除自我修复

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## What to build

完成一条从完整原回答到目标提及事实的可信纵向路径：无损建立 source map，使用项目已配置的目标名称和别名直接扫描原文，保存精确位置和次数，并让该事实不依赖开放实体召回或语义阶段是否成功。

同时从 v5 候选路径删除会制造表面完成率的自我修复：不得自动寻找语义证据、从模型标准名派生未确认别名、扩大原文 occurrence，或程序性覆盖推荐、排名和情绪。语义增强失败时必须保留已完成的目标事实，并把未知写成明确状态。

## Acceptance criteria

- [ ] 相同完整回答和目标别名配置重复运行时，目标 presence、提及次数、位置及证据完全一致。
- [ ] 用户提供的“大工业园区”回答产生 `brand_mentioned=false`、提及次数 0，且不会生成目标推荐、排名或有效情绪样本。
- [ ] 阶段 1 漏掉目标实体、返回坏竞品行或完全不可用时，已完成的目标事实不被清空或降级。
- [ ] 模型 canonical name、未注册短名和程序派生别名不能单独产生目标命中或新增 occurrence。
- [ ] 自动语义补证据、未确认别名扩展和程序性情绪覆盖均有失败优先的回归测试，并在候选运行路径中为 0 次。
- [ ] 无效目标事实不能写入对应业务指标；语义未知不能被兼容占位伪装成业务否定值。

## Blocked by

- [001-freeze-v5-evaluation-contract.md](001-freeze-v5-evaluation-contract.md)
