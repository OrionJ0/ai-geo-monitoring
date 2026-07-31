---
title: "接入问题集与项目自动监测入口"
status: closed
type: AFK
blocked_by:
  - "004-web-runtime-safety"
  - "005-citation-analysis-retry"
---

# 接入问题集与项目自动监测入口

> 历史规则说明：本 issue 验收时采用“跳过不可用 Web”；2026-07-29 曾改为任一 Web 不可用即整批阻断；该整批阻断规则又于 2026-07-31 退役。当前正式规则是全局启用平台逐项检查，不可用平台记录并跳过，其他可用平台继续。详见 `../../closed-2026-07-31-002-single-brand-platform-runtime/`。

## Parent

- PRD：`docs/closed-2026-07-26-002-deepseek-web-monitoring/prd.md`
- Tech Spec：`docs/closed-2026-07-26-002-deepseek-web-monitoring/TECH-SPEC.md`
- 对应实施切片：U-005、U-006、U-008 的多入口部分

## User stories covered

- US-1：在现有 GEO 工作流中使用 DeepSeek 网页版。
- US-2：API 和 Web 运行记录保持独立。
- US-9：不同入口的 Web 任务仍全局串行。
- US-10：任何入口失败都不回退 API。

## What to build

把问题集运行和项目自动监测接到已经验证的同一 Web Adapter、preflight、FIFO、持久化和错误语义。不得为这两个入口复制浏览器会话、调度器或任务表。

运行规划在配额和任务创建前处理 Web 不可用状态。本 issue 的验收记录保留当时实现事实；现行批次处理语义以 2026-07-31 的单品牌全局平台需求为准。无论来源是项目手动运行、问题集还是项目自动监测，Web 记录都必须保留相同的平台代码、样本标识、证据契约和失败行为。

## Acceptance criteria

- [x] 问题集选择 `deepseek-web` 后通过正式问题集运行入口创建 Web 记录。
- [x] 项目自动监测到期后通过现有项目调度链调用同一个 Web Adapter。
- [x] 三类入口共享同一个 Web FIFO，跨入口同时到达时页面最大并发仍为 1。
- [x] 三类入口共享相同 preflight、错误码、完成条件、证据结构和无回退规则。
- [x] 历史验收（已退役）：Web preflight 失败时跳过 Web 且不消费其配额；当前正式规则为整次运行阻断。
- [x] 只有 Web 平台且 Web 不可用时，不创建等待记录并返回明确不可用原因。
- [x] 问题集记录进入现有 run 归属、槽位、执行租约、reconcile 和历史快照逻辑。
- [x] 项目自动监测记录进入现有调度时槽、执行租约和项目历史逻辑。
- [x] 问题集和自动监测中的 Web 失败均断言 DeepSeek API Adapter 调用次数为 0。
- [x] 集成测试覆盖问题集、项目自动监测、跨入口串行和混合 API/Web 运行。

## Blocked by

- `004-web-runtime-safety.md`
- `005-citation-analysis-retry.md`

## Verification

- `node --test tests/QuestionSetRunStart.test.js tests/ScheduledExecutionClaim.test.js tests/WebPlatformService.test.js tests/ProjectRunService.test.js tests/AIPlatformService.test.js`
- 结果：81/81 通过。
- 覆盖：正式问题集 Web 记录与槽位、项目自动监测调度时槽、三入口共享 FIFO、混合 API/Web 规划、Web preflight 跳过与零配额、统一无 API fallback 分派。
