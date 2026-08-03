---
title: "53KF 有效对话 API 查证与接入门禁"
status: blocked
type: AFK
blocked_by:
  - "当前 53KF 账户只读开放 API 权限与接口合同"
---

# 53KF 有效对话 API 查证与接入门禁

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- [营销漏斗数据源 ADR](../../adr/0001-marketing-funnel-data-source-of-truth.md)

## Current evidence

- 53KF 官方产品页公开说明支持开放 API，官方帮助文档证明后台保存聊天记录并可按条件查询。
- 官方公开资料没有给出当前账户可直接调用的聊天记录/消息端点、认证参数、字段、限流或历史覆盖合同。
- 当前项目和本地安全配置中没有 53KF 只读凭据；因此不能真实调用，也不能把浏览器私有请求、窗口打开、自动问候或测试 fixture 当成接口证据。

## Acceptance criteria

- [ ] 当前账户已开通独立最小权限只读 API，凭据只存在受控环境中。
- [ ] 真实响应能区分访客、人工客服、机器人和系统消息，并提供稳定会话 ID。
- [ ] 只有至少一条访客实际发送消息的会话进入 `ONLINE_CHAT`；窗口打开、邀请、自动问候和纯客服消息被排除。
- [ ] 严格响应合同、脱敏 fixture、分页/限流/历史覆盖/去重/异常测试通过。
- [ ] 生产入口从 `NOT_CONNECTED` 切为真实 `AVAILABLE/PARTIAL` 并完成页面与日志验收。

## Unblock condition

由 53KF 账户管理员或官方支持提供当前账户的只读开放 API 权限与正式接口文档，至少包含认证、会话列表、消息明细、来源字段、限流和历史保留期。
