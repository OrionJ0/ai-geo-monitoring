---
title: "发布 A2、删除旧字段并关闭统一 OAuth 需求"
status: active
type: HITL
blocked_by:
  - "005-retire-legacy-tongji-columns.md"
---

# 发布 A2、删除旧字段并关闭统一 OAuth 需求

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-1：生产数据库和运行时只保留一套 OAuth 秘密凭据。
- US-2：两个产品在当前 Token 版本上独立验证。
- US-3：全部营销页面继续遵循真实数据来源。
- US-4：不可逆迁移具备停服、备份、恢复和正式入口证据。
- US-5：003 完整关闭后才移交 006。

## What to build

在停服前用当前 Access Context 完成双产品即时复验，然后停止正式 backend、冻结 Token 版本与写入、创建 A2 专用数据库备份，并通过独立 Git Bundle 快进 A2 revision。使用最高版本 015 门禁应用 contract 迁移，完成 audit 后启动服务，从正式域名验收管理页和全部营销页面。

只有代码、数据库、API、运行时和现役文档中的旧统计凭据路径全部清零，且生产入口没有阻断回归，才能把 003 目录改为 `closed` 并解除 006 的开始门禁。迁移或验收失败时保持服务停止，按 Tech Spec 恢复备份并快进 A2 后代 revert revision；不得只回退代码、非快进回退或恢复旧 Token fallback。

## Acceptance criteria

- [x] 停服前当前 Token 版本完成账户目录、搜索推广合同、`getSiteList` 和目标站点最小 `getData` 即时验证，两项能力状态与当前版本一致。
- [x] 正式 backend 停止后 Token 版本和数据库写入冻结，A2 专用备份完成并记录可恢复标识。
- [x] A2 使用独立于 A1 的 Git Bundle 快进，`--expected-latest=015-drop-legacy-tongji-credentials` 和 migration audit 成功。
- [x] 数据库已删除三个旧统计凭据字段，迁移 ledger、checksum 与当前仓库 schema 一致。
- [x] backend/frontend 由正式 systemd 服务启动，公开 revision、健康和 `/api/ready` 与 A2 目标一致，没有第二套进程。
- [x] 管理页只有 OAuth 和非秘密 userName，搜索推广与百度统计分别显示当前版本真实状态。
- [x] 市场总览、广告表现、关键词、搜索词、网站流量和页面报告从正式域名通过，数据来源、日期、精确值、空值和错误语义不变。
- [x] 官网、53KF、线索和订单继续按真实连接状态展示，不因共享 Token 被拼接、补差或误报接入。
- [x] 全仓与生产证据证明旧字段、旧路由、旧 service、旧 UI、fallback、feature flag 和现役双 Token 说明为零。
- [x] 凭据扫描和日志复核证明 Token、Secret、Code、Cookie 和原始授权响应未泄露。
- [x] 015 或启动验收失败时，服务保持停止，数据库备份与 A2 后代 revert revision 按顺序恢复并通过 audit 后才重新接流量。
- [ ] 全部验收通过后，003 目录和文档索引更新为 `closed`，并明确下一顺序为 006 → 007 → 005。

## 2026-08-05 对抗式审查加固门禁

- [x] 发布桥接 revision `5d11cbc69f56743f3b0a57d6436d4ec895fb0486` 已由独立 Bundle 正式发布；后端、营销、官网、咨询、前端、构建和真实 Chrome 40/40 全部通过，公开 revision、ready、systemd 与 migration audit 复核正常。
- [x] 本地加固候选通过刷新 claim/迁移聚焦测试 33/33、含绑定上下文与 SQLite 并发栅栏的专项 52/52、营销 200/200、后端 994/994、前端 104/104、部署专项 13/13、lint、40 路由构建和设置页真实 Chrome 3/3。
- [x] PostgreSQL 015 在可丢弃 PG16 实例真实执行两次；先取最终 `ACCESS EXCLUSIVE` 再锁其余门禁表，015 checksum 不变，成功与失败原子性均保留。
- [ ] 运行时加固 revision 使用桥接后的 launcher 正式发布，并复核双产品只读探针、正式 Chrome、公开 revision、systemd、迁移 audit 与旧路径搜索。

## Blocked by

- [Issue 005：交付迁移 015 并退役旧统计凭据合同](005-retire-legacy-tongji-columns.md)。
