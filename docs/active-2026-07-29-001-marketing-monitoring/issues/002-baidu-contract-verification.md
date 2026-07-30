---
title: "确认百度 OAuth 与搜索推广真实契约"
status: blocked
type: HITL
blocked_by: []
---

# 确认百度 OAuth 与搜索推广真实契约

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 覆盖：US-001、US-002、US-005

## Goal

用百度官方文档、调试工具或获批测试账户确认 OAuth、账户目录和搜索推广报表的真实契约，形成版本化 `manifest.json` 与脱敏 fixtures。该门禁完成前不得实现真实响应解析。

## Scope

- 只确认 SEARCH 和只读接口，不研究 FEED 或写接口。
- 确认授权、换 Token、refresh grant、账户目录和搜索报表。
- 确认 Long ID wire 类型/唯一作用域、金额、时区、分页、限流、错误、撤权能力和数据规模。
- 更新 Tech Spec、适配器类型及 Issues 003～009 的受影响验收标准。
- 禁止提交 Secret、Token、授权码、原始 state、签名和可识别账户隐私。

## Acceptance Criteria

- [ ] 清单记录证据日期、官方来源、应用权限、接口版本和被验证账户类型。
- [ ] 授权请求、callback、code exchange 的参数、Content-Type、响应和错误已确认。
- [ ] refresh grant 的请求、过期字段及 Refresh Token 缺失/相同/新值行为已确认。
- [ ] refresh grant 响应丢失后的安全重放语义与结果未知处理已确认。
- [ ] 百度侧撤权端点及语义已确认；不存在时明确记录本地断开与控制台撤权步骤。
- [ ] 账户目录字段、外部 ID JSON 类型、分页和授权主体关系已确认。
- [ ] 搜索报表的服务名、请求体、字段、业务错误包裹和完整分页已确认。
- [ ] 日期上限、统计时区、数据延迟、限流、重试提示和响应大小已确认。
- [ ] 每个外部 ID 的 wire 类型、前导零、字符集和跨授权主体唯一作用域已确认。
- [ ] HTTP/业务错误到内部 code、retryable、retryAfter 和连接状态的映射已确认。
- [ ] 广告消费币种、原始单位、最大精度和固定 scale 归一规则已确认。
- [ ] 单账户及项目合计的绑定数、推广计划行数与响应字节安全预算已确认；超限时重开 API 设计。
- [ ] manifest 能逐项追溯到脱敏样本或官方证据，未知项明确标为 blocker。
- [ ] Tech Spec 与下游 issue 已按最终契约修订，不保留与证据冲突的占位假设。

## Verification

```bash
node --test backend/tests/marketing/BaiduContractManifest.test.js
node --test backend/tests/marketing/BaiduContractSecrets.test.js
git diff --check
```

人工证据：

- 百度控制台/调试工具的脱敏记录与 manifest 版本一致。
- schema、占位符、唯一 canary 和熵扫描通过，并由第二人确认 fixtures 无秘密、无原始 state、无可识别账户数据。
- 对未能真实触发的 refresh 变体明确记录“未观察”，不能伪造成功证据。

## Blocked by

- 获批百度应用或可用测试账户。
- 百度官方调试能力。
- 当前用户已明确暂不提供外部系统接口；2026-07-29 起等待真实契约证据。

## 2026-07-29 工程进展

- 历史：曾建立 `baidu-marketing-pending-2026-07-29` 通用 OAuth 阻塞清单；该错误路径已于 2026-07-30 删除，不再是当前契约入口。
- 历史：当时生产出站 allowlist 为空且适配器未实现；当前状态以 2026-07-30 进展为准。
- 已完成来源追溯、阻塞状态、秘密扫描和无出站请求测试。
- 未提供获批应用、真实账户或脱敏响应，因此账户目录、搜索报表、金额、时区、分页、限流、错误、撤权和刷新轮换仍不得推测，本 issue 不关闭。

## 2026-07-30 官方文档与实现进展

- 用户指定的 `pageId=100138` 是营销 API 能力总览；具体 OAuth 契约来自同一官方站点 `pageId=100441`，搜索推广计划报告来自 `pageId=102474`。
- 已新增不可变清单 `baidu-marketing-docs-2026-07-30/manifest.json`，确认授权页、六参数签名 callback、Token/refresh、`getUserInfo`、请求包裹和 `reportType=2290316` 计划报告请求。
- 已实现官方 AES-128-CBC/NoPadding callback 验签、出站方法+主机+路径白名单、Token/账户请求和计划报告请求构造；生产 allowlist 仍为空。
- 官方 Token 参数表要求 `grantType=auth_code`，同页 Demo 使用 `access_token`；当前遵循参数表并保留真实试点 blocker。
- 官方计划报告页没有给出成功响应体，`cost` 只说明为 `Double`，未说明币种/固定 scale/时区；适配器会在成功请求后以 `BAIDU_REPORT_RESPONSE_UNVERIFIED` 阻断解析，不伪造映射。
- 新增 `PILOT_READY`：只允许授权、callback、Token 与账户目录，项目绑定、报表刷新、executor 和导航不会在正式流程生效。
- 仍需本项目专用获批应用、实际 scope、普通/超管/代理商账户样本、报告成功/错误样本、refresh 轮换与响应丢失证据，因此本 issue 保持 blocked。

## 2026-07-30 真实试点证据

- 专用应用、稳定 HTTPS callback 和获批 Scope 已验证；动态 state 授权、Token 交换与账户目录成功。
- 搜索计划报告真实返回 777 行、4 页；响应体、分页、账户/计划/日期/指标 wire 类型已用完全脱敏 fixture 固化。
- 百度统计站点目录与 `trend/time/a` 响应已验证；`--` 无数据标记不转换为 0。
- 新契约只标记为 `PILOT_VERIFIED`，保留金额/时区正式证据、refresh 轮换、撤权和错误重试 blocker，因此本 issue 仍不关闭。
