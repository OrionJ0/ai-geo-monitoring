---
title: "交付广告表现真实双周期比较"
status: open
type: AFK
blocked_by:
  - "001-freeze-contract-and-sanitized-baseline.md"
---

# 交付广告表现真实双周期比较

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-1：广告指标显示真实等长上期，不再把未请求的数据当成零。
- US-4：脱敏生产形状可以在本地回归双周期行为。

## What to build

让广告表现页在 006 的轻量 Dashboard 和广告层级资源上完成本期与等长相邻上期的完整读取、校验和展示。两个周期必须钉扎同一成功 revision，并验证币种、cost scale 和服务端回显日期；本期层级继续正常展示，上期只用于指标比较。

上期超出 coverage 或确实不可用时，本期仍可使用，页面把上期及环比显示为不可用。可重试错误、真实零值和缺失值保持不同状态；项目或日期切换后的旧响应不能覆盖新选择。

## Acceptance criteria

- [ ] 所选闭区间按上海完整日计算等长、紧邻的 previousFrom/previousTo，不受浏览器本地时区偏移。
- [ ] 页面实际请求本期和上期广告层级资源，两次请求携带轻量 Dashboard 返回的同一 revision。
- [ ] 两周期响应的 revision、filter、currency 和 cost scale 均经过校验，不一致时不生成比较结果。
- [ ] 本期广告树、汇总、筛选、展开、移动端和空/错状态保持现役行为。
- [ ] 上期 `READY` 时指标卡显示真实比较；上期越界或不可用时显示不可用，不显示伪造 `0`。
- [ ] 上期可重试错误保持错误语义，不被降级成“没有上期数据”；本期错误不会用上期替代。
- [ ] 项目或日期快速切换时，旧 request generation 的响应被丢弃，不能覆盖新页面状态。
- [ ] hook、adapter、精确值合同和浏览器请求测试覆盖 current/previous、零、null、不可用、错误和过期响应。
- [ ] 页面不重新读取已退役 Dashboard 明细，也不新增 compare RPC、feature flag 或旧路径 fallback。

## Blocked by

- [Issue 001：冻结 006 后合同并建立脱敏回归基线](001-freeze-contract-and-sanitized-baseline.md)。
