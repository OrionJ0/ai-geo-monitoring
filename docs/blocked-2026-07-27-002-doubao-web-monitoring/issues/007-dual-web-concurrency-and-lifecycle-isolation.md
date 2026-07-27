---
title: "验证双 Web 并行与生命周期隔离"
status: blocked
type: AFK
blocked_by:
  - "003-doubao-login-preflight-and-runtime-status.md"
  - "004-doubao-single-prompt-trusted-capture.md"
  - "005-multi-platform-evidence-citations-and-reports.md"
  - "006-question-set-retry-and-scheduled-monitoring.md"
---

# 验证双 Web 并行与生命周期隔离

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 覆盖用户故事：US-006、US-009、US-010

## What to build

建立入口级自动化验证，证明豆包 Web 与 DeepSeek Web 分别单通道串行，但可以跨平台并行，并且登录、验证、选择器、浏览器、证据和关闭状态相互隔离。

测试应从正式运行服务提交两个平台任务，记录 Adapter 开始与结束区间，证明每个平台最大页面采集并发为 1，同时两平台执行区间可以重叠。分别触发两个平台的登录、验证、页面结构和浏览器异常，验证另一个平台仍能继续运行。

应用关闭、启动恢复和证据清理也必须覆盖两个实例，不能因一个平台失败而跳过另一个平台的浏览器关闭、锁释放或证据恢复。

## Acceptance criteria

- [x] 两条豆包 Web 任务严格串行，观测到的豆包页面最大并发数为 1。
- [x] 两条 DeepSeek Web 任务严格串行，观测到的 DeepSeek 页面最大并发数为 1。
- [x] 一条豆包 Web 与一条 DeepSeek Web 可以同时执行，运行区间存在重叠。
- [x] API 平台不进入任一 Web FIFO，并可与两个 Web 平台并行。
- [ ] 豆包登录失效、人工验证或页面结构熔断不会改变 DeepSeek 状态。
- [ ] DeepSeek 登录失效、人工验证或页面结构熔断不会改变豆包状态。
- [ ] 一个浏览器连接或生成超时被回收后，另一个平台的浏览器保持可用。
- [x] 两个平台的状态 API 分别返回自己的 running、queued 和 pending 数量。
- [x] 应用关闭中两个平台都拒绝新的页面工作。
- [x] 应用关闭会有界等待两个 FIFO，并关闭两个浏览器、释放两个 Profile 锁。
- [x] 启动恢复会遍历两个证据 Store；单个 Store 失败不会被报告为全部成功。
- [x] 代码搜索和依赖检查证明不存在共享全局 Web 锁、共享浏览器 session 或错误 Store 路由。
- [x] 双平台正式入口测试证明豆包 Web 失败后豆包 API 调用次数仍为 0。

阻塞说明：进程内 FIFO、状态、关闭和无 API 回退已有自动化证据；真实双 headed Chrome 的故障互不影响、资源占用和会话回收仍需目标 VM 验收。

## Blocked by

- `003-doubao-login-preflight-and-runtime-status.md`
- `004-doubao-single-prompt-trusted-capture.md`
- `005-multi-platform-evidence-citations-and-reports.md`
- `006-question-set-retry-and-scheduled-monitoring.md`
