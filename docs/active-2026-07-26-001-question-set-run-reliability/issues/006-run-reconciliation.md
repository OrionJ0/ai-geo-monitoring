---
title: "统一 Reconcile 让恢复暂停和重试收敛"
status: open
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

- [ ] run 仍有 pending 时只可能派生为 running 或 paused，不写终态快照。
- [ ] run 没有 pending 时 reconcile 必须写入 `completed_at` 和与当前槽位一致的完整快照。
- [ ] 全成功、成功失败混合和全失败分别收敛为正确终态。
- [ ] pause 后最后一个在途任务结束时自动收敛；没有 pending 时不再显示无法继续的 paused。
- [ ] startup 和周期 recovery 处理完过期任务后，对全部受影响 run 执行 reconcile。
- [ ] resume 遇到零 pending 时清理暂停状态并立即收敛。
- [ ] retry 增加 revision 后，旧 executor 的 finalize CAS 失败且不能覆盖新快照。
- [ ] finalize 失败不被静默忽略，能够重试或进入告警。
- [ ] 报告 GET、历史列表和导出接口不产生状态写入。
- [ ] 真实进程重启测试证明子任务、父状态、completed_at、快照和错误字段一致。

## Blocked by

- [005 增加执行租约续期与终态 Fencing](005-execution-lease-fencing.md)
