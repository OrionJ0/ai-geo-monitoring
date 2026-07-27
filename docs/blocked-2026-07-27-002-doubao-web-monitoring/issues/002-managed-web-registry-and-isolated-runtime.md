---
title: "注册豆包 Web 并建立隔离受管运行时"
status: closed
type: AFK
blocked_by:
  - "001-doubao-page-contract-and-resource-baseline.md"
---

# 注册豆包 Web 并建立隔离受管运行时

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 覆盖用户故事：US-001、US-002、US-009、US-010

## What to build

将当前只服务 DeepSeek 的 Web 单例收敛为代码内受管平台注册表和可按平台实例化的运行内核，并注册默认关闭的 `doubao-web`。

平台目录应将豆包 API `doubao` 与豆包网页版 `doubao-web` 显示为两个独立平台。豆包网页版不需要 API Key，只具备项目监测和人工登录能力，不得进入结构化分析、模型目录、连接测试、问题建议、直接检测或旧调度入口。

DeepSeek Web 与豆包 Web 必须分别持有自己的 Profile、证据目录、Chrome 会话、FIFO、预检缓存、熔断状态和 Profile 锁。现有 DeepSeek 正式调用方迁移到注册表后，删除默认 DeepSeek 单例依赖，不保留旧路径或隐藏 fallback。

应用启动恢复、平台可用性检查和正常关闭也必须遍历注册平台，确保所有运行实例都能被恢复和回收。

## Acceptance criteria

- [x] 平台初始化后存在内置 `doubao-web`，名称为“豆包网页版”，默认状态为关闭。
- [x] `doubao-web` 使用独立的受管 adapter type 和稳定模型标识 `doubao-web-ui`。
- [x] `doubao-web` 不要求 API Key，且不具备任何 API 专属能力。
- [x] `doubao` 与 `doubao-web` 在平台目录中保持独立代码和名称。
- [x] 保留平台代码被自定义配置占用时返回冲突，不静默转换已有数据。
- [x] 平台代码与 adapter type 不匹配时返回配置错误，不进入 API 请求服务。
- [x] DeepSeek Web 与豆包 Web 的运行时可变状态完全隔离。
- [x] 同平台任务遵守 FIFO；不同平台实例不存在共享全局锁。
- [x] 两个平台不能配置相同、互相包含或指向日常 Chrome 的 Profile 和证据目录。
- [x] DeepSeek 现有平台身份、状态接口契约和运行行为保持兼容。
- [x] 应用启动恢复和正常关闭会处理全部注册 Web 实例。
- [x] 正式调用链中不再存在直接依赖旧 DeepSeek Web 默认单例的路径。

## Blocked by

- `001-doubao-page-contract-and-resource-baseline.md`
