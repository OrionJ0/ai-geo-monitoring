---
title: "发布 A2、删除旧字段并关闭统一 OAuth 需求"
status: open
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
- US-5：003 关闭后解除自身生产发布窗口，不把 006 代码实施定义为技术后继。

## What to build

在停服前用当前 Access Context 完成双产品即时复验，然后停止正式 backend、冻结 Token 版本与写入、创建 A2 专用数据库备份，并通过独立 Git Bundle 快进 A2 revision。使用最高版本 015 门禁应用 contract 迁移，完成 audit 后启动服务，从正式域名验收管理页和全部营销页面。

只有代码、数据库、API、运行时和现役文档中的旧统计凭据路径全部清零，且生产入口没有阻断回归，才能把 003 目录改为 `closed`。006 不以此作为代码开始门禁，但不得与 003 的生产发布/观察窗口重叠；003 关闭后记录窗口已释放。迁移或验收失败时保持服务停止，按 Tech Spec 恢复备份并快进 A2 后代 revert revision；不得只回退代码、非快进回退或恢复旧 Token fallback。

## Acceptance criteria

- [ ] 停服前当前 Token 版本完成账户目录、搜索推广合同、`getSiteList` 和目标站点最小 `getData` 即时验证，两项能力状态与当前版本一致。
- [ ] 正式 backend 停止后 Token 版本和数据库写入冻结，A2 专用备份完成并记录可恢复标识。
- [ ] A2 使用独立于 A1 的 Git Bundle 快进，`--expected-latest=015-drop-legacy-tongji-credentials` 和 migration audit 成功。
- [ ] 数据库已删除三个旧统计凭据字段，迁移 ledger、checksum 与当前仓库 schema 一致。
- [ ] backend/frontend 由正式 systemd 服务启动，公开 revision、健康和 `/api/ready` 与 A2 目标一致，没有第二套进程。
- [ ] 管理页只有 OAuth 和非秘密 userName，搜索推广与百度统计分别显示当前版本真实状态。
- [ ] 市场总览、广告表现、关键词、搜索词、网站流量和页面报告从正式域名通过，数据来源、日期、精确值、空值和错误语义不变。
- [ ] 官网、53KF、线索和订单继续按真实连接状态展示，不因共享 Token 被拼接、补差或误报接入。
- [ ] 全仓与生产证据证明旧字段、旧路由、旧 service、旧 UI、fallback、feature flag 和现役双 Token 说明为零。
- [ ] 凭据扫描和日志复核证明 Token、Secret、Code、Cookie 和原始授权响应未泄露。
- [ ] 015 或启动验收失败时，服务保持停止，数据库备份与 A2 后代 revert revision 按顺序恢复并通过 audit 后才重新接流量。
- [ ] 全部验收通过后，003 目录和文档索引更新为 `closed`，并明确 003 生产窗口已经释放；006/007 按各自真实依赖继续，003、006、007 全部关闭后才进入 005。

## Blocked by

- [Issue 005：交付迁移 015 并退役旧统计凭据合同](005-retire-legacy-tongji-columns.md)。
