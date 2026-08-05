---
title: "交付服务端分页的关键词资源"
status: open
type: AFK
blocked_by:
  - "002-deliver-search-term-resource.md"
---

# 交付服务端分页的关键词资源

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-2：关键词数据增长后仍保持有界页面负载。
- US-4：关键词与页面根状态使用同一 revision。
- US-5：详细消费者逐个迁移，不同时破坏 Dashboard。

## What to build

在已经验证的快照选择和资源信封上增加关键词只读资源，并把关键词分析页迁移到服务端分页、筛选和排序。页面继续保留现役日期调整、状态、警告和精确指标语义，不再下载完整广告层级和搜索词。

## Acceptance criteria

- [ ] 关键词请求复用同一 revision、项目、coverage 和权限合同，不自行选择 latest。
- [ ] 聚合键、精确指标、trend、计划和单元归属与现役 Dashboard 关键词合同一致。
- [ ] page size 有界，排序字段、顺序、文本查询、计划和单元过滤使用允许列表或绑定参数。
- [ ] 数值排序使用精确数据库表达，稳定 tie-breaker 保证相邻页不重复或遗漏。
- [ ] 响应返回完整筛选范围 summary；改变 page/pageSize 不改变 summary，且 summary 与 items/count 同 revision、filter 和只读事务。
- [ ] 关键词页面正确展示分页总数、筛选、排序、合法空页、错误、stale 快照警告和本期 summary；上期双周期由 007 实施。
- [ ] 页面网络请求不再携带或解析 campaigns、adGroups、searchTerms 明细。
- [ ] R1 旧 Dashboard JSON 和未迁移消费者保持不变。

## Blocked by

- [Issue 002：交付 revision 钉扎的搜索词资源](002-deliver-search-term-resource.md)。
