# 市场总览渠道对比验收证据

## 本地发布候选

验收时间：2026-08-05（Asia/Shanghai）。

| 门禁 | 结果 |
| --- | --- |
| 后端完整测试 `backend/npm test` | 1015 / 1015 通过 |
| 营销专项 `backend/npm run test:marketing` | 157 / 157 通过 |
| 官网数据 `backend/npm run test:website-data` | 31 / 31 通过 |
| 咨询记录 `backend/npm run test:consultation-records` | 35 / 35 通过 |
| 部署入口 `npm run test:deployment` | 26 / 26 通过 |
| 前端合同 `nextjs-frontend/npm test` | 104 / 104 通过 |
| ESLint | 通过，无 error/warning |
| Next.js production build | 通过，40 个路由完成构建 |
| 市场总览 Playwright | 11 / 11 通过，包含桌面、390px、键盘、reduced-motion、axe、空态、局部错误、陈旧快照、权限和正式重定向 |

本地截图由 production build 的浏览器验收生成在 `output/playwright/market-overview-fixture/`。关键文件包括：

- `market-overview-desktop-1440x1024.png`
- `market-overview-mobile-390x844.png`
- `market-overview-mobile-table-scroll-390x844.png`
- `market-overview-partial-error-1440x1024.png`
- `market-overview-stale-1440x1024.png`

## 代码入口证据

- 首页常驻流量请求固定使用 `website-traffic-overview` 的 `source=ALL&metric=visits&includeSourceComparison=true`。
- 选中单渠道时只按需读取同一个区间接口，不并发发起七个浏览器请求。
- `tongji-trend`、`tongji-source-trends` 两条公开路由及 `readProjectTrend`、`readProjectSourceTrends` 两个专属包装已删除。
- HTTP 合同测试证明两条旧路由返回 404，且不会先执行项目授权或触发百度统计读取。
- 首页源码和浏览器测试都断言没有旧接口请求；广告表现继续只读 Dashboard，网站流量页继续使用 overview/pages。
- 页面只接受与当前设备、日期、来源和指标完全一致的响应，筛选切换期间不会短暂展示上一来源或上一日期范围的数据。

## 生产发布前基线

2026-08-05 11:19 CST 只读复核：

- `origin/main`：`8c8988d3c3d7bac694d8d7ee3112a41ba6eea51f`；
- `GET https://insight.guangtuo.com/api/health`：HTTP 200，revision `6894789199afac645c007721d1e70e99a7caca6c`；
- `GET https://insight.guangtuo.com/api/frontend-health`：HTTP 200，同 revision；
- `GET https://insight.guangtuo.com/api/ready`：`ready`，SQLite WAL、scheduler 已启动且无当次错误。

以上只证明发布前公开运行态健康，不证明本需求已部署。

## 尚未完成的生产门禁

- 当前机器没有生产 SSH 私钥，`ubuntu@182.254.140.163` 返回 `Permission denied (publickey,password)`，因此尚未读取 Nginx access log 证明旧接口没有外部消费者。
- 当前 `gh` 登录令牌无效，尚不能触发并跟踪正式 Git Bundle workflow。
- 尚未从生产登录态采集新接口网络请求、页面 selector、截图、服务器 `HEAD/origin/main/worktree` 和三页共享指标对账证据。
- 生产官网模块、53KF、线索和订单状态必须在发布后重新读取；当前只允许沿用发布前的 `DISABLED`、`NOT_CONNECTED`、`UNAVAILABLE` 基线，不能由本地 fixture 推断。

在上述门禁完成前，本需求目录保持 `active`，Issue 005 不关闭，也不得声称已正式生效。
