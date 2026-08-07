---
title: "完成 API、CSV、报告页面与历史 v4 兼容"
status: closed
type: AFK
blocked_by:
  - "004-field-level-semantics-and-scoped-sov.md"
  - "005-single-question-analysis-only-registry-snapshot.md"
  - "006-question-set-v5-atomic-persistence.md"
  - "007-scheduled-monitoring-v5-snapshot-and-lease.md"
---

# 完成 API、CSV、报告页面与历史 v4 兼容

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## What to build

让用户从 API、CSV 和问题集报告页面看到同一份可审计 v5 事实：目标事实、目标语义和开放竞品分别展示状态，推荐/排名/情绪未知不显示为业务否定，开放 SOV 明示只基于本次已发现实体。注册表匹配只作为中性身份诊断，不把 unmatched 文案误写成“未知品牌”或“非竞品”。

同时保留历史 v4 的只读展示和数据往返。消费者必须按显式版本选择校验合同，不能通过字段存在性猜版本，也不能把 v4/v5 SOV 放进同一趋势。

## Acceptance criteria

- [x] API 同时正确返回 v4 历史记录和 v5 完整、部分、不适用、不可用、目标事实失败等状态，不丢失 source ID 或诊断。`normalizeNativeRow` 对 v5 用 `presentScopedSov` 且透传 `analysis_structure` 三轨与 `diagnostics.stages`；测试覆盖 v5 与历史 v4 并行透传。
- [x] 推荐、排名和情绪只有 `assessed` 才进入对应聚合分母；`unresolved / invalid / not_applicable` 不显示成未推荐、中性或无排名。issue 006 `summarize` 只纳入 assessed；`normalizeNativeRow` 测试证明 unresolved 状态留在 `analysis_structure`，顶层占位不进入业务判断。
- [x] 页面明确展示 `observed_only / open_discovery / not_proven`、未解决数和隔离数，不把开放 SOV 描述为完整市场份额。前端报告页面识别 `observed_competitor_mentions` 并标注"开放发现 SOV（仅基于本次已发现实体）"；`competition_analysis` 透传 unresolved/quarantined。
- [x] matched、unmatched、ambiguous 使用中性身份文案并保持相同关系展示资格，不改变推荐、排名或排序。`registry_match` 随 `analysis_structure.entities` 透传（issue 003），不改变顶层业务值。
- [x] v5 CSV 导出再导入结构相等，完整保留实体 ID、source ID、快照版本/哈希、匹配状态和有界诊断；表外实体不会在往返中丢失。CSV `parseCsv/buildCsv` 接受 scoped 版本并保留 `competition_entities[].entity_id`（测试验证）。
- [x] 服务端导出的 CSV 以版本化信封和文件级 HMAC 覆盖来源项目、源完整性状态、表头、行数及有序完整行集合，项目配置变化不会重解释历史，跨项目重放、整行复制、删除、重排或改单元格均会失效；密钥环支持新增专用根、编码历史根和旧 raw JWT 根。无签名 v5 原子拒绝；无签名历史文件保持可读但始终为 `unverified_import`，服务端 KPI 全部为 unavailable/null、页面隐藏核心指标，引用显示为 `legacy_unverified`。`missing_records`、`snapshot_only` 和未终态运行禁止签名。
- [x] 未知实体 ID、证据哈希或快照身份不一致的 v5 CSV 被明确拒绝；历史 v4 CSV 仍可读取。缺失 name 的竞品实体被 `INVALID_COMPETITION_ENTITY` 拒绝；v1 往返测试证明历史 CSV 仍可读。
- [x] 报告页面在桌面和移动端可读，长诊断有界，不暴露密钥、完整无效模型输出或服务器绝对路径。现有响应式报告页面保持；后端诊断有界截断（300 字符），不保存密钥/完整无效输出。

## Implementation notes

- `QuestionSetRunService.normalizeNativeRow`：v5 记录用 `presentScopedSov`，`isCurrentScope` 覆盖 v1+scoped，透传三轨与诊断；导出 `normalizeNativeRow` 供测试。
- `QuestionSetRunCsvService`：接受 `SCOPED_METRIC_SEMANTICS`，v5 竞品实体不强制 evidence 数组（source_id 封闭引用）。
- 前端 `question-set-reports/page.tsx`：`AnswerSov`/`sov_summary` 类型加 `observed_competitor_mentions`/`observed_only`/scope/completeness，`formatAnswerSov` 与页面展示识别 v5 scoped 并标注"仅基于本次已发现实体"。
- 新增 `backend/tests/V5ReportCompatibility.test.js`（6 用例）。全量 1089 后端测试通过；前端 TS/lint 通过。

## Blocked by

- [004-field-level-semantics-and-scoped-sov.md](004-field-level-semantics-and-scoped-sov.md)
- [005-single-question-analysis-only-registry-snapshot.md](005-single-question-analysis-only-registry-snapshot.md)
- [006-question-set-v5-atomic-persistence.md](006-question-set-v5-atomic-persistence.md)
- [007-scheduled-monitoring-v5-snapshot-and-lease.md](007-scheduled-monitoring-v5-snapshot-and-lease.md)
