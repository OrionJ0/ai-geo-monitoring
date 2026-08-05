---
title: "发布 A1 并验证统一 OAuth 正式运行"
status: open
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

- [ ] A1 目标 revision 包含迁移 014、统一运行路径、管理 UI、测试和现役文档，但不存在迁移 015。
- [ ] 发布前数据库备份完成，Git Bundle 快进、`--expected-latest=014-unified-oauth-context`、migration audit、systemd 重启和公开就绪检查全部成功。
- [ ] 管理页只有 OAuth 与必要 userName，连接 API 独立显示 marketing/tongji 状态，旧统计 Token 路由调用为零。
- [ ] 四份搜索推广报告仍在同一项目刷新中全成全败并写入同一 refresh revision。
- [ ] 百度统计站点、趋势、来源和页面通过统一 OAuth 上下文读取，旧凭据 service 和模块装配不存在。
- [ ] 市场总览、广告表现、关键词、搜索词和网站流量从正式域名显示真实数据；官网及未接入销售指标保持原状态。
- [ ] A1 运行中至少一次真实 OAuth Token 刷新完成，刷新后的当前版本重新验证账户目录、`getSiteList` 和目标站点最小 `getData`。
- [ ] 刷新后两个产品状态均对应当前 auth generation/token version，旧成功状态没有泄漏到新版本。
- [ ] 生产日志、SQL 和调用证据证明旧三个字段运行时读写为零，但字段仍保留用于 A1 观察期恢复。
- [ ] 凭据扫描证明浏览器、日志、fixture、文档和 Git diff 不含 Access Token、Refresh Token、Secret、Code 或原始授权响应。
- [ ] A1 验收证据记录公开 revision、服务器 HEAD、迁移状态、浏览器 Network 和双产品验证；需求保持 `active`，不提前声明旧字段已退役。
- [ ] 阻断失败时只使用后代 revert Git Bundle 恢复并记录退出条件，不启用隐藏 fallback。

## Blocked by

- [Issue 003：硬切百度统计到统一 OAuth 运行路径](003-hard-cut-tongji-to-unified-oauth.md)。
