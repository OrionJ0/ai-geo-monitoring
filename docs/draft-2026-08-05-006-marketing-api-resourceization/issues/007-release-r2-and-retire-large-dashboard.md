---
title: "发布 R2 并正式退役 Dashboard 大响应"
status: open
type: HITL
blocked_by:
  - "006-hard-cut-lightweight-dashboard.md"
---

# 发布 R2 并正式退役 Dashboard 大响应

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-1：市场总览使用轻量快照根。
- US-2：关键词和搜索词负载有界。
- US-3：广告表现保留严格层级。
- US-4：全部页面使用一致 revision。
- US-5：旧合同按证据正式退役且没有长期双版本。

## What to build

用独立 Git Bundle 发布 R2，从正式域名验证轻量 Dashboard 和三个详情资源成为唯一生产路径。完成响应预算、数据库查询、浏览器页面、旧调用清零、代码与文档清理证据后关闭 006，并移交 007 修复生产数据正确性；007 关闭后才解除 005 的实施门禁。

## Acceptance criteria

- [ ] 公开 backend/frontend revision 与 R2 目标一致，健康和就绪检查通过。
- [ ] Dashboard 正式响应不包含四个旧明细数组，市场总览仍正确展示真实广告汇总和趋势。
- [ ] 广告表现、关键词和搜索词页面分别使用层级、关键词和搜索词资源，revision、日期和来源一致。
- [ ] 关键词和搜索词单请求返回行数始终不超过 page size，合法空页与快照缺失可区分。
- [ ] 生产访问、浏览器 Network、代码搜索和文档搜索共同证明旧大响应消费者与现役说明为零。
- [ ] R2 相对基线降低不必要响应字节，查询和页面 P95 无阻断回归。
- [ ] 不存在 `/v1`、长期旧合同、feature flag、兼容 adapter 或运行时 fallback。
- [ ] 阻断失败只通过 R2 后代 revert revision 快进恢复完整 R1，并记录再次硬切的退出条件。

## Blocked by

- [Issue 006：硬切轻量 Dashboard 并删除旧大响应](006-hard-cut-lightweight-dashboard.md)。
