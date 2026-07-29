---
title: "建立新旧 SOV 版本边界并迁移存量数据"
status: closed
type: AFK
blocked_by: []
---

# 建立新旧 SOV 版本边界并迁移存量数据

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-3、US-6、US-7
- 重点验收：AC-010、AC-024、AC-037、AC-T06、AC-T09、AC-T13

## What to build

建立记录级指标语义版本和新 SOV 独立存储边界，并提供可审计、幂等的存量数据迁移。历史旧 SOV 必须保留原值和原名称，只能通过版本化历史读取能力展示；迁移不得重算或重新解释旧结果。

## Acceptance criteria

- [x] 指标、任务、问题集运行和报告快照能够保存明确的指标语义版本，新 SOV 使用独立值、分子、分母和竞争实体证据字段。
- [x] 新记录可以将旧 `share_of_voice` 保持为空，存量旧记录全部标记为历史竞品配置口径且原值不变。
- [x] 提供只读审计与正式迁移入口，重复执行、中断后重试以及 SQLite/Postgres 场景均满足幂等性。
- [x] 迁移前后旧 SOV 的记录数量、记录标识和值摘要一致；迁移不生成新版 SOV。
- [x] 历史读取返回版本化 SOV 表达，无法恢复的旧分子、分母保持为空，不做反推。
- [x] 自动化测试覆盖全新数据库、旧库迁移、重复迁移、未知旧分析版本和数据库重启。

## Blocked by

None - can start immediately.

## Verification

- `node --test tests/GeoMetricSemanticsMigration.test.js`
- `node --test tests/GeoMetricSemanticsService.test.js`
- `node --test tests/AIPlatformRecordSchema.test.js`
- 一次性 PostgreSQL 16：`GeoMetricSemanticsPostgres.test.js`
- `npm test`：828 个后端测试全部通过。
- 本地旧 `backend/database.sqlite` 已先备份到 Git 忽略的 `backend/database.pre-geo-metric-20260729.sqlite`，迁移后只读审计为 `migration_required=false`，`PRAGMA quick_check=ok`。
- 从真实 `node app.js` 入口启动后，`GET /api/ready` 返回 `ready`；验证后进程已停止。
