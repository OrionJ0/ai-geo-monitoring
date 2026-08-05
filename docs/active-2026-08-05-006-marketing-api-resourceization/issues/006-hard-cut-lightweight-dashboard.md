---
title: "硬切轻量 Dashboard 并删除旧大响应"
status: open
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

- [ ] Dashboard 不再读取或返回 campaigns、adGroups、keywords 和 searchTerms 数组。
- [ ] summary/trend 继续来自计划事实；四类数量在同一 revision 和事务中聚合，不靠加载完整数组计数。
- [ ] 无快照时继续区分未连接、无快照和真实零数据，不把缺失伪装成零快照。
- [ ] 市场总览只消费轻量 Dashboard，并保持日期 clamp、状态、趋势、刷新和精确指标合同。
- [ ] 三个详细页面继续只消费各自资源，响应 revision 与根合同一致。
- [ ] 旧大响应类型、adapter、fixture 合同、fallback、测试和现役说明全部删除。
- [ ] 自动化与全仓搜索证明生产调用方不再依赖四个旧数组。

## Blocked by

- [Issue 005：发布 R1 并证明详细页面零旧数组消费者](005-release-r1-and-prove-zero-detail-consumers.md)。
