---
title: "交付迁移 015 并退役旧统计凭据合同"
status: closed
type: AFK
blocked_by:
  - "004-release-a1-and-verify-unified-runtime.md"
---

# 交付迁移 015 并退役旧统计凭据合同

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-1：数据库最终不再保存第二枚统计 Token。
- US-4：不可逆清理只在 A1 真实运行证据充分后发生。
- US-5：旧实现、旧文档和恢复合同同时收敛。

## What to build

在 A1 完成真实 Token 刷新与双产品复验后，交付独立于 A1 的迁移 015、迁移门禁、恢复验证和仓库清理。015 只在所有活动绑定对应连接、统计用户名、产品状态、观察版本和 refresh claim 都满足合同后删除旧统计账号、Token 密文和更新时间字段；任一条件不满足时整个事务回滚。

同步删除模型、查询、测试、文档和诊断中把旧字段描述为现役路径的引用，并把迁移 CLI 的 A2 最高版本固定为 015。本切片只准备 A2 候选 revision，不执行生产停服或正式迁移，也不能与 A1 合并为同一个发布。

## Acceptance criteria

- [x] 迁移 015 只在 A1 已完成至少一次真实 Token 刷新、当前版本双产品均验证且旧字段运行时零读写后进入仓库。
- [x] 活动绑定连接非 CONNECTED、userName 未验证、产品状态非 VERIFIED、观察版本不匹配或 refresh claim 活动时，015 事务完整失败且旧字段保留。
- [x] 门禁通过时只删除旧统计账号、统计 Token 密文和旧凭据更新时间三个字段，不修改 001–014 已应用迁移。
- [x] migration audit、checksum、重复执行和失败回滚测试覆盖 SQLite/PostgreSQL 项目支持口径。
- [x] 迁移 CLI 接受 `--expected-latest=015-drop-legacy-tongji-credentials` 并拒绝缺失、越界或意外 pending 版本。
- [x] A2 候选代码不再读取、写入、序列化或描述旧字段，旧路由、service、adapter、配置和现役双 Token 文档搜索为零。
- [x] A2 前数据库备份与 A2 后代 revert revision 的恢复演练有可执行证据，恢复后 migration audit 与代码 schema 一致。
- [x] 公开 API、Provider、广告快照、百度统计缓存和页面合同没有因 contract 清理发生变化。
- [x] 本切片未部署生产、未停止服务、未应用 015，需求仍保持 `active`。

## Blocked by

- [Issue 004：发布 A1 并验证统一 OAuth 正式运行](004-release-a1-and-verify-unified-runtime.md)。

## 2026-08-05 A2 候选验收证据

- 前置事实：Issue 004 已证明 A1 生产运行时零旧字段读写，并通过现役连接完成真实 OAuth 刷新 `tokenVersion 5 → 6`；刷新后搜索推广与百度统计均以当前授权代次和版本复验为 `VERIFIED`。因此 015 才进入独立于 A1 的后续 revision。
- 迁移门禁：015 只检查存在活动绑定的连接，要求连接为 `CONNECTED`、统计用户名非空且已验证、两个产品状态为 `VERIFIED`、四个 observed 版本与当前授权代次/Token 版本一致，并拒绝任何残留 refresh claim。任一重授权处于 `PENDING`/`PROCESSING` 也会拒绝迁移；失败统一返回稳定错误 `MARKETING_LEGACY_TONGJI_CONTRACT_UNSAFE`。
- contract 范围：门禁通过后只在同一事务删除 `tongji_account_name`、`tongji_access_token_ciphertext`、`tongji_credential_updated_at`；001–014 未改写。A1 前探针已改为读取现役 `tongji_user_name`，运行测试和诊断不再向已删除列写 canary。
- SQLite 证据：聚焦迁移/CLI 27 项通过，覆盖十类不安全状态、重授权、成功删列、重复执行、checksum、第二条 DDL 合成失败后的完整回滚，以及备份恢复到 014 代码边界后的 audit 一致性。显式 A2 门禁只允许数据库已连续应用到 014、pending 仅为 015，拒绝空库或跨版本意外 pending。
- PostgreSQL 证据：本机临时 PostgreSQL 16 容器中连续两次执行可丢弃 schema runner，均真实应用 001–015；015 前插入满足合同的活动连接和绑定，015 后三个旧列不存在，audit ready。后续广告原子快照成功，合成失败仍保留上一 revision；临时容器已删除。
- 回归证据：后端营销 188/188、后端全量 994/994、部署 26/26、前端合同 104/104、lint、TypeScript 和 40 路由生产构建全部通过。公开 API、Provider facade、四报表、预算、百度统计缓存和页面合同没有修改。
- 正式部署入口：A2 候选把 `scripts/deploy.mjs` 的营销最高版本更新为 015，并以部署流程测试证明浏览器验收、备份、015 apply/audit 和 systemd 启动顺序不变。A2 恢复演练证明恢复数据库备份后，使用不含 015 的后代恢复 revision 可重新通过 014 audit；禁止只退代码或非快进回退。
- 旧路径搜索：除不可变迁移 006/014、contract 迁移 015、迁移专项测试和带日期历史证据外，现役后端、前端、脚本和当前入口均不再读取、写入或序列化旧字段；不存在旧 service、旧凭据路由、配置、adapter 或双 Token fallback。
- 当前正式路径：生产仍是 A1 revision `e8de9d56619a69b5de98f8bee5e9bc5d42d69e41` 的统一 Access Context，三个旧列仍在生产数据库中但零读写。本 issue 只交付 A2 候选，未停止服务、未发布、未应用 015；父需求继续 `active`，下一门禁为 Issue 006 的停服备份与 A2 正式发布。
