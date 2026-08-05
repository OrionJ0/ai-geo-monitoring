---
title: "广告搜索词独立下钻与真实 Dashboard 接入"
status: closed
depends_on:
  - "003-ad-performance-page"
  - "013-page-data-interface-inventory"
---

# 广告搜索词独立下钻与真实 Dashboard 接入

## 目标

在不改变百度四报告后端、快照和迁移的前提下，让关键词分析页消费现役 Dashboard 的独立 `searchTerms` 集合：投放关键词只展示按账户、计划、单元和关键词名称精确匹配的证据数量；用户进入独立搜索词页后查看搜索词、匹配方式、添加状态和精确广告指标。

## 强制边界

- 搜索词不进入“账户 → 推广计划 → 推广单元 → 投放关键词”的严格实体树，不伪造 `keywordId`。
- 前端实体键镜像后端事实元组，包含搜索词、添加状态和匹配方式。
- 无效或不完整的 `accountId + keywordId` 下钻参数必须显示“下钻范围无效”，不得静默展示全量搜索词；全量视图只能由用户显式点击进入。
- 当前周期继续使用 `readMarketingDashboard` 的日期范围钳制，并校验响应项目所有权；stale 快照继续保留数据和告警。
- 上一周期只在 `revision`、币种和金额精度与本期完全一致时参与比较；慢响应不阻塞本期展示。
- 生产只请求现役只读 Dashboard，不新增写接口，不启用 fixture 或旧 provider fallback。

## 验收

- [x] 先写搜索词实体键、精确证据关联和无效范围失败测试。
- [x] 新增 `/geo/keyword-analysis/search-terms`，并在关键词明细中提供证据数量链接。
- [x] 前端 89 条单元/合同测试、lint 和 39 路由 production build 通过。
- [x] 本地 production build 下使用严格 API fixture 的关键词/搜索词回归 14/14 通过，覆盖精确下钻、显式全量切换、跨版本拒绝比较、错误周期拒绝、慢上期不阻塞、跨期改名和 axe；该证据不代表本地真实上游或生产验收。
- [x] 后端 994、营销 150、官网 28、咨询 35、部署脚本 26 条本地测试，以及营销页 API fixture Playwright 34/34 通过。
- [x] 正式 Git Bundle 部署后，从正式域名验证真实搜索词页面且未启用 fixture。

## 生产验收证据（2026-08-05）

- 11:36 CST 的 `/api/health` 与 `/api/frontend-health` 均报告 revision `6894789199afac645c007721d1e70e99a7caca6c`；该 revision 已包含广告搜索词下钻提交。
- 在 `https://insight.guangtuo.com/geo/keyword-analysis` 的现有登录态中，页面显示“百度推广 · 真实数据”，关键词明细提供“查看命中的广告搜索词”链接。
- 从“广拓”的唯一证据链接进入精确下钻 URL 后，页面保持同一正式域名，显示 1 条搜索词及匹配方式、添加状态、消费、展现、点击、CTR 和平均 CPC；没有伪造关键词层级。
- 直接进入 `/geo/keyword-analysis/search-terms?view=all`，页面显示“百度推广 · 真实数据”、本期 61 条搜索词，并提供推广单元、命中广告关键词、添加状态和匹配方式筛选。
- 生产构建只在 `NODE_ENV !== 'production' && NEXT_PUBLIC_KEYWORD_ANALYSIS_FIXTURE === 'true'` 时允许关键词/搜索词 fixture；本次页面来源标签为真实 Dashboard，不是 `development-fixture`。
- 证据截图保存在工作区忽略目录：`output/playwright/production-search-terms-20260805/search-terms-all.jpg`、`output/playwright/production-search-terms-20260805/search-term-drilldown-guangtuo.jpg`。截图不进入 Git。
- 本 issue 只关闭搜索词页面生产验收；服务器日志敏感信息扫描随后已由 [Issue 016](016-real-data-release-acceptance.md) 完成并关闭。

## 回滚边界

本切片只增加前端只读消费与页面路由；回滚时可撤销本 issue 对应提交，不回滚或改写百度营销迁移、四报告快照和生产 Token。
