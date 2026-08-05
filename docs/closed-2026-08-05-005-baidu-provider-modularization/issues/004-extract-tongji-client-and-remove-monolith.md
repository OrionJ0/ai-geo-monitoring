---
title: "抽取百度统计客户端并删除单体产品逻辑"
status: closed
type: AFK
blocked_by:
  - "003-extract-search-ads-client.md"
---

# 抽取百度统计客户端并删除单体产品逻辑

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-1：百度统计变化被限制在独立产品客户端内。
- US-2：统计请求继续经过唯一安全内核。
- US-3：流量页面的数据、分页、空值和错误语义不变。

## What to build

把站点目录、趋势、质量、来源和页面报告的请求、能力开关、分页、预算和严格解析完整迁入百度统计客户端。完成后 facade 只保留构造、委托和兼容导出，并删除其中已经迁出的产品常量、parser、分页和网络逻辑。

## Acceptance criteria

- [x] 统计客户端只接收 003 统一后的 Access Context、`userName` 和 `site_id`，不实现 Token 生命周期或持久化。
- [x] 站点、趋势、质量、来源和页面报告的设备、日期、分页、去重、合法空数据与错误合同和基线一致。
- [x] 统计与搜索客户端互不 require，且共享同一个 HTTP 内核实例。
- [x] facade 只负责构造、委托和兼容导出，不保留产品请求、parser、分页或 fallback。
- [x] 旧单体产品逻辑和重复安全网络实现的生产引用为零。
- [x] 管理、网站流量、来源趋势和页面报告集成测试全部通过，统一 Token 失败时不调用旧实现。

## Blocked by

- [Issue 003：抽取搜索推广四报表客户端](003-extract-search-ads-client.md)。

## 验收证据

- TDD 红灯先让模块边界测试因缺少 `BaiduTongjiClient` 以 `MODULE_NOT_FOUND` 失败；实现后 facade/模块边界与等价合同聚焦 72/72 通过。
- `BaiduTongjiClient.js` 独占站点目录、趋势、质量、来源与页面报告的日期/设备校验、来源能力开关、2 MiB 单响应预算、页面报告 30 秒整轮预算、分页去重和严格 parser。它只持有 manifest 与共享 HTTP 内核，不持有 Secret，也不实现 Token 获取、刷新、密文持久化或备用凭据。
- facade 已收敛为兼容组合层，只构造一个 HTTP 内核、一个 OAuth 客户端、一个搜索推广客户端和一个百度统计客户端，并保留原四个 CommonJS 导出及 21 个 prototype 方法；百度统计五个公开方法仅委托唯一统计客户端。
- 管理/绑定、统一 Access Context、统一 OAuth 只读探针、网站流量、来源趋势与页面报告集成回归 70/70 通过；统一 Token 失败继续返回统一上下文错误，不调用替代凭据或旧统计实现。
- 007 的来源 `COMPLETE/PARTIAL/INVALID`、83/82 PARTIAL、缺失与真实零，以及相同页面路径稳定消歧继续由等价基线覆盖；没有修改统计缓存、公开 API、数据库、页面或指标合同。
- 依赖与源码扫描确认搜索推广和百度统计客户端互不 require；唯一 `defaultTransport`、allowlist、fetch/AbortController 仍只在 `BaiduHttpKernel`。facade 内不再存在产品常量、request body、parser、分页循环、feature flag 或 runtime fallback。
- 全量营销回归 244/244、后端顶层回归 994/994 通过，`git diff --check` 通过。该 issue 不涉及前端或正式发布，因此无需重复前端构建与浏览器验收。
- 本地候选路径为 `marketing/index.js → BaiduMarketingClient facade → {BaiduOAuthClient, BaiduSearchAdsClient, BaiduTongjiClient} → BaiduHttpKernel`，旧单体产品实现已删除。中间态仍未发布，生产正式入口继续运行 007 revision `17214184f9c0ec2c9508080cb571f6b8b45923c4` 的单体 Provider；本地模块化结构目前不会在正式流程生效。
- 下一门禁是 Issue 005：完成对抗式审查、全量等价与秘密扫描，确认 0805-002 没有发布/观察冲突后，使用 Git Bundle 和 systemd 正式硬切，并从 `https://insight.guangtuo.com` 验证 OAuth、四报表、百度统计和全部营销页面。
