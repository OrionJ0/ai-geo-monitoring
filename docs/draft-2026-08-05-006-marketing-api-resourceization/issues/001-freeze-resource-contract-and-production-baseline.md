---
title: "冻结广告资源合同与生产基线"
status: open
type: HITL
blocked_by: []
---

# 冻结广告资源合同与生产基线

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-2：关键词和搜索词在数据增长后仍保持有界负载。
- US-4：所有页面通过同一 revision 保持快照一致。
- US-5：迁移前有明确合同、基线和退役条件。

## What to build

在不改变当前生产 API 的前提下，从正式入口测量 Dashboard 响应体积、读取耗时、页面请求、刷新/四报表调用次数和真实消费者；同时在新路由实现前交付唯一 OpenAPI 3.1 合同，冻结四个广告读取 operation 的分页、排序、筛选、响应、空值、错误、缓存、revision、数据源和上游行为，并固定广告层级与关键词的全筛选范围 summary。该证据是后续 R1 实现的门禁，不以 fixture 行数代替生产事实。

## Acceptance criteria

- [ ] 记录基线时 003 与 006 均没有进行中的生产发布或观察窗口；记录当前正式凭据路径，但不要求 003 关闭。
- [ ] 记录 Dashboard 压缩前后字节、数据库读取耗时和可获得的 P95 基线，不记录敏感业务明细。
- [ ] 盘点仓库内页面、CLI、诊断脚本及可观测生产调用，确认当前详细数组消费者清单。
- [ ] 记录同一项目并发页面读取时 Dashboard、refresh run 和四份百度报告的调用次数，证明现役刷新协调没有按页面数量放大上游请求。
- [ ] 用真实数据确认关键词和搜索词默认/最大 page size，并冻结为服务端合同。
- [ ] 用现役 UI 确认允许的排序、文本查询和父级筛选字段，不加入假想字段。
- [ ] 冻结广告层级和关键词 summary 的现役指标字段、精确类型、null 语义及与分页无关性。
- [ ] 冻结轻量 Dashboard、广告层级、关键词、搜索词的响应 schema、错误码和缓存规则。
- [ ] 新建唯一 `docs/openapi/marketing-ad-read.openapi.yaml`，只覆盖 006 的四个 GoodieAI 广告读取 operation，不包含百度上游、百度统计流量或全项目 API。
- [ ] OpenAPI 为每个 operation 冻结请求、响应、null、错误、缓存、`x-data-source`、`x-upstream-behavior` 和真实 `x-release-stage`；完整 Dashboard 为 `LIVE_R0`，三个详情 operation 为 `PLANNED_R1`，轻量 Dashboard 候选 schema 为 `PLANNED_R2`。
- [ ] 提供可复现的前端 wire type 生成和 stale check，并用同一 OpenAPI 校验现役 Dashboard 及脱敏候选响应；不强制生产每次响应重复运行时校验。
- [ ] `docs/API.md` 只保留现役路由和业务语义摘要，不复制 OpenAPI 字段表；不新建 Swagger 门户或第二套手写合同。
- [ ] 证据证明本切片没有修改生产响应、页面默认路径、数据库或刷新行为。

## Blocked by

None - can start immediately. 生产发布和观察窗口仍不得与 003 重叠。
