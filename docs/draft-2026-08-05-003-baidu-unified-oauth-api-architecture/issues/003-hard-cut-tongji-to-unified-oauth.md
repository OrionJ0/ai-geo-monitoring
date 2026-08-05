---
title: "硬切百度统计到统一 OAuth 运行路径"
status: open
type: AFK
blocked_by:
  - "002-deliver-versioned-product-capability-state.md"
---

# 硬切百度统计到统一 OAuth 运行路径

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-1：管理员只维护一套百度秘密凭据。
- US-2：管理页面独立显示两个产品的真实能力。
- US-3：广告、流量与官网咨询继续保持各自主数据源。
- US-5：统一凭据不改变公开数据合同或 Provider 行为。

## What to build

把百度统计站点目录、趋势、来源和页面读取全部切换到由统计用户名与版本化 OAuth Access Context 组成的唯一上下文。管理员只能配置非秘密 userName，服务端必须用当前 OAuth Token 即时验证站点目录后才保存；正常读取、绑定恢复和 TTL 复核统一经过同一个上下文入口。

同一切片删除旧统计 Token 输入、写路由、凭据 service、内联 resolver 和运行时解密路径。统一 OAuth 失败时直接返回稳定错误，不读取旧字段、不调用第二枚 Token、不保留 feature flag 或 fallback。公开营销数据 API、四报表原子刷新、统计缓存和页面数据语义保持不变。

## Acceptance criteria

- [ ] 统计上下文只组合已验证 userName 与连接服务返回的当前 Access Context，不实现第二套 Token 生命周期或缓存。
- [ ] 用户名配置请求只接受严格 `{ userName }`，使用当前 OAuth Token 成功读取站点目录后才以观察版本 CAS 保存。
- [ ] 站点目录、绑定创建/恢复、趋势、来源趋势和页面读取全部经过唯一统计上下文与现役并发门，不存在第二个 resolver。
- [ ] 24 小时站点归属 TTL、绑定版本变化、账号错误和域名变化按 Tech Spec 触发复核，域名变化不自动改绑。
- [ ] 旧统计凭据写路由不再注册并返回标准 404；旧凭据 service、模块装配、Token 解密和运行时调用全部删除。
- [ ] 管理页面只有一个 OAuth 授权入口，可配置非秘密统计用户名并分别展示 marketing/tongji 状态，不再显示或提交统计 Token。
- [ ] 连接列表继续是裸数组，旧前端字段依赖为零；桌面、移动端、键盘操作和独立产品失败状态通过回归。
- [ ] 旧统计密文字段写入测试 canary 后，所有运行路径的 SQL、service 和日志读取次数仍为零。
- [ ] 统一 OAuth 不可用时不 fallback；上游错误不会覆盖上一份完整广告快照，也不会改变广告/统计/官网主数据源边界。
- [ ] Dashboard、流量总览、页面报告、刷新任务和官网接口路径与响应语义回归通过；Provider、预算、双读和原子快照行为不变。
- [ ] A1 候选 revision 只包含迁移 014，明确不包含迁移 015。

## Blocked by

- [Issue 002：交付版本化百度产品能力状态](002-deliver-versioned-product-capability-state.md)。
