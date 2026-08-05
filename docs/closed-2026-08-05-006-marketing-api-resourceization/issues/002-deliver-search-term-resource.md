---
title: "交付 revision 钉扎的搜索词资源"
status: closed
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

- [x] 详情请求必须提供 revision，服务端在项目权限检查后验证其属于同项目完整成功快照。
- [x] 日期必须位于 revision coverage 内；刷新发生后，旧 revision 请求仍只返回旧事实。
- [x] 搜索词在数据库完成聚合、允许列表筛选、稳定排序和有界分页，总数与 items 属于同一只读事务。
- [x] 精确指标保持字符串，搜索词只保留关键词名称证据且不返回 `keywordId`。
- [x] 合法空页、revision 缺失/不存在、越界日期和快照不可用有不同稳定语义。
- [x] 搜索词页面的本期与上期使用同一 revision；上期超出 coverage 时诚实显示不可比较。
- [x] 旧 Dashboard 合同、市场总览、关键词和广告表现消费者在本切片中保持不变。

## 2026-08-05 验收证据

- 红灯：后端合同测试首次因 `MarketingAdResourceService` 不存在而以 `MODULE_NOT_FOUND` 失败；HTTP 合同随后以资源路由 `404` 失败；前端合同首次因页面没有 `/search-terms` 消费路径失败。
- 后端：新增唯一 `MarketingSnapshotSelector` 与 additive `GET /api/marketing/projects/:projectId/search-terms`；权限检查先于 revision 解析，显式 revision、coverage、状态和有界查询均使用绑定参数或允许列表。
- 数据正确性：SQLite 的分页 items 通过数据库逐位十进制聚合保持超出 64 位整数范围的字符串精度，summary 与 trend 使用服务端 `BigInt` 精确求和；测试以 `999999999999999999999999` 跨日聚合，确认 summary、items、trend 和数值分页不经过 JavaScript `Number`。
- 页面路径：搜索词页只用一份完整 Dashboard 取得并缓存根 revision；本期和上期都请求 `/search-terms` 且强制校验同一 revision、项目和日期。分页、搜索、筛选和排序只改变详情请求，不重新选择根 revision；上期越过 coverage 时保留服务端错误原因并显示不可比较。
- 回归：后端营销测试 205/205；前端营销合同测试 104/104；ESLint 全量通过；Next 生产构建、内置 TypeScript 检查和 40 个路由生成通过。
- Chrome：真实 Chrome 的关键词/搜索词套件 16/16 通过，覆盖下钻不扩权、错误 revision、错误周期、上一周期等待、同 revision 双周期、服务端分页/搜索/排序和 1280px 页面稳定性；本切片最新专项运行证明翻页与筛选期间完整 Dashboard 仅请求 1 次，所有详情请求 revision 相同。
- 不变性：旧 Dashboard 四个明细数组及其他消费者仍保留，市场总览、广告表现和关键词正式代码未迁移；四报表抓取、预算、双读、原子快照、数据库 schema 和 provider 均未修改。生产仍运行 `58469e29214ccc28e989f07d54af873d9c0ba801`，本资源尚未发布，当前正式页面仍走旧 Dashboard。

## Blocked by

- [Issue 001：冻结广告资源合同与生产基线](001-freeze-resource-contract-and-production-baseline.md)。
