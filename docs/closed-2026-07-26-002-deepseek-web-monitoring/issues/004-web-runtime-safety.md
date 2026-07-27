---
title: "加固 Web 串行、熔断与无回退语义"
status: closed
type: AFK
blocked_by:
  - "003-project-web-capture-tracer"
---

# 加固 Web 串行、熔断与无回退语义

## Parent

- PRD：`docs/closed-2026-07-26-002-deepseek-web-monitoring/prd.md`
- Tech Spec：`docs/closed-2026-07-26-002-deepseek-web-monitoring/TECH-SPEC.md`
- 对应实施切片：U-003、U-004、U-005、U-006 的可靠性部分

## User stories covered

- US-8：页面异常返回明确错误。
- US-9：Web 串行但 API 保持并发。
- US-10：Web 失败后绝不回退 API。

## What to build

把单问题闭环加固为可持续运行的进程级 Web 执行通道。所有 DeepSeek Web 页面任务共用不会被单次失败毒化的 FIFO，任意时刻最多一个任务操作页面；API 查询继续使用现有项目并发。

对登录失效、人工验证和选择器不匹配建立熔断状态，当前及排队任务快速失败，不循环刷新页面。发送问题后禁止整次自动重试和第二次发送；回答超时、部分正文、截图失败和浏览器退出都以稳定错误结束。应用收到关闭信号时停止接收新 Web 任务并清理 CDP、Chrome 和 profile 锁。

## Acceptance criteria

- [x] 多个来源同时提交 Web 问题时严格按进入顺序执行，观测到的页面活动最大并发为 1。
- [x] 任一 Web 任务失败后 FIFO 仍能正确结算后续允许执行的任务，不发生队列永久挂起。
- [x] API 平台不进入 Web FIFO，Web 长任务不会把 API 最大并发降为 1。
- [x] 登录失效、人工验证和选择器不匹配分别打开熔断，排队任务不再导航、刷新或发送问题。
- [x] 已发送问题的任务不会自动创建第二个对话、第二次输入或第二次发送。
- [x] 超时、正文不完整、正文超限、截图失败和浏览器关闭均返回独立机器可读错误码。
- [x] 失败记录不会生成成功可见性指标，也不会保存部分回答供 analysis-only 重试。
- [x] 所有 Web 失败测试均断言 DeepSeek API Adapter 调用次数为 0。
- [x] 执行租约失效时拒绝迟到 worker 终态，并清理该 worker 新产生的未引用证据。
- [x] `SIGINT` 与 `SIGTERM` 使用同一个幂等关闭流程，停止 scheduler、HTTP server、Web 队列、CDP 和 Chrome。
- [x] 结构化日志只包含白名单字段，不包含完整问题、回答、页面凭据或本机路径。

## Blocked by

- `003-project-web-capture-tracer.md`

## Verification

- `node --test tests/WebPlatformService.test.js tests/DeepSeekWebAdapter.test.js tests/ProjectRunService.test.js tests/AIPlatformService.test.js tests/ApplicationShutdownService.test.js`
- 结果：73/73 通过。
- 覆盖：FIFO 最大并发 1、失败后队列恢复、三类熔断、API/Web 隔离、单次发送、超限/截图/浏览器关闭错误、失败记录无指标和无部分正文、迟到及异常 worker 证据回收、幂等关闭。
