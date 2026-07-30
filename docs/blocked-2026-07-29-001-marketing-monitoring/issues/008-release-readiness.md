---
title: "补齐安全、迁移与发布准备"
status: blocked
type: AFK
blocked_by:
  - "007-marketing-dashboard-accessibility.md"
---

# 补齐安全、迁移与发布准备

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 覆盖：第一期工程发布门禁

## Goal

把搜索营销模块纳入现有部署检查、显式迁移、readiness、日志安全、文档和入口回归，使其具备进入真实百度生产验收的条件。

## Scope

- 全新/已有 SQLite 与 PostgreSQL 迁移审计。
- 部署顺序、配置检查、启动恢复和关闭钩子。
- 本地测试代理、生产入口合成 canary 预检及自动日志哨兵。
- README、API、环境、部署和故障处理文档。
- 真实授权前先扫描生产代理/APM 的合成 canary；Issue 009 在真实授权后复扫。

## Acceptance Criteria

- [ ] 5 张领域表及 ledger 在全新和已有 SQLite/PostgreSQL 幂等迁移。
- [ ] 外键、十进制 TEXT CHECK、绑定防重和活动 run 唯一由数据库强制。
- [ ] 发布脚本按“备份→迁移→审计→启动→ready”执行。
- [ ] 根 `sequelize.sync()` 不创建或修改营销表。
- [ ] 模块配置、schema、singleton 或启动恢复异常使营销路由 fail-closed，但不使 GEO/SEO 全局 readiness 失败。
- [ ] 百度网络不可达不影响 readiness，页面仍可读取旧快照。
- [ ] 配置检查拒绝部分配置、不安全 callback、未知契约版本且不回显值。
- [ ] 本地与生产入口测试不记录 launch Cookie/path 秘密、callback query、303 Location 或 OAuth/Token body，安全头和独立限流生效。
- [ ] 自动哨兵扫描页面、API、本地代理和应用日志，秘密命中数为零。
- [ ] 方法+主机+路径的自动 allowlist 测试证明没有百度写接口，任何未知出站请求使测试失败。
- [ ] 服务端测试项目 allowlist 阻止非试点用户直接访问 URL/API；验收后才能扩展为正式范围。
- [ ] 无重叠部署和 executor singleton 入口级测试通过。
- [ ] 管理员状态可发现陈旧、连续失败、超时 run、需重授权和结果未知；故障文档写明负责人、处置与恢复验证。
- [ ] 项目归档/删除、应用关停和模块关闭入口级回归通过。
- [ ] 现有 GEO/SEO 构建、默认测试和正式入口不受影响。
- [ ] 当前运行、迁移、回滚和故障文档不描述 FEED 或未来来源为已实现。

## Verification

```bash
npm --prefix backend test
npm --prefix backend run test:marketing
npm --prefix nextjs-frontend test
npm --prefix nextjs-frontend run test:marketing:browser
npm --prefix nextjs-frontend run lint
npm --prefix nextjs-frontend run build
npm --prefix backend run migrate:marketing
npm --prefix backend run audit:marketing
POSTGRES_TEST_URL='<disposable-test-url>' npm --prefix backend run test:postgres:marketing
npm run test:deployment
npm run deploy:check
node --test backend/tests/marketing/BaiduOutboundAllowlist.test.js
git diff --check
```

证据：

- 全新库、升级库、模块开/关和百度不可达的入口级日志。
- 唯一合成 canary 在任何真实 Token 进入前经过浏览器/API/生产代理/APM/应用日志全链路后扫描为零。
- 部署检查输出明确证明迁移和 readiness，而不只检查 health。

## Blocked by

- `007-marketing-dashboard-accessibility.md`

## 2026-07-29 工程进展

- 已完成 5 张领域表与 ledger、SQLite 迁移/审计、PostgreSQL runner、安全配置审计、试点项目 allowlist 和独立授权限流。
- 部署脚本已按备份后、启动前执行营销迁移与 checksum 审计，并运行营销后端/前端/浏览器测试。
- 历史：2026-07-29 阻塞契约没有网络适配器；当前已有文档白名单适配器和受限试点，生产 allowlist 仍为空，全局 readiness 仍不依赖百度。
- 真实 PostgreSQL、生产 ingress/APM canary、日志扫描、部署 singleton 和正式入口验收需外部环境，本 issue 不关闭。

## 2026-07-30 发布准备进展

- 不可变迁移增加到 4 个，新增 `authorized_open_id` 与 `refresh_token_expires_at`，SQLite 测试已覆盖升级后的列审计。
- 环境变量已硬切到百度官方术语 `APP_ID/SECRET_KEY/SCOPE`，删除旧 `CLIENT_ID/CLIENT_SECRET` 路径。
- 新增显式 `MARKETING_MONITORING_PILOT_MODE`；文档契约只能进入 `PILOT_READY`，正式模式仍要求 `VERIFIED`、零 blocker、完整金额口径与生产 allowlist。
- 试点正式入口只开放授权/账户检查，绑定、看板、刷新和 executor 返回 `MARKETING_PILOT_AUTH_ONLY`；营销测试全量通过。
- 尚未在用户服务器完成部署、HTTPS callback、反向代理/APM 秘密扫描或真实 PostgreSQL 验收，本 issue 不关闭。
