---
title: "实现定时计划时槽唯一领取与防重"
status: closed
type: AFK
blocked_by:
  - "001-sqlite-readiness"
---

# 实现定时计划时槽唯一领取与防重

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-1、US-6

## What to build

为每个定时计划的到期时槽建立持久执行账本，并同时提供进程内 single-flight 与数据库级唯一领取。取得持久时槽所有权后才能创建任务、消耗配额和调用平台；长执行跨越后续 interval 时不得被重复拾取。

该账本表达一次调度执行，不改变问题集报告模型。执行成功、失败或进程退出后都应留下可查询、可恢复、可告警的状态。

## Acceptance criteria

- [x] 同一个进程中的前一轮 tick 未结束时，后续 tick 不会并行进入扫描和执行。
- [x] 同一计划、同一到期时槽只能存在一个有效执行实例。
- [x] 两个进程同时领取同一时槽时，只有一个进程取得执行权；唯一冲突被视为已由其他执行器领取。
- [x] `next_run_at` 的推进与时槽实例创建处于同一事务，不会出现重复领取窗口。
- [x] 执行时长超过 30 秒或多个 interval 后，平台调用、任务批次和配额变化仍只有一份。
- [x] 进程在取得时槽后退出时，执行实例保持可诊断，并能按恢复规则进入明确终态。
- [x] 项目级监测和单问题计划分别使用自己的 schedule kind，不被错误包装为问题集运行。
- [x] SQLite 和 Postgres 都通过同一时槽并发领取测试。
- [x] 可观测数据包含领取成功、重复领取被拒绝、执行终态和最近错误。

## Blocked by

- [001 修复 SQLite 并暴露真实 Readiness](001-sqlite-readiness.md)

## Verification

- `node --test tests/ScheduledExecutionClaim.test.js`：7/7 通过；包含 SQLite 文件数据库双实例竞争、事务回滚、长任务重入、崩溃恢复与独立 schedule kind。
- `POSTGRES_TEST_URL=... npm run test:postgres:scheduler`：1/1 通过；使用一次性 PostgreSQL 15 容器完成真实双连接唯一领取，容器验证后已停止并自动删除。
- `node --test tests/SchedulerService.test.js`：21/21 通过。
- `node --test tests/AIPlatformRecordSchema.test.js`：5/5 通过。
- `npm test`：611/611 通过，0 失败、0 跳过。
- TDD 红灯证据包括：并发 tick 首次得到 `2 !== 1`、账本表首次不存在、双调度器长任务首次平台调用计数为 0、恢复方法首次不存在、记录首次缺少 `scheduled_execution_id`。
- `/api/ready` 已暴露领取成功、重复/过期领取、执行终态和最近错误计数；调度记录通过 `scheduled_execution_id` 关联所属执行时槽。
