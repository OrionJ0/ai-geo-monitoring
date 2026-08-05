---
title: "硬切首页区间数据链并修复广告汇总"
status: closed
type: AFK
blocked_by:
  - 002-all-source-range-comparison-api.md
---

# 硬切首页区间数据链并修复广告汇总

## Parent

- `../prd.md`
- `../TECH-SPEC.md`

## What to build

让市场总览只使用 Dashboard 广告事实和百度统计区间事实。广告快照覆盖范围内没有返回的零投放日按精确零参与周期汇总，未知日仍保持缺失；首页渠道表、全部访问和单渠道访问统一使用区间合同，不再读取固定 30 日趋势接口。

## Acceptance criteria

- [x] 广告快照 coverage 内的稀疏零投放日不再导致周期投入、展现、点击和 CPC 显示 `—`。
- [x] coverage 外、响应失败或合同无效的数据不被补零。
- [x] 首页渠道表与访问趋势使用相同设备、日期和百度统计区间口径。
- [x] 首页源码和浏览器请求不再调用固定 `tongji-trend`、`tongji-source-trends`。
- [x] 前端 sourceKey 统一使用正式 WebsiteSourceKey，不保留 UI 私有翻译表。
- [x] 比较响应在前端边界严格校验，竞态响应不能覆盖最新筛选。
- [x] 相同范围的首页广告汇总与广告表现页一致。

## Blocked by

- `002-all-source-range-comparison-api.md`
