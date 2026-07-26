---
title: "修复 SQLite 并暴露真实 Readiness"
status: closed
type: AFK
blocked_by: []
---

# 修复 SQLite 并暴露真实 Readiness

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-6

## What to build

让 SQLite 的并发配置在真实连接上可靠生效，并把数据库、调度器初始化和首次恢复状态纳入独立 readiness。进程存活检查继续只表达 HTTP 进程存活；核心执行能力未准备好时必须返回不可就绪，不能仅记录 warning 后继续伪装健康。

这个切片应贯通数据库连接初始化、启动状态、运维接口、错误日志和自动化验证，可独立演示“配置真实生效”与“初始化失败时不 ready”。

## Acceptance criteria

- [x] SQLite 启动后真实查询得到 `journal_mode=wal`、`busy_timeout>=5000` 和 `synchronous=normal`。
- [x] SQLite callback 风格调用被正确等待，PRAGMA 失败不再被静默吞掉。
- [x] 每个需要连接级配置的新 SQLite 连接都应用并验证 busy timeout。
- [x] Postgres 启动时不执行 SQLite PRAGMA，readiness 仍能正确反映数据库和调度状态。
- [x] 调度器只有在刷新、首次恢复和定时器安装成功后才进入 started。
- [x] 调度器初始化失败后状态可重试，不会因 started 提前置位而永久卡死。
- [x] liveness 与 readiness 分离；必需检查失败时 readiness 返回 503 和安全错误摘要。
- [x] 日志与接口不暴露密钥、JWT、平台原始响应或其他敏感信息。
- [x] 自动化测试覆盖 SQLite 成功、PRAGMA 失败、Postgres 分支和 scheduler 首次启动失败。

## Blocked by

None - can start immediately.

## Verification

- `node --test tests/DatabaseConfig.test.js`：6/6 通过。
- `node --test tests/SchedulerService.test.js`：18/18 通过。
- `npm test`：600/600 通过。
- 使用临时文件 SQLite 从真实连接读取 WAL、busy timeout 与 synchronous。
- 使用真实临时 HTTP 端口验证 ready=200、scheduler 初始化失败时 ready=503，且 health 仍为 200。
