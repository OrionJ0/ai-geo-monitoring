---
title: "交付版本化百度产品能力状态"
status: closed
type: AFK
blocked_by:
  - "001-prove-unified-oauth-production-preflight.md"
---

# 交付版本化百度产品能力状态

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-2：管理员能分别判断搜索推广和百度统计是否可用。
- US-4：授权版本变化后旧的成功状态不会被误用。
- US-5：在现有连接模型上完成最小 additive 扩展。

## What to build

在统一 OAuth 前提通过后，交付迁移 014、版本化 Access Context 和两个产品的独立能力状态。管理连接 API 继续返回裸数组，只 additive 展示搜索推广与百度统计的有效状态；服务端以连接当前 auth generation 和 token version 判定状态是否有效，浏览器不接收内部版本。

重新授权开始、回调完成、Token 刷新和断开必须在原事务中失效旧状态；断开同时清除统计用户名。所有上游验证结果使用观察版本 compare-and-set 写回，旧请求晚回不能覆盖新凭据状态。本切片只建立 A1 所需状态与迁移边界，不切换统计运行时，也不得包含迁移 015。

## Acceptance criteria

- [x] 迁移 014 增加非秘密统计用户名、验证时间和两个产品的最小状态字段，候选旧用户名不自动标记为已验证。
- [x] 迁移不复制、不解密第二枚统计 Token，也不根据历史快照或缓存推断 `VERIFIED`。
- [x] 唯一 Access Context 在必要刷新完成后返回 Access Token、auth generation 和 token version；旧 Token getter 只作为内部兼容包装。
- [x] 连接 API 保持裸数组，在单行 additive 返回 marketing/tongji 有效状态，不暴露 Token、内部版本、scope 或原始错误。
- [x] 状态不对应当前 auth generation/token version 或连接非 CONNECTED 时，对外只能是 `UNKNOWN`。
- [x] 重新授权、回调、刷新和断开原子失效两个产品状态；刷新与重授清验证时间，断开还清统计用户名。
- [x] 产品验证结果使用观察版本 CAS 写回，旧请求晚回影响 0 行且不能覆盖新状态。
- [x] 权限不足、账号不匹配、上游错误和合法无数据使用各自稳定状态，不相互冒充。
- [x] 迁移 CLI 支持并测试 `--expected-latest=014-unified-oauth-context`，任何缺失、越界或意外 pending 版本都在事务前失败。
- [x] 本切片仓库中不存在迁移 015，也不修改公开营销数据 API、Provider、快照或数据来源语义。

## Blocked by

- [Issue 001：用生产只读探针证明统一 OAuth 前提](001-prove-unified-oauth-production-preflight.md)。

## 验收证据

### 2026-08-05 本地 TDD 与回归

- 红灯：新增合同最初因缺少 014 列、`getAccessContext`、能力 CAS 和最高迁移版本门禁产生 9 个预期失败；实现后聚焦迁移、CLI 与产品状态测试 15/15 通过。
- 迁移 014 只复制非空 `tongji_account_name` 到 `tongji_user_name`，验证时间和两个产品 observed 版本保持空，状态为 `UNKNOWN`；旧统计 Token 密文保持原样且未解密、未复制。
- `getAccessContext` 对未过期 Token 返回已提交的授权代次和 Token 版本；刷新成功在同一 CAS 更新中递增版本、失效两个产品状态并清统计用户名验证时间，旧 `getAccessToken` 仅取其 `accessToken`。
- `recordProductAccess` 只允许固定产品和状态，使用 `connection id + CONNECTED + auth generation + token version` CAS；旧请求返回 `false` 且不能覆盖新状态。
- 管理连接真实 HTTP 路由继续返回裸数组；单行 `products.marketing/tongji` 由服务端按当前版本计算，旧版本、空版本、非法状态或非 `CONNECTED` 均 fail closed 为 `UNKNOWN`。响应不含 auth generation、token version、scope、凭据密文或旧统计凭据状态。
- 重授开始、回调成功、OAuth 刷新成功和断开均由自动化证明原子失效两个产品状态；重授/刷新清验证时间，断开清新统计用户名。旧统计字段不再被连接列表读取，也不再被 disconnect 写入。
- 权限缺失使用 `REAUTH_REQUIRED`，用户名不匹配使用 `ACCOUNT_MISMATCH`，网络/限流/5xx 使用 `UPSTREAM_ERROR`，合法无数据仍可记录 `VERIFIED`。
- `--expected-latest=014-unified-oauth-context` 成功应用 001–014；传入 013 边界时在迁移事务前以 `MARKETING_MIGRATION_EXPECTED_LATEST_MISMATCH` 拒绝。迁移 ledger 额外拒绝非连续历史。
- 全量 `npm run test:marketing` 在复用原工作区只读 `node_modules` 且允许本机临时 HTTP 监听的环境中 170/170 通过；`git diff --check` 和语法检查通过。
- 全仓确认不存在迁移 015；本切片没有修改 `BaiduMarketingClient`、公开营销数据 routes、快照表、四报表预算/双读或数据来源合同。

结论：Issue 002 已建立 A1 所需的 expand schema 与版本化能力边界，但尚未切换百度统计运行时。当前正式生产仍使用双凭据旧路径，本地新状态目前不会在正式流程生效。
