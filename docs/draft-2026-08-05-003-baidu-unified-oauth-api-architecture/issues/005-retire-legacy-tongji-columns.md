---
title: "交付迁移 015 并退役旧统计凭据合同"
status: open
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

- [ ] 迁移 015 只在 A1 已完成至少一次真实 Token 刷新、当前版本双产品均验证且旧字段运行时零读写后进入仓库。
- [ ] 活动绑定连接非 CONNECTED、userName 未验证、产品状态非 VERIFIED、观察版本不匹配或 refresh claim 活动时，015 事务完整失败且旧字段保留。
- [ ] 门禁通过时只删除旧统计账号、统计 Token 密文和旧凭据更新时间三个字段，不修改 001–014 已应用迁移。
- [ ] migration audit、checksum、重复执行和失败回滚测试覆盖 SQLite/PostgreSQL 项目支持口径。
- [ ] 迁移 CLI 接受 `--expected-latest=015-drop-legacy-tongji-credentials` 并拒绝缺失、越界或意外 pending 版本。
- [ ] A2 候选代码不再读取、写入、序列化或描述旧字段，旧路由、service、adapter、配置和现役双 Token 文档搜索为零。
- [ ] A2 前数据库备份与 A2 后代 revert revision 的恢复演练有可执行证据，恢复后 migration audit 与代码 schema 一致。
- [ ] 公开 API、Provider、广告快照、百度统计缓存和页面合同没有因 contract 清理发生变化。
- [ ] 本切片未部署生产、未停止服务、未应用 015，需求仍保持 `active`。

## Blocked by

- [Issue 004：发布 A1 并验证统一 OAuth 正式运行](004-release-a1-and-verify-unified-runtime.md)。
