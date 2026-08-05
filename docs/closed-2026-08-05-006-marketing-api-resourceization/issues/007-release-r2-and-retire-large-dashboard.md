---
title: "发布 R2 并正式退役 Dashboard 大响应"
status: closed
type: HITL
blocked_by:
  - "006-hard-cut-lightweight-dashboard.md"
---

# 发布 R2 并正式退役 Dashboard 大响应

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-1：市场总览使用轻量快照根。
- US-2：关键词和搜索词负载有界。
- US-3：广告表现保留严格层级。
- US-4：全部页面使用一致 revision。
- US-5：旧合同按证据正式退役且没有长期双版本。

## What to build

用独立 Git Bundle 发布 R2，从正式域名验证轻量 Dashboard 和三个详情资源成为唯一生产路径。完成响应预算、数据库查询、浏览器页面、旧调用清零、代码与文档清理证据后关闭 006，并移交 007 修复生产数据正确性；007 关闭后才解除 005 的实施门禁。

R2 范围例外已由用户的统一 HITL 授权覆盖：新增不可变迁移 016，以 `refresh_run_id` 区分四张事实表的 revision，并冻结“当前 + 紧邻上一成功 revision”保留窗口。迁移既有 R1 数据时只把当前成功 revision 标为可读；更早或已裁剪 revision 必须返回 `409 MARKETING_SNAPSHOT_UNAVAILABLE`。该例外不改变百度四报表、预算、双读、同一 `refresh_run_id` 或全成全败原子提交。

## Acceptance criteria

- [x] 公开 backend/frontend revision 与 R2 目标一致，健康和就绪检查通过。
- [x] Dashboard 正式响应不包含四个旧明细数组，市场总览仍正确展示真实广告汇总和趋势。
- [x] 广告表现、关键词和搜索词页面分别使用层级、关键词和搜索词资源，revision、日期和来源一致。
- [x] 关键词和搜索词单请求返回行数始终不超过 page size，合法空页与快照缺失可区分。
- [x] 生产访问、浏览器 Network、代码搜索和文档搜索共同证明旧大响应消费者与现役说明为零。
- [x] R2 相对基线降低不必要响应字节，查询和页面 P95 无阻断回归。
- [x] 不存在 `/v1`、长期旧合同、feature flag、兼容 adapter 或运行时 fallback。
- [x] 阻断失败只通过 R2 后代 revert revision 快进恢复完整 R1，并记录再次硬切的退出条件。
- [x] 恢复 revision 永久保留迁移 016 文件、checksum、部署最高迁移和兼容 schema，只回退 R2 运行时合同；用已应用 016 的数据库副本完成恢复门禁。

## Blocked by

- [Issue 006：硬切轻量 Dashboard 并删除旧大响应](006-hard-cut-lightweight-dashboard.md)。

## 生产关闭证据

- R2 Git Bundle `be6bee67cc62fb4d17c27de5742ea3a88a23808aaf12b94f53fa28f690aca1b4` 将服务器从 `d5695402d9b39c0ce04108bc36b6d4aa02daac13` 快进到 `d9b0688e28ba9b3a33fcfb061fe7d7235388ec22`；正式部署器完成停服确认、不可覆盖数据库备份、测试、迁移 016、构建与 systemd 重启，上传 Bundle 随后删除。
- 公开 `/api/health`、`/api/frontend-health` 与服务器 `HEAD` 均为 R2 revision，`/api/ready` 为 `ready`，服务器工作区干净，两个 systemd 单元各有一个活动主进程；迁移 `001`–`016` 全部应用且无 pending。
- 生产 Dashboard 为 `marketing_dashboard_v2`，解码响应 2,869 B，顶层只含状态、coverage、filter、summary、trend、bindings、counts 和刷新状态，旧 `campaigns/adGroups/keywords/searchTerms` 均不存在。层级、关键词和搜索词资源回显同一 revision、日期与来源；关键词和搜索词第一页均为 50 条且未超过 page size。
- 30 次正式 HTTPS 采样 P95：Dashboard 47.61 ms、广告层级 181.04 ms、关键词 140.26 ms、搜索词 54.05 ms。SQLite `EXPLAIN QUERY PLAN` 证明关键词和搜索词按 `refresh_run_id` 索引读取；生产保留事实状态为两个 `SUCCEEDED/retained` revision。
- `/usr/bin/google-chrome` 从唯一正式域名打开市场总览、广告表现、广告关键词和全量广告搜索词，四页正式根节点与表格均可见，营销请求全部 200；Network 分别使用 Dashboard、`ad-hierarchy`、`keywords` 和 `search-terms`，未出现兼容查询或浏览器直连百度。
- 观察窗内结构化日志记录 140 次广告读取成功、0 次失败、0 个秘密标记、0 个服务错误；Nginx 记录 Dashboard 39、层级 33、关键词 33、搜索词 37 次请求，旧 `dashboard?view/includeDetails` 为 0。仓库搜索只剩历史验收叙述，不存在现役旧数组消费者、adapter、fallback 或长期双版本。
- 已预验证后代恢复 revision `c167453568cf9dd27fda442529b424f2a5fc5963`，Bundle SHA-256 为 `63eff4e357802d97309efe4a1b6fa734fa0da3d60b66e8ceb35e3ff8dab1e42e`。它保留迁移 016 与部署最高迁移，只恢复完整 R1 运行合同；仅在 R2 阻断失败时快进使用，恢复后必须重新修复 R2 并重复本节全部退出门禁。
