---
title: "消除关键词翻页重复读取上期汇总"
status: open
type: tdd
blocked_by:
  - "002-validate-runtime-responses-with-openapi.md"
---

# 消除关键词翻页重复读取上期汇总

## 验收标准

- [ ] 失败测试证明 page/pageSize 变化当前会重复请求相同上期 summary；
- [ ] 翻页只请求本期页，上期 summary 按项目/revision/周期/业务筛选复用；
- [ ] 项目、revision、日期或业务筛选变化会正确失效；
- [ ] 失败不会永久缓存，迟到响应不会污染新 generation；
- [ ] 不改变 API、数据库、上游百度调用或页面数值合同。
