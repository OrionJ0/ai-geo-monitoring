---
title: "发布 R1 并证明详细页面零旧数组消费者"
status: open
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

- [ ] 公开 backend/frontend revision 与 R1 目标一致，健康和就绪检查通过。
- [ ] 搜索词、关键词和广告表现页分别只读取其所需资源，数据、日期、来源、空值和错误状态正确。
- [ ] 浏览器 Network 证明所有详情请求携带并回显相同项目 revision，单请求行数不超过 page size。
- [ ] 代码搜索和生产访问证据表明详细页面读取 Dashboard 四个旧数组的消费者为零。
- [ ] 市场总览仍使用旧 Dashboard 的 summary/trend，R1 没有提前删除兼容数组。
- [ ] R1 前后响应字节、查询耗时和页面请求证据已记录，没有 revision、指标或分页 P0/P1。
- [ ] 观察期与 003、007、005 的实施或生产观察窗口不重叠。

## Blocked by

- [Issue 002：交付 revision 钉扎的搜索词资源](002-deliver-search-term-resource.md)。
- [Issue 003：交付服务端分页的关键词资源](003-deliver-keyword-resource.md)。
- [Issue 004：交付一致快照的广告层级资源](004-deliver-ad-hierarchy-resource.md)。
