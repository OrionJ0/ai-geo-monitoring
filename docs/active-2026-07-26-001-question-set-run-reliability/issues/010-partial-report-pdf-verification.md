---
title: "完成 Partial 交互与 PDF 像素验收"
status: open
type: AFK
blocked_by:
  - "006-run-reconciliation"
  - "007-history-evidence-capabilities"
  - "009-csv-terminal-import-validation"
---

# 完成 Partial 交互与 PDF 像素验收

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-5、US-7

## What to build

让 partial、snapshot-only 和 imported 报告向用户展示一致、可操作的状态。报告顶部需要显示完成、失败、待处理数量和失败阶段摘要；按钮完全依赖服务端 capabilities。

同时修复 PDF 模式的宽度预算。交互型展开控件不得挤占 A4 内容区，长问题、长平台名和多页明细必须通过真实浏览器导出及逐页像素检查。

## Acceptance criteria

- [ ] partial 报告明确显示完成、失败、待处理数量和主要失败阶段。
- [ ] 可重试 partial 提供重试入口；不可重试报告展示稳定原因而非可点击失败按钮。
- [ ] snapshot-only 和 imported 标签、说明与 capabilities 一致。
- [ ] running、paused、partial、completed、failed 的提示不会互相矛盾。
- [ ] PDF 模式的显式列宽与附加列总和不超过实际内容宽度。
- [ ] PDF 不渲染交互型展开列；原回答和诊断以适合打印的静态内容输出。
- [ ] 长中文问题、长平台名、全部指标列和两页以上报告均能完整导出。
- [ ] A4 PDF 不打开系统打印对话框，不包含导航和操作区。
- [ ] Chrome 真实导出后逐页渲染，最右列、右边界、分页和换行像素验收通过。
- [ ] 前端自动化测试覆盖 capabilities、partial 摘要、imported 只读和 PDF 宽度预算。

## Blocked by

- [006 统一 Reconcile 让恢复暂停和重试收敛](006-run-reconciliation.md)
- [007 保护历史证据并返回操作 Capabilities](007-history-evidence-capabilities.md)
- [009 收紧 CSV 导入并阻断伪运行态](009-csv-terminal-import-validation.md)
