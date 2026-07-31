---
title: "以全局启用平台作为唯一监测范围"
status: closed
type: AFK
blocked_by:
  - 001-admin-single-brand-workspace.md
---

# 以全局启用平台作为唯一监测范围

## Parent

- `../prd.md`
- `../TECH-SPEC.md` U2

## What to build

平台设置中的启用状态成为新运行唯一的平台范围来源。品牌和问题的遗留平台字段不再由正式 UI 写入，也不参与手动或自动监测计划；基础配置不完整的平台不能被启用。

## Acceptance criteria

- [x] 启用未完成基础配置的平台返回稳定 409 错误。
- [x] 新运行目标为全部启用问题乘以全部全局启用且具备监测能力的平台。
- [x] 品牌或问题遗留平台字段与全局启用状态冲突时，仍以全局启用状态为准。
- [x] 问题创建、编辑和列表正式 UI 不再提供平台选择或平台范围提示。
- [x] 项目自动监测与手动运行使用相同平台来源。

## Blocked by

- `001-admin-single-brand-workspace.md`
