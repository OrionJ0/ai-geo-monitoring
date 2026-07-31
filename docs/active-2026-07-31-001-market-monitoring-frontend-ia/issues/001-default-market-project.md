---
title: "默认监控项目端到端配置"
status: closed
type: AFK
blocked_by: []
---

# 默认监控项目端到端配置

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-007、US-008

## What to build

为广拓内部工作台建立唯一、显式、可审计的默认监控项目。管理员能够选择一个活动项目作为默认上下文；有权用户进入业务页面时能够直接解析该项目，不再依赖项目列表第一项、最近访问记录或浏览器缓存猜测。

默认项目缺失、归档、删除或当前用户无权访问时，系统必须停止后续项目数据读取并给出明确处理指引。该能力继续保留现有项目实体和权限边界，不把广拓数据改造成无边界的全局单例。

## Acceptance criteria

- [x] 管理员可以将一个存在且活动的项目设置为默认监控项目，并在重新进入设置后看到一致结果。
- [x] 非管理员不能修改默认监控项目。
- [x] 有权用户可以读取默认项目的最小上下文，无需读取完整管理员设置。
- [x] 未配置、项目已归档、项目已删除和用户无权访问分别返回稳定、可解释的状态。
- [x] 任何错误状态都不会自动选择其他项目。
- [x] 项目标识在前后端传递时不存在字符串与数字比较造成的错选。
- [x] 自动化测试覆盖成功、权限不足、无配置、归档、删除和读取失败。

## Blocked by

None - can start immediately.

## Verification

- `backend`: `npm test`，929 项全部通过。
- `nextjs-frontend`: `npm test`，11 项全部通过。
- `nextjs-frontend`: `node --test src/utils/defaultProjectContext.test.cjs`，3 项全部通过。
- 本次涉及的三个前端 TypeScript 文件通过 ESLint。
- 项目级 `tsc --noEmit` 仍被既有 `.next/dev` 生成类型和 Playwright 类型版本冲突阻断；生产构建在优化阶段无错误输出但未在限定时间内完成，未作为本 issue 的通过证据。
