---
title: "网站流量独立页面"
status: closed
type: AFK
blocked_by:
  - "001-default-market-project.md"
---

# 网站流量独立页面

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-001、US-004、US-009

## What to build

把现有百度统计能力整理为独立的“网站流量”页面。页面自动使用默认监控项目，读取当前授权范围内的正常站点，并展示访客数、访问次数、PV、日期趋势、站点范围和来源状态。

网站流量必须独立于广告快照工作。广告来源失败不能阻止流量页面读取；网站访问也不得被自动归因到广告账户、推广计划或点击。

## Acceptance criteria

- [x] 页面无需项目选择即可读取默认项目的网站流量。
- [x] 页面展示访客数、访问次数、PV、覆盖范围、站点和读取状态。
- [x] 单一正常站点时可以读取并展示逐日趋势。
- [x] 无正常站点、多个正常站点、无可用连接、归档项目和来源失败具有不同错误状态。
- [x] 百度返回无数据标记时不按零值展示。
- [x] 页面明确说明网站流量与广告数据尚未建立跨来源归因。
- [x] 广告接口失败不影响本页面独立读取百度统计。
- [x] 精确指标、等价数据表、键盘操作和窄屏布局通过验证。

## Blocked by

- [001-default-market-project.md](001-default-market-project.md)

## Verification

- `node --test tests/marketing/website-traffic-page.test.cjs`，4 项全部通过。
- 页面只调用百度统计 `/tongji-trend`，不依赖广告 dashboard 或刷新 API。
- 空值、无数据标记、站点/连接歧义和归档状态均保留独立文案。
