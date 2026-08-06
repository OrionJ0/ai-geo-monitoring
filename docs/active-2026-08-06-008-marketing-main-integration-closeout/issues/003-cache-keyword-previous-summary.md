---
title: "消除关键词翻页重复读取上期汇总"
status: closed
type: tdd
blocked_by:
  - "002-validate-runtime-responses-with-openapi.md"
---

# 消除关键词翻页重复读取上期汇总

## 验收标准

- [x] 失败测试证明 page/pageSize 变化当前会重复请求相同上期 summary；
- [x] 翻页只请求本期页，上期 summary 按项目/revision/周期/业务筛选复用；
- [x] 项目、revision、日期或业务筛选变化会正确失效；
- [x] 失败不会永久缓存，迟到响应不会污染新 generation；
- [x] 不改变 API、数据库、上游百度调用或页面数值合同。

## 验收证据

- 红灯：行为测试首先因 `keywordPreviousSummaryCache.ts` 不存在而失败，证明旧 hook
  没有可复用的上期汇总身份缓存；
- 缓存键只包含项目、Dashboard revision、上期日期范围和 query/campaign/ad group，
  显式排除 page、pageSize 与排序；并发翻页复用同一个 Promise；
- 项目、revision、任一日期或业务筛选变化均有失效反例；失败 Promise 在同一身份内
  不形成请求风暴，用户显式刷新会强制重试并可恢复；
- `requestSequence` 继续作为页面状态写入门禁，缓存对象本身不写 React 状态，因此
  迟到 generation 不能覆盖新页面；
- 聚焦 16/16、前端营销全量 127/127、ESLint、TypeScript 与 Next.js 生产构建通过；
- 真实 Chrome 在本地正式关键词页面加载开发 fixture，点击下一页后表格切换为第二页，
  页面保持可操作且控制台 0 error/0 warning；正式生产尚未发布本修复。
