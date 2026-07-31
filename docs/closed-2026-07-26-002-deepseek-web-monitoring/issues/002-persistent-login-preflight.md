---
title: "建立持久 Chrome 会话与人工登录检查"
status: closed
type: HITL
blocked_by:
  - "001-platform-identity-capabilities"
---

# 建立持久 Chrome 会话与人工登录检查

> 历史规则说明：本 issue 验收时采用“仅跳过不可用 Web”；2026-07-29 曾改为任一 Web 不可用即整批阻断；该整批阻断规则又于 2026-07-31 退役。当前正式规则是全局启用平台逐项检查，不可用平台记录并跳过，其他可用平台继续。详见 `../../closed-2026-07-31-002-single-brand-platform-runtime/`。

## Parent

- PRD：`docs/closed-2026-07-26-002-deepseek-web-monitoring/prd.md`
- Tech Spec：`docs/closed-2026-07-26-002-deepseek-web-monitoring/TECH-SPEC.md`
- 对应实施切片：U-003，以及 U-005 的 preflight 部分

## User stories covered

- US-7：人工登录一次后复用本机会话。
- US-8：登录、验证或页面异常时得到明确错误。

## What to build

提供 DeepSeek Web 专用的 headed Chrome 会话和 `web:login` 人工登录命令。会话使用固定且独立的本地 profile、随机本机 CDP 端口、单一受控页面和排他锁；不得共用日常 Chrome 或 SEO 临时浏览器。

把运行前检查接入平台可用性规划：在创建 Web 任务和消费配额前检查 Chrome、目录权限、profile 占用、官方页面 origin、登录态和基本页面契约。本 issue 下方验收项保留当时实现事实；现行批次处理语义以 2026-07-31 的单品牌全局平台需求为准。

## Acceptance criteria

- [x] `npm run web:login -- deepseek-web` 启动专用 headed Chrome，用户可以完全人工完成登录或验证。
- [x] 命令只在检测到唯一可用的对话输入区域后报告登录成功。
- [x] 正常关闭命令后保留专用 profile，再次启动后端可以复用登录态。
- [x] 专用 profile 默认位于被版本控制忽略的运行时目录，权限收紧且不与日常 Chrome、SEO 临时目录共用。
- [x] 同一 profile 被后端、登录命令或第二进程占用时返回 `web_profile_in_use`，不自动接管或删除 profile。
- [x] preflight 能区分 Chrome 未配置、启动失败、登录失效、人工验证和页面契约不匹配。
- [x] 历史验收：Web preflight 失败发生在任务创建和配额消费之前；批次级处理规则已由 2026-07-31 的需求替换。
- [x] 平台目录读取本身不会启动 Chrome，动态 preflight 只在运行规划或明确检查时发生。
- [x] 自动化测试使用 fake Chrome/CDP 和临时目录，不依赖真实账号。
- [x] HITL 验收完成一次人工登录、正常关闭和后端重启后的会话复用。

## Blocked by

- `001-platform-identity-capabilities.md`

## Verification

- `npm run web:login -- deepseek-web` 使用专用 headed Chrome 完成登录并正常关闭。
- 再次运行正式登录命令，无需输入凭据即确认唯一对话输入区。
- 新 Node.js 后端进程执行强制 preflight，返回 `ready` 和 `deepseek-web-v1`。
- 相关后端回归测试 133/133、前端平台目录测试 4/4 通过。
- profile 与 evidence 默认目录均由 `.gitignore` 命中；临时操作脚本已删除。
