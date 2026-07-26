---
title: "保护历史证据并返回操作 Capabilities"
status: open
type: AFK
blocked_by:
  - "003-run-record-ownership-migration"
  - "006-run-reconciliation"
---

# 保护历史证据并返回操作 Capabilities

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-4、US-5

## What to build

把问题集运行证据从当前项目分析缓存的清理生命周期中隔离。常规问题、竞品和指标清理不得删除 run-owned 任务、原回答或指标；用户明确删除整个项目时仍沿用现有授权和级联语义。

报告服务根据来源、状态和完整性返回统一 capabilities 与 integrity。前端使用这些能力决定按钮和提示，不再展示必然返回 409 的重试操作。

## Acceptance criteria

- [ ] 常规问题编辑、竞品编辑和当前分析缓存清理不会删除 run-owned 任务、原回答和指标。
- [ ] 用户明确删除整个项目时，仍按现有权限删除其完整聚合，不产生不可达残留。
- [ ] 底层数据完整的历史报告保持可查看、可导出，并在有失败项时可重试。
- [ ] snapshot-only 旧报告保持可查看和可导出，但返回 `can_retry=false` 及稳定原因。
- [ ] 活跃运行缺少底层记录时进入可诊断失败并收敛，不无限显示 running。
- [ ] 报告返回 pause、resume、retry 的服务端 capabilities 和 integrity 摘要。
- [ ] imported 报告所有执行型 capability 均为 false。
- [ ] 前端完全依据 capabilities 显示或禁用操作，不发送已知必然失败的请求。
- [ ] 数据完整性审计证明新运行悬空引用为 0，并对每个存量损坏运行给出分类。

## Blocked by

- [003 建立运行任务归属并迁移存量数据](003-run-record-ownership-migration.md)
- [006 统一 Reconcile 让恢复暂停和重试收敛](006-run-reconciliation.md)
