---
title: "消除百度报告 URL 双重机器真值"
status: open
type: tdd
blocked_by:
  - "003-cache-keyword-previous-summary.md"
---

# 消除百度报告 URL 双重机器真值

## 验收标准

- [ ] 失败测试证明客户端仍依赖第二个报告 URL 字面量；
- [ ] 搜索推广客户端从版本化 manifest/共享安全内核取得报告端点；
- [ ] manifest 是唯一报告端点机器真值；
- [ ] 四报表顺序、编号、字段、预算、QPS、双读和原子快照不变；
- [ ] 安全内核 allowlist 仍不可由调用方放宽。
