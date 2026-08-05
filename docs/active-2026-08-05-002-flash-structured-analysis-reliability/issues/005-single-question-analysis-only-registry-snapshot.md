---
title: "接入单问题与 analysis-only 不可变快照"
status: closed
type: AFK
blocked_by:
  - "003-competitor-registry-resolver-and-request-invariance.md"
  - "004-field-level-semantics-and-scoped-sov.md"
---

# 接入单问题与 analysis-only 不可变快照

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## What to build

让单问题候选运行完整保存 v5 三轨结构、注册表快照身份和分阶段诊断，并让 analysis-only 严格重放原记录的回答、引用与注册表快照。竞品表在原运行后发生变化时，历史重试结果不能读取实时配置而漂移。

该切片保持现有事务原子性和监测配额边界：外部模型调用不进入数据库事务；结构与完成状态在同一事务落库；analysis-only 不重新访问豆包、DeepSeek Web 等监测平台。

## Acceptance criteria

- [x] 单问题候选运行保存稳定的注册表快照版本、哈希、条目数量、每实体匹配状态和完整 v5 状态结构。`createTargetRecord` v5 冻结 `competitor_snapshot` 与 `ai_structured_v5`/scoped SOV 契约；v5 分析器输出 `competitor_registry_snapshot`（version/sha256/entry_count）与逐实体 `registry_match`（issue 003/004）。
- [x] analysis-only 复用原回答哈希、引用、平台证据和原注册表快照，不访问监测平台、不消耗监测配额。`resolveFrozenSnapshot` 优先复用原记录 `competitor_snapshot`；analysis-only 从既有 `ResultDetail` 读取原回答（现役机制保持），不触发网页采集。
- [x] 原运行后修改竞品表再执行 analysis-only，仍使用原快照；新建运行使用新快照和新哈希。`resolveFrozenSnapshot` 测试证明记录快照优先于实时竞品实例，快照 sha256 由 entry 内容确定。
- [x] 对相同回答，新旧注册表快照不会改变阶段 1 或阶段 2 请求体，只能改变最终回接的身份元数据。issue 003 请求不变性测试覆盖，快照只附加 `registry_match`。
- [x] 模型调用、指标写入和记录完成保持既有事务边界；事务或租约失败不会留下半条 v5 指标。`runInTransaction`/`persistVisibilityMetric`/`updateRecordTerminalState` 原子边界保持，v5 分析器不落入事务（CON-001）。
- [x] 单问题候选失败时保存有界诊断和完整原回答，且不会静默调用 v4、Pro 或监测平台。`metricFailureDiagnostics` 识别 `AIResponseAnalysisV5Error` 并输出分阶段诊断；v5 分析器无 fallback；`failRecord` 保留原回答供 analysis-only 重试。

## Implementation notes

- 新增 V5 契约常量 `V5_ANALYSIS_CONTRACT`/`V5_STRUCTURE_VERSION`（GeoMetricSemanticsService），`CURRENT_ANALYSIS_PROVIDER='v4'` 默认保持现役，`analysisProvider='v5'` 为候选。
- `QuestionRecord` 新增 `competitor_snapshot` 列；新增 `V5SnapshotMigrationService` + `migrateV5SnapshotFields.js` additive 迁移（只增列）。
- `ProjectRunService`：`resolveAnalysisContract`/`resolveMetricSemantics`/`normalizeCompetitorSnapshot`/`resolveFrozenSnapshot`；`createTargetRecord`/`runTarget`/`finalizeSuccessfulRecord`/`buildVisibilityMetricPayload` 支持 provider 与快照；重试记录创建复制原记录契约与快照；`metricFailureDiagnostics`/`metricFailureMessage` 支持 v5 错误。
- 新增 `backend/tests/V5ProjectRunIntegration.test.js`（8 用例）。全量 1075 后端测试通过。

## Blocked by

- [003-competitor-registry-resolver-and-request-invariance.md](003-competitor-registry-resolver-and-request-invariance.md)
- [004-field-level-semantics-and-scoped-sov.md](004-field-level-semantics-and-scoped-sov.md)
