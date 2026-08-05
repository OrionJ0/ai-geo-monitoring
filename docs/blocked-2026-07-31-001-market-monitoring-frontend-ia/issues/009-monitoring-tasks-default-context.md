---
title: "监测任务自动项目上下文"
status: closed
type: AFK
blocked_by:
  - "001-default-market-project.md"
  - "002-workspace-navigation-and-entry.md"
---

# 监测任务自动项目上下文

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-005

## What to build

让问题库、运行报告和适用的告警页面自动使用默认监控项目，同时保留问题创建、问题集运行、报告深链、导入导出、重试和告警管理的完整行为。

项目上下文变化或异步请求晚到时，旧项目响应不得污染当前页面。默认项目不可用时，不得创建任务、消费配额或执行跨项目写操作。

## Acceptance criteria

- [x] 问题库无需项目选择即可加载、创建、编辑和运行默认项目的问题。
- [x] 问题集运行和单问题运行继续生成正确的独立报告。
- [x] 运行报告保留 `run_id` 深链、导入、导出、重试、暂停和恢复能力。
- [x] 历史链接中的项目参数不能绕过默认项目和权限边界。
- [x] 告警页面使用默认项目完成读取和CRUD，且不改变现有GEO告警语义。
- [x] 默认项目变化时，旧筛选、选中项和生成中的建议按现有安全规则清理。
- [x] 晚到请求结果不会写入新的项目上下文。
- [x] 无默认项目时不创建任务、不消费配额、不执行写操作。
- [x] 问题库、运行报告和告警的现有回归测试继续通过。

## Blocked by

- [001-default-market-project.md](001-default-market-project.md)
- [002-workspace-navigation-and-entry.md](002-workspace-navigation-and-entry.md)

## Verification

- `node --test src/utils/promptPageState.test.cjs src/utils/alertPageState.test.cjs src/utils/questionSetReportPage.test.cjs`，30 项全部通过。
- `npx eslint src/app/geo/prompts/page.tsx src/app/geo/alerts/page.tsx src/app/geo/question-set-reports/page.tsx src/lib/useDefaultProjectContext.ts`，无错误或警告。
- 问题库、运行报告和告警规则均只从 `useDefaultProjectContext` 读取项目；普通用户项目选择器及项目列表请求已移除。
- 报告 URL 只保留 `run_id`，页面会删除历史 `project_id`；问题/问题集运行跳转也不再生成项目参数。
- 默认上下文缺失时写按钮禁用，保存与运行处理函数在发送请求前再次检查项目 ID；上下文变化会失效旧请求并清理编辑、筛选和运行状态。
- `npx tsc --noEmit` 未报告本次页面的业务类型错误；命令仍被既有 `.next/dev` 生成类型不兼容和 Playwright `Page` 版本冲突阻断。
