---
title: "市场工作台逐页数据与接口矩阵"
status: open
type: AFK
blocked_by: []
---

# 市场工作台逐页数据与接口矩阵

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- [数据接入矩阵](../data-integration-matrix.md)

## What to build

逐页核对市场总览、广告表现、关键词分析、网站流量、咨询数据、订单结果以及 AI/GEO/SEO 页面，把可见指标和交互、前端 hook、GoodieAI API、上游来源、配置、权限、敏感字段、缺口和验收证据收敛为同一份矩阵。状态必须区分代码存在、本地真实调用和生产已生效。

## Acceptance criteria

- [x] 覆盖用户指定的全部页面和相关数据模块。
- [x] 每行包含页面/组件/指标、hook、内部 API、上游、状态、配置、权限/敏感字段、缺口/动作/证据。
- [x] 官网表单、53KF 和销售系统保持独立事实。
- [x] 订单结果明确保持生产 `UNAVAILABLE`。
- [x] 最终 Run Report 已回填本地证据；生产因 SSH 发布前置条件阻塞，状态明确保留且本 issue 不关闭。
