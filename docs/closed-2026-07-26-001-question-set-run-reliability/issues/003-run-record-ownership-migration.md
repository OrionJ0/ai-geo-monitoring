---
title: "建立运行任务归属并迁移存量数据"
status: closed
type: AFK
blocked_by: []
---

# 建立运行任务归属并迁移存量数据

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-4

## What to build

为 native 问题集运行建立明确的任务归属和稳定槽位，使关系字段成为当前运行任务的正式事实源。迁移现有运行时，完整记录得到归属，缺失底层记录但仍有快照的报告被分类为 snapshot-only，活跃且缺失记录的运行被标识为完整性失败。

迁移不得伪造历史原始回答、指标或任务。完成后，报告、重试、暂停和恢复可以脱离 JSON ID 数组工作，为后续原子启动、清理保护和租约收敛提供基础。

## Acceptance criteria

- [x] 每个新 native run 的当前问题 × 平台槽位都有唯一稳定序号和明确 run 归属。
- [x] 重试替换当前槽位时，旧记录保留 run 审计归属，但不再占用当前槽位。
- [x] 存量完整记录按原数组顺序正确回填，不产生重复 current slot。
- [x] 底层记录缺失但终态快照存在的旧报告保持可读，并被标识为 snapshot-only。
- [x] 底层记录缺失且没有终态快照的活跃运行进入明确完整性失败分类。
- [x] 迁移前输出只读完整性统计并要求数据库备份；迁移失败可安全中止。
- [x] 报告和执行服务切换到关系字段后，不再把 JSON ID 数组作为生产事实源或 fallback。
- [x] 数据库和 API 测试覆盖完整、部分缺失、全部缺失、重复槽位和 imported 报告。
- [x] 若物理旧列不能在当前发布安全删除，必须登记迁移未完成；本次已在验证备份后安全删除旧列。

## Blocked by

None - can start immediately.

## Verification

- `node --test tests/QuestionSetRunOwnershipMigration.test.js`：3/3 通过；覆盖只读审计、完整/快照/缺失记录分类、跨运行冲突安全中止、物理旧列删除和唯一索引语义。
- 运行归属相关服务与 API 测试：`ProjectRunService` 35/35、`QuestionSetRunService` 10/10、`QuestionSetRunApi` 11/11、`PromptAnalysisCleanupService` 6/6、`ProjectDeletionService` 2/2、`QuestionSetsApi` 7/7、schema 6/6。
- `npm test`：617/617 通过，0 失败、0 跳过。
- 真实 SQLite 迁移前只读审计：15 个 native run；2 个完整、13 个 snapshot-only、195 个缺失引用、0 个重复引用、0 个归属冲突。
- 迁移前备份：`backend/backups/question-set-run-ownership-2026-07-26.sqlite`，39,161,856 字节，权限 `0600`，`PRAGMA quick_check=ok`。
- 真实迁移：更新 15 个 run、回填 66 条现存记录、删除 `question_set_runs.record_ids`；事后 `owned_records=66`、`duplicate_slots=0`、旧列数为 0。
- 报告入口抽查：run 1 仍从 4 行终态快照可读且标记 snapshot-only；run 15 返回 60 行；run 16 返回 6 行。
- 真实旧库重启首次发现 `sequelize.sync()` 先建索引导致缺列启动失败；已增加前置列迁移和回归测试。最终 `/api/ready` 返回 ready，SQLite 为 WAL / busy timeout 5000 / synchronous normal，调度器已启动。
- 生产代码搜索仅在一次性迁移服务读取 legacy `record_ids`；模型、报告、重试、暂停、恢复和正式运行入口均不再读写该列，也没有 fallback。
