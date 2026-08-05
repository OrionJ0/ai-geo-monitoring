---
title: "冻结 006 后广告双周期合同与脱敏基线"
status: open
type: HITL
blocked_by:
  - "../../draft-2026-08-05-006-marketing-api-resourceization/issues/007-release-r2-and-retire-large-dashboard.md"
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

- [ ] 006 已完成 R2、退役旧 Dashboard 大响应并从正式入口验收关闭。
- [ ] 冻结 006 后广告层级与关键词的全筛选范围 summary 字段、精确类型、null 语义、revision、coverage、currency 和 cost scale 合同。
- [ ] 建立双周期就绪、上期不可用及 null/零/十进制字符串脱敏 fixture。
- [ ] fixture 经后端 presenter 和前端 decoder 合同验证，能够稳定重现本需求列出的缺口与边界形状。
- [ ] 自动扫描和人工复核共同证明 fixture、日志及变更中不含 Token、Secret、Authorization、Cookie、统计用户名、真实关键词/搜索词、联系人、电话、邮箱、IP 或会话标识。
- [ ] 本切片运行代码 diff 为零，未提前修改页面、API、数据库、Provider 或生产配置。

## Blocked by

- [006 Issue 007：发布 R2 并正式退役 Dashboard 大响应](../../draft-2026-08-05-006-marketing-api-resourceization/issues/007-release-r2-and-retire-large-dashboard.md)。
