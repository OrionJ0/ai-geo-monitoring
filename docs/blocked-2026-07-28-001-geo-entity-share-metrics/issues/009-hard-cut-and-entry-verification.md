---
title: "硬切正式入口并退役旧运行逻辑"
status: blocked
type: HITL
blocked_by:
  - "001-version-and-migration.md"
  - "002-single-answer-v3-sov.md"
  - "003-analysis-failure-and-coverage.md"
  - "004-question-set-report-and-csv.md"
  - "005-project-dashboard-platform-view.md"
  - "006-project-report-platform-snapshot.md"
  - "007-consumer-semantics-and-alerts.md"
  - "008-offline-human-baseline.md"
---

# 硬切正式入口并退役旧运行逻辑

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-1 至 US-7
- 重点验收：AC-010、AC-021、AC-022、AC-025、AC-032 至 AC-038、AC-T01、AC-T06、AC-T11 至 AC-T14

## What to build

在完成迁移审计、人工基线和全部消费者升级后，将新版分析与指标语义设为单问题、问题集、自动监测和 analysis-only 重试的唯一正式路径。删除旧运行时分析、旧配置竞品 SOV 计算、静默截断、隐藏开关和 fallback，并通过真实入口证据证明切换完成。

## Acceptance criteria

- [x] 人工确认数据库备份、迁移审计结果和至少一个可用分析平台。
- [x] 单问题、问题集、自动监测和 analysis-only 重试生成的新记录全部使用新版契约和指标语义。
- [x] 新分析失败不会调用旧分析器、旧 SOV、截断输入或分段计算。
- [x] 旧运行时代码、旧配置竞品计算、无版本正式消费者和误导文档已经删除；历史读取适配器仍能读取旧结果。
- [x] 代码搜索证明旧符号只存在于迁移、历史只读适配器、旧 fixture 或明确标注的历史文档。
- [ ] 真实入口证据覆盖采集、AI 分析、程序计算、项目看板、项目报告、问题集报告、PDF、CSV、告警和洞察。
- [x] 后端测试、前端测试、lint、build、数据库迁移演练和健康检查全部通过。
- [x] README、CONTEXT、API 和文档索引明确当前正式口径、非品牌词问题规范和人工比较基线规则。

## Blocked by

- [001-version-and-migration.md](001-version-and-migration.md)
- [002-single-answer-v3-sov.md](002-single-answer-v3-sov.md)
- [003-analysis-failure-and-coverage.md](003-analysis-failure-and-coverage.md)
- [004-question-set-report-and-csv.md](004-question-set-report-and-csv.md)
- [005-project-dashboard-platform-view.md](005-project-dashboard-platform-view.md)
- [006-project-report-platform-snapshot.md](006-project-report-platform-snapshot.md)
- [007-consumer-semantics-and-alerts.md](007-consumer-semantics-and-alerts.md)
- [008-offline-human-baseline.md](008-offline-human-baseline.md)

## Verification progress

- 本地正式 SQLite 已完成“独立备份 → 迁移 → 只读审计 → `node app.js` 启动 → `/api/ready`”链路，备份和数据库完整性检查均为 `ok`。
- 同一份 2,677 字真实千问回答曾使用 `qwen3.7-plus` 首次分析成功：52.604 秒，16 个企业实体与 16 条关系完整对应；该记录只作为历史证据，不再是当前正式分析配置。
- 2026-07-29 再次执行正式库只读审计，结果为 `migration_required=false`、缺失列 0、未版本化记录 0；正式库和备份的 `PRAGMA quick_check` 均为 `ok`。
- 该 v3 验收阶段的分析配置已硬切为 `deepseek/deepseek-v4-pro`、`choice_set_few_shot_v1` 与高强度思考，不再使用千问进行结构化分析；旧提示词和关闭思考分支已删除。DeepSeek Pro 连接测试成功，本地设置页展示 `thinking=enabled`、`reasoning_effort=high`、实际请求参数和 `token_limit: null`。当前 v4 切换由 `../../blocked-2026-07-29-002-ai-semantic-analysis-quality/` 继续验收。
- 同日通过生产配置执行 40 条真实回答全量刷新：40/40 成功，38 条首次通过，S06、S39 经一次定向重试后成功，无效输出失败率为 0%；请求始终提交当前问题和完整原回答，没有应用层 Token 上限、截断、分段或旧分析器回退。
- 用户已确认接受正式数据库备份、迁移审计和分析平台可用性证据；`human_review_confirmed` 已设为 `yes`，正式 `BASELINE-REPORT.md` 已更新，Issue 008 已关闭。
- v3 生产配置入口执行真实基线样本 S01，缓存证据记录 `analysis_prompt_revision=choice_set_few_shot_v1`、`analysis_model=deepseek-v4-pro`、首次分析成功且目标排名为 1；该阶段基线缓存会拒绝缺少对应提示词修订号的旧结果。
- 硬切后的生产配置全量刷新为 40/40 成功；10 条多实体全部可计算，错误排除 8，SOV MAE 0.51pp，聚合偏差 -0.06pp。榜单一致率 25%、情绪一致率 80% 作为剩余质量限制记录，不影响本 issue 继续等待目标 VM 的真实消费者入口验收。
- 后端 833/833、前端 260/260、部署 11/11、ESLint 和生产构建全部通过；管理员真实登录设置页后确认 DeepSeek Pro、实际请求 JSON、无 Token 上限和临时结构化测试均可用。
- 仍待在目标 VM 覆盖看板、项目报告、问题集报告、PDF、CSV、告警和洞察的真实入口验收；因此本 issue 完成文档更新后仍保持 `blocked`，不宣称生产发布完成。

## Verification

- `GeoRuntimeHardCut.test.js` 证明正式分析器只有 v3 完整输入路径，新记录固定写当前版本，旧 SOV 字段只写空值。
- 已删除 `ProjectMetricsService` 中没有生产调用的旧 `summarize / buildDashboardSummary / buildPromptCoverage / buildPromptPerformance / buildTrend` 聚合器及其旧测试。
- 单问题与问题集原子启动、项目终态生成、自动调度共用终态服务、analysis-only 重试、报告、CSV、告警和洞察均有行为或入口策略测试。
- SQLite 真实旧库副本完成审计、迁移、复审和幂等重跑：70 条旧 SOV 的数量与 SHA-256 校验和 `4038f2e...621f8` 前后一致，`quick_check=ok`，迁移后无缺列、无未版本化项目记录。
- PostgreSQL 16 迁移分支已在 Issue 001 通过真实集成测试；本次收口环境未提供 `POSTGRES_TEST_URL`，未重复执行。
- 迁移后数据库副本启动生产模式服务，`/api/health` 返回 `OK`，`/api/ready` 返回 `ready`，SQLite 为 WAL、`busy_timeout=5000`、`synchronous=normal`，调度器已启动且无恢复错误。
- `npm test`（backend）：822/822 通过。
- `node --test src/utils/*.test.cjs src/utils/*.test.mjs`：256/256 通过。
- 前端 ESLint 与 `npm run build`：通过。

## Blockers

1. 从真实单问题、问题集、自动监测和 analysis-only 重试入口产生新记录，并完成页面、PDF、CSV、告警和洞察的最终证据核对。
