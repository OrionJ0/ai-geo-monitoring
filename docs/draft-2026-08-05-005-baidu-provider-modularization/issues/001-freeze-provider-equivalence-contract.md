---
title: "冻结百度 Provider 黑盒等价合同"
status: open
type: AFK
blocked_by:
  - "003 完成 A2 并关闭"
  - "../../active-2026-08-05-006-marketing-api-resourceization/issues/007-release-r2-and-retire-large-dashboard.md"
  - "../../draft-2026-08-05-007-marketing-production-data-correctness/prd.md"
---

# 冻结百度 Provider 黑盒等价合同

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-2：共享网络安全控制不能因拆分而复制或放宽。
- US-3：广告与流量数据、错误和预算在重构前后保持一致。

## What to build

在现役单体 Provider 仍是唯一正式真值时，建立一套通过公开 facade 执行的脱敏黑盒特征合同。合同覆盖 OAuth、账户目录、搜索推广四报表和百度统计主要报告，冻结请求序列、允许路径、输出、稳定错误、预算、等待、取消和导出 identity。同时审计“实际出站调用→唯一 manifest 条目→官方来源/验证状态→脱敏 fixture/parser/trace”可追溯链。

本切片只增加可执行证据，不改变生产 Provider。后续切片不能通过更新 golden 来接受未批准的行为变化。

## Acceptance criteria

- [ ] 公开构造、方法、导出和错误 class identity 均有合同断言。
- [ ] 脱敏 trace 覆盖 method、path、body 形状、timeout、响应字节、等待和取消，不包含 Token、Secret、关键词或搜索词明文。
- [ ] 搜索推广四报表顺序、双读、QPS、整轮预算和规范化输出在旧实现上被固定。
- [ ] 百度统计站点、趋势、来源、质量和页面分页的成功、合法空数据与错误合同被固定。
- [ ] 007 修正后的来源 COMPLETE/PARTIAL/INVALID、同路径页面消歧和相关稳定错误合同被固定。
- [ ] allowlist、HTTP 非成功、超时、超大响应、非 JSON 和网络失败均有稳定错误四元组断言。
- [ ] 每个实际百度出站调用都可追溯到唯一 manifest 条目，其方法/地址、报告编号或统计 method、字段、官方来源、验证日期/状态、能力与预算完整。
- [ ] manifest、脱敏 fixture、严格 parser 与 request trace 的对应关系有自动合同测试，缺证据能力保持未验证/fail-closed。
- [ ] 不新建百度上游 OpenAPI、官方文档镜像、第二套手写端点清单或实时/定时漂移监测平台。
- [ ] 全部新增合同测试在未拆分的现役 Provider 上通过，运行代码 diff 为零。

## Blocked by

- 003 完成 A2、正式入口验收并关闭。
- [006 Issue 007：R2 正式切换并退役旧大响应](../../active-2026-08-05-006-marketing-api-resourceization/issues/007-release-r2-and-retire-large-dashboard.md)。
- [007：营销生产数据正确性与双周期回归](../../draft-2026-08-05-007-marketing-production-data-correctness/prd.md)完成正式入口验收并关闭。
