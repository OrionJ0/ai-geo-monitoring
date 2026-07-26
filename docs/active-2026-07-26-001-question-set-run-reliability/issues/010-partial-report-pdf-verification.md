---
title: "完成 Partial 交互与 PDF 像素验收"
status: closed
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

- [x] partial 报告明确显示完成、失败、待处理数量和主要失败阶段。
- [x] 可重试 partial 提供重试入口；不可重试报告展示稳定原因而非可点击失败按钮。
- [x] snapshot-only 和 imported 标签、说明与 capabilities 一致。
- [x] running、paused、partial、completed、failed 的提示不会互相矛盾。
- [x] PDF 模式的显式列宽与附加列总和不超过实际内容宽度。
- [x] PDF 不渲染交互型展开列；原回答和诊断以适合打印的静态内容输出。
- [x] 长中文问题、长平台名、全部指标列和两页以上报告均能完整导出。
- [x] A4 PDF 不打开系统打印对话框，不包含导航和操作区。
- [x] Chrome 真实导出后逐页渲染，最右列、右边界、分页和换行像素验收通过。
- [x] 前端自动化测试覆盖 capabilities、partial 摘要、imported 只读和 PDF 宽度预算。

## Verification

- 报告 API 新增 `execution_summary.failure_stages`；专项服务测试验证 1 条完成、1 条失败会聚合为 `analysis_validation: 1`。
- 页面通过单一 `getRunStateNotice` 派生 running、paused、partial、completed、failed、snapshot-only 和 imported 说明，避免状态文案与 capabilities 分叉。
- Chrome 真实打开 run #15：页面显示“已完成 55 条，失败 5 条，待处理 0 条”“结构化分析校验 5 条”，并显示可执行的“重试失败项（5）”。
- Chrome 真实打开 snapshot-only run #14：显示“仅快照”和不可重试原因，不渲染重试按钮。
- PDF 纸张容器实测 980px，表格内容 922px，七个显式列预算 880px；导出态展开控件为 0、静态详情为 6、操作区不可见。
- 首轮像素检查发现长回答在第 10→11 页交界切过文字行；增加 PDF 专用文本换行边界后重新导出，交界改为完整逻辑行之间分页。
- 最终 Chrome 下载文件为 11 页 A4、2.7MB；Poppler 逐页渲染为 993×1404 PNG，11/11 页左右 12px 边缘非白像素均为 0，最右“情绪”列完整。
- 证据：
  - `output/pdf/issue-010-question-set-report.pdf`
  - `output/playwright/issue-010-pdf-layout.png`
  - `output/playwright/issue-010-partial-run-15.png`
  - `output/playwright/issue-010-snapshot-run-14.png`
- 本 issue 专项前端测试 20/20、后端完整回归 663/663、TypeScript、ESLint（0 error）和 Webpack 生产构建通过。
- 前端全量 Node 测试 202/203；唯一失败是既有 `devServerConfig.test.mjs` 仍期待 `next dev -p 3001`，而当前正式脚本和文档均为 `next dev -H 0.0.0.0 -p 3001`。该发布门禁漂移交由 Issue 011 收口，不影响本 issue 的状态/PDF验收结论。

## Blocked by

- [006 统一 Reconcile 让恢复暂停和重试收敛](006-run-reconciliation.md)
- [007 保护历史证据并返回操作 Capabilities](007-history-evidence-capabilities.md)
- [009 收紧 CSV 导入并阻断伪运行态](009-csv-terminal-import-validation.md)
