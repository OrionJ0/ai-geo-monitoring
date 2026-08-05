---
title: "扩展全部渠道区间趋势比较合同"
status: closed
type: AFK
blocked_by:
  - 001-paid-traffic-trend-contract.md
---

# 扩展全部渠道区间趋势比较合同

## Parent

- `../prd.md`
- `../TECH-SPEC.md`

## What to build

在现有百度统计区间流量合同上增加可选的全部渠道比较能力。一次请求返回全部访问、七个稳定渠道的当前逐日访问、当前与上一周期汇总、渠道占比和变化率；单渠道趋势失败时保留其他来源，默认旧请求不增加读取成本或改变响应。

## Acceptance criteria

- [x] 只有全部来源、访问指标的合法请求可以启用渠道比较，非法组合返回稳定 400 错误。
- [x] 比较响应包含七个唯一、稳定排序的正式 sourceKey。
- [x] 每个渠道包含汇总状态、趋势状态、当前/上一汇总、占比、变化率和当前逐日访问。
- [x] 单渠道失败返回 PARTIAL 和该行 UNAVAILABLE，其他可信来源继续返回。
- [x] 基础快照、鉴权或日期合同失败仍按请求级错误处理。
- [x] 未启用比较的现有网站流量请求保持原响应和读取成本。
- [x] 服务端来源读取有并发上限并复用现有缓存与 refresh 去重。

## Blocked by

- `001-paid-traffic-trend-contract.md`
