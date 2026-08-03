---
title: "拦截采集过渡态并实施 evidence 字段级修复"
status: closed
type: bugfix
blocked_by: []
---

# 拦截采集过渡态并实施 evidence 字段级修复

## Parent

- `../TECH-SPEC.md` 14
- 覆盖 REQ-016 至 REQ-020、AC-014 至 AC-018

## What to build

统一识别豆包搜索状态、资料摘要和计划文本，在进入结构化分析前将其标记为“采集无效”；历史报告只读识别相同数据并从分析覆盖率及全部品牌指标中排除。对表格组合 evidence 增加不放宽校验的确定性锚定；仍失败时只修复失败 evidence 字段，不重新生成完整 JSON。

## Acceptance criteria

- [x] 豆包 adapter 不会把已知搜索、资料摘要或计划块保存为最终回答。
- [x] 正式执行链在分析调用前写入 `web_capture_invalid_answer`，保留原始采集证据且不生成品牌指标。
- [x] 历史记录读取时标记 `capture_quality.status=invalid`，单独计数且不进入分析覆盖率分母。
- [x] 项目和问题集聚合都排除采集无效记录；存量异常指标也不能污染品牌、情绪、SOV 或引用指标。
- [x] 表格组合 evidence 只有在全部单元逐字可定位时才确定性拆分；不得丢弃错误单元后通过。
- [x] evidence 二次请求只包含失败字段，响应仅允许字段补丁；未知、重复、缺失和无法定位的 evidence 继续失败。
- [x] 后端 988 / 988、本次前端报告页 18 / 18、lint 和生产构建通过。
- [x] 发布门禁发现的既有营销前端契约缺口已用只读边界文案最小修复，营销测试 29 / 29。
- [x] 发布浏览器门禁发现的导航分组标题对比度问题已修复，并增加颜色契约测试；axe 入口回归仍作为发布必过项。
- [x] 使用生产 `deepseek-v4-flash`、关闭思考模式完成 20 条真实样本验证，20 / 20（100%）通过；3 条采集无效在分析前排除，4 条仅修复失败 evidence 字段。
- [x] 通过 Git Bundle 和正式部署入口发布至 `6820ac3`，公开报告入口、systemd/readiness 与豆包 `doubao-web-v3` 实时预检通过复核。

## Root cause evidence

- 生产记录 39：截图停留在“正在搜索”，生成停止按钮仍存在。
- 生产记录 45：截图只有“搜索 1 个关键词，参考 6 篇资料”和搜索链接，生成停止按钮仍存在。
- 生产记录 51：截图只有“我将梳理……为后续……做准备”的计划块，生成停止按钮仍存在。
- 生产记录 54：同一豆包账号随后生成完整表格回答，说明前三条是采集提前完成，不是平台拒答或账号失效。

## Verification evidence

- `backend/tests/DoubaoWebAdapter.test.js`
- `backend/tests/ProjectRunService.test.js`
- `backend/tests/QuestionSetRunService.test.js`
- `backend/tests/ProjectMetricsService.test.js`
- `backend/tests/AIResponseAnalysisV4.test.js`
- `nextjs-frontend/src/utils/questionSetReportPage.test.cjs`

## Release boundary

- 当前唯一正式入口已使用本 issue 的新代码，分析默认路径为 DeepSeek API `deepseek-v4-flash`，思考模式和 Web 搜索关闭。
- 旧的过渡态直入分析路径和 evidence 整份 JSON 重试路径已从正式调用链移除，没有保留静默 fallback；历史异常仅在报告读取时按相同采集质量规则只读归类。
- 入口级证据：正式部署全门禁通过、公开 readiness/报告 HTTP 通过、运行 #3 报告 10 / 10 有效分析、Flash benchmark 20 / 20、豆包实时预检 ready。
