---
title: "发布 R1 并证明详细页面零旧数组消费者"
status: closed
type: HITL
blocked_by:
  - "002-deliver-search-term-resource.md"
  - "003-deliver-keyword-resource.md"
  - "004-deliver-ad-hierarchy-resource.md"
---

# 发布 R1 并证明详细页面零旧数组消费者

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-2：详细页面负载有界。
- US-3：广告层级保持可用。
- US-4：真实多请求页面没有 revision 混用。
- US-5：additive 阶段获得进入 R2 的生产证据。

## What to build

用正式 Git Bundle 发布 R1，从受支持生产域名逐页验证搜索词、关键词和广告表现已经使用三个新资源，同时旧 Dashboard 仍保持完整合同。记录响应体积、数据库耗时、revision 一致性、详细数组消费者和访问证据，形成 R2 的硬门禁。

## Acceptance criteria

- [x] 公开 backend/frontend revision 与 R1 目标一致，健康和就绪检查通过。
- [x] 搜索词、关键词和广告表现页分别只读取其所需资源，数据、日期、来源、空值和错误状态正确。
- [x] 浏览器 Network 证明所有详情请求携带并回显相同项目 revision，单请求行数不超过 page size。
- [x] 代码搜索和生产访问证据表明详细页面读取 Dashboard 四个旧数组的消费者为零。
- [x] 市场总览仍使用旧 Dashboard 的 summary/trend，R1 没有提前删除兼容数组。
- [x] R1 前后响应字节、查询耗时和页面请求证据已记录，没有 revision、指标或分页 P0/P1。
- [x] 观察期与 003、007、005 的实施或生产观察窗口不重叠。

## 2026-08-06 验收证据

- 发布：首个候选 `c65f6c6e30c193a6ec978b3552a3911a4e5f5499` 上线后，生产核验发现搜索词正式 hook 仍从 Dashboard 的 `keywords/searchTerms` 构造下钻范围，因此未关闭本 issue。修正提交 `d5695402d9b39c0ce04108bc36b6d4aa02daac13` 用事实元组替代该依赖，并以 SHA-256 `a4577c12ca84996417878cacc8fff5e76d3bf3a42d19ce109b042897aa62d513` 的完整 Git Bundle 快进发布；服务器没有直接编辑源码。
- 健康：服务器 `HEAD`、公开 `/api/health` 和 `/api/frontend-health` 精确等于 `d5695402d9b39c0ce04108bc36b6d4aa02daac13`，`/api/ready` 为 `ready`；两个 systemd 单元分别只有一个活动主进程，工作区干净。营销迁移 `001`–`015` 全部应用且无 pending，发布备份权限为 `600`。
- 回归：正式部署通过后端 994/994、营销 210/210、官网 31/31、咨询 35/35、前端 104/104、lint、TypeScript/40 路由构建和单 worker Chrome 45/45。修正前合同测试先因正式 hook 仍使用完整 Dashboard 断言失败；修正后新增“Dashboard 四数组完全缺失仍可打开三个详情页”的真实 Chrome 用例。
- 正式页面与 Network：服务器 `/usr/bin/google-chrome` 从唯一支持域名验收市场总览、广告表现、关键词、关键词下钻搜索词和全量搜索词，截图仅保存在 `output/playwright/r1-production-d569540/`。详情资源全部携带并回显同一 opaque revision；关键词请求为 `10/10` 行，搜索词本期为 `20/20`、上期为 `1/1`，没有跨 revision 或越过 page size。下钻 URL 只携带账户、计划、单元、单元名称和关键词名称事实，不伪造搜索词 `keywordId`。
- 当前正式路径：市场总览继续读取完整 Dashboard 的状态、summary 和 trend；广告表现读取 Dashboard 根后调用 `/ad-hierarchy`；关键词读取 Dashboard 根后调用 `/keywords`；搜索词读取 Dashboard 根后调用本期与上期 `/search-terms`。详细 hook/page 对 `campaigns/adGroups/keywords/searchTerms` 的生产引用搜索为零，Nginx 留存窗口观测到 Dashboard 13、广告层级 3、关键词 3、搜索词 8 次请求，全部为 Chrome User-Agent。
- R1 兼容边界：Dashboard 仍按 additive 合同返回四个旧数组，市场总览仍依赖其根字段；旧大响应生成代码、旧 adapter 和兼容测试将在 Issue 006/007 的 R2 硬切中删除。它们没有被重新设为详情页 fallback。本 issue 关闭只代表 R1 观察门禁通过，006 需求仍为 `active`。
- 下一门禁：仓库尚未交付项目约定要求的唯一 OpenAPI 3.1 GoodieAI 广告读取合同和由其生成的前端 wire type，因此没有把 R1 描述成 006 整体合同已完成；该合同、后端响应合同测试与轻量 Dashboard 硬切必须在 006 关闭前完成。
- 性能与体积：30 次服务器内只读 service 测量中，完整 Dashboard 为 1,061,845 B、P50/P95/最大 118.19/130.43/132.02 ms；广告层级为 889,563 B、97.89/131.91/137.78 ms；关键词 50 行为 67,692 B、101.01/118.69/138.66 ms；搜索词 50 行为 39,271 B、30.22/32.92/36.46 ms。浏览器七日范围中，广告层级 289,132 B，关键词 10 行 5,947 B，搜索词 20 行 9,220 B。R1 暂时同时下载兼容 Dashboard 与详情资源；R2 删除完整根数组后才计算最终页面节省。
- 既有边界：市场总览同时请求的官网表单模块仍按既定生产配置返回 `503/DISABLED`，产生唯一一条浏览器 console resource error；这不是营销资源失败，也没有用 fixture 或 fallback 掩盖。

## Blocked by

- [Issue 002：交付 revision 钉扎的搜索词资源](002-deliver-search-term-resource.md)。
- [Issue 003：交付服务端分页的关键词资源](003-deliver-keyword-resource.md)。
- [Issue 004：交付一致快照的广告层级资源](004-deliver-ad-hierarchy-resource.md)。
