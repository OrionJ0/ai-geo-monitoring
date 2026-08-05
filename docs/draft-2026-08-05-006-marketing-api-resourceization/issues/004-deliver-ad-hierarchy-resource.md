---
title: "交付一致快照的广告层级资源"
status: open
type: AFK
blocked_by:
  - "003-deliver-keyword-resource.md"
---

# 交付一致快照的广告层级资源

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-3：广告表现页继续获得完整严格层级。
- US-4：计划、单元和关键词属于同一 revision。
- US-5：最后一个详细消费者迁移后可以准备退役旧大响应。

## What to build

新增显式 revision 的广告层级读资源，在一个只读事务中返回计划、单元和关键词，并把广告表现页迁移到该资源。层级是页面读模型，不新增数据库事实，也不把搜索词嵌入关键词树。

## Acceptance criteria

- [ ] 计划、单元和关键词在同一事务、同一 revision 和同一日期过滤下读取。
- [ ] 账户 → 计划 → 单元 → 关键词的 ID、名称、精确指标和 trend 合同与现役页面一致。
- [ ] 响应返回完整筛选范围 summary，和三层事实同 revision、filter、币种、cost scale 及只读事务。
- [ ] 响应不读取或返回搜索词，也不创建新的可写 CRUD 语义。
- [ ] 父子 ID/名称不一致、重复事实或快照不完整时拒绝响应，不返回部分层级。
- [ ] 广告表现页的树形展开、本期汇总、筛选、状态、移动端和空/错状态通过回归；上期双周期由 007 实施。
- [ ] 页面不再从 Dashboard 读取 campaigns、adGroups 或 keywords。
- [ ] R1 旧 Dashboard 仍保持完整合同，供尚未硬切的市场总览使用。

## Blocked by

- [Issue 003：交付服务端分页的关键词资源](003-deliver-keyword-resource.md)。
