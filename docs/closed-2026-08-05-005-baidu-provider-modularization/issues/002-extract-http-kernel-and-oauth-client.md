---
title: "抽取唯一安全 HTTP 内核与 OAuth 客户端"
status: closed
type: AFK
blocked_by:
  - "001-freeze-provider-equivalence-contract.md"
---

# 抽取唯一安全 HTTP 内核与 OAuth 客户端

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-1：OAuth、搜索推广和百度统计拥有明确产品边界。
- US-2：所有百度调用继续共用一套安全网络控制。
- US-3：现役消费者不感知内部拆分。

## What to build

让现有 facade 通过一个共享安全 HTTP 内核完成全部百度网络请求，并把授权 URL、回调签名、授权码交换、Token 刷新和账户目录完整迁入 OAuth 客户端。搜索推广与百度统计在本切片结束时也必须经过同一内核，但仍可暂留各自产品逻辑，且中间状态不得发布。

## Acceptance criteria

- [x] facade 只构造一个 HTTP 内核，所有百度产品请求都经过该实例。
- [x] 内核统一执行 HTTPS/allowlist、timeout、响应体预算、JSON 解析、取消和稳定网络错误，不包含产品字段或分页规则。
- [x] OAuth 与账户目录从 facade 调用到上游、规范化输出和错误的黑盒合同与 Issue 001 完全一致。
- [x] Secret Key 只进入 OAuth 客户端，不传递给搜索推广或百度统计客户端。
- [x] 旧路径导出的错误 class 和精确值 helper identity 保持不变。
- [x] 仓库只有一个 transport、allowlist 和共享网络错误实现，不存在可关闭安全控制的选项。

## Blocked by

- [Issue 001：冻结百度 Provider 黑盒等价合同](001-freeze-provider-equivalence-contract.md)。

## 验收证据

- TDD 红灯先让新边界测试因缺少 `adapters/baidu/BaiduErrors` 以 `MODULE_NOT_FOUND` 失败；实现后新增模块边界 3/3 通过，Issue 001 等价合同继续 7/7 通过。
- `BaiduErrors.js` 现在唯一拥有 `BaiduMarketingError`、`BaiduContractBlockedError` 和百度重授权码判断；旧 `BaiduMarketingClient.js` 直接 re-export 同一 class identity，公开导出、21 个 prototype 方法和 `decimalNumberToScaledText` identity 未改变。
- `BaiduHttpKernel.js` 是仓库唯一 `defaultTransport` 与 manifest allowlist 解析实现，统一处理 HTTPS/无凭据 URL/精确路径、默认及剩余 timeout、响应字节预算、非枚举原始字节、流式取消、JSON 解析和六类稳定网络错误。源码扫描只发现一个 `fetch`、一个 `AbortController`、一个 `defaultTransport` 和一个 `documentedAllowlist`，没有关闭安全控制或无限 timeout 选项。
- facade 构造且只构造一个 `BaiduHttpKernel`，OAuth 客户端持有同一实例；facade 的 `requestJson`、搜索推广和百度统计剩余逻辑均委托该内核。facade 不再保存 `transport` 或 `allowlist`，没有第二套网络实现。
- `BaiduOAuthClient.js` 完整拥有授权 URL、回调签名、授权码交换、Token 刷新、账户目录分页及其规范化/错误。Secret Key 只保存于该 OAuth 客户端；facade 仅在构造时直接传入 OAuth 客户端，不保存该值，HTTP 内核和剩余搜索/统计逻辑均不持有 Secret。
- 聚焦 OAuth、统计、搜索、默认 transport、Issue 001 和模块边界共 33/33 通过；全量营销回归 241/241 通过；后端顶层回归 994/994 通过。该 issue 不修改前端、公开 API、数据库、页面或配置，因此未运行前端构建与浏览器验收。
- 本地候选路径为 `marketing/index.js → BaiduMarketingClient facade → {BaiduOAuthClient, 剩余搜索/统计逻辑} → 同一 BaiduHttpKernel`；没有旧网络 fallback。按需求约束该中间态不发布，所以生产正式入口仍运行 007 已发布 revision 的旧单体实现，本地拆分目前不会在正式流程生效。
- 下一门禁是 Issue 003：在保持 facade、共享内核、四报表顺序、双读、QPS、整轮预算和原子快照全部等价的前提下抽取 `BaiduSearchAdsClient`；不得修改 composition root、API、数据库或页面。
