---
title: "注册 DeepSeek Web 并隔离平台能力"
status: closed
type: AFK
blocked_by: []
---

# 注册 DeepSeek Web 并隔离平台能力

## Parent

- PRD：`docs/closed-2026-07-26-002-deepseek-web-monitoring/prd.md`
- Tech Spec：`docs/closed-2026-07-26-002-deepseek-web-monitoring/TECH-SPEC.md`
- 对应实施切片：U-001

## User stories covered

- US-1：把 DeepSeek 网页版作为独立平台加入项目。
- US-2：分别查看 DeepSeek API 和 DeepSeek Web 样本。

## What to build

把 `deepseek-web` 注册为受管内置平台，通过服务端生成的 capabilities 明确区分监测、分析、模型列表、密钥管理、连接测试、直接检测和旧定时任务能力。平台在启用后可以进入项目监测选择，但所有 API 专属入口必须在服务端拒绝它；`deepseek` 的配置、调用和历史身份保持不变。

第一版只允许管理员启停 Web 平台，不允许把它改成其他 Adapter、修改官方页面 origin、配置 API Key 或读取模型列表。已有自定义平台占用保留代码时，初始化必须明确失败，不能静默改写用户配置。

## Acceptance criteria

- [x] 平台目录同时返回代码不同的 `deepseek` 与 `deepseek-web`，显示名称和网页样本标识可以明确区分。
- [x] `deepseek-web` 不要求 API Key，启用后可以作为项目监测平台选择。
- [x] 平台目录和管理接口返回完整 capabilities，旧 API 平台保持原有可用性。
- [x] 管理界面对 `deepseek-web` 隐藏密钥、模型刷新、连接测试和 API 联网测试，只允许启停。
- [x] AI 结构化分析、问题建议、直接检测/SSE、模型目录和旧独立定时任务在服务端拒绝 `deepseek-web`。
- [x] `deepseek-web` 的受管 Adapter、官方 origin 和网页样本标识不可由管理接口修改。
- [x] 已有非内置平台占用 `deepseek-web` 时返回稳定冲突错误，不覆盖原配置。
- [x] 历史平台代码和 `deepseek` 现有预设不被迁移、归一化或重命名。
- [x] 自动化测试覆盖平台目录、管理接口、能力过滤和保留代码冲突。

## Blocked by

None - can start immediately.

## Verification

- 后端平台、管理接口、入口策略测试：83/83 通过。
- 前端平台目录与能力控制测试：4/4 通过。
- 相关 TypeScript/TSX 文件通过 ESLint 定向检查。
