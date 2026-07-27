---
title: "展示登录、验证与不可用的 Web 通道状态"
status: blocked
implementation_status: complete
type: AFK
blocked_by:
  - "target-vm-recovery-acceptance"
---

# 展示登录、验证与不可用的 Web 通道状态

## Parent

- PRD：`docs/blocked-2026-07-27-001-market-team-vm-web-queue/prd.md`
- Tech Spec：`docs/blocked-2026-07-27-001-market-team-vm-web-queue/TECH-SPEC.md`
- 对应实施切片：U2

## User stories covered

- US-3：用户能够区分正常排队与需要人工处理。
- US-7：虚拟机运维负责人统一维护 DeepSeek 登录和验证。
- US-8：浏览器异常后可以回收并恢复后续任务。
- US-10：失败结果保留明确错误和采集阶段。

## What to build

在公共状态闭环中加入登录失效、人工验证、环境不可用和关闭中的状态。状态来源只读取 Web 运行通道已有的生命周期、熔断和最后已知阻塞原因，不因 UI 轮询主动访问 DeepSeek。

页面把需要人工处理的情况统一说明为“联系虚拟机运维负责人”，不要求市场部同事输入 DeepSeek 凭据。短暂的浏览器错误在异常会话回收后应恢复为当前真实状态，不能作为永久告警残留；登录、验证和选择器类进程内熔断则必须在人工恢复后重启后端清除。已经失败的运行仍保留在各自报告中，由运维恢复后显式重试。

## Acceptance criteria

- [ ] 登录失效映射为 `login_required`，并返回 `needs_action=true`。
- [ ] 人工验证映射为 `verification_required`，不返回页面内容、账号标识或会话数据。
- [ ] Chrome 缺失、profile 冲突、选择器失配和已知浏览器连接故障映射为 `unavailable` 及稳定原因码。
- [ ] 后端关闭过程中返回 `shutting_down`，新 Web 工作仍按现有契约返回 `web_shutdown`。
- [ ] 平台被管理员停用时返回 disabled 语义，前端不持续展示故障告警。
- [ ] 状态优先级固定，登录、验证、关闭和不可用不会被 pending 数量覆盖。
- [ ] transient 浏览器错误完成会话回收后不会永久保留为旧状态。
- [ ] 公共响应不包含问题正文、回答、记录 ID、PID、本机目录、内部异常或浏览器凭据。
- [ ] 问题库和运行报告对相同状态显示一致的标题、级别和下一步。
- [ ] 登录、验证或选择器故障恢复后按 `prod:stop → web:login → prod:start` 重启后端，公共状态回到当前 `idle`/`busy`，原失败运行继续保留重试入口。
- [ ] 不新增在线 `force` preflight 或“清除熔断”接口绕过正式恢复流程。
- [ ] 任意阻塞状态都不会触发 DeepSeek API fallback 或生成替代答案。

## Blocked by

- 目标虚拟机上的登录/验证恢复与正式后端重启验收；由 `004-multi-browser-release-acceptance.md` 统一收集证据。

## 实施与自动化验收记录

- 已完成 `login_required`、`verification_required`、`unavailable`、`shutting_down` 与 disabled 状态的固定优先级映射。
- 公共响应只暴露稳定原因码；未知内部错误归一为 `web_runtime_unavailable`，不返回问题、回答、记录、PID、目录、异常或凭据。
- 登录、验证和选择器故障会打开进程内熔断；缺失 Chrome、启动失败、profile 冲突与配置错误会保留安全阻塞状态；短暂连接错误回收后不残留旧告警。
- 文档已固定 `prod:stop → web:login → prod:start` 恢复顺序，未新增在线 `force` 或清除熔断接口。
- 自动化证据：`WebPlatformService.test.js`、`WebPlatformRuntimeStatusService.test.js`、`AIPlatformService.test.js` 与前端状态映射测试均通过。
- 未关闭原因：仍需在目标虚拟机实际触发并恢复登录或验证状态，证明新后端进程清除旧进程内熔断且原失败报告保留重试入口。
