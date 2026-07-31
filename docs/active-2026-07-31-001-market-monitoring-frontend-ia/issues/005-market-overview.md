---
title: "市场总览与全链路概览"
status: open
type: HITL
blocked_by:
  - "003-ad-performance-page.md"
  - "004-website-traffic-page.md"
---

# 市场总览与全链路概览

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-001、US-003、US-009、US-010

## What to build

建立市场总览页面，用三个一级模块呈现全链路概览、投入与流量趋势、需要关注。页面分别组合广告本地快照和百度统计实时结果，任何一个来源失败时仍展示另一个来源的可用数据。

全链路固定呈现广告投放、网站访问、原始咨询和订单结果。当前原始咨询与订单结果只说明来源系统尚无稳定API，不展示零值、模拟数字、订单数量或虚构转化率。页面需要完成桌面端和移动端的人工视觉评审。

## Acceptance criteria

- [x] 首页只有全链路概览、投入与流量趋势、需要关注三个一级模块。
- [x] 广告阶段以消费为核心指标，网站阶段以访客数为核心指标。
- [x] 原始咨询和订单结果显示“来源暂不可接入”及具体依赖，不显示数字。
- [x] 页面不展示订单数量，也不生成广告到访问的转化率。
- [x] 广告和网站来源分别展示自己的覆盖范围、更新时间或读取模式。
- [x] 任一来源失败时页面进入部分可用状态，另一来源数据不会消失。
- [x] 趋势区域不再次陈列周期汇总数字，也不通过连续漏斗或折线暗示归因。
- [x] 图表原始值保持精确，并提供等价数据或可访问摘要。
- [ ] 桌面1440px和移动375px的关键状态截图通过人工视觉评审。
- [x] 空数据、部分失败、两来源失败和正常数据状态均完成入口验证。

## Blocked by

- [003-ad-performance-page.md](003-ad-performance-page.md)
- [004-website-traffic-page.md](004-website-traffic-page.md)

## Verification in progress

- 页面结构、空状态与精确值契约测试 9 项通过。
- 真实浏览器正常数据状态：1440px 与 375px 均无横向溢出，三模块顺序一致，控制台无错误。
- 隔离浏览器模拟验证：广告失败时网站数据继续展示；双来源失败时进入“来源暂不可用”；成功空读区分“零数据”和“无数据”，不伪造零值。
- 截图：
  - `nextjs-frontend/output/playwright/market-overview/market-overview-v2-1440.png`
  - `nextjs-frontend/output/playwright/market-overview/market-overview-v2-375.png`
  - `nextjs-frontend/output/playwright/market-overview/market-overview-v2-mobile-menu.png`
  - `nextjs-frontend/output/playwright/market-overview/market-overview-partial.png`
  - `nextjs-frontend/output/playwright/market-overview/market-overview-two-errors.png`
  - `nextjs-frontend/output/playwright/market-overview/market-overview-empty.png`
- 待完成：人工视觉评审。

## Visual revision

- 根据 2026-07-31 评审意见，移除独立展示字体、杂志式大标题、`01/02/03` 编号和自定义长卡片。
- 页面重新使用现有 Inter/系统字体、Ant Design `Card`、`Statistic`、`Alert`、`Empty` 以及项目既有蓝灰色和间距。
- 移动端全链路使用两列紧凑卡片，趋势单列展示；侧边栏改为覆盖式展开，不再把主内容挤窄。
