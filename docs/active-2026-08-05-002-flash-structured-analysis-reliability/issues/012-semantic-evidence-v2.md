---
title: "实现 semantic_evidence_v2 双角色证据合同"
status: closed
type: AFK
closed_at: 2026-08-05
blocked_by: []
---

# 实现 semantic_evidence_v2 双角色证据合同

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- [009 失败门禁](009-flash-41x3-comparison-gate.md)

## What to build

将单一 `evidence_source_ids` 拆成实体 occurrence 证据与语义上下文证据。程序从冻结实体目录确定性投影 `entity_occurrence_source_ids`；Flash 阶段 2 只输出 `semantic_context_source_ids` 来支持推荐、排名、情绪、候选顺序和竞品关系。两类证据通过封闭 `entity_id` 组合审计，允许实体列举和语义表达位于不同片段。

程序不得生成、补写或替换 semantic context。上下文 ID 无效或不能支持断言时，只定向修复该断言；仍失败则降级字段或竞品项，不清空目标事实。合同使用 `three_track_partial_v2 / semantic_evidence_v2`，历史 v1 继续只读。

## Acceptance criteria

- [x] 阶段 2 schema、提示词和修复提示只要求模型返回 `semantic_context_source_ids`，并向修复请求提供错误断言、source map 和实体 occurrence IDs。`SEMANTIC_PROMPT_REVISION=closed_entity_semantics_v4_evidence_roles`，`CONTRACT_REVISION=three_track_partial_v2`；修复提示含 `<source_map>` 与 `<entity_occurrence_ids>`。
- [x] 最终证据包同时保存程序投影的 occurrence IDs 与模型输出的 semantic context IDs；两者均存在于同一冻结 source map，但不要求位于同一片段。`target_semantics` 三字段与竞品关系均输出 `evidence.entity_occurrence_source_ids + semantic_context_source_ids`。
- [x] 实体在前文列举、后文以简称、集合或顺序表达推荐/关系/情绪的 fixture 可以按证据角色正确校验。跨片段推荐/关系/情绪测试通过；提示词过滤空行片段，防止模型引用无语义内容。
- [x] 未知 ID、空的必需语义上下文和引用无内容片段的上下文仍被拒绝；程序自动生成 semantic context 的计数为 0。不采用固定指示词表机械判断（009 高降级根因），语义支持度由人工真值评测约束。
- [x] 修复仍失败时只把对应语义字段或竞品项标为 unresolved/invalid，`target_fact` 和其他已通过字段保持不变。重复推荐（真实 Flash 多上下文推荐同一实体）程序确定性合并去重，不重复输出、不补写上下文。
- [x] API、CSV、页面和历史读取能区分 v1 单数组与 v2 双角色证据，不静默重解释历史记录。`analysis_structure` 透传，`analysis_contract_version` 分派校验；历史 v1 只读。

## 完成记录

- 修改 `backend/services/AIResponseSemanticJudgmentService.js`：v2 提示词/输出合同（`semantic_context_source_ids`）、`validateSemanticContextSourceIds`（未知/空/无内容拒绝，不要求 occurrence 共片段）、修复提示携带 source map 与 occurrence IDs、重复推荐合并、提示词过滤空行。
- 修改 `backend/services/AIResponseAnalysisV5Service.js`：`CONTRACT_REVISION=three_track_partial_v2`；`calculate` 组装双角色证据包（程序 occurrence + 模型 semantic context），竞品关系输出 `entity_occurrence_source_ids`。
- 测试更新与新增：跨片段语义上下文、未知/空/无内容拒绝、重复推荐合并、修复提示内容、提示词合同、编排层证据包组装。
- 回归：全部相关测试 176 个通过（v5 全套 + benchmark + 运行服务）。
- 真实冒烟：S43（目标唯一命中、v1 下为降级样本）真实 `deepseek-v4-flash` 3/3：target_mapping=resolved、target_semantics=complete、推荐 assessed(true)、情绪 assessed(positive)，与人工真值一致，约 8s/次。S55 映射歧义路径此前 3/3 无回归。

## Blocked by

None - can start immediately. 与 011 使用不同状态边界，可独立实现，合并时以 `target_mapping` 合同为准。
