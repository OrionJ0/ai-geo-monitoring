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

- 已建立版本化阻塞清单 `baidu-marketing-pending-2026-07-29/manifest.json`，记录证据日期、3 个官方来源、已确认的通用 OAuth 事实和全部未知项。
- 生产出站 allowlist 保持为空，`runtime.adapterImplemented=false`；配置审计和适配器构造都会 fail-closed。
- 已完成来源追溯、阻塞状态、秘密扫描和无出站请求测试。
- 未提供获批应用、真实账户或脱敏响应，因此账户目录、搜索报表、金额、时区、分页、限流、错误、撤权和刷新轮换仍不得推测，本 issue 不关闭。
