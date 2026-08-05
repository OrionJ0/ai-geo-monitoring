---
title: "交付百度统计来源分区完整性"
status: open
type: AFK
blocked_by: []
---

# 交付百度统计来源分区完整性

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-2：来源分类明确说明是否覆盖全站访问。
- US-4：本地可以复现并回归 `83/82` 等生产形状。

## What to build

在百度统计 service、公开流量响应和网站流量页面之间交付完整的来源分区质量状态。服务端基于同一日期、设备和 visits 指标计算 `COMPLETE`、`PARTIAL` 或 `INVALID`，返回总访问、已分类访问、可证明的未覆盖差额和稳定原因码；前端直接消费该状态，不自行猜测或重新归一。

`83/82` 应成功返回 `PARTIAL` 并明确覆盖不完整。未覆盖差额只作为数据质量证据，不增加业务来源、不命名渠道、不进入归因。已分类大于总量、负数或非法十进制属于不可能合同，必须使用稳定错误拒绝展示。

## Acceptance criteria

- [ ] 先冻结现役 `website-traffic-overview` 的脱敏响应形状和 `83/82` 样本；不等待 003、006，不复制生产 Token、原始来源明细或站点身份。
- [ ] 总量和全部来源均为精确非负数且合计相等时，返回 `COMPLETE`、差额 `"0"` 和空原因码。
- [ ] 任一必需来源为空或已分类合计小于总量时，返回 `PARTIAL`、可证明的 total/classified/residual 和稳定原因码。
- [ ] `83/82` 脱敏样本返回 `PARTIAL`、total `"83"`、classified `"82"`、residual `"1"`。
- [ ] 已分类大于总量、负数或非法十进制时返回现役错误信封和稳定 `TONGJI_SOURCE_PARTITION_INVALID`，页面不展示为可信报表。
- [ ] 任一来源为空时不再跳过全部校验，也不能声称分区完整。
- [ ] residual 不进入来源 rows、不创建 `UNCLASSIFIED`/`OTHER` 等来源键、不参与份额归一或跨系统归因。
- [ ] 前端显示总量、已分类量和覆盖状态；`PARTIAL` 下可见来源份额不被重新归一到 100%。
- [ ] 新元数据以本 issue 冻结的现役响应形状选择最小 additive 位置，现役来源行、日期、设备、权限和空状态合同不回归。
- [ ] 后端合同、API、adapter 和页面测试覆盖 COMPLETE、null PARTIAL、83/82 PARTIAL、INVALID、零值和总量不可用。

## Blocked by

None - can start immediately. 生产发布和观察窗口不得与 003、006 重叠。
