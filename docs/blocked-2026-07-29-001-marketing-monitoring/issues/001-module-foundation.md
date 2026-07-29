---
title: "建立营销模块、测试入口与迁移基础"
status: closed
type: AFK
blocked_by: []
---

# 建立营销模块、测试入口与迁移基础

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 覆盖：US-003、US-007、US-009

## Goal

在不调用百度、不创建广告数据的前提下，建立独立营销模块、模块状态、显式迁移 runner 和前端测试入口。模块默认关闭，现有 GEO/SEO 正式入口不受影响。

## Scope

- 创建 `backend/modules/marketing/` facade、配置和状态路由。
- 增加 `audit:marketing`、`migrate:marketing`，先建立带 checksum 和并发锁的迁移 ledger/runner；不创建可被后续改写的占位迁移。
- 确保营销模型不参加根 `sequelize.sync()`。
- 增加营销页面骨架和静态“后续接入落地页/销售系统”说明。
- 为 `nextjs-frontend` 增加真实可执行的 `test` script。
- 为后端增加递归执行 `backend/tests/marketing/` 的 `test:marketing` script。
- 不创建百度连接、绑定、指标或运行表。

## Acceptance Criteria

- [x] `MARKETING_MONITORING_ENABLED` 默认关闭；全空配置不改变现有启动、health 或 ready。
- [x] 启用但配置不完整时只返回 `MISCONFIGURED` 和缺失键名，不回显值。
- [x] 回调配置有 query、fragment 或非测试 HTTP 地址时审计失败。
- [x] 营销路由通过模块 facade 挂载，不继续扩张现有大型 GEO 路由。
- [x] 根 `sequelize.sync()` 不创建任何 `baidu_*` 表。
- [x] 营销迁移 ledger 记录不可变 checksum，SQLite 可幂等审计/应用；真实 PostgreSQL runner 与 DDL 验收在 Issue 005 完成。
- [x] 模块状态接口不泄露 Secret；普通用户不能读取管理员级配置详情。
- [x] 页面骨架无假咨询、假订单、信息流或完整漏斗。
- [x] `npm --prefix nextjs-frontend test` 确实执行测试，空测试或静默成功不可接受。
- [x] 故意失败的营销测试会让 `test:marketing` 非零退出，证明发布命令没有漏掉子目录。
- [x] 营销配置异常只使营销模块 fail-closed，不改变现有 GEO/SEO 全局 ready。

## Verification

```bash
node --test backend/tests/marketing/MarketingModule.test.js
node --test backend/tests/marketing/MarketingMigration.test.js
node --test backend/tests/marketing/MarketingConfig.test.js
npm --prefix backend run test:marketing
npm --prefix nextjs-frontend test
npm --prefix nextjs-frontend run lint
npm --prefix nextjs-frontend run build
npm --prefix backend run migrate:marketing
npm --prefix backend run audit:marketing
npm run deploy:check
git diff --check
```

证据：

- 自动测试证明模块关闭时现有 GEO/SEO 路由和 readiness 不变。
- 数据库检查证明根 `sequelize.sync()` 后不存在营销领域表，修改已应用迁移 checksum 会被审计拒绝。
- 前端测试输出显示至少一个营销页面骨架测试被执行。

## Blocked by

None.

## Completion

- 完成日期：2026-07-29
- 正式状态：模块代码和状态路由已接入，默认关闭；营销页面骨架已构建，但尚未加入工作台导航。
- 迁移状态：仅创建不可变技术 ledger，没有任何百度领域表或占位迁移。
- 验收证据：营销测试 18 项、前端骨架测试 3 项、后端回归 880 项、前端 lint/build、临时 SQLite migrate/audit 和 `git diff --check` 均通过。
