---
title: "硬切轻量 Dashboard 并删除旧大响应"
status: closed
type: AFK
blocked_by:
  - "005-release-r1-and-prove-zero-detail-consumers.md"
---

# 硬切轻量 Dashboard 并删除旧大响应

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-1：市场总览只读取快照状态、汇总和趋势。
- US-4：市场总览与详情资源共享清晰的快照根合同。
- US-5：旧 Dashboard 合同按门禁完成硬退役。

## What to build

将 Dashboard 改为只返回当前广告快照根、状态、绑定、coverage、filter、summary、trend、层级数量和刷新状态，并迁移市场总览。同步删除四个旧明细数组、旧大响应 adapter、兼容分支、失效测试和当前文档，使轻量合同成为仓库内唯一默认路径。

## Acceptance criteria

- [x] Dashboard 不再读取或返回 campaigns、adGroups、keywords 和 searchTerms 数组。
- [x] summary/trend 继续来自计划事实；四类数量在同一 revision 和事务中聚合，不靠加载完整数组计数。
- [x] 无快照时继续区分未连接、无快照和真实零数据，不把缺失伪装成零快照。
- [x] 市场总览只消费轻量 Dashboard，并保持日期 clamp、状态、趋势、刷新和精确指标合同。
- [x] 三个详细页面继续只消费各自资源，响应 revision 与根合同一致。
- [x] 旧大响应类型、adapter、fixture 合同、fallback、测试和现役说明全部删除。
- [x] 自动化与全仓搜索证明生产调用方不再依赖四个旧数组。

## Blocked by

- [Issue 005：发布 R1 并证明详细页面零旧数组消费者](005-release-r1-and-prove-zero-detail-consumers.md)。

## 验收证据（2026-08-05）

- RED：合同测试首先证明仓库没有唯一 OpenAPI 3.1 合同、Dashboard 缺少 `marketing_dashboard_v2` 且仍返回四个旧数组；实现后测试转绿。
- 后端：Dashboard 只选择计划指标列计算 summary/trend，并在同一只读事务、同一 revision 和 filter 下用四个分组计数查询构建 `hierarchyCounts`；没有加载计划以下三类明细。
- 合同：`goodieai-marketing-ad-read.openapi.json` 是四个现役读接口的唯一机器合同；后端运行时合同从其 `x-runtime-contract` 派生，前端 wire type 自动生成并通过漂移检查。
- 回归：后端全量 `994/994`，营销模块 `211/211`，前端静态/单元 `104/104`，TypeScript、ESLint、合同生成漂移检查全部通过。
- 构建与浏览器：Next.js 生产构建完成 `40/40` 路由；本地真实 Chrome 营销套件 `45/45` 通过。详情页只请求各自资源并钉扎最终轻量根 revision；默认日期越界时按正式合同执行 `422 → coverage → clamp`。
- 退役搜索：生产源码不存在 `adaptMarketingDashboard`、`assertMarketingDashboardResponse` 或 Dashboard 四数组读取；测试仅保留否定断言，历史文档不作为现役入口。
- 发布边界：本 Issue 只完成本地 R2 候选硬切，当前生产仍是 R1 完整 Dashboard；正式默认切换、生产 Network/响应预算和旧数组生产调用归零由 Issue 007 验收。
