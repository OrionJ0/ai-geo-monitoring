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

- 迁移 `baidu_campaign_daily_metrics`、`baidu_ad_group_daily_metrics`、`baidu_keyword_daily_metrics`、`baidu_search_term_daily_metrics` 和 `baidu_marketing_refresh_runs`。
- 实现固定窗口、完整分页、严格解析、精确值和项目级全有或全无提交。
- 实现 dashboard 的汇总、趋势、计划/单元/关键词/独立搜索词集合和正交状态。
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
- [x] dashboard 在同一只读事务按 refresh_run_id 返回同一 revision 的 summary、trend、campaigns、adGroups、keywords、searchTerms、逐绑定健康和覆盖范围。
- [ ] 成功 run 持久化 contract version、currency 和 cost scale，契约切换后旧快照仍按旧口径展示。
- [x] 计划、单元和关键词行包含账户及全部稳定父级 ID；搜索词明确不包含百度未返回的关键词 ID。
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

- 已完成最近 30 个已结束上海自然日窗口、项目单活动运行、严格行解析、BigInt 聚合、批量入库、提交栅栏和项目级全有或全无替换。
- dashboard 在单一读事务中返回 revision、正交状态、覆盖范围、精确汇总、逐日趋势和完整计划明细。
- SQLite 已验证失败零替换与数据库十进制 CHECK；PostgreSQL disposable runner 已覆盖方言专用 ledger、并发单活动 run、精确快照与失败保留旧 revision，并有拒绝生产 URL 的安全门，但本环境未提供 `POSTGRES_TEST_URL`。
- 真实报表服务、分页、金额 scale、规模预算和 PostgreSQL 实例验收依赖 Issue 002/外部环境，本 issue 不关闭。

## 2026-07-30 搜索计划报告进展

- 已按官方计划报告页固定端点、`reportType=2290316`、`DAY`、9 个必要字段（含已删除计划展示名）、`startRow=0`、`rowCount=200`、QPS 50 和最大 731 天请求约束。
- `PILOT_READY` 不挂载刷新/看板/调度，无法从正式业务入口调用报告。
- 官方页面没有成功响应体、分页终止字段、消费币种/scale 和时区；当前客户端在成功响应后明确返回 `BAIDU_REPORT_RESPONSE_UNVERIFIED`，不进入快照映射。
- 取得脱敏真实响应并完成百度后台同口径核对前，本 issue 不关闭，正式流程不会生成营销快照。

## 2026-07-30 真实报表解析进展

- 真实 30 天报告返回 777 行、4 页，已验证 `body.data[0].rows`、`rowCount` 与 `totalRowCount`。
- 适配器完成完整分页、账户一致性、日期、Long ID、整数指标和 2 位消费精度校验；脱敏 fixture 覆盖正常、分页、串线和超精度拒绝。
- `PILOT_DATA_READY` 可为白名单项目生成搜索广告原子快照；正式币种/时区证据和百度后台同口径核对未完成，本 issue 保持 blocked。

## 2026-08-03 完整层级本地实现

- 新增官方计划 `2290316`、单元 `2284618`、关键词 `2602783`、搜索词 `2307838` 四报表合同和严格客户端；刷新入口已硬切到 `fetchSearchReports()`，没有计划级 fallback。
- 四组事实在同一次项目事务内原子替换并共享 `refresh_run_id`；重复事实、行数超限、父子 ID/名称不一致都会拒绝整次刷新并保留旧快照。
- Dashboard additive 返回四组聚合数据，广告表现页按稳定 ID 下钻到关键词。搜索词报告没有关键词 ID，因此保持独立数组，不嵌入关键词严格子树。
- 后端营销测试、前端 51 项测试和 Next.js 生产构建已通过。本地迁移审计包含 `010-search-hierarchy-snapshots`。
- 2026-08-03 已使用服务器现有生产 Token 只读取得计划 98、单元 224、关键词 524、搜索词 45 行真实响应，严格字段和父子关系均通过。尚未保存新增层级脱敏 fixture、与百度后台核对或从正式域名验收，因此本 issue 继续保持 `blocked`，生产当前不会使用本地新实现。

## 2026-08-04 生产完整日窗口修复

- 生产四层刷新连续以 `REPORT_DUPLICATE_FACT` 失败；只读诊断证明重复只发生在关键词和搜索词的跨页结果，单页内无重复。
- 相同账号读取包含上海当天的 30 日区间时，关键词有 1143 条额外重复、搜索词有 60 条额外重复；读取截至前一日的 30 个完整自然日时，关键词 4556 行和搜索词 734 行均全量唯一。
- 快照窗口固定为最近 30 个已结束的上海自然日，继续拒绝任何重复事实，不增加静默去重或计划级 fallback。
- 四份报告按相同覆盖区间连续读取两轮，比较规范化后的完整事实集；任何一层漂移都以 `BAIDU_REPORT_SNAPSHOT_UNSTABLE` 失败并保留上一快照。
- 两轮分页共享每报告 QPS 限速器，同一项目刷新的全部账户绑定共享请求数、行数、响应体和墙钟预算；首轮转成紧凑摘要后即释放完整行，流式正文也受单请求超时约束。
- 刷新失败时记录仅含 projectId、runId、coverage、failureCode 和耗时的结构化日志；已有旧 revision 时按需入口继续返回完整旧快照，三个页面显著显示 `STALE`、失败码和数据截止日期。
