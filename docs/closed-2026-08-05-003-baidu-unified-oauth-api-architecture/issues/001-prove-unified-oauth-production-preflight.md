---
title: "用生产只读探针证明统一 OAuth 前提"
status: closed
type: HITL
blocked_by: []
---

# 用生产只读探针证明统一 OAuth 前提

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-4：在不可逆切换前先取得真实生产证据。
- US-5：用最小变更证明统一凭据前提，不提前重构运行路径。

## What to build

交付一个只在生产服务器仓库内运行的无状态只读探针，并通过 tooling-only Git Bundle 执行。探针使用当前数据库密文对应的 OAuth Access Token，按现役预算依次验证账户目录、搜索推广四报表、百度统计站点目录和目标站点最小数据请求；不得触发 Token 刷新、重新授权、绑定变更、快照写入或业务服务重启。

输出只保留脱敏状态、日期、行数、哈希和 Token 版本。探针结果是后续实施的硬门禁：同一 Token 双产品通过才可进入 Issue 002；权限、用户名、站点或 Token 前提失败时，需求改为 `blocked`，不能加入双 Token fallback。需要重新授权时必须另行批准维护窗口。

## Acceptance criteria

- [x] 探针只接受 connection、project 和受限日期参数，不接受 Token、Secret、任意 URL 或任意上游方法。
- [x] 探针直接读取当前 Access Token，不调用自动刷新、OAuth callback、重新授权或任何百度写 API。
- [x] 搜索推广账户与计划、单元、关键词、搜索词四份报告使用现役 allowlist、双读、限流和整轮预算完成合同校验。
- [x] 百度统计使用同一 Token 和已确认 userName 完成 `getSiteList`、目标 site/domain 匹配及最小 `getData` 合同校验。
- [x] 合法无数据、权限不足、Token 过期、用户名不匹配、站点缺失、限流和上游失败被明确区分。
- [x] 探针前后连接状态、auth generation、token version、密文、绑定状态和业务事实完全不变，并有自动化副作用断言。
- [x] 输出不包含完整 connection/site ID、Token、Secret、站点列表、关键词、搜索词或百度原始错误正文。
- [x] tooling-only revision 不包含迁移、模块装配或业务运行路径变化，也不重启正式 backend/frontend。
- [x] 双产品通过时保存脱敏证据并解除 Issue 002 门禁；任一硬停止条件成立时目录改为 `blocked`，U2–U5 不开始。

## 生产验收证据

### 2026-08-05 17:35–17:38 CST 无状态只读预检

- 公开后端与前端 revision、服务器 `HEAD` 均为 `ba0b1eb3a76ae59847594a7647e68e35eb7bd373`；GitHub 生产部署 workflow 无运行中任务，服务器 deployment lock 不存在。
- 服务器 migration audit 为 `PILOT_DATA_READY`，迁移 001–013 已应用且无 pending；正式 backend/frontend 均为 `active`，进程自 12:17 CST 启动，探针前后没有重启。
- 为避免把 0805-002 未发布提交链带入生产，从服务器真实 `HEAD` 构造了只含 CLI、合同测试和 package 入口的 tooling 提交 `79b3ffdfa8bc28abf54a6b4530f256d05235949e`。Git Bundle SHA-256 为 `468e3f08d6c365da28b76eb4cf90dbd286e22d4f5fb8d047ed378a1ce5b91a5e`，服务器端 `git bundle verify` 通过。
- Bundle 只取入临时 ref，并在 `/tmp` detached worktree 执行；服务器 `main` 没有快进、切换或工作树写入。生产主工作树原有的一个无关未跟踪文件保持原样，未查看、删除或清理。
- 服务器端合同测试 6/6 通过。真实探针以数据库密文对应的同一个当前 OAuth Access Token（仅记录 `tokenVersion=5`）验证 2026-08-04：搜索推广四报表 `campaigns=32`、`adGroups=74`、`keywords=183`、`searchTerms=14`，百度统计目标站点最小查询 `siteCount=1`、`rowCount=1`，双产品均为 `VERIFIED/HAS_DATA`。
- 探针返回 `sideEffects.state=UNCHANGED`，证明连接全字段、授权代次、Token 版本与密文、项目绑定及统计站点绑定前后摘要一致；没有刷新 Token、重新授权、写业务数据、执行迁移或重启服务。
- 探针输出仅保留日期、数量、Token 版本和 SHA-256 标识；没有复制或输出 Token、数据库、`.env`、Cookie、完整 connection/site ID、业务明细或百度原始响应。
- 执行后服务器 `HEAD` 仍为 `ba0b1eb3`、两个 systemd 服务仍为 `active`；临时 worktree、临时 ref 和服务器 `/tmp` Bundle 已删除。

结论：同一现役 OAuth Token 可同时调用搜索推广和百度统计，Issue 002 门禁解除。当前正式业务入口仍使用历史双凭据运行时，本 issue 只证明统一凭据前提，不代表正式路径已经切换。
