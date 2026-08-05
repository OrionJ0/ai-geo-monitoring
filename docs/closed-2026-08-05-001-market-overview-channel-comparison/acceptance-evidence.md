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

## 正式发布

2026-08-05 12:18 CST 完成正式发布：

- 发布候选提交：`ba0b1eb3a76ae59847594a7647e68e35eb7bd373`；
- 正式 Git Bundle workflow：`30973958050`，`verify` 与 `deploy` 均成功；
- workflow 在候选构建、Bundle 校验、服务器快进和正式部署入口中完成验证，没有直接编辑服务器源码；
- `GET https://insight.guangtuo.com/api/health`：HTTP 200，revision 为上述提交；
- `GET https://insight.guangtuo.com/api/frontend-health`：HTTP 200，revision 为上述提交；
- `GET https://insight.guangtuo.com/api/ready`：`ready`，SQLite 使用 WAL，scheduler 已启动且无当次错误；
- `HEAD https://insight.guangtuo.com/geo/market-overview`：HTTP 200，由 Nginx 与 Next.js 正常响应。

发布过程中第一次登录态验收发现生产来源比较为 `PARTIAL` 时，部分渠道有汇总但没有逐日趋势，等价数据表把未知值传入严格十进制格式化器并导致页面崩溃。新增生产形状浏览器回归后，将这类单元格改为按覆盖状态显示 `—`，仍不把未知值伪装为 0。修复提交即上述正式 revision。

修复后的门禁结果：前端合同 104 / 104、完整营销浏览器测试 38 / 38、ESLint 和 production build 均通过；workflow 候选验证再次通过。

## 登录态生产验收与同范围对账

验收范围：PC，最近 7 天，2026-07-29 至 2026-08-04。Chrome 登录态从唯一正式入口读取真实运行页面，验收开始后的 console error/warning 为 0。

| 页面 | 生产事实 |
| --- | --- |
| 市场总览 | 百度推广投入 `¥1,534.57`、展现 `2,101`、访问 `12`；全部访问 `83`；来源默认显示“全部”；全链路表格保留；表头显示“官网咨询”。 |
| 广告表现 | 总消费 `¥1,535`（页面按元取整展示）、总展现 `2,101`、总点击 `104`、CPC `¥14.76`，与首页同口径事实一致。 |
| 网站流量 | 访问总量 `83`；直接访问 `30`、外部引荐 `25`、百度搜索 `14`、百度推广 `12`、Google 搜索 `1`，与首页来源行和占比一致。 |

市场总览的全部渠道图同时显示七个稳定来源。必应搜索和其他搜索在当前生产范围没有可用逐日覆盖时，页面显示 `—` 且其他来源继续展示；没有再次出现“营销指标必须是十进制字符串”崩溃。

## 未接入状态复核

- 咨询数据页：官网表单模块当前不可用；53KF 尚未完成真实账户接口、有效对话规则和历史覆盖验证；没有用联系点击或 fixture 补齐。
- 首页线索入池与成交结果仍显示 `—`。
- 订单结果页明确显示销售系统尚未接入，不使用 mock 数据，也不从金额推导订单数。

## 证据边界

- 当前执行机没有生产 SSH 私钥，未读取 Nginx 原始 access log；旧链无消费者的结论来自仓库生产引用清零、旧路由/包装删除、HTTP 回归 404、正式页面新区间能力和登录态入口验收的组合证据。
- 登录态验收没有导出含会话信息的原始网络记录，也没有把 Token、Cookie 或浏览器存储写入文档。
- 未单独保存生产截图；页面 selector、可见文本、同范围数值、控制台与公网 revision 已在验收会话中读取。需求关闭不依赖伪造或缺失的截图证据。
