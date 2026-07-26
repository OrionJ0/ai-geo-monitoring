---
title: "原子且幂等地提交问题集运行"
status: closed
type: AFK
blocked_by:
  - "003-run-record-ownership-migration"
---

# 原子且幂等地提交问题集运行

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-3

## What to build

把问题集运行启动重构为 plan、commit、dispatch 三段式正式入口。客户端以稳定幂等键提交，服务端在同一事务中完成幂等占位、运行实例、配额预留、全部任务和稳定槽位；事务提交后才允许 worker 开始执行。

该切片必须彻底替代“先创建空 run、后逐条建任务、再回写 IDs”的旧路径。重复请求返回同一运行回执，异常不留下空运行、孤儿任务或配额变化。

## Acceptance criteria

- [x] 前端初次提交生成合规幂等键，网络重试和重复点击复用相同键。
- [x] 相同用户、项目、问题集和幂等键的并发请求返回同一 run ID。
- [x] 同一幂等键用于不同请求指纹时返回稳定 409，不错误回放其他运行。
- [x] 运行实例、配额预留、全部任务和当前槽位在一个事务内同时提交。
- [x] 在配额后、任务中部或关联阶段注入异常时，run、任务和配额均零残留。
- [x] 不可用平台及原因随运行计划持久化，并能在最终报告读取。
- [x] 事务提交后 dispatch 失败不会丢失任务；未领取 pending 可被后续 dispatcher 发现。
- [x] 正式运行接口只调用新的原子启动入口，不再直接创建空 run。
- [x] 幂等回放响应明确标识 replay，前端随后重新读取真实报告状态。
- [x] 入口级测试证明新入口被调用、旧启动路径未被调用。

## Blocked by

- [003 建立运行任务归属并迁移存量数据](003-run-record-ownership-migration.md)

## Verification

- `QuestionSetRunStart.test.js`：5/5 通过；使用真实临时 SQLite 覆盖顺序回放、不同指纹 409、三个事务故障注入点、并发同键提交和提交后补发。
- 原子性故障注入分别发生在配额写入后、首条任务写入后和事务提交前；每次均验证 run、任务、配额计数为 0。
- 并发同键测试验证两个请求得到同一 run ID，仅创建 1 个 run、2 条当前任务、扣减 2 次任务配额且只 dispatch 1 次。
- 运行计划只持久化实际接受执行的平台；跳过平台保存 `PLATFORM_UNAVAILABLE`、底层原因和用户可读说明。报告接口可读 `analysis_contract_version`、`planned_platforms` 和 `skipped_platforms`。
- 幂等键只保存 SHA-256 摘要，不保存或记录原文；同键不同问题集返回 `409 IDEMPOTENCY_KEY_REUSED`。
- `QuestionSetsApi.test.js` 8/8、`GeoProjectsRoutePolicy.test.js` 22/22：正式问题集运行路由只调用 `startQuestionSetRun()`，不再调用旧 `createNativeRun()`、`enqueueProjectRun()` 或异常清理空 run。
- 生产代码搜索不存在 `QuestionSetRunService.createNativeRun`；旧创建方法已删除。前端将同一键同时放入 `Idempotency-Key` 和请求体，成功后清理，网络失败后保留，回放后进入真实报告。
- 调度器启动及周期 tick 均补发已提交但未领取的 pending；启动 recovery 排除 run-owned 未领取任务，避免将安全待补发任务误判中断。
- 后端全量测试：626/626 通过，0 失败、0 跳过。前端 Node 测试：179/179 通过；ESLint 0 错误（1 个与本 issue 无关的既有 warning）；Next.js 生产构建成功并生成 28 个静态页面。
- 真实 SQLite 重启迁移成功：新增 6 个运行计划字段和唯一索引 `question_set_runs_idempotency_unique`；历史运行幂等字段仍为空，`PRAGMA quick_check=ok`，无待补发 run-owned pending。
- 真实 `/api/ready` 返回 ready：SQLite 为 WAL / busy timeout 5000 / synchronous normal，调度器已启动且 recovery 正常。
