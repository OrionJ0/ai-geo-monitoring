---
title: "冻结 006 后合同并建立脱敏回归基线"
status: closed
type: HITL
blocked_by:
  - "003 完成 A2、正式入口验收并关闭"
  - "../../closed-2026-08-05-006-marketing-api-resourceization/issues/007-release-r2-and-retire-large-dashboard.md"
---

# 冻结 006 后广告双周期合同与脱敏基线

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-4：本地无需生产 Token 也能复现生产响应边界。
- US-5：生产行为、内部合同和验收证据使用同一口径。

## What to build

在 006 正式关闭后，冻结轻量 Dashboard、广告层级和关键词的真实内部响应合同。使用系统已经规范化的响应建立脱敏 fixture 与可执行基线，固定广告 summary、revision、coverage、currency、cost scale 和错误信封，证明已知双周期与上期不可用问题可以在本地重现。

百度统计来源 `83/82` 和同路径问题不依赖 006，分别由 Issue 004、005 在现役统计合同上建立自己的最小脱敏基线，本 issue 不再阻塞它们。

本切片只建立后续修复所需的可信事实和隐私边界，不修改正式业务行为。生产原始报文、Token、数据库、统计用户名、真实查询词和个人信息不得进入本地或 Git；fixture 需要人工完成最终脱敏复核。

## Acceptance criteria

- [x] 003 已完成 A2、正式入口验收并关闭，006 已完成 R2、退役旧 Dashboard 大响应并关闭。
- [x] 冻结 006 后广告层级与关键词的全筛选范围 summary 字段、精确类型、null 语义、revision、coverage、currency 和 cost scale 合同。
- [x] 冻结现役来源比较字段形状，确定分区元数据采用最小 additive 位置，不破坏既有来源行消费者。
- [x] 确认页面报告存在可跨请求稳定使用的 page identity，并固定数字与不透明字符串的排序规则。
- [x] 建立双周期就绪、上期不可用、来源 `83/82`、同路径碰撞及 null/零/十进制字符串五类脱敏 fixture。
- [x] fixture 经后端 OpenAPI 合同和前端真实 decoder 验证，能够稳定重现本需求列出的缺口与边界形状。
- [x] 自动扫描和人工复核共同证明 fixture、日志及变更中不含 Token、Secret、Authorization、Cookie、统计用户名、真实关键词/搜索词、联系人、电话、邮箱、IP 或会话标识。
- [x] 本切片运行代码 diff 为零，未提前修改页面、API、数据库、Provider 或生产配置。

## Blocked by

- 003 完成 A2、正式入口验收并关闭。
- [006 Issue 007：发布 R2 并正式退役 Dashboard 大响应](../../closed-2026-08-05-006-marketing-api-resourceization/issues/007-release-r2-and-retire-large-dashboard.md)。

## 验收证据

- 正确性基线见[脱敏生产形状基线](../production-shape-baseline.md)。五个 JSON 仅包含规范化虚构数据；自动高风险模式扫描和人工 diff 复核均未发现秘密、个人信息、生产身份或原始百度响应。
- 后端基线合同 5/5 通过：依据 006 OpenAPI 冻结层级/关键词 summary 三个精确字段、同 revision/coverage/currency/costScale、等长相邻周期、稳定错误信封、83/82 差额与 page identity。
- 前端真实 decoder 3/3 通过：当前广告根与本期层级、当前/上期关键词 fixture 可解码；上期层级被现役 decoder 错绑到 Dashboard 本期 summary；83/82 被现役 decoder 接受为 `COMPLETE` 且无 partition；两个不同 pageId 的同路径记录可解码但没有消歧元数据。三处缺口均被稳定复现，未在本 issue 提前修复。
- 生产只读规范化核对没有保存响应正文：当前采样分别观测到全设备 200/198、PC 153/152、全设备单日 89/88，现役状态仍为 `COMPLETE`；入口页 57 个唯一数字字符串 pageId 中有一个规范化路径碰撞组，组内 35 条事实。该证据确认 83/82 不是孤立形状，且 pageId 可跨请求作为稳定身份。
- 本 issue 只改需求状态、测试与 `tests/fixtures/marketing-production-correctness/`；运行页面、API、数据库、Provider、生产配置和 006 正式合同 diff 均为零。
