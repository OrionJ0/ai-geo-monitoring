---
title: "AI品牌监测页面自动项目上下文"
status: closed
type: AFK
blocked_by:
  - "001-default-market-project.md"
  - "002-workspace-navigation-and-entry.md"
---

# AI品牌监测页面自动项目上下文

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-005

## What to build

让AI搜索表现和引用来源分析自动使用默认监控项目，并完成面向用户的改名。普通用户不再看到项目选择器，但原有周期、平台、趋势、竞品、引用域名和URL证据必须完整保留。

历史链接中的项目参数只有在与默认项目一致且用户有权访问时才可继续使用；其他项目参数不得绕过新的单项目上下文。

## Acceptance criteria

- [x] AI搜索表现自动加载默认项目，不要求用户选择项目。
- [x] 引用来源分析自动加载同一默认项目。
- [x] 两个页面的原有指标、周期、平台和证据筛选没有丢失。
- [x] 菜单和选中态统一使用新名称，主内容不重复侧边栏页名和介绍。
- [x] 与默认项目一致的历史链接仍能打开对应筛选和证据。
- [x] 指向其他项目的历史参数不会触发跨项目读取。
- [x] 默认项目缺失、归档或无权时页面显示统一阻断状态。
- [x] 自动化回归证明指标计算和来源数据合同没有改变。
- [x] AI 搜索表现的数据 section 不使用装饰性 `::before` 色条，以普通边框、标题和留白表达层级。

## Blocked by

- [001-default-market-project.md](001-default-market-project.md)
- [002-workspace-navigation-and-entry.md](002-workspace-navigation-and-entry.md)

## Verification

- `node --test src/utils/projectDashboardState.test.cjs src/utils/sourcePageState.test.cjs`，12 项全部通过。
- `npx eslint src/app/geo/project-dashboard/page.tsx src/app/geo/sources/page.tsx`，无错误或警告。
- 两个页面统一从 `useDefaultProjectContext` 取项目 ID，不再请求项目列表或渲染项目选择器；URL 中的 `project_id` 不参与数据请求。
- 原有周期、平台、竞品、来源域名与 URL 证据逻辑保留，请求序列保护继续阻止旧响应覆盖新筛选结果。
- `projectDashboardState.test.cjs` 验证核心数据 section 不存在装饰性 `::before` 规则。
