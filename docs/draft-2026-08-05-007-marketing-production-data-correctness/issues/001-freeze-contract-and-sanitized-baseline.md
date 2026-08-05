---
title: "冻结 006 后合同并建立脱敏回归基线"
status: open
type: HITL
blocked_by:
  - "003 完成 A2、正式入口验收并关闭"
  - "../../active-2026-08-05-006-marketing-api-resourceization/issues/007-release-r2-and-retire-large-dashboard.md"
---

# 冻结 006 后合同并建立脱敏回归基线

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-4：本地无需生产 Token 也能复现生产响应边界。
- US-5：生产行为、内部合同和验收证据使用同一口径。

## What to build

在 003 和 006 正式关闭后，冻结轻量 Dashboard、广告层级、关键词、来源比较和页面报告的真实内部响应合同。使用系统已经规范化的响应建立脱敏 fixture 与可执行基线，固定广告 summary 字段、来源分区字段位置、页面稳定身份和错误信封，证明已知双周期、`83/82` 与同路径问题可以在本地重现。

本切片只建立后续修复所需的可信事实和隐私边界，不修改正式业务行为。生产原始报文、Token、数据库、统计用户名、真实查询词和个人信息不得进入本地或 Git；fixture 需要人工完成最终脱敏复核。

## Acceptance criteria

- [ ] 003 已完成 A2、正式入口验收并关闭，006 已完成 R2、退役旧 Dashboard 大响应并关闭。
- [ ] 冻结 006 后广告层级与关键词的全筛选范围 summary 字段、精确类型、null 语义、revision、coverage、currency 和 cost scale 合同。
- [ ] 冻结现役来源比较字段形状，确定分区元数据采用最小 additive 位置，不破坏既有来源行消费者。
- [ ] 确认页面报告存在可跨请求稳定使用的 page identity，并固定数字与不透明字符串的排序规则。
- [ ] 建立双周期就绪、上期不可用、来源 `83/82`、同路径碰撞及 null/零/十进制字符串五类脱敏 fixture。
- [ ] fixture 经后端 presenter 和前端 decoder 合同验证，能够稳定重现本需求列出的缺口与边界形状。
- [ ] 自动扫描和人工复核共同证明 fixture、日志及变更中不含 Token、Secret、Authorization、Cookie、统计用户名、真实关键词/搜索词、联系人、电话、邮箱、IP 或会话标识。
- [ ] 本切片运行代码 diff 为零，未提前修改页面、API、数据库、Provider 或生产配置。

## Blocked by

- 003 完成 A2、正式入口验收并关闭。
- [006 Issue 007：发布 R2 并正式退役 Dashboard 大响应](../../active-2026-08-05-006-marketing-api-resourceization/issues/007-release-r2-and-retire-large-dashboard.md)。
