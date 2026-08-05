---
title: "冻结百度 Provider 黑盒等价合同"
status: closed
type: AFK
blocked_by:
  - "003 完成 A2 并关闭"
  - "../../closed-2026-08-05-006-marketing-api-resourceization/issues/007-release-r2-and-retire-large-dashboard.md"
  - "../../closed-2026-08-05-007-marketing-production-data-correctness/prd.md"
---

# 冻结百度 Provider 黑盒等价合同

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-2：共享网络安全控制不能因拆分而复制或放宽。
- US-3：广告与流量数据、错误和预算在重构前后保持一致。

## What to build

在现役单体 Provider 仍是唯一正式真值时，建立一套通过公开 facade 执行的脱敏黑盒特征合同。合同覆盖 OAuth、账户目录、搜索推广四报表和百度统计主要报告，冻结请求序列、允许路径、输出、稳定错误、预算、等待、取消和导出 identity。

本切片只增加可执行证据，不改变生产 Provider。后续切片不能通过更新 golden 来接受未批准的行为变化。

## Acceptance criteria

- [x] 公开构造、方法、导出和错误 class identity 均有合同断言。
- [x] 脱敏 trace 覆盖 method、path、body 形状、timeout、响应字节、等待和取消，不包含 Token、Secret、关键词或搜索词明文。
- [x] 搜索推广四报表顺序、双读、QPS、整轮预算和规范化输出在旧实现上被固定。
- [x] 百度统计站点、趋势、来源、质量和页面分页的成功、合法空数据与错误合同被固定。
- [x] 007 修正后的来源 COMPLETE/PARTIAL/INVALID、同路径页面消歧和相关稳定错误合同被固定。
- [x] allowlist、HTTP 非成功、超时、超大响应、非 JSON 和网络失败均有稳定错误四元组断言。
- [x] 全部新增合同测试在未拆分的现役 Provider 上通过，运行代码 diff 为零。

## Blocked by

- 003 完成 A2、正式入口验收并关闭。
- [006 Issue 007：R2 正式切换并退役旧大响应](../../closed-2026-08-05-006-marketing-api-resourceization/issues/007-release-r2-and-retire-large-dashboard.md)。
- [007：营销生产数据正确性与双周期回归](../../closed-2026-08-05-007-marketing-production-data-correctness/prd.md)完成正式入口验收并关闭。

## 验收证据

- TDD 红灯先因缺少 `createSanitizedProviderTrace` 以 `MODULE_NOT_FOUND` 失败；补齐测试侧记录器后，新增黑盒合同 7/7 通过。记录器只保存请求方法、无查询参数路径、递归 body 类型形状、timeout、响应字节、等待和取消原因；凭据、授权码、关键词与搜索词字段统一写为 `[REDACTED]`。
- facade 合同固定四个 CommonJS 导出、21 个 prototype 方法、`BaiduMarketingError` 与 `BaiduContractBlockedError` 的 class identity，以及错误 `name/code/status/retryable` 四元组。OAuth、账户目录、四份搜索报告与五类百度统计读取均只经公开 `BaiduMarketingClient` 调用。
- 搜索推广合同固定 `2290316 → 2284618 → 2602783 → 2307838` 两轮顺序、同一整轮 budget、现役 50/50/10/10 QPS 产生的 `20ms + 80ms` 等待、每请求 8 MiB 上限、512 请求整轮上限和规范化输出；现有分页、行数、64 MiB、120 秒及不稳定双读测试继续共同生效。
- 百度统计合同固定站点目录、趋势、来源、质量指标、页面报告、合法空页和不支持来源错误；每项请求保持 2 MiB 响应上限。007 的 `COMPLETE`、`83/82 PARTIAL`、不可能分区 `TONGJI_SOURCE_PARTITION_INVALID`，以及 `baidu-page:<pageId>` 同路径消歧身份继续是重构基线。
- 安全传输合同以真实默认 transport 固定 allowlist、HTTP 503、100ms 超时、Content-Length 超限、非 JSON、网络失败六类错误四元组，并观测到 HTTP、超限与超时中止三类取消事件；错误结果不含模拟上游细节。
- 聚焦合同与相关回归 46/46 通过；全量营销回归 238/238 通过；后端顶层回归 994/994 通过。Issue 001 不涉及前端、构建或浏览器行为，因此未运行前端与浏览器验收。
- `git diff -- backend/modules/marketing` 为空；生产运行代码、数据库、配置、页面与部署均未改变。当前正式入口仍由 `backend/modules/marketing/adapters/BaiduMarketingClient.js` 单体 facade 处理全部百度调用，新测试不是运行入口，旧单体仍是默认且尚未退役。
- 秘密与无关修改扫描未发现生产 Token、Secret、Authorization、Cookie、服务器凭据、真实关键词/搜索词或 0805-002 文件。下一门禁是 Issue 002：在保持本合同全绿的前提下抽取唯一安全 HTTP 内核与 OAuth 客户端；在 Issue 005 正式硬切前，本需求不会改变生产路径。
