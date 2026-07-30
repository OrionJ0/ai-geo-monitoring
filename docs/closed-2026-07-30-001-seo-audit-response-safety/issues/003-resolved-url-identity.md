---
title: "按 Resolved URL 合并页面并修复真实入口"
status: closed
type: AFK
blocked_by:
  - "002-trusted-response-crawl-stop.md"
---

# 按 Resolved URL 合并页面并修复真实入口

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-4、US-5

## What to build

把实际重定向结果作为全站页面的网络身份。发现阶段仍记录用户提交和站内发现的 URL，取得响应后再按 resolved URL 合并页面分析与评分结果。多个 requested URL 指向同一最终页面时只生成一组检查实例，同时保留 requested URL、最终 URL、重定向链和别名证据。

修复全站报告把入口固定写成站点根路径的问题。报告必须展示真实入口 final URL；Canonical 继续只作为页面 SEO 声明，不参与抓取去重。全站范围确定后，站内 URL 重定向到外域时只记录重定向事实，不把外域正文纳入本站评分。

## Acceptance criteria

- [x] `/cn` 与 `/cn/` 最终落到同一 URL 时只执行一次页面分析、只生成一组检查实例且只计分一次。
- [x] 两个并发抓取的别名落到同一 resolved URL 时不会产生重复页面结果或重复问题实例。
- [x] 报告保留用户提交 URL、真实 final URL、重定向链和有界别名证据，任一字段都不会被 Canonical 覆盖。
- [x] 用户提交 `/cn/` 且最终入口仍为 `/cn/` 时，报告顶层 final URL 保留该路径，不再固定显示站点根路径。
- [x] 裸域或 `www` 发生跨 origin 入口重定向时，以最终入口 origin 建立现有全站同源范围。
- [x] 范围内页面重定向到外域时记录跳转事实，但外域页面内容、标题和检查项不进入本站技术健康评分。
- [x] Canonical 声明错误、跨域或冲突时仍由现有 Canonical 检查报告，不改变请求身份或去重结果。
- [x] 正常无重定向页面、现有 Sitemap 发现和站内链接发现行为没有回归。

## Blocked by

- [002 建立可信响应与风控止损闭环](002-trusted-response-crawl-stop.md)

## Verification

- `node --test tests/SeoSiteAuditService.test.js`
- 结果：22 项通过，0 项失败。
- `node --test $(rg --files tests | rg '/Seo.*\\.test\\.js$' | sort)`
- 结果：151 项 SEO 回归通过，0 项失败。
- 验证覆盖：入口路径保留、入口和并发别名合并、别名证据、跨 origin 入口范围、子页面外域重定向隔离，以及 Canonical/Sitemap/站内链接既有行为。
