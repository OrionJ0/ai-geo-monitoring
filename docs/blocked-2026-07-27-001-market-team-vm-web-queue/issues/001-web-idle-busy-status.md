---
title: "打通 DeepSeek Web 空闲与繁忙状态闭环"
status: blocked
implementation_status: complete
type: AFK
blocked_by:
  - "target-vm-hitl-acceptance"
---

# 打通 DeepSeek Web 空闲与繁忙状态闭环

## Parent

- PRD：`docs/blocked-2026-07-27-001-market-team-vm-web-queue/prd.md`
- Tech Spec：`docs/blocked-2026-07-27-001-market-team-vm-web-queue/TECH-SPEC.md`
- 对应实施切片：U1

## User stories covered

- US-2：其他同事运行 Web 时仍可提交并排队。
- US-3：用户能够看见通道空闲、运行和等待状态。
- US-4：每次提交进入独立运行报告。
- US-8：一个坏会话不能永久阻塞后续队列。
- US-9：单后端实例始终维持同一个 FIFO。

## What to build

建立一个无副作用的 DeepSeek Web 公共运行状态闭环：后端把进程内活动采集快照与数据库中的可执行 Web pending 记录合并为 `idle` 或 `busy` 状态，通过认证后的只读接口提供给问题库和运行报告页面。计数必须联表父 `QuestionSetRun`：排除已暂停且没有有效执行租约的休眠记录，同时保留暂停前已经取得有效租约、仍可能在 FIFO 中等待或执行的记录。

状态固定路径精确跳过通用 API limiter，但仍先通过现有认证，并在认证后使用独立只读 limiter。前端状态每 30 秒刷新；现有运行报告调整为 running 每 10 秒、paused 每 30 秒刷新，历史抽屉不再跟随每次报告轮询请求。页面进入后台后停止轮询，重新可见时立即刷新。

繁忙状态只展示当前活动数量和等待数量，不承诺当前报告的精确队列位置或预计完成时间，也不以状态接口结果替代运行自身的报告状态。暂停保持协作式语义，暂停提示改为“已开始调度的任务完成后暂停”。

## Acceptance criteria

- [ ] 没有活动采集和可执行 pending Web 记录时返回 `idle`。
- [ ] 有 Web 任务时返回 `busy`，并分别给出非负的 `pending_count`、`running_count` 和 `queued_count`。
- [ ] `running_count` 只反映实际页面采集，始终不大于 1；等待 FIFO 的执行租约不被误算为活动采集。
- [ ] `pending_count` 以持久化的可执行 pending Web 记录为基础，服务重启后仍可恢复，并归一化为始终不小于 `running_count`。
- [ ] 仅存在已暂停且没有有效执行租约的 pending 记录时，这些记录不计入 `pending_count`，公共状态可返回 `idle`。
- [ ] 已暂停父运行下持有未过期 `execution_token`/`lease_expires_at` 的记录仍计入；租约过期后排除。
- [ ] `question_set_run_id IS NULL` 的 pending 记录仍计入；非空父 ID 找不到父记录时不得因 LEFT JOIN 后 `paused_at` 为 NULL 而误计，但记录自身持有有效租约时仍计入。
- [ ] 暂停只阻止后续领取，暂停前已取得有效租约的记录允许完成；提示明确为“已开始调度的任务完成后暂停”。
- [ ] 状态查询不启动 Chrome、不执行 preflight、不占用 Web FIFO，也不改变熔断状态。
- [ ] 只读接口要求有效登录，响应设置 `private, no-store`，且只返回白名单字段。
- [ ] 通用 limiter 只对精确状态路径执行 skip；该路径仍要求认证，并在认证后使用独立 `1000 次/15 分钟` 只读 limiter。
- [ ] 问题库和运行报告使用同一状态展示契约。
- [ ] 状态页面可见时每 30 秒刷新；运行报告在 running/paused 时分别每 10/30 秒刷新；页面隐藏时停止轮询，恢复可见后立即刷新。
- [ ] 历史抽屉只在打开、用户主动刷新和当前报告发生终态转换时刷新，不跟随每次报告定时轮询。
- [ ] 至少两个浏览器持续查看状态和运行报告 15 分钟时，正常轮询不返回 429。
- [ ] 旧请求结果不能覆盖路由切换或新一轮请求的状态。
- [ ] 状态接口读取失败只显示低强调度提示，不禁用既有运行入口。
- [ ] 当前报告已经完成但全局通道仍繁忙时，报告继续显示完成，不暗示当前报告仍在等待。

## Blocked by

- 目标虚拟机双浏览器 15 分钟轮询验收；该真实入口证据由 `004-multi-browser-release-acceptance.md` 统一收集。

## 实施与自动化验收记录

- 已完成数据库可执行 pending 计数、进程内活动采集快照、固定优先级状态派生和认证后只读接口。
- 已完成精确跳过通用 limiter、独立 `1000/15 分钟` limiter、`private, no-store` 与响应白名单。
- 已在问题库和运行报告页接入同一状态组件，状态轮询为 30 秒；报告 running/paused 轮询为 10/30 秒，隐藏页停轮询，历史刷新已解耦。
- 自动化证据：`WebPlatformRuntimeStatusService.test.js`、`WebPlatformRuntimeStatusDatabase.test.js`、`AIPlatformsApi.test.js`、`ApiRateLimitPolicy.test.js`、`deepSeekWebRuntimeStatus.test.cjs`、`questionSetReportPage.test.cjs` 均通过。
- 未关闭原因：验收标准中的两个真实浏览器连续 15 分钟无 429 必须在目标虚拟机完成，当前本地环境不能替代。
