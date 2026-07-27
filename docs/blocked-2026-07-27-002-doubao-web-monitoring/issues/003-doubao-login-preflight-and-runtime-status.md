---
title: "打通豆包人工登录、预检与运行状态"
status: blocked
type: AFK
blocked_by:
  - "001-doubao-page-contract-and-resource-baseline.md"
  - "002-managed-web-registry-and-isolated-runtime.md"
---

# 打通豆包人工登录、预检与运行状态

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 覆盖用户故事：US-006、US-008、US-009

## What to build

为 `doubao-web` 提供完整的人工登录、运行前预检、登录恢复和用户可见运行状态。

虚拟机运维负责人应能通过统一 Web 登录命令选择豆包网页版，在豆包专用 Chrome 中人工完成登录或验证。系统只在允许源站、登录状态有效且唯一对话输入区可用时确认预检通过；不得读取、保存或显示账号密码和浏览器会话凭据。

运行状态接口按平台代码返回独立状态和等待数量。现有 DeepSeek 状态 URL、schema 和字段保持不变，豆包使用自己的状态 schema。问题页与问题集报告页通过通用 Web 状态组件分别展示两个平台，不能合并队列数量或错误状态。

切换到通用登录和状态实现后，删除 DeepSeek 专用登录脚本、专用状态 hook 和专用状态组件，不保留两套并行逻辑。

## Acceptance criteria

- [x] 统一登录命令可以选择 `doubao-web` 并启动豆包专用 Chrome。
- [ ] 登录、验证码、账号选择和人工验证全部由运维负责人在真实浏览器中完成。
- [x] 登录成功后浏览器正常关闭并释放锁，同时保留专用 Profile 中的登录状态。
- [ ] 服务重启后可以使用同一豆包 Profile 恢复登录状态。
- [x] 未登录、需要验证、页面结构不匹配和正常可用返回不同稳定状态。
- [x] 未知平台或非受管 Web 平台不能使用 Web 登录命令。
- [x] 豆包运行状态只统计 `doubao-web` 的 pending、running 和 queued 数量。
- [x] DeepSeek 运行状态只统计 `deepseek-web`，原 URL 与 schema 保持兼容。
- [x] 问题页和问题集报告页可以分别展示豆包与 DeepSeek 的独立状态条。
- [x] 平台关闭且不需要人工操作时不展示普通空闲状态条。
- [x] 前端页面隐藏时暂停轮询，恢复可见后重新读取状态。
- [x] 状态接口读取失败不会绕过正式任务提交时的运行前预检。
- [x] 旧 DeepSeek 专用登录和状态实现已经删除或完全迁移，不再被正式入口引用。

阻塞说明：命令、状态机和关闭/锁释放已有自动化证据；目标 VM 上的人工登录、验证和跨服务重启后的豆包登录态恢复仍需运维负责人验收。

## Blocked by

- `001-doubao-page-contract-and-resource-baseline.md`
- `002-managed-web-registry-and-isolated-runtime.md`
