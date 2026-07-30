---
title: "完善自动刷新、Token 与运行生命周期"
status: blocked
type: AFK
blocked_by:
  - "005-search-sync-snapshot.md"
---

# 完善自动刷新、Token 与运行生命周期

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 覆盖：US-003、US-004、US-006、US-007

## Goal

在手动刷新闭环上补齐陈旧触发、自动重试、连接级 Token refresh claim、启动恢复、优雅关停及项目归档/删除竞争。

## Scope

- dashboard 纯读返回陈旧状态，前端再显式 POST 固定窗口运行。
- 实现单进程执行器和持久化 run 轮询。
- 实现连接级短期 refresh claim 与 auth/token generation CAS。
- 完成启动恢复、关停、归档和删除栅栏。
- 不建设多实例 lease、heartbeat、runner owner 或消息队列；用无重叠部署和 executor singleton 强制单进程边界。

## Acceptance Criteria

- [ ] dashboard GET 零写入、零百度调用；前端看到 `NONE/STALE` 后并发 POST 仍只创建一个 run。
- [ ] `lastSuccessfulAt + 10 分钟` 独立决定陈旧，`next_retry_at` 只限制自动重试。
- [ ] 手动刷新可绕过自动退避，但不能创建第二个活动 run。
- [ ] 同一连接并发过期时，单条条件 UPDATE 原子抢占 claim，只发生一次外部 refresh grant。
- [ ] claim 失败者等待并重读连接，不并发调用百度。
- [ ] refresh 响应缺失或返回相同 Refresh Token 时保留旧值，返回新值时替换。
- [ ] Token 写回按 claim、auth generation 和 token version CAS；晚到结果不能覆盖重授权或断开。
- [ ] 结果确定失败或响应结果未知时连接进入带原因的 `REAUTH_REQUIRED`，暂停相关绑定并保留旧快照；旋转型 grant 不盲重试。
- [ ] 取得 executor singleton 后才把遗留 QUEUED/RUNNING 标为 `INTERRUPTED`、使 execution token 失效并释放活动键。
- [ ] 优雅关停停止接收新运行，有限等待后把未完成运行标为 `INTERRUPTED`。
- [ ] 归档先完成时晚到刷新不得提交；删除要求项目已归档且无活动 run。
- [ ] 最终提交 CAS `RUNNING + active_project_key + execution_token`；已中断 run 的迟到响应零写入。
- [ ] 执行器默认全局并发 1、FIFO、有队列上限/排队超时；重叠第二进程不能消费或恢复 run。
- [ ] 外部请求有超时、响应大小、最大页数、最大行数和总 deadline。
- [ ] 读取失败永不产生部分账户新旧混合快照。

## Verification

```bash
node --test backend/tests/marketing/MarketingAutoRefresh.test.js
node --test backend/tests/marketing/BaiduTokenRefreshClaim.test.js
node --test backend/tests/marketing/MarketingRunRecovery.test.js
node --test backend/tests/marketing/MarketingProjectLifecycleRace.test.js
npm --prefix backend run test:marketing
POSTGRES_TEST_URL='<disposable-test-url>' npm --prefix backend run test:postgres:marketing
npm --prefix backend test
git diff --check
```

证据：

- fake provider 计数证明多个并发调用只有一次 refresh grant。
- SQLite 与 PostgreSQL 均覆盖 refresh/reauth/disconnect、archive/commit 交错。
- 子进程测试证明 SIGTERM 后活动键被释放且 run 终态可解释。
- 重叠进程测试证明第二 executor 被拒绝，旧进程迟到提交被 CAS 拒绝。

## Blocked by

- `005-search-sync-snapshot.md`

## 2026-07-29 工程进展

- 已完成连接级条件 claim、auth/token generation CAS、Refresh Token 缺失/相同/旋转写回、结果未知转重新授权和绑定暂停；旧 refresh 失败不能误伤新授权代次。
- 已完成 dashboard 纯读陈旧判断、单进程 FIFO executor、启动恢复、关停全部排队/运行任务失效及归档/迟到提交栅栏。
- 自动化测试证明并发过期仅一次 refresh grant，项目归档先完成时晚到结果零写入。
- 真实 refresh 轮换、丢响应重放语义和跨进程部署锁仍需 Issue 002 与生产环境验证，本 issue 不关闭。

## 2026-07-30 Token 生命周期进展

- Refresh 请求已按官方参数增加授权 `userId`，并校验响应主体/openId 不得串连接。
- Access/Refresh 有效期使用官方响应 `expiresIn/refreshExpiresIn`，不依赖文档默认值；Refresh Token 到期时间由迁移 004 持久化。
- 缺失/相同/新 Refresh Token 的 CAS 行为保持不变，自动化测试覆盖单飞刷新和晚到结果。
- 真实轮换、旧 Access Token 是否仍有效和响应丢失重放仍未观察，受限试点失败时保持保守重新授权，本 issue 不关闭。
