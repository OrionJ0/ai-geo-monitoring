---
title: "正式发布与真实入口验收"
status: open
type: HITL
blocked_by:
  - "003-period-comparison.md"
  - "004-tongji-report-source.md"
  - "005-website-form-report-source.md"
  - "006-search-term-data-minimization.md"
  - "007-run-reliability.md"
  - "008-retry-rerun-cancel.md"
  - "009-immutable-report-history.md"
---

# 正式发布与真实入口验收

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- [ADR 0001](../../adr/0001-marketing-funnel-data-source-of-truth.md)
- [ADR 0002](../../adr/0002-marketing-ai-analysis-read-only-tool-boundary.md)
- [ADR 0003](../../adr/0003-versioned-chart-intent-for-frozen-marketing-ai-reports.md)
- [ADR 0004](../../adr/0004-minimized-search-term-sample-for-marketing-ai-reports.md)

## What to build

完成营销数据 AI 分析的发布门禁、生产配置、迁移、正式入口切换和真实项目验收。发布必须使用项目规定的正式 Git Bundle 与 systemd 流程，在当前唯一正式域名中证明导航、创建运行、真实来源读取、结构化模型生成、报告刷新、历史和删除实际走新模块。

本切片需要人工提供或确认生产营销 AI 配置、发布窗口和真实项目范围，因此属于 HITL。验收必须逐来源记录生产状态，不能用 fixture、旧缓存或本地实现推断生产已经接通；未完成时需求目录不得关闭，也不得称为正式生效。

## Acceptance criteria

- [ ] 后端和前端完整自动化测试、静态检查、正式构建、SQLite/PostgreSQL 迁移审计及回滚准备全部通过并留存摘要。
- [ ] 生产营销 AI 配置经管理员人工确认，凭据只存在于受保护的服务端配置或密文存储，不进入仓库、浏览器、日志或验收材料。
- [ ] 正式部署只通过项目批准的 Git Bundle 与 systemd 入口完成，不直接编辑服务器源码，也不并行启动第二套前后端进程。
- [ ] 从 `https://insight.guangtuo.com` 登录后可进入“营销数据 AI 分析”，创建运行并观察其走新执行器、固定 Evidence 和结构化报告路径。
- [ ] 真实运行分别记录百度广告、百度统计和官网表单的生产覆盖、取数时间与失败状态；未接入的 53KF、线索和订单保持诚实缺失。
- [ ] 生产证据证明新运行没有使用主看板旧广告快照、缓存 FALLBACK、Agent、模型工具、联网搜索或 GEO `ai_structured_v4` 分析路径。
- [ ] 从真实入口验证默认和自选周期、同项目防重、离页恢复、部分覆盖、失败重试、重新运行、取消、当前报告、历史查看和删除回退。
- [ ] 生成报告后改变来源数据或当前模型配置，旧报告的数值、文字和图表仍保持生成时内容。
- [ ] 数据库与日志抽查证明只保存固定有界证据、最终报告和轻量调用元数据，不保存完整 Prompt、模型原始响应、上游报文、聊天历史或敏感搜索词。
- [ ] 页面完成桌面、移动端、键盘、焦点、状态播报、图表等价表格和无敏感信息泄漏的真实浏览器验收。
- [ ] README、CONTEXT、API、部署文档、文档索引和需求状态准确区分本地实现、默认入口、生产配置及真实验收；只有全部门禁通过后才将需求目录关闭。

## Blocked by

- [003-period-comparison.md](003-period-comparison.md)
- [004-tongji-report-source.md](004-tongji-report-source.md)
- [005-website-form-report-source.md](005-website-form-report-source.md)
- [006-search-term-data-minimization.md](006-search-term-data-minimization.md)
- [007-run-reliability.md](007-run-reliability.md)
- [008-retry-rerun-cancel.md](008-retry-rerun-cancel.md)
- [009-immutable-report-history.md](009-immutable-report-history.md)
