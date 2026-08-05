---
title: "交付一致快照的广告层级资源"
status: closed
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

- [x] 计划、单元和关键词在同一事务、同一 revision 和同一日期过滤下读取。
- [x] 账户 → 计划 → 单元 → 关键词的 ID、名称、精确指标和 trend 合同与现役页面一致。
- [x] 响应返回完整筛选范围 summary，和三层事实同 revision、filter、币种、cost scale 及只读事务。
- [x] 响应不读取或返回搜索词，也不创建新的可写 CRUD 语义。
- [x] 父子 ID/名称不一致、重复事实或快照不完整时拒绝响应，不返回部分层级。
- [x] 广告表现页的树形展开、本期汇总、筛选、状态、移动端和空/错状态通过回归；上期双周期由 007 实施。
- [x] 页面不再从 Dashboard 读取 campaigns、adGroups 或 keywords。
- [x] R1 旧 Dashboard 仍保持完整合同，供尚未硬切的市场总览使用。

## 验收证据

- 后端聚焦合同：`MarketingAdHierarchyResource.test.js` 3/3 通过；覆盖显式 revision、权限先行、同事务三表读取、超安全整数精确聚合、逐日 trend、父子名称冲突拒绝、私有缓存和零搜索词查询。
- 后端营销回归：`npm run test:marketing` 210/210 通过；四报表抓取、预算、双读、原子快照与旧 Dashboard 合同未修改。
- 前端迁移：`useAdPerformance.ts` 先读取 Dashboard 根，再以相同 revision/from/to 请求 `/api/marketing/projects/:projectId/ad-hierarchy`；响应边界校验项目、revision、coverage、summary、三层唯一身份、父子名称、精确指标及 trend。
- 前端回归：营销单测 104/104、全量 ESLint、TypeScript 和生产构建通过，共生成 40 个路由。
- 真实浏览器：Playwright Chrome 19/19 通过；验证广告树默认计划层、展开、状态诚实表达、同页仅一次根请求与一次层级请求、revision/日期钉扎、旧 Dashboard 明细损坏不影响已迁移详情页，以及层级资源孤儿关键词会失败关闭。
- 入口与退役边界：本地广告表现正式消费者已走 `Dashboard` 根 + `ad-hierarchy`；关键词和搜索词也已走各自资源。市场总览仍按 R1 约束读取完整 Dashboard；旧 JSON 尚未退役，等待 R1 生产观察和 R2。
- 生产边界：本提交尚未发布，当前生产 revision 仍为 `58469e2`，正式入口仍使用完整 Dashboard；未把本地测试或 fixture 描述为生产切换。

## Blocked by

- [Issue 003：交付服务端分页的关键词资源](003-deliver-keyword-resource.md)。
