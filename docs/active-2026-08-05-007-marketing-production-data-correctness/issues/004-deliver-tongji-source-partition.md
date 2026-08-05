---
title: "交付百度统计来源分区完整性"
status: closed
type: AFK
blocked_by:
  - "001-freeze-contract-and-sanitized-baseline.md"
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

- [x] 总量和全部来源均为精确非负数且合计相等时，返回 `COMPLETE`、差额 `"0"` 和空原因码。
- [x] 任一必需来源为空或已分类合计小于总量时，返回 `PARTIAL`、可证明的 total/classified/residual 和稳定原因码。
- [x] `83/82` 脱敏样本返回 `PARTIAL`、total `"83"`、classified `"82"`、residual `"1"`。
- [x] 已分类大于总量、负数或非法十进制时返回现役错误信封和稳定 `TONGJI_SOURCE_PARTITION_INVALID`，页面不展示为可信报表。
- [x] 任一来源为空时不再跳过全部校验，也不能声称分区完整。
- [x] residual 不进入来源 rows、不创建 `UNCLASSIFIED`/`OTHER` 等来源键、不参与份额归一或跨系统归因。
- [x] 前端显示总量、已分类量和覆盖状态；`PARTIAL` 下可见来源份额不被重新归一到 100%。
- [x] 新元数据以 Issue 001 冻结的最小 additive 位置交付，现役来源行、日期、设备、权限和空状态合同不回归。
- [x] 后端合同、API、adapter 和页面测试覆盖 COMPLETE、null PARTIAL、83/82 PARTIAL、INVALID、零值和总量不可用。

## Verification

- 后端：`npm run test:marketing`，227 项通过；最终聚焦 service、分区与 API 测试 30 项通过。
- 前端：`npm test`，117 项通过；`npm run lint`、`npx tsc --noEmit`、`npm run build` 通过，生产构建生成 40 个路由。
- 真实浏览器：生产构建下运行网站流量与市场总览 Chrome 用例，19 项通过；验证 `61843/61842` 为 `PARTIAL`、可见来源份额保持 `30.1%`，且页面不创建差额来源。
- 合同：`sourceComparison.partition` 为 additive 元数据；原 `sourceComparison.state` 继续表示来源趋势可用性，避免改变现役含义。
- 正式路径：代码仍通过 `/api/marketing/projects/:projectId/website-traffic-overview` 和两个现役页面消费；本 issue 尚未发布，生产仍运行上一正式 revision。

## Blocked by

- [Issue 001：冻结 006 后合同并建立脱敏回归基线](001-freeze-contract-and-sanitized-baseline.md)。
