---
title: "交付版本化百度产品能力状态"
status: open
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

- [ ] 迁移 014 增加非秘密统计用户名、验证时间和两个产品的最小状态字段，候选旧用户名不自动标记为已验证。
- [ ] 迁移不复制、不解密第二枚统计 Token，也不根据历史快照或缓存推断 `VERIFIED`。
- [ ] 唯一 Access Context 在必要刷新完成后返回 Access Token、auth generation 和 token version；旧 Token getter 只作为内部兼容包装。
- [ ] 连接 API 保持裸数组，在单行 additive 返回 marketing/tongji 有效状态，不暴露 Token、内部版本、scope 或原始错误。
- [ ] 状态不对应当前 auth generation/token version 或连接非 CONNECTED 时，对外只能是 `UNKNOWN`。
- [ ] 重新授权、回调、刷新和断开原子失效两个产品状态；刷新与重授清验证时间，断开还清统计用户名。
- [ ] 产品验证结果使用观察版本 CAS 写回，旧请求晚回影响 0 行且不能覆盖新状态。
- [ ] 权限不足、账号不匹配、上游错误和合法无数据使用各自稳定状态，不相互冒充。
- [ ] 迁移 CLI 支持并测试 `--expected-latest=014-unified-oauth-context`，任何缺失、越界或意外 pending 版本都在事务前失败。
- [ ] 本切片仓库中不存在迁移 015，也不修改公开营销数据 API、Provider、快照或数据来源语义。

## Blocked by

- [Issue 001：用生产只读探针证明统一 OAuth 前提](001-prove-unified-oauth-production-preflight.md)。
