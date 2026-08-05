---
title: "发布 A1 并验证统一 OAuth 正式运行"
status: closed
type: HITL
blocked_by:
  - "003-hard-cut-tongji-to-unified-oauth.md"
---

# 发布 A1 并验证统一 OAuth 正式运行

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-1：正式环境只使用一套 OAuth 秘密凭据。
- US-2：两个产品能力在真实刷新前后均可验证。
- US-3：全部营销页面继续使用正确主数据源。
- US-4：A2 不可逆清理前保留明确观察期和恢复路径。

## What to build

把迁移 014、统一统计上下文、管理入口和旧运行路径清理作为 A1 独立 Git Bundle 发布。发布前备份数据库，使用最高版本门禁应用 014，并从正式域名验证管理、广告和流量入口。A1 运行中至少完成一次由现役连接服务管理的真实 OAuth Token 刷新，再用新版本 Token 复验搜索推广和百度统计。

A1 后旧数据库字段暂时存在，但运行时读写必须为零，需求保持 `active`。阻断回归只能通过 A1 后代 revert revision 经正式发布流程恢复明确的 A1 前路径，不允许代码内 fallback、直接编辑服务器或非快进回退。

## Acceptance criteria

- [x] A1 目标 revision 包含迁移 014、统一运行路径、管理 UI、测试和现役文档，但不存在迁移 015。
- [x] 发布前数据库备份完成，Git Bundle 快进、`--expected-latest=014-unified-oauth-context`、migration audit、systemd 重启和公开就绪检查全部成功。
- [x] 管理页只有 OAuth 与必要 userName，连接 API 独立显示 marketing/tongji 状态，旧统计 Token 路由调用为零。
- [x] 四份搜索推广报告仍在同一项目刷新中全成全败并写入同一 refresh revision。
- [x] 百度统计站点、趋势、来源和页面通过统一 OAuth 上下文读取，旧凭据 service 和模块装配不存在。
- [x] 市场总览、广告表现、关键词、搜索词和网站流量从正式域名显示真实数据；官网及未接入销售指标保持原状态。
- [x] A1 运行中至少一次真实 OAuth Token 刷新完成，刷新后的当前版本重新验证账户目录、`getSiteList` 和目标站点最小 `getData`。
- [x] 刷新后两个产品状态均对应当前 auth generation/token version，旧成功状态没有泄漏到新版本。
- [x] 生产日志、SQL 和调用证据证明旧三个字段运行时读写为零，但字段仍保留用于 A1 观察期恢复。
- [x] 凭据扫描证明浏览器、日志、fixture、文档和 Git diff 不含 Access Token、Refresh Token、Secret、Code 或原始授权响应。
- [x] A1 验收证据记录公开 revision、服务器 HEAD、迁移状态、浏览器 Network 和双产品验证；需求保持 `active`，不提前声明旧字段已退役。
- [x] 阻断失败时只使用后代 revert Git Bundle 恢复并记录退出条件，不启用隐藏 fallback。

## Blocked by

- [Issue 003：硬切百度统计到统一 OAuth 运行路径](003-hard-cut-tongji-to-unified-oauth.md)。

## 2026-08-05 A1 正式验收证据

- 发布边界：最终 A1 revision 为 `e8de9d56619a69b5de98f8bee5e9bc5d42d69e41`，Git Bundle SHA-256 为 `3c0a3734b755c79d76915a4febc5d1d86e8387bf8ca9b5cef622767e7ded69d1`。服务器从原正式 revision `ba0b1eb3a76ae59847594a7647e68e35eb7bd373` 只快进，最终树严格等于该正式基线加 003 文档与 A1 实现，不含并行的 0805-002 Flash 工作线。
- 发布纠偏：首个候选因 migration audit 误传 apply-only 参数停止，第二个候选因错误继承未发布 Flash 代码导致 readiness 503；两次均未宣称成功，也未应用无关迁移。最终通过后代修正提交和正式 Git Bundle 前向恢复，未直接编辑服务器、未非快进回退、未启用 fallback。
- 数据库与迁移：A1 前可恢复备份为 `/opt/ai-geo-monitoring/backend/releases/database.pre-9789ee096798c9309d649c01d63b4c02b36ec524.sqlite`。正式审计显示营销迁移 `001`–`014` 全部应用、无 pending，仓库和账本均不存在 `015`。三个旧列 `tongji_account_name`、`tongji_access_token_ciphertext`、`tongji_credential_updated_at` 仍存在，符合 A1 观察期边界。
- 构建与服务：隔离工作树通过后端营销 174 项、前端 104 项、部署 26 项、lint 和生产构建；正式部署再次通过完整后端回归、营销 174 项、官网 31 项、咨询 35 项、前端 104 项、lint、生产构建和 Playwright 40 项。前后端仅由 systemd 启动，公开 `/api/health`、`/api/ready`、`/api/frontend-health` 均成功并返回 A1 revision。
- 真实刷新：服务端内存中通过现役 `BaiduConnectionService` 完成一次真实 OAuth 刷新，`tokenVersion` 从 5 增至 6，`authGeneration` 保持 1。刷新后搜索推广账户目录和百度统计 `getSiteList`、目标站点最小 `getData` 均通过；两个产品状态均为 `VERIFIED`，观察版本均为 6，没有输出或复制 Token、Cookie、数据库及原始百度响应。
- 搜索推广快照：最新成功刷新序号为 46，覆盖 `2026-07-06` 至 `2026-08-04`，同一脱敏 revision 哈希 `89f873aa30a27165` 下计划 768、单元 1765、关键词 4739、搜索词 748 行；四类事实各自只有一个 revision，证明仍为同次原子快照。
- 正式 Chrome：服务器 `/usr/bin/google-chrome` 从唯一正式域名依次验收市场总览、广告表现、关键词、搜索词、网站流量和管理页，页面均为 200 且对应营销 API 为 200。管理页显示搜索推广和百度统计两个 `VERIFIED`；打开“更新统计用户名”弹窗后只有一个用户名文本框、零密码框，并显示统一 OAuth Token 说明。截图只保存在服务器 `output/playwright/a1-production-e8de9d5/`，浏览器凭据未离开服务器内存。
- 旧路径与秘密：现役后端模块、路由和前端代码搜索对三个旧列、`BaiduTongjiCredentialService`、内联 resolver 和 `tongji-credential` 为零；一次显式退役 canary 证明旧路由返回 404，正式页面 Network 没有调用它。A1 发布后的 systemd 日志未匹配 error、fatal、Token 或 Secret 泄漏；Git diff 检查和新增内容人工复核未发现真实凭据或原始授权响应。
- A1 历史正式路径：搜索推广与百度统计都从同一连接的版本化 Access Context 读取；新实现当时已是默认且无双 Token fallback。旧数据库列仅为 A1 恢复窗口保留，因此该阶段父需求继续为 `active`，下一门禁是 Issue 005 的迁移 015；现役关闭状态见 Issue 006 和 `docs/DEPLOYMENT.md`。
