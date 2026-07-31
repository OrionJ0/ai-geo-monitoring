---
title: "正式切换并完成运行 #3 生产验收"
status: closed
type: HITL
blocked_by:
  - 001-observable-run-control.md
  - 002-structured-answer-citations.md
  - 003-retrieval-candidate-quality.md
  - 004-analysis-evidence-normalization.md
---

# 正式切换并完成运行 #3 生产验收

## Parent

- `../TECH-SPEC.md` U5
- 覆盖 AC-011、AC-013 及全部前置验收标准的正式入口证明

## What to build

把前四个 issue 的实现接入唯一正式问题集报告和 Web 采集入口，完成全量自动化、真实浏览器和生产发布门禁。发布前备份生产数据，使用项目规定的 Git Bundle 和 systemd 流程部署；确认后仅对运行 #3 的两条结构化分析失败记录执行幂等 analysis-only 重试，不伪造或重写其存量原回答。

## Acceptance criteria

- [x] 后端全量测试、前端 Node 回归、lint、类型检查和生产构建全部通过。
- [x] 真实公开入口证明暂停后不再领取排队任务、重复继续不产生重复平台调用，且执行状态文案与数量一致。
- [x] DeepSeek Web 与豆包 Web 的新回答结构、显式引用、检索候选和分析诊断均从真实报告页面通过验收。
- [x] 发布前完成 SQLite 在线备份和完整性检查；服务器源码只通过本地提交、推送、Git Bundle 快进和正式部署入口更新。
- [x] 部署前后核对服务器 Git 状态、systemd 服务、readiness 和两个受管 Chrome 会话，不启动第二套 Node 进程。
- [x] 运行 #3 的失败项只做 analysis-only 重试，不生成新 Web capture、不扣监测配额；存量纯文本回答保持不变。
- [x] 新实现成为正式默认路径，旧任意 JSON URL 递归抓取和非幂等恢复不再被调用，相关当前文档同步更新。

## Blocked by

- `001-observable-run-control.md`
- `002-structured-answer-citations.md`
- `003-retrieval-candidate-quality.md`
- `004-analysis-evidence-normalization.md`

## Acceptance evidence

- 正式实现提交：`d84c0f3`、`8538a00`、`eb4984c`、`2b6f60a`、`ba5e0b7`；每次均通过 Git Bundle 快进和仓库正式部署入口发布，未直接编辑服务器源码。
- 自动化门禁：后端 977 / 977、市场监测 95 / 95、前端监测 Node 29 / 29、Playwright 2 / 2；lint 0 error（1 条既有 `<img>` warning），生产构建 36 个路由。
- 运行 #3：2 条失败项只走 analysis-only，`full_monitoring_count=0`、`quota_consumed=0`，原始回答与证据未改写；最终 10 / 10 完成、分析覆盖率 100%。
- 运行 #4：暂停后不再领取排队任务，已领取任务完成后显示“运行已暂停”；继续只领取剩余项，没有重复记录或重复平台调用。
- 运行 #7：豆包保存约 3000 字完整 Markdown 和 6 条显式引用；单条分析重试保持回答哈希、长度与引用不变，最终 3 / 3 完成、分析覆盖率 100%。
- 生产运行时：后端与前端 systemd 服务 active，readiness 正常，SQLite `quick_check` 通过，DeepSeek 与豆包使用两个独立受管 Chrome profile。
