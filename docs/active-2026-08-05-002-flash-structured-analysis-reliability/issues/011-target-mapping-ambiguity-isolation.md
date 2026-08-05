---
title: "隔离目标实体映射歧义并保持目标事实完整"
status: closed
type: AFK
closed_at: 2026-08-05
blocked_by: []
---

# 隔离目标实体映射歧义并保持目标事实完整

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- [009 失败门禁](009-flash-41x3-comparison-gate.md)

## What to build

把确定性目标原文事实与阶段 1 目标实体映射拆成独立状态。回答同时出现目标品牌短名、英文名、公司全称，且它们被抽成多个 grounded 实体时，系统保留目标 presence、count 和全部原文位置，输出 `target_mapping.status=ambiguous` 与空 `target_entity_id`，只把需要唯一实体 ID 的目标语义降级为不可用。

不得猜选一个实体、无合同自动合并实体、删除 grounded 实体或抛出整条 `analysis_target_mapping_ambiguous`。单问题、问题集、自动监测和 analysis-only 使用同一行为。

## Acceptance criteria

- [x] S55 同形 fixture 同时包含“广拓（Gato）”和“上海广拓信息技术有限公司”时，`target_fact.status=complete`，presence/count/mentions 与确定性扫描一致。`buildEntityCatalog` 不再抛 `analysis_target_mapping_ambiguous`；`target_mentions` 由确定性 `buildTargetMentions` 生成（S55 = 2：广拓 + 上海广拓）。
- [x] 多个实体覆盖目标 occurrences 时输出 `target_mapping.status=ambiguous`、`target_entity_id=null`，目标语义为 unavailable，开放竞品实体仍保留。`target_semantics.status=unavailable`，三个字段均为 `unavailable`；`competition_analysis` 保持 partial 且保留全部实体。
- [x] 唯一命中、目标未出现和目标配置无效分别保持 resolved、not_applicable 和 invalid-input 语义，不产生回归。新增 `target_mapping` 独立状态机，`target_fact.status` 仅在目标配置无有效名称/别名时为 `invalid_input`。
- [x] 四类入口和持久化/API/CSV/UI 不把 mapping ambiguous 显示为整条分析失败，也不把目标语义未知显示成未推荐、中性或无排名。`analysis_structure` 整体透传持久化，聚合只纳入 `assessed`，`unavailable` 不进入分母。
- [x] 自动化回归通过后，对 S55 冻结原回答真实调用 `deepseek-v4-flash` 3 次，3/3 完成目标事实且没有 `analysis_target_mapping_ambiguous`。真实结果：target_fact=complete（mentioned=true、count=2）、target_mapping=ambiguous、目标语义 unavailable、competition=partial，耗时约 7.1s/次。

## 完成记录

- 修改 `backend/services/AIEntityCatalogService.js`：`buildEntityCatalog` 把目标映射歧义从抛错改为独立 `target_mapping` 状态（resolved / not_applicable / ambiguous / invalid_input），`target_mentions` 在目标配置有效时总是由确定性扫描生成。
- 修改 `backend/services/AIResponseAnalysisV5Service.js`：`calculate` 读取 `target_mapping`，映射歧义时目标语义三字段与总状态均为 `unavailable`；`analysis_structure` 增加 `target_mapping`。
- 新增测试：`AIEntityCatalogService.test.js`（S55 同形 ambiguous、invalid_input 语义）、`AIResponseAnalysisV5Tracks.test.js`（映射歧义整条不失败）。
- 回归：AIEntityCatalogService 11 个、v5 全套 78 个、ProjectRun/QuestionSetRun 74 个测试全部通过。

## Blocked by

None - can start immediately.
