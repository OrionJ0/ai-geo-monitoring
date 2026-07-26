---
title: "增加执行租约续期与终态 Fencing"
status: closed
type: AFK
blocked_by:
  - "003-run-record-ownership-migration"
---

# 增加执行租约续期与终态 Fencing

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-2

## What to build

把当前一次性 execution token 升级为带所有者、过期时间和 heartbeat 的执行租约。任务只有在原子领取成功后才能调用外部平台或分析 API；ResultDetail、指标和任务终态必须在一个短事务中携带当前 token 提交。

恢复器回收租约后，旧 worker 的迟到成功或失败写入必须被拒绝。成功路径同时清除旧错误，消除 `completed` 与中断错误并存的矛盾数据。

## Acceptance criteria

- [x] pending 任务通过原子条件取得唯一 token、owner 和 expires_at。
- [x] 租约时长根据完整执行预算设置，长任务在有效执行期间按约定周期续租。
- [x] 活跃且持续续租的任务不会被 startup 或周期 recovery 回收。
- [x] ResultDetail、VisibilityMetric 和 QuestionRecord 终态在同一短事务提交。
- [x] 所有 worker 终态更新都要求当前 execution token；token 不匹配时整体拒绝本次产物。
- [x] 恢复器先回收、旧 worker 后提交的测试中，旧 worker 无法改变状态、指标或 run revision。
- [x] 成功任务清空旧 error message，失败任务保留稳定失败阶段和安全错误码。
- [x] 已过期且可能已经调用外部平台的任务不会被自动再次调用平台，而是进入可诊断、可人工重试状态。
- [x] 租约领取、续租失败和迟到写入拒绝均有结构化、无敏感信息的观测证据。

## Verification

- `node --test tests/QuestionRecordLeaseFencing.test.js`：8/8 通过，覆盖领取、预算化 TTL、续租、恢复、事务终态和迟到 worker fencing。
- Issue 相关回归：114/114 通过，覆盖项目运行、定时运行、检测入口、问题集报告与调度时槽。
- `npm test`：635/635 通过。
- 真实 `backend/database.sqlite` 启动恢复验证：构造一条已过期租约后重启正式后端，startup recovery 将其收敛为 `failed`，清除 token、owner、started_at、expires_at，并写入 `execution_interrupted` / `stale_pending_recovered`；验证后已删除该合成记录，`PRAGMA quick_check` 返回 `ok`。
- 正式 `/api/ready` 返回 ready，数据库确认 `journal_mode=wal`、`busy_timeout=5000`、`synchronous=NORMAL`，调度器已启动。

## Blocked by

- [003 建立运行任务归属并迁移存量数据](003-run-record-ownership-migration.md)
