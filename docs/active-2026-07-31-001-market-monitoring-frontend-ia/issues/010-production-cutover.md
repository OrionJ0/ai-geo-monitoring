---
title: "正式切流、旧入口退役与生产入口验收"
status: open
type: HITL
blocked_by:
  - "002-workspace-navigation-and-entry.md"
  - "003-ad-performance-page.md"
  - "004-website-traffic-page.md"
  - "005-market-overview.md"
  - "006-data-health-attention.md"
  - "007-trend-anomaly-rules.md"
  - "008-ai-monitoring-default-context.md"
  - "009-monitoring-tasks-default-context.md"
---

# 正式切流、旧入口退役与生产入口验收

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-001 至 US-010

## What to build

完整导航和市场总览默认入口已按产品评审提前开放。本切片在百度合同达到 `VERIFIED`、试点限制关闭、前置页面和视觉评审全部通过后，把百度来源从试点状态切换为正式数据，并让旧合并营销入口单向进入新市场总览。

本切片需要从真实登录入口证明新页面被调用、旧页面未被调用、GEO/SEO能力仍然可达，并同步清理旧导航、默认值、测试和现役文档中的旧路径描述。旧页面不得保留为静默回退或第二套正式流程。

> 2026-08-04 生产状态：`/geo` 默认进入市场总览，`/geo/marketing` 已单向重定向，普通用户项目页已进入管理员工作区设置。Git Bundle workflow `30876793311` 已部署 `f265bd3`，正式入口已验证市场、百度统计与 AI/GEO 页面；本 issue 因百度仍为 `PILOT_DATA_READY`、生产移动端证据与官网/53KF/销售外部条件尚未闭合而继续保持 `open`。

## Acceptance criteria

- [ ] 百度合同状态为零阻塞的 `VERIFIED`，试点模式已关闭，模块正式状态为 `READY`。
- [x] 用户从真实登录入口进入工作台时默认到达市场总览。
- [x] 侧边栏显示市场总览、投放与流量、转化结果，并继续显示AI品牌监测、网站诊断和监测任务。
- [x] 本地代码与 production build 中旧营销 URL 单向进入市场总览，旧合并页面逻辑不再执行。
- [x] 广告表现、网站流量、市场总览和需要关注均使用新页面路径；真实数据仍保持试点能力门。
- [x] 本地代码中项目列表不再是普通用户入口，管理员仍可在工作区设置维护默认项目。
- [ ] 桌面端、移动端、直接URL、权限不足、单来源失败和旧链接完成入口级验收。
- [x] 自动化测试、静态检查、生产构建和营销专项门禁通过。
- [x] 代码搜索证明没有生产导航、默认重定向或推荐文档继续指向旧合并流程。
- [x] README、上下文、文档索引和营销现役需求准确描述新入口、当前数据边界和回滚条件。
- [x] 生产验证证据明确区分已实现、已设默认、已部署和真实入口已验证。

## Blocked by

- [002-workspace-navigation-and-entry.md](002-workspace-navigation-and-entry.md)
- [003-ad-performance-page.md](003-ad-performance-page.md)
- [004-website-traffic-page.md](004-website-traffic-page.md)
- [005-market-overview.md](005-market-overview.md)
- [006-data-health-attention.md](006-data-health-attention.md)
- [007-trend-anomaly-rules.md](007-trend-anomaly-rules.md)
- [008-ai-monitoring-default-context.md](008-ai-monitoring-default-context.md)
- [009-monitoring-tasks-default-context.md](009-monitoring-tasks-default-context.md)
- External gate: Baidu contract `VERIFIED`, pilot disabled, visual review approved.
