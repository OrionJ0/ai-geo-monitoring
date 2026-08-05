---
title: "硬切百度统计到统一 OAuth 运行路径"
status: closed
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

- [x] 统计上下文只组合已验证 userName 与连接服务返回的当前 Access Context，不实现第二套 Token 生命周期或缓存。
- [x] 用户名配置请求只接受严格 `{ userName }`，使用当前 OAuth Token 成功读取站点目录后才以观察版本 CAS 保存。
- [x] 站点目录、绑定创建/恢复、趋势、来源趋势和页面读取全部经过唯一统计上下文与现役并发门，不存在第二个 resolver。
- [x] 24 小时站点归属 TTL、绑定版本变化、账号错误和域名变化按 Tech Spec 触发复核，域名变化不自动改绑。
- [x] 旧统计凭据写路由不再注册并返回标准 404；旧凭据 service、模块装配、Token 解密和运行时调用全部删除。
- [x] 管理页面只有一个 OAuth 授权入口，可配置非秘密统计用户名并分别展示 marketing/tongji 状态，不再显示或提交统计 Token。
- [x] 连接列表继续是裸数组，旧前端字段依赖为零；桌面、移动端、键盘操作和独立产品失败状态通过回归。
- [x] 旧统计密文字段写入测试 canary 后，所有运行路径的 SQL、service 和日志读取次数仍为零。
- [x] 统一 OAuth 不可用时不 fallback；上游错误不会覆盖上一份完整广告快照，也不会改变广告/统计/官网主数据源边界。
- [x] Dashboard、流量总览、页面报告、刷新任务和官网接口路径与响应语义回归通过；Provider、预算、双读和原子快照行为不变。
- [x] A1 候选 revision 只包含迁移 014，明确不包含迁移 015。

## Blocked by

- [Issue 002：交付版本化百度产品能力状态](002-deliver-versioned-product-capability-state.md)。

## 验收证据

- TDD 红灯先证明新 context service 缺失、正式流量仍读取旧统计密文、旧路由与 Token UI 仍存在；实现后新增 5 个统计上下文/API 合同用例，覆盖严格 body、版本 CAS、24 小时 TTL、绑定版本变化、域名变化、账号错误、队列重试头和零 fallback。
- `npm run test:marketing`：174/174 通过；Dashboard、四报表刷新、统计缓存、来源趋势、页面报告、迁移 014 与旧路由 404 均包含在回归范围内。
- 前端 `node --test tests/marketing/*.test.cjs`：106/106 通过；目标组件 ESLint 通过；`next build --webpack` 编译、应用 TypeScript 和 40 个路由生产构建通过。
- 真实 Chrome：`baidu-marketing-settings.spec.ts` 桌面与 390×844 移动端 2/2 通过；验证双产品独立状态、营销区域零密码输入、键盘 Enter 打开对话框、PUT 仅提交 `{ userName }`，并保存桌面/移动端截图。
- 代码搜索证明现役模块不再读取 `tongji_access_token_ciphertext`、不装配 `BaiduTongjiCredentialService`、不存在旧内联 resolver 或 `tongji-credential` 路由；旧字段仅保留在不可变迁移、A2 前只读探针和回归 canary 中，等待 Issue 005/迁移 015 最终删除。
- 当前 feature worktree 的 A1 候选最高迁移仍为 `014-unified-oauth-context`，仓库中不存在迁移 015；未执行生产迁移、发布、重新授权或 Token 操作。

## 正式路径与下一门禁

- 本地 A1 候选：站点目录、绑定校验、趋势、来源趋势和页面报告默认走 `BaiduTongjiContextService → BaiduConnectionService.getAccessContext`；旧实现已从候选代码删除。
- 当前生产：尚未发布本 issue，仍运行 A1 前 revision 和旧独立统计 Token 路径；本地完成不代表生产切换。
- 下一门禁：Issue 004 在用户明确批准后生成独立 A1 Git Bundle、应用且仅应用迁移 014，并从 `https://insight.guangtuo.com` 验证真实管理、广告与流量入口。A1 发布属于 HITL。
