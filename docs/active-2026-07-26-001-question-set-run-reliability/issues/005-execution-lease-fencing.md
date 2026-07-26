---
title: "增加执行租约续期与终态 Fencing"
status: open
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

- [ ] pending 任务通过原子条件取得唯一 token、owner 和 expires_at。
- [ ] 租约时长根据完整执行预算设置，长任务在有效执行期间按约定周期续租。
- [ ] 活跃且持续续租的任务不会被 startup 或周期 recovery 回收。
- [ ] ResultDetail、VisibilityMetric 和 QuestionRecord 终态在同一短事务提交。
- [ ] 所有 worker 终态更新都要求当前 execution token；token 不匹配时整体拒绝本次产物。
- [ ] 恢复器先回收、旧 worker 后提交的测试中，旧 worker 无法改变状态、指标或 run revision。
- [ ] 成功任务清空旧 error message，失败任务保留稳定失败阶段和安全错误码。
- [ ] 已过期且可能已经调用外部平台的任务不会被自动再次调用平台，而是进入可诊断、可人工重试状态。
- [ ] 租约领取、续租失败和迟到写入拒绝均有结构化、无敏感信息的观测证据。

## Blocked by

- [003 建立运行任务归属并迁移存量数据](003-run-record-ownership-migration.md)
