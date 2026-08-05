---
title: "交付广告表现真实双周期比较"
status: closed
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

- [x] 所选闭区间按上海完整日计算等长、紧邻的 previousFrom/previousTo，不受浏览器本地时区偏移。
- [x] 页面实际请求本期和上期广告层级资源，两次请求携带轻量 Dashboard 返回的同一 revision。
- [x] 两周期响应的 revision、filter、currency 和 cost scale 均经过校验，不一致时不生成比较结果。
- [x] 本期广告树、汇总、筛选、展开、移动端和空/错状态保持现役行为。
- [x] 上期 `READY` 时指标卡显示真实比较；上期越界或不可用时显示不可用，不显示伪造 `0`。
- [x] 上期可重试错误保持错误语义，不被降级成“没有上期数据”；本期错误不会用上期替代。
- [x] 项目或日期快速切换时，旧 request generation 的响应被丢弃，不能覆盖新页面状态。
- [x] hook、adapter、精确值合同和浏览器请求测试覆盖 current/previous、零、null、不可用、错误和过期响应。
- [x] 页面不重新读取已退役 Dashboard 明细，也不新增 compare RPC、feature flag 或旧路径 fallback。

## Blocked by

- [Issue 001：冻结 006 后合同并建立脱敏回归基线](001-freeze-contract-and-sanitized-baseline.md)。

## 验收证据

- `useAdPerformance` 先读取轻量 Dashboard，再并发请求 current/previous 两个 `/ad-hierarchy`；两次请求使用同一 revision，previous 范围由 UTC 日历上的等长相邻闭区间生成。request generation 在根响应和两份详情响应后均设门禁，迟到结果不会提交。
- 层级 decoder 继续要求 project、revision、coverage、currency、costScale、filter、树关系和逐日汇总成立；current 额外要求 summary 等于 Dashboard，previous 允许同 revision 下属于另一日期范围的真实 summary。
- adapter 仅以本期资源构建现役树，并按稳定账户/计划/单元/关键词身份附加上期趋势；页面指标卡直接消费两期资源 summary。`READY` 零值保持精确 `"0"`，越界为 `UNAVAILABLE`，其他失败为 `ERROR` 并显示可重试提示。
- 前端聚焦合同 16/16、前端全量营销 112/112、后端营销 224/224 通过；ESLint、TypeScript 与 Next.js 生产构建通过，共生成 40 条路由。
- 正式 Chrome 的本地生产构建回归 22/22 通过；其中验证两次同 revision 请求和等长相邻范围、上期 422 保留本期树、上期 503 保持错误、7 天迟到响应不能覆盖已切换的 14 天状态。
- 代码搜索与 diff 复核确认页面没有读取 Dashboard 明细数组，没有新增 compare RPC、feature flag、旧 Dashboard fallback、Provider/数据库/API/生产配置修改。
- 本 issue 尚未发布；当前生产仍运行 `d9b0688e28ba9b3a33fcfb061fe7d7235388ec22` 的 006 R2 路径，本地双周期行为要到 007 发布 issue 后才在正式入口生效。
