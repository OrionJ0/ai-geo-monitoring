---
title: "完成确定性目标事实轨并删除自我修复"
status: closed
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

- [x] 相同完整回答和目标别名配置重复运行时，目标 presence、提及次数、位置及证据完全一致。`buildTargetMentions` 确定性扫描夹具证明同一回答两次运行输出 `deepEqual` 且 source/start/end 一致。
- [x] 用户提供的“大工业园区”回答产生 `brand_mentioned=false`、提及次数 0，且不会生成目标推荐、排名或有效情绪样本。`AIResponseAnalysisV5Contract.test.js` 覆盖顶层指标与 `target_mentions=[]`、`target_entity_id=null`。
- [x] 阶段 1 漏掉目标实体、返回坏竞品行或完全不可用时，已完成的目标事实不被清空或降级。契约测试证明实体目录无目标时 `buildTargetMentions` 仍独立产出命中。
- [x] 模型 canonical name、未注册短名和程序派生别名不能单独产生目标命中或新增 occurrence。删除 `expandGroundedUniqueShortAliases`/`expandGroundedTargetAliases`/canonical 名与“市”变体扫描，实体目录测试证明 `杭州海康威视科技有限公司` 不派生 `海康`、`深圳市中安谐` 不派生 `深圳中安谐`。
- [x] 自动语义补证据、未确认别名扩展和程序性情绪覆盖均有失败优先的回归测试，并在候选运行路径中为 0 次。删除 `validateEvidenceSourceIds` 的 `supplementMissingEntitySources`、`calculate` 的 `neutral→positive` 覆盖、`salvageGroundedMentions` 重新定位；全库 grep 确认 0 残留引用，新增失败优先测试覆盖三处。
- [x] 无效目标事实不能写入对应业务指标；语义未知不能被兼容占位伪装成业务否定值。`calculate` 现只透传阶段 2 `assessed` 情绪标签，不覆盖模型 neutral；`not_applicable` 顶层兼容占位不进入业务分母（真实状态在 `analysis_structure.sentiment.status`）。

## Implementation notes

- `AIEntityCatalogService.js`：删除 `expandGroundedTargetAliases`、`expandGroundedUniqueShortAliases`、`conservativeShortAliases` 及行政前缀/公司后缀常量；`expandGroundedEntityOccurrences` 只扫描已验证 `surface_forms`。
- `AIResponseSemanticJudgmentService.js`：删除 `supplementMissingEntitySources` 自动补证据，证据缺失判 `analysis_evidence_reference_invalid`。
- `AIResponseAnalysisV5Service.js`：删除 `POSITIVE_CUE`/`groundedPositive` 与 `neutral→positive` 程序性情绪覆盖。
- `AIResponseEntityExtractionService.js`：`salvageGroundedMentions` 改为 `quarantineUngroundedMentions`，无法锚定的行隔离并记录 `quarantined_mentions`。
- 新增 `backend/tests/AIResponseAnalysisV5Contract.test.js`（7 用例）；更新实体目录、语义判断、实体抽取、v5 服务既有测试以符合新合同。全量 1049 后端测试通过。

## Blocked by

- [001-freeze-v5-evaluation-contract.md](001-freeze-v5-evaluation-contract.md)
