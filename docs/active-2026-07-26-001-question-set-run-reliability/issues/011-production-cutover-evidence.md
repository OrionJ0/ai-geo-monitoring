---
title: "正式切换并完成生产级可靠性验收"
status: open
type: HITL
blocked_by:
  - "001-sqlite-readiness"
  - "002-scheduled-occurrence-deduplication"
  - "003-run-record-ownership-migration"
  - "004-atomic-idempotent-run-start"
  - "005-execution-lease-fencing"
  - "006-run-reconciliation"
  - "007-history-evidence-capabilities"
  - "008-persist-analysis-only-retry"
  - "009-csv-terminal-import-validation"
  - "010-partial-report-pdf-verification"
---

# 正式切换并完成生产级可靠性验收

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-1 至 US-7

## What to build

在人工确认备份、迁移窗口和生产影响后，把正式入口硬切到新的调度时槽、原子启动、租约 fencing、关系归属和 reconcile 路径。删除旧空 run 启动链、旧任务关联事实源和隐藏 fallback，并从真实公开入口完成并发、故障、重启、历史清理、导入和 PDF 验收。

这个 issue 不重新实现前置能力，只负责生产迁移、正式切换、证据闭环和发布决策。任何未达到的门禁都必须保留 open，不得仅凭单元测试宣称完成。

## Acceptance criteria

- [ ] 人工确认生产数据库备份、迁移窗口、回滚边界和当前影响范围。
- [ ] 存量完整性审计列出完整、snapshot-only 和活跃损坏运行，不修改或伪造历史指标。
- [ ] 正式问题集运行入口只走原子幂等路径，默认配置不再指向旧实现。
- [ ] 定时执行只走持久时槽领取，旧重复调度入口和 fallback 已删除。
- [ ] 生产代码不再读写 JSON `record_ids` 作为运行事实源。
- [ ] 入口级测试证明新实现被调用、旧实现未被调用。
- [ ] 同一调度时槽并发领取实测只有一个执行、一次配额变化和一组任务。
- [ ] 相同初始运行幂等键并发提交实测只有一个 run 和一次配额预留。
- [ ] 真实进程重启证明租约恢复、迟到写入拒绝和父 run 收敛。
- [ ] 编辑项目数据后，完整历史仍可查看和重试；snapshot-only 报告正确禁用重试。
- [ ] 非法 CSV、合法终态 CSV、analysis-only 暂停恢复和 partial 操作均从真实 API/UI 通过验收。
- [ ] Chrome 真实导出 A4 PDF，并保存逐页无裁切证据。
- [ ] readiness、结构化日志和数据库不变量查询能够证明运行状态。
- [ ] README、API、部署说明和当前需求文档只推荐新正式路径；旧描述被删除或明确标记为历史退役。
- [ ] 若任一外部消费者、迁移或验证尚未完成，需求目录不得改为 closed，且必须记录剩余项、移除条件和负责人。

## Blocked by

- [001 修复 SQLite 并暴露真实 Readiness](001-sqlite-readiness.md)
- [002 实现定时计划时槽唯一领取与防重](002-scheduled-occurrence-deduplication.md)
- [003 建立运行任务归属并迁移存量数据](003-run-record-ownership-migration.md)
- [004 原子且幂等地提交问题集运行](004-atomic-idempotent-run-start.md)
- [005 增加执行租约续期与终态 Fencing](005-execution-lease-fencing.md)
- [006 统一 Reconcile 让恢复暂停和重试收敛](006-run-reconciliation.md)
- [007 保护历史证据并返回操作 Capabilities](007-history-evidence-capabilities.md)
- [008 持久化 Analysis-only 重试上下文](008-persist-analysis-only-retry.md)
- [009 收紧 CSV 导入并阻断伪运行态](009-csv-terminal-import-validation.md)
- [010 完成 Partial 交互与 PDF 像素验收](010-partial-report-pdf-verification.md)
