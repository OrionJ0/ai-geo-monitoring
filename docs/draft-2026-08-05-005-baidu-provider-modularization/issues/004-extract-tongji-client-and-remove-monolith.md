---
title: "抽取百度统计客户端并删除单体产品逻辑"
status: open
type: AFK
blocked_by:
  - "003-extract-search-ads-client.md"
---

# 抽取百度统计客户端并删除单体产品逻辑

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-1：百度统计变化被限制在独立产品客户端内。
- US-2：统计请求继续经过唯一安全内核。
- US-3：流量页面的数据、分页、空值和错误语义不变。

## What to build

把站点目录、趋势、质量、来源和页面报告的请求、能力开关、分页、预算和严格解析完整迁入百度统计客户端。完成后 facade 只保留构造、委托和兼容导出，并删除其中已经迁出的产品常量、parser、分页和网络逻辑。

## Acceptance criteria

- [ ] 统计客户端只接收 003 统一后的 Access Context、`userName` 和 `site_id`，不实现 Token 生命周期或持久化。
- [ ] 站点、趋势、质量、来源和页面报告的设备、日期、分页、去重、合法空数据与错误合同和基线一致。
- [ ] 统计与搜索客户端互不 require，且共享同一个 HTTP 内核实例。
- [ ] facade 只负责构造、委托和兼容导出，不保留产品请求、parser、分页或 fallback。
- [ ] 旧单体产品逻辑和重复安全网络实现的生产引用为零。
- [ ] 管理、网站流量、来源趋势和页面报告集成测试全部通过，统一 Token 失败时不调用旧实现。

## Blocked by

- [Issue 003：抽取搜索推广四报表客户端](003-extract-search-ads-client.md)。
