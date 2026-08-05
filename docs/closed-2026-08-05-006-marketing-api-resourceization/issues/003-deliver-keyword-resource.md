---
title: "交付服务端分页的关键词资源"
status: closed
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

- [x] 关键词请求复用同一 revision、项目、coverage 和权限合同，不自行选择 latest。
- [x] 聚合键、精确指标、trend、计划和单元归属与现役 Dashboard 关键词合同一致。
- [x] page size 有界，排序字段、顺序、文本查询、计划和单元过滤使用允许列表或绑定参数。
- [x] 数值排序使用精确数据库表达，稳定 tie-breaker 保证相邻页不重复或遗漏。
- [x] 响应返回完整筛选范围 summary；改变 page/pageSize 不改变 summary，且 summary 与 items/count 同 revision、filter 和只读事务。
- [x] 关键词页面正确展示分页总数、筛选、排序、合法空页、错误、stale 快照警告和本期 summary；上期双周期由 007 实施。
- [x] 页面网络请求不再携带或解析 campaigns、adGroups、searchTerms 明细。
- [x] R1 旧 Dashboard JSON 和未迁移消费者保持不变。

## 验收证据

- 后端聚焦合同：`MarketingKeywordResource.test.js` 与既有搜索词资源测试共 5/5 通过；覆盖显式 revision、权限先行、精确超大整数、跨页稳定顺序、完整筛选范围 summary、trend、绑定参数和无搜索词字段。
- 精确排序：SQLite 测试路径使用数据库内任意精度交叉乘积排名；`9007199254740993 / 1` 与 `9007199254740992 / 1` 的 CPC 顺序未退化为浮点相等。PostgreSQL 正式路径继续使用 `numeric` 分子分母表达。
- 有界读取：明细先在数据库排序分页，trend 再以当前页事实身份绑定读取；page size 默认 50、最大 200。summary、items 和 count 位于同一只读事务且同 revision/filter。
- 后端营销回归：`npm run test:marketing` 共 207/207 通过。
- 前端合同与回归：关键词单测 11/11、营销前端全量单测 104/104、全量 ESLint 通过，`npm run build` 生成 40 个路由并完成 TypeScript 检查。
- 真实浏览器：Playwright Chrome 17/17 通过；验证根请求只执行一次、详情请求钉扎相同 revision、服务端翻页/查询/排序、stale/错误状态、1280px 布局，以及关键词页不再解析旧 Dashboard 明细数组。
- 入口与退役边界：本地关键词正式消费者已改为 `Dashboard` 快照根 + `/api/marketing/projects/:projectId/keywords`；旧 Dashboard JSON 和广告表现等未迁移消费者仍保留，等待 R1 后的后续 issue。生产尚未发布本提交，当前生产仍走完整 Dashboard。
- 安全与范围：diff 未包含 Token、Cookie、`.env`、私钥、生产响应或用户提供的服务器凭据；原始工作区 0805-002 文件和修改未被触碰。

## Blocked by

- [Issue 002：交付 revision 钉扎的搜索词资源](002-deliver-search-term-resource.md)。
