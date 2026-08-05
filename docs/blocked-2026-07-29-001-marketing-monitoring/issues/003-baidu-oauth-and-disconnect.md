---
title: "完成百度 OAuth、连接与断开闭环"
status: blocked
type: AFK
blocked_by:
  - "001-module-foundation.md"
  - "002-baidu-contract-verification.md"
---

# 完成百度 OAuth、连接与断开闭环

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 覆盖：US-001、US-007

## Goal

实现管理员从本站发起授权、经一次性同源启动地址跳转百度、处理 callback、安全保存连接、重新授权和断开本地连接的完整路径。

## Scope

- 迁移 `baidu_authorization_attempts` 和 `baidu_marketing_connections`。
- 实现授权尝试、固定 launch、callback、本次结果读取、连接列表、重授权和断开。
- callback 完成后跳转无查询参数结果页。
- 断开清 Token 并暂停相关绑定的接口边界；绑定表在 Issue 004 落地。
- 本 issue 不拉取报表。

## Acceptance Criteria

- [ ] 认证 POST 设置一次性 HttpOnly/Secure/SameSite launch Cookie；普通 JSON 只返回固定同源 `launchUrl`，不返回票据、百度 URL 或原始 state。
- [ ] launch 重查发起人仍为 active 管理员，消费 Cookie 后才生成 provider state、保存哈希并 303 到百度。
- [ ] callback 精确解析单值参数，拒绝重复键、数组、超长、过期、篡改和重放。
- [ ] callback CAS `PENDING -> PROCESSING` 后才换 Token。
- [ ] 授权尝试记录 operation、目标连接和 expected auth generation。
- [ ] 最终写入前重查管理员、目标连接代次和外部授权主体。
- [ ] 新重授权或断开使旧尝试失效；晚到回调不能覆盖新凭据。
- [ ] code exchange 超时且结果不确定时进入 `OUTCOME_UNKNOWN`，不盲重试。
- [ ] Token 复用现有加密服务保存，Long ID 的 wire 解码与编码不经过 JavaScript Number。
- [ ] callback 设置一次性结果 Cookie 并只 303 到 queryless 结果页；发起管理员可读取本次 attempt 终态，包括失败和 `OUTCOME_UNKNOWN`。
- [ ] launch/callback/结果页使用 no-store/no-referrer；动态票据、query 和 303 Location 不进入测试遥测。
- [ ] 断开递增 auth generation、清除两个 Token、阻止后续目录和刷新调用；百度侧撤权按契约执行或明确转人工。
- [ ] 页面、API、测试代理和日志哨兵中不存在 Token、Secret、授权码和原始 state。

## Verification

```bash
node --test backend/tests/marketing/BaiduAuthorizationApi.test.js
node --test backend/tests/marketing/BaiduAuthorizationRace.test.js
node --test backend/tests/marketing/BaiduCredentialLeak.test.js
npm --prefix backend run audit:marketing
npm --prefix backend test
git diff --check
```

证据：

- 测试记录包含重复 callback、晚到 callback、断开竞争和 `OUTCOME_UNKNOWN`。
- 本地测试代理与日志哨兵使用唯一假秘密，并证明扫描结果为零。
- 从真实设置页点击能在现有 Bearer JWT 架构下进入百度授权页；结果页 URL 不含 callback 参数且能关联本次尝试。

## Blocked by

- `001-module-foundation.md`
- `002-baidu-contract-verification.md`

## 2026-07-29 工程进展

- 已完成一次性 launch/result Cookie、state 哈希、callback CAS、凭据加密、重授权代次、断开清密钥与绑定暂停。
- 已用真实 Express 入口和竞态测试验证重放、重复参数、结果未知、错误主体及断开行为。
- 历史：2026-07-29 阻塞契约下所有授权路由 fail-closed；当前默认仍关闭，但显式 `PILOT_READY` 已可调用只读试点接口。
- 待 Issue 002 提供真实 Token/撤权契约后实现并验收生产适配器，因此本 issue 不关闭。

## 2026-07-30 官方 OAuth 适配进展

- callback 已硬切为百度营销的 `appId/authCode/state/userId/timestamp/signature`，删除通用百度 OAuth 的 `code/error/error_description` 兼容。
- 已按官方算法实现自然 key 排序 JSON、Base64、`secretKey` 前 16 字符、AES-128-CBC/NoPadding、零 IV、大写 HEX 和常量时间比较。
- Token 交换已硬切到 `POST https://u.baidu.com/oauth/accessToken`，Refresh Token 已硬切到 `POST https://u.baidu.com/oauth/refreshToken`。
- 新增迁移 `004-baidu-oauth-identity`，保存加密 Token 之外的 `openId` 与 Refresh Token 到期时间；刷新请求同时绑定授权 `userId`。
- 受限试点可从公网正式路由完成真实 OAuth，但百度应用尚未申请/审核，真实 callback 与撤权仍未验收，本 issue 不关闭。
