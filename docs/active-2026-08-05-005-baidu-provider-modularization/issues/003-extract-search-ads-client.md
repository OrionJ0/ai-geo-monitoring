---
title: "抽取搜索推广四报表客户端"
status: closed
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

- [x] 四个官方报告类型、请求顺序、双读轮次和共享整轮预算与基线一致。
- [x] report type 级 QPS、分页、等待、响应字节和超时没有新增请求或预算放宽。
- [x] 乱序事实、重复、父子 ID/名称冲突和双读不稳定继续使用现役稳定错误拒绝。
- [x] 搜索词只保留计划、单元、关键词名称和搜索词证据，不产生 `keywordId`。
- [x] facade 的搜索推广方法仅委托一个搜索客户端，返回仍为四份事实的原合同。
- [x] 广告刷新集成测试证明四报表继续全成全败并写入同一 `refresh_run_id`，失败不覆盖上一份完整快照。

## Blocked by

- [Issue 002：抽取唯一安全 HTTP 内核与 OAuth 客户端](002-extract-http-kernel-and-oauth-client.md)。

## 验收证据

- TDD 红灯先让模块边界测试因缺少 `BaiduSearchAdsClient` 以 `MODULE_NOT_FOUND` 失败；完整移动后 facade 边界、Issue 001 等价合同和搜索层级聚焦 41/41 通过。
- `BaiduSearchAdsClient.js` 现在独占四个 report 配置选择、严格 parser、精确金额 helper、分页、report type 级 QPS 状态、共享整轮请求/行/响应字节/120 秒预算、两轮稳定摘要和 `campaigns/adGroups/keywords/searchTerms` 输出。facade 的八个搜索方法只委托唯一实例，公开 prototype 与导出不变。
- 脱敏 request trace 继续固定 `2290316 → 2284618 → 2602783 → 2307838` 两轮顺序、8 个请求、50/50/10/10 QPS 的共享等待、每请求 8 MiB、整轮 512 请求/250000 行/64 MiB/120 秒上限；没有新增请求、独立预算或超时放宽。
- 稳定/不稳定双读、乱序事实、分页、响应字节和墙钟预算测试继续通过；层级快照测试继续拒绝孤儿与父子冲突。搜索词规范化仍没有 `keywordId`，只保留计划、单元、关键词名称、搜索词、状态和匹配证据。
- 快照/刷新集成 11/11 通过：四表在同一刷新中原子提交并共享 `refresh_run_id` 与 provider budget；不稳定读取、后续绑定失败或层级错误均保留上一份完整 active revision，不产生部分覆盖。
- `decimalNumberToScaledText` 从搜索客户端经旧 facade re-export 同一函数 identity；搜索客户端与 HTTP 内核均不持有 Secret。源码扫描确认旧 facade 已无 reportType、关键词/搜索词 parser、搜索预算或 QPS 状态，且所有请求仍走 Issue 002 的同一 HTTP 内核。
- 全量营销回归 242/242 通过；后端顶层回归 994/994 通过。该 issue 未修改 composition root、公开 API、数据库、页面、四报表抓取合同或前端，因此无需前端构建与浏览器验收。
- 本地候选路径为 `marketing/index.js → BaiduMarketingClient facade → BaiduSearchAdsClient → BaiduHttpKernel`；旧 facade 内搜索实现已删除且无 fallback。中间态仍未发布，生产正式入口继续运行 007 已发布 revision 的旧单体 Provider，本地搜索客户端目前不会在正式流程生效。
- 下一门禁是 Issue 004：把百度统计站点、趋势、来源、质量和页面逻辑完整迁入 `BaiduTongjiClient`，随后删除 facade 最后的产品实现与重复校验；007 来源分区和页面消歧必须保持基线不变。
