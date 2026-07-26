---
title: "统一 Reconcile 让恢复暂停和重试收敛"
status: closed
type: AFK
blocked_by:
  - "005-execution-lease-fencing"
---

# 统一 Reconcile 让恢复暂停和重试收敛

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-2、US-5

## What to build

建立单一、幂等的父运行 reconcile，将任务事实收敛为父状态、`completed_at`、终态快照和 revision。正常队列排空、暂停后的在途任务排空、startup/周期 recovery、resume 发现零 pending、retry batch 结束都必须经过同一收敛入口。

报告读取继续保持只读，不能通过 GET 顺手修状态。旧执行器或旧 revision 的 finalize 不得覆盖更新后的重试结果。

## Acceptance criteria

- [x] run 仍有 pending 时只可能派生为 running 或 paused，不写终态快照。
- [x] run 没有 pending 时 reconcile 必须写入 `completed_at` 和与当前槽位一致的完整快照。
- [x] 全成功、成功失败混合和全失败分别收敛为正确终态。
- [x] pause 后最后一个在途任务结束时自动收敛；没有 pending 时不再显示无法继续的 paused。
- [x] startup 和周期 recovery 处理完过期任务后，对全部受影响 run 执行 reconcile。
- [x] resume 遇到零 pending 时清理暂停状态并立即收敛。
- [x] retry 增加 revision 后，旧 executor 的 finalize CAS 失败且不能覆盖新快照。
- [x] finalize 失败不被静默忽略，能够重试或进入告警。
- [x] 报告 GET、历史列表和导出接口不产生状态写入。
- [x] 真实进程重启测试证明子任务、父状态、completed_at、快照和错误字段一致。

## Verification

- `node --test tests/QuestionSetRunReconciliation.test.js`：12/12 通过，覆盖 pending/paused、三种正常终态、缺槽位诊断终态、暂停排空、revision fencing、retry batch 收尾、recovery 重试/拒绝、resume-zero-pending 和报告只读。
- Issue 相关回归：102/102 通过。
- `npm test`：647/647 通过。
- 真实 `backend/database.sqlite` 重启验证：临时 run 含 1 条 completed 和 1 条过期租约 pending；正式后端 startup recovery 将子任务收敛为 `failed / execution_interrupted / stale_pending_recovered`，父 run 同次写入 `completed_at`、清除 `paused_at` 并固化 2 行 partial 快照。
- 验证后已精确删除临时 run 与 2 条临时 record；剩余计数均为 0，`PRAGMA quick_check` 返回 `ok`。
- 最终正式 `/api/ready` 返回 ready，数据库为 WAL、`busy_timeout=5000`、`synchronous=NORMAL`，调度器无 recovery/reconcile 错误。

## Blocked by

- [005 增加执行租约续期与终态 Fencing](005-execution-lease-fencing.md)
