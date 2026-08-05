---
title: "修复百度推广访问趋势合同与一致性门禁"
status: closed
type: AFK
blocked_by: []
---

# 修复百度推广访问趋势合同与一致性门禁

## Parent

- `../prd.md`
- `../TECH-SPEC.md`

## What to build

为百度推广访问建立一条不可静默失真的趋势合同：使用唯一、经证据支持的百度统计付费来源筛选，并在刷新、缓存命中和缓存回退时校验逐日访问加总与同范围来源汇总一致。汇总非零但趋势为空或为零时必须被识别为合同错误，不能写入缓存或作为正常无数据返回。

## Acceptance criteria

- [x] 百度推广趋势请求只使用一个现役来源筛选，不保留双试或 fallback。
- [x] 同范围逐日 visits 加总与百度推广来源汇总精确一致时才允许返回和缓存。
- [x] REFRESHED、HIT、FALLBACK 都执行相同一致性门禁。
- [x] 真实 `0 == 0` 被保留；未知值不被补零或伪造成一致。
- [x] 汇总与趋势不一致时返回稳定错误码，错误趋势不进入缓存。
- [x] provider、service 和缓存回归测试覆盖正常、零值、不一致及 stale 场景。

## Blocked by

None - can start immediately.
