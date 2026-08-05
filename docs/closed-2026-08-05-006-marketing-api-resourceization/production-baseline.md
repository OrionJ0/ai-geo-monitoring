# 006 Issue 001 生产基线与冻结合同

## 边界

- 测量时间：2026-08-05（Asia/Shanghai）。
- 正式入口：`https://insight.guangtuo.com`。
- 正式运行 revision：`58469e29214ccc28e989f07d54af873d9c0ba801`。
- 所有测量都只读取现役完整快照、正式 HTTPS 响应、Chrome Network 和 Nginx 访问计数；没有触发刷新、调用百度上游、写数据库或修改生产配置。
- 证据只保存聚合字节、耗时、行数、路径和状态，不保存 Token、Cookie、数据库、业务明细或原始响应。

## Dashboard 响应与读取基线

正式数据库当时的完整快照覆盖 2026-07-06 至 2026-08-04，状态为 `FRESH/DATA`。只读原始 Dashboard service 连续预热一次后测量 30 次：

| 指标 | 结果 |
| --- | ---: |
| 未压缩 JSON | 1,066,452 B |
| gzip | 71,178 B |
| Brotli 估算 | 39,942 B |
| DB/service 读取 P50 | 121.02 ms |
| DB/service 读取 P95 | 153.53 ms |
| DB/service 读取最大值 | 182.70 ms |
| 计划 / 单元 / 关键词 / 搜索词 | 45 / 192 / 898 / 350 |

正式 HTTPS 响应保持 `Cache-Control: private, no-store`。一次 identity 请求为 1,066,452 B；20 次 gzip 请求均为 71,178 B，P95 为 297.63 ms。首次 identity 请求包含新连接建立，耗时 1,791.20 ms，只保留为冷启动观察值，不冒充 P95。

## 正式 Chrome 页面请求基线

同一登录态从正式域名逐页打开并等待数据完成：

| 页面 | 完整 Dashboard 请求数 | 解码后 Dashboard 字节 |
| --- | ---: | ---: |
| 市场总览 | 1 | 1,066,452 B |
| 广告表现 | 1 | 317,908 B |
| 关键词分析 | 1 | 317,908 B |
| 搜索词 | 2 | 648,003 B |

搜索词页两次请求分别读取本期和上期完整 Dashboard。Nginx 当前保留日志在采样时累计观测到 110 次 Dashboard 请求：89 次为浏览器 User-Agent，另外 21 次是本 issue 明确执行的 HTTPS 基线探针；没有 curl 或其他可识别的 API 客户端。三个新资源的生产请求为 0，因为 Issue 001 尚未注册任何新路由。日志留存窗口不能代表长期调用量，因此只用于证明现役路径，不据此推导业务 P95。

## 消费者清单

仓库搜索和真实 Network 共同确认：

- `useMarketOverview.ts`：直接读取 Dashboard，只消费状态、summary 和 trend。
- `readMarketingDashboard.ts`：广告表现与关键词页的共同根读取入口，负责 coverage clamp。
- `useAdPerformance.ts` / `adPerformanceAdapter.ts`：消费 campaigns、adGroups、keywords。
- `useKeywordAnalysis.ts` / `keywordAnalysisAdapter.ts`：消费 keywords，并为现役搜索词证据读取 searchTerms。
- `useAdSearchTerms.ts` / `adSearchTermAdapter.ts`：本期经共同读取入口、上期直接请求 Dashboard，消费 keywords 与 searchTerms。
- 后端 CLI 和诊断脚本未发现四个明细数组的现役消费者；当前 Nginx 留存窗口除浏览器和本 issue 的受控测量外，没有可识别的其他 API 客户端。合同测试和开发 fixture 属于迁移时必须同步清理的内部依赖，不是生产调用方。

## 冻结查询合同

生产规模支持默认 `pageSize=50`、最大 `pageSize=200`：898 个关键词默认 18 页、最大 5 页；350 个搜索词默认 7 页、最大 2 页。该上限显著低于当前完整 Dashboard 行数，又足以支持现役表格交互。`page` 默认 1，文本 query 最长 200 字符。

关键词资源：

- 过滤：`query`、`campaignId`、`adGroupId`；
- 排序：`keywordName`、`impressions`、`clicks`、`costAmountScaled`、`ctr`、`averageCpc`。

搜索词资源：

- 过滤：`query`、`accountId`、`campaignId`、`adGroupId`、`keywordName`、`queryStatus`、`matchType`；
- 排序：`searchTerm`、`keywordName`、`impressions`、`clicks`、`costAmountScaled`、`ctr`、`averageCpc`。

`accountId + campaignId + adGroupId + keywordName` 是现役关键词到搜索词入口保留事实身份所需的范围，不创建 `keywordId`。`queryStatus` 与 `matchType` 已存在于正式搜索词筛选。CTR/CPC 排序只能基于精确分子分母比较，不能转换为 JavaScript 浮点。

## 冻结响应与错误合同

- schema：`marketing_dashboard_v2`、`marketing_ad_hierarchy_v1`、`marketing_keywords_v1`、`marketing_search_terms_v1`。
- 详情必须携带同项目、完整 `SUCCEEDED` refresh run 的 revision，并受 coverage 约束；不允许隐式 latest。
- 广告层级和关键词 summary 固定为 `impressions`、`clicks`、`costAmountScaled` 三个现役精确字段，使用无符号十进制字符串。当前事实没有可证明的 conversions 字段，因此不在 006 中新增占位指标；缺失值保持 `null`。
- summary 应用与 items 相同的完整筛选，不随 page/pageSize 改变，并与 items/count 在同一只读事务中读取。
- Dashboard 缓存为 `private, no-store`；显式 revision 详情为 `private, max-age=60`。
- 稳定错误：`MARKETING_REVISION_REQUIRED`、`MARKETING_AD_RESOURCE_QUERY_INVALID`、`MARKETING_REVISION_NOT_FOUND`、`MARKETING_SNAPSHOT_UNAVAILABLE`、`DASHBOARD_DATE_OUT_OF_RANGE`、`MARKETING_AD_RESOURCE_FAILED`。
- 机器合同位于 `backend/modules/marketing/contracts/MarketingAdReadContract.js`；Issue 001 没有把它接入路由或改变现役 JSON。

## Issue 001 不变性证明

- 生产服务器仍运行 `58469e29214ccc28e989f07d54af873d9c0ba801`；本切片没有发布操作。
- 本地只新增未接线的合同常量、合同测试和文档；没有修改路由、service、模型、迁移、前端 hook 或 adapter。
- 三个资源路径仍未注册，正式 Dashboard 继续返回四个明细数组；刷新预算、双读、原子快照和统一 OAuth 完全未改。

## R1 additive 发布后测量（2026-08-06）

- 正式应用 revision：`d5695402d9b39c0ce04108bc36b6d4aa02daac13`。
- 快照 coverage：2026-07-07 至 2026-08-05；完整范围计划 / 单元 / 关键词 / 搜索词为 45 / 191 / 921 / 345。行数变化来自生产快照推进，不能直接当作代码性能变化。
- 30 次服务器内只读 service 测量：

| 资源 | 解码 JSON | P50 | P95 | 最大值 | 返回范围 |
| --- | ---: | ---: | ---: | ---: | --- |
| 完整 Dashboard | 1,061,845 B | 118.19 ms | 130.43 ms | 132.02 ms | 全范围四数组 |
| 广告层级 | 889,563 B | 97.89 ms | 131.91 ms | 137.78 ms | 全范围三层级 |
| 关键词 | 67,692 B | 101.01 ms | 118.69 ms | 138.66 ms | 50 / 921 |
| 搜索词 | 39,271 B | 30.22 ms | 32.92 ms | 36.46 ms | 50 / 345 |

真实 Chrome 默认七日页面请求为：市场总览完整 Dashboard 1,061,845 B；广告表现 Dashboard 318,325 B + 广告层级 289,132 B；关键词 Dashboard 318,325 B + 关键词 10 行 5,947 B；全量搜索词 Dashboard 318,325 B + 本期 20 行 9,220 B + 上期 1 行 1,136 B。搜索词从基线两份完整 Dashboard 的 648,003 B 降至 328,681 B；关键词在 R1 兼容期约为 324,272 B；广告表现在 R1 兼容期暂增至 607,457 B。R1 的目标是证明消费者迁移，完整 Dashboard 仍因市场总览兼容而返回旧数组；最终节省必须在 R2 硬切后重新测量。

所有详情请求携带并回显同一快照 revision，`items <= pageSize`。详细页面生产 hook/page 不再读取 Dashboard 的 `campaigns`、`adGroups`、`keywords` 或 `searchTerms`；市场总览继续只消费根状态、summary 和 trend。Nginx 留存窗口中的四类请求全部来自 Chrome User-Agent。测量没有触发刷新、百度上游请求或业务写入，也没有保存 Token、Cookie、数据库、业务明细或原始响应。

## R2 硬切发布后测量（2026-08-06）

- 正式应用 revision：`d9b0688e28ba9b3a33fcfb061fe7d7235388ec22`；快照 coverage 为 2026-07-07 至 2026-08-05，计划 / 单元 / 关键词 / 搜索词为 45 / 191 / 921 / 345。
- Dashboard 解码 JSON 为 2,869 B，不含四个旧明细数组；广告层级 889,563 B，关键词第一页 50/921、67,692 B，搜索词第一页 50/345、39,271 B。三个详情资源与根使用同一 revision、日期和来源，详情响应均包含 `Vary: Authorization`。

| 资源 | 30 次 HTTPS P50 | 30 次 HTTPS P95 | 最大值 |
| --- | ---: | ---: | ---: |
| 轻量 Dashboard | 30.75 ms | 47.61 ms | 48.19 ms |
| 广告层级 | 150.40 ms | 181.04 ms | 233.52 ms |
| 关键词 | 122.71 ms | 140.26 ms | 154.95 ms |
| 搜索词 | 44.45 ms | 54.05 ms | 58.24 ms |

真实 Chrome 默认七日页面请求为：市场总览轻量 Dashboard 2,869 B；广告表现轻量 Dashboard 1,420 B + 广告层级 289,132 B；关键词轻量 Dashboard 1,420 B + 关键词 10 行 5,947 B；全量搜索词轻量 Dashboard 1,420 B + 本期 20 行 9,220 B + 上期 1 行 1,136 B。相对 R1，市场总览从 1,061,845 B 降至 2,869 B，广告表现从 607,457 B 降至 290,552 B，关键词从约 324,272 B 降至 7,367 B，搜索词从 328,681 B 降至 11,776 B。

生产 `/usr/bin/google-chrome` 验证四个正式页面根节点和表格均可见，营销请求全部为 200；Network 没有兼容 query。观察窗中结构化日志成功 140、失败 0、秘密标记 0、服务错误 0；Nginx Dashboard / 层级 / 关键词 / 搜索词分别为 39 / 33 / 33 / 37，旧 `view/includeDetails` 查询为 0。SQLite 查询计划命中关键词和搜索词的 `refresh_run_id` 索引，数据库保留两个成功 revision 的事实。
