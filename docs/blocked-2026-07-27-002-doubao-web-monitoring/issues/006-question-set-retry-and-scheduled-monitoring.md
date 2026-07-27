---
title: "接入问题集、失败重试与自动监测"
status: closed
type: AFK
blocked_by:
  - "004-doubao-single-prompt-trusted-capture.md"
  - "005-multi-platform-evidence-citations-and-reports.md"
---

# 接入问题集、失败重试与自动监测

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 覆盖用户故事：US-001、US-002、US-007、US-010

## What to build

把豆包 Web 接入问题集运行、原报告失败重试和项目自动监测，使全部正式入口复用与单问题相同的受管实例、页面 Adapter、联网搜索要求、证据语义和错误行为。

运行规划继续沿用现有幂等、配额、任务持久化、暂停、执行租约和终态栅栏。豆包 Web 在运行前已知不可用时，只跳过该平台并允许其他平台继续；任务开始后才发生的失败则保留可重试记录。

网页采集成功但结构化分析失败时，重试只能重做分析，不能再次发送豆包页面问题。网页采集本身失败时，需要用户从原报告明确重试，系统不得自动重新提交或改发豆包 API。

## Acceptance criteria

- [x] 问题集可以同时选择豆包 API、豆包 Web、DeepSeek API 和 DeepSeek Web，并为每个平台建立独立记录。
- [x] 问题集中的豆包 Web 任务通过与单问题相同的正式 Adapter 执行。
- [x] 项目自动监测中的豆包 Web 任务通过同一正式 Adapter 执行。
- [x] 同一幂等键不会重复创建运行、任务、配额预留或问题记录。
- [x] 豆包 Web 在运行规划前已知不可用时不创建伪成功记录、不消费其配额，其他平台继续运行。
- [x] 任务开始后出现登录、验证、选择器、搜索或浏览器错误时保留独立失败记录。
- [x] 用户可以从原问题集报告重试豆包 Web 失败项。
- [x] Web 采集成功但分析失败时，重试不产生第二次豆包页面发送。
- [x] Web 采集失败后的重试只有在用户明确触发后才创建新页面任务。
- [x] 问题集暂停时，尚未取得执行租约的豆包 Web 记录不污染可执行等待数量。
- [x] 旧直接检测和旧独立调度入口无法选择或调用 `doubao-web`。
- [x] 任意正式入口中的豆包 Web 失败均不会调用豆包 API。
- [x] 问题集报告、历史和导出保留 `doubao-web` 平台身份与证据。

## Blocked by

- `004-doubao-single-prompt-trusted-capture.md`
- `005-multi-platform-evidence-citations-and-reports.md`
