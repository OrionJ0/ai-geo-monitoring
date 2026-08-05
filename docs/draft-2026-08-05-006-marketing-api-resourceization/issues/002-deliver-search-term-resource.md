---
title: "交付 revision 钉扎的搜索词资源"
status: open
type: AFK
blocked_by:
  - "001-freeze-resource-contract-and-production-baseline.md"
---

# 交付 revision 钉扎的搜索词资源

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-2：搜索词使用服务端分页、筛选和排序。
- US-4：本期与上期搜索词只读取同一 revision。
- US-5：新资源先 additive 上线，不破坏旧 Dashboard。

## What to build

建立唯一广告快照选择边界，新增显式 revision 的搜索词只读资源，并把搜索词页面从两次完整 Dashboard 请求迁移到该资源。R1 期间旧 Dashboard 响应保持不变；搜索词页先从它取得 revision 和有效日期，再按需读取分页数据。

## Acceptance criteria

- [ ] 详情请求必须提供 revision，服务端在项目权限检查后验证其属于同项目完整成功快照。
- [ ] 日期必须位于 revision coverage 内；刷新发生后，旧 revision 请求仍只返回旧事实。
- [ ] 搜索词在数据库完成聚合、允许列表筛选、稳定排序和有界分页，总数与 items 属于同一只读事务。
- [ ] 精确指标保持字符串，搜索词只保留关键词名称证据且不返回 `keywordId`。
- [ ] 合法空页、revision 缺失/不存在、越界日期和快照不可用有不同稳定语义。
- [ ] 搜索词页面的本期与上期使用同一 revision；上期超出 coverage 时诚实显示不可比较。
- [ ] 旧 Dashboard 合同、市场总览、关键词和广告表现消费者在本切片中保持不变。

## Blocked by

- [Issue 001：冻结广告资源合同与生产基线](001-freeze-resource-contract-and-production-baseline.md)。
