---
title: "完成目标虚拟机发布验收并正式启用"
status: blocked
type: HITL
blocked_by:
  - "001-doubao-page-contract-and-resource-baseline.md"
  - "002-managed-web-registry-and-isolated-runtime.md"
  - "003-doubao-login-preflight-and-runtime-status.md"
  - "004-doubao-single-prompt-trusted-capture.md"
  - "005-multi-platform-evidence-citations-and-reports.md"
  - "006-question-set-retry-and-scheduled-monitoring.md"
  - "007-dual-web-concurrency-and-lifecycle-isolation.md"
---

# 完成目标虚拟机发布验收并正式启用

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 覆盖用户故事：US-001 至 US-010

## What to build

在目标虚拟机的正式部署和持久桌面会话中完成豆包 Web 的人工登录、服务重启、单问题、问题集、失败重试、项目自动监测、证据查看、双 Web 并行和故障恢复验收。

验收必须从市场部实际使用的公开入口发起，并同时证明新实现被调用、豆包 API 未被调用、DeepSeek Web 不受影响。自动化测试、独立 Adapter 调用或本地开发环境成功不能替代这一步。

2026-07-29 产品决策已将新初始化的 `doubao-web` 改为默认启用预置；默认启用不等于目标 VM 已验收。若真实验收失败，保留明确失败证据，管理员可临时停用平台并直接修复豆包 Web 新实现，不增加 API fallback、共享浏览器或第二套临时逻辑。全部验收通过后更新当前运行文档，并将需求目录和 issue 状态收敛为完成。

## Acceptance criteria

- [ ] 目标虚拟机只运行一个受支持的后端实例，并保持持久图形桌面会话。
- [ ] 豆包 Profile、证据目录和数据库均位于持久磁盘。
- [ ] 运维负责人停止生产服务后，通过统一登录命令完成人工登录或验证。
- [ ] 登录浏览器关闭并重新启动生产服务后，豆包登录状态能够恢复。
- [ ] 从问题库单问题入口完成至少一次有引用和一次无引用的豆包 Web 运行。
- [ ] 成功报告可查看联网状态截图、最终回答截图、回答正文和引用源。
- [ ] 从问题集入口完成包含豆包 Web 的真实运行，并保留独立平台记录。
- [ ] 从原报告完成至少一次失败项重试，并验证仅分析重试不会重新发送页面问题。
- [ ] 项目自动监测实际产生豆包 Web 记录。
- [ ] 同时运行豆包 Web 与 DeepSeek Web，两个平台各自串行且可以跨平台并行。
- [ ] 双 Web 并行期间 CPU、内存、桌面会话和浏览器响应满足 001 中确认的资源基线。
- [ ] 人工制造豆包登录失效或验证状态后，页面提示正确，恢复后可从原报告重试。
- [ ] 运行日志、调用证据和代码搜索证明豆包 Web 失败时豆包 API 调用次数为 0。
- [ ] 服务关闭后两个 Chrome 均被回收，两个 Profile 锁均被释放。
- [x] README、环境变量、部署说明、项目上下文和文档索引均描述当前真实入口与运维流程。
- [x] 新初始化的 `doubao-web` 默认启用；已有管理员启停状态不被预置同步覆盖。
- [ ] 在默认启用状态下从正式市场部入口复测成功，并验证登录失效时不会回退 API。
- [ ] 正式切换后不存在旧默认单例、旧登录脚本、隐藏 fallback 或把豆包 Web 描述为未接入的当前文档。
- [x] 需求目录状态、PRD、Tech Spec 和全部 issue 状态与真实完成情况一致。

阻塞说明：当前开发机不是目标市场部虚拟机，且本轮没有变更目标 VM。默认启用预置属于代码和新初始化策略；仍需由运维负责人在目标 VM 完成以上 HITL 验收后关闭本 issue。

## Blocked by

- `001-doubao-page-contract-and-resource-baseline.md`
- `002-managed-web-registry-and-isolated-runtime.md`
- `003-doubao-login-preflight-and-runtime-status.md`
- `004-doubao-single-prompt-trusted-capture.md`
- `005-multi-platform-evidence-citations-and-reports.md`
- `006-question-set-retry-and-scheduled-monitoring.md`
- `007-dual-web-concurrency-and-lifecycle-isolation.md`
