---
title: "完成搜索同步与项目原子快照"
status: blocked
type: AFK
blocked_by:
  - "004-search-project-bindings.md"
---

# 完成搜索同步与项目原子快照

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 覆盖：US-003、US-005、US-006、US-007

## Goal

交付第一条真实数据纵向路径：为项目创建手动刷新，读取全部活动账户的最近 30 天搜索报表，全部成功后原子替换项目快照，并从单个 dashboard API 读取一致数据。

## Scope

- 迁移 `baidu_campaign_daily_metrics` 和 `baidu_marketing_refresh_runs`。
- 实现固定窗口、完整分页、严格解析、精确值和项目级全有或全无提交。
- 实现 dashboard 的汇总、趋势、完整推广计划列表和正交状态。
- 增加安全的 PostgreSQL 营销集成测试 runner。
- 本 issue 先完成手动刷新；自动陈旧刷新和 Token claim 在 Issue 006。

## Acceptance Criteria

- [ ] 刷新 POST 不接受日期；窗口固定为最近 30 个 Asia/Shanghai 自然日。
- [ ] 同项目活动运行由数据库唯一 `active_project_key` 保证。
- [ ] 所有活动绑定、所有分页和所有字段成功解析后才进入替换事务。
- [ ] 每页/每行的账户身份与绑定严格一致；不一致时整项目失败且零写入。
- [ ] 任一账户、分页、业务错误、响应矛盾或预算超限时，整个项目旧快照不变。
- [ ] 提交事务重查项目 ACTIVE、绑定指纹、连接 auth generation，并 CAS run 仍为 RUNNING、活动键和 execution token。
- [ ] 成功事务删除项目旧 metrics、插入新 metrics 并完成 run，不暴露中间状态。
- [ ] 完整成功空结果记录 `ZERO` 和覆盖范围，而不是 `NONE`。
- [ ] 外部 ID、展现、点击和消费统一为十进制 TEXT；聚合只用 BigInt。
- [ ] 禁止 `Number`、`parseInt`、浮点求和和 Sequelize `Model.sum` 处理精确值。
- [ ] dashboard 在同一只读事务按 refresh_run_id 返回同一 revision 的 summary、trend、campaigns、逐绑定健康和覆盖范围。
- [ ] 成功 run 持久化 contract version、currency 和 cost scale，契约切换后旧快照仍按旧口径展示。
- [ ] campaign 行包含账户标识、campaign ID 和名称。
- [ ] 日期筛选仅查询本地覆盖范围，不调用百度；越界返回 422。
- [ ] 同一账户、计划和日期重复同步不产生重复事实。
- [ ] PostgreSQL runner 只使用本次创建、随机命名、受限且完全限定的 disposable namespace；DDL 前拒绝生产 URL、同 `DATABASE_URL`、public fallback 和伪造 namespace。

## Verification

```bash
node --test backend/tests/marketing/MarketingRefreshApi.test.js
node --test backend/tests/marketing/MarketingSnapshotAtomicity.test.js
node --test backend/tests/marketing/MarketingExactValues.test.js
node --test backend/tests/marketing/MarketingDashboardApi.test.js
npm --prefix backend run test:marketing
npm --prefix backend run audit:marketing
POSTGRES_TEST_URL='<disposable-test-url>' npm --prefix backend run test:postgres:marketing
npm --prefix backend test
git diff --check
```

证据：

- SQLite 与 PostgreSQL 都覆盖第二个账户失败后零新行提交。
- SQLite `BEGIN IMMEDIATE` 与 PostgreSQL `FOR UPDATE` 都覆盖归档/改绑和提交交错；并发 dashboard 不混合 revision。
- 超过 `Number.MAX_SAFE_INTEGER` 的 ID/指标在数据库、API 和聚合结果一致。
- PostgreSQL 安全 runner 的拒绝生产 URL 测试无需连接生产库即可通过。

## Blocked by

- `004-search-project-bindings.md`

## 2026-07-29 工程进展

- 已完成固定上海 30 日窗口、项目单活动运行、严格行解析、BigInt 聚合、批量入库、提交栅栏和项目级全有或全无替换。
- dashboard 在单一读事务中返回 revision、正交状态、覆盖范围、精确汇总、逐日趋势和完整计划明细。
- SQLite 已验证失败零替换与数据库十进制 CHECK；PostgreSQL disposable runner 已覆盖方言专用 ledger、并发单活动 run、精确快照与失败保留旧 revision，并有拒绝生产 URL 的安全门，但本环境未提供 `POSTGRES_TEST_URL`。
- 真实报表服务、分页、金额 scale、规模预算和 PostgreSQL 实例验收依赖 Issue 002/外部环境，本 issue 不关闭。
