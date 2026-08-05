---
title: "抽取搜索推广四报表客户端"
status: open
type: AFK
blocked_by:
  - "002-extract-http-kernel-and-oauth-client.md"
---

# 抽取搜索推广四报表客户端

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-1：搜索推广变化被限制在独立产品客户端内。
- US-3：广告快照和页面数据在拆分前后保持一致。

## What to build

把计划、单元、关键词和搜索词四份报告的请求、分页、QPS、整轮预算、双读、稳定摘要、严格解析和精确值规范化完整迁入搜索推广客户端。现有 facade 继续提供相同方法，广告刷新仍通过同一调用链获得四份事实并在原事务中原子落库。

## Acceptance criteria

- [ ] 四个官方报告类型、请求顺序、双读轮次和共享整轮预算与基线一致。
- [ ] report type 级 QPS、分页、等待、响应字节和超时没有新增请求或预算放宽。
- [ ] 乱序事实、重复、父子 ID/名称冲突和双读不稳定继续使用现役稳定错误拒绝。
- [ ] 搜索词只保留计划、单元、关键词名称和搜索词证据，不产生 `keywordId`。
- [ ] facade 的搜索推广方法仅委托一个搜索客户端，返回仍为四份事实的原合同。
- [ ] 广告刷新集成测试证明四报表继续全成全败并写入同一 `refresh_run_id`，失败不覆盖上一份完整快照。

## Blocked by

- [Issue 002：抽取唯一安全 HTTP 内核与 OAuth 客户端](002-extract-http-kernel-and-oauth-client.md)。
