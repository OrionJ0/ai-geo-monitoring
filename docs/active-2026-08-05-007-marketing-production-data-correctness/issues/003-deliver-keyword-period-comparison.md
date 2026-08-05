---
title: "交付关键词真实双周期比较"
status: open
type: AFK
blocked_by:
  - "002-deliver-ad-performance-period-comparison.md"
---

# 交付关键词真实双周期比较

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-1：关键词指标显示真实等长上期，不再使用固定空值或补零。
- US-4：脱敏生产形状可以在本地回归分页资源的双周期行为。

## What to build

让关键词页复用已验证的双周期状态和日期算法：本期继续分页读取明细与完整筛选范围 summary，上期使用同一关键词资源的最小合法分页只读取对应 summary。两个周期应用相同的文本、计划和单元筛选，并钉扎同一成功 revision。

列表分页只影响本期 items，不影响本期或上期指标卡。筛选后上期合法空集合、上期资源不可用和精确零值必须分别表达，不能从当前页、客户端下载的全部分页或固定 `null` 推导比较结果。

## Acceptance criteria

- [ ] 关键词页本期和上期请求使用与 Issue 002 相同的等长周期、request generation 和同 revision 校验。
- [ ] 本期列表继续有界分页；本期与上期指标均来自资源返回的完整筛选范围 summary。
- [ ] 上期请求使用最小合法 page/pageSize，不为计算指标下载全部关键词分页。
- [ ] query、campaignId、adGroupId 和日期过滤在两个周期保持一致，并由响应 filter 回显验证。
- [ ] 改变本期页码或 page size 不改变任一周期 summary；改变业务筛选会重新请求两个周期。
- [ ] 上期合法空集合显示真实零值；超 coverage 或资源不可用显示不可用；可重试错误保留错误状态。
- [ ] 关键词指标卡不再使用固定 `previous={null}`、当前可见页汇总或补零逻辑。
- [ ] 快速切换项目、日期、筛选和分页时，过期响应不能覆盖最新页面状态。
- [ ] hook、adapter、分页、筛选、精确值和浏览器网络回归通过，广告表现与搜索词周期比较不回归。

## Blocked by

- [Issue 002：交付广告表现真实双周期比较](002-deliver-ad-performance-period-comparison.md)。
