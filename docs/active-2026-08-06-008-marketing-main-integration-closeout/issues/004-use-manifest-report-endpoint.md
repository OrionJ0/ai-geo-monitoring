---
title: "消除百度报告 URL 双重机器真值"
status: closed
type: tdd
blocked_by:
  - "003-cache-keyword-previous-summary.md"
---

# 消除百度报告 URL 双重机器真值

## 验收标准

- [x] 失败测试证明客户端仍依赖第二个报告 URL 字面量；
- [x] 搜索推广客户端从版本化 manifest/共享安全内核取得报告端点；
- [x] manifest 是唯一报告端点机器真值；
- [x] 四报表顺序、编号、字段、预算、QPS、双读和原子快照不变；
- [x] 安全内核 allowlist 仍不可由调用方放宽。

## 验收证据

- 红灯：模块边界测试精确定位到 `BaiduSearchAdsClient` 内第二份
  `getReportData` URL 字面量；行为反例在替换 manifest 报告 URL 时先得到
  `BAIDU_CONTRACT_NOT_RUNNABLE`，证明客户端仍用本地 URL 裁决抢在安全内核之前；
- 客户端现在只要求 manifest 报告包含非空 URL，并把同一值传给共享
  `BaiduHttpKernel`；应用运行代码中不再出现该报告 URL 字面量；
- 篡改 manifest 报告 URL、但不修改版本化 allowlist 的反例稳定返回
  `BAIDU_OUTBOUND_NOT_ALLOWED`，且 transport 零调用；私有 allowlist 仍不可由调用方赋值放宽；
- 四报表聚焦 39/39、营销模块全量 245/245 通过，既有顺序、编号、字段、QPS、
  资源预算、双读和 005 等价基线均保持；
- 本 issue 不涉及公开 API、数据库或前端；正式生产尚未发布本修复。
