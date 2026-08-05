---
title: "交付关键词真实双周期比较"
status: closed
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

- [x] 关键词页本期和上期请求使用与 Issue 002 相同的等长周期、request generation 和同 revision 校验。
- [x] 本期列表继续有界分页；本期与上期指标均来自资源返回的完整筛选范围 summary。
- [x] 上期请求使用最小合法 page/pageSize，不为计算指标下载全部关键词分页。
- [x] query、campaignId、adGroupId 和日期过滤在两个周期保持一致，并由响应 filter 回显验证。
- [x] 改变本期页码或 page size 不改变任一周期 summary；改变业务筛选会重新请求两个周期。
- [x] 上期合法空集合显示真实零值；超 coverage 或资源不可用显示不可用；可重试错误保留错误状态。
- [x] 关键词指标卡不再使用固定 `previous={null}`、当前可见页汇总或补零逻辑。
- [x] 快速切换项目、日期、筛选和分页时，过期响应不能覆盖最新页面状态。
- [x] hook、adapter、分页、筛选、精确值和浏览器网络回归通过，广告表现与搜索词周期比较不回归。

## Blocked by

- [Issue 002：交付广告表现真实双周期比较](002-deliver-ad-performance-period-comparison.md)。

## 验收证据

- `useKeywordAnalysis` 先读取轻量 Dashboard，再并发请求 current/previous 两个 `/keywords`；两期使用同一 revision 和等长相邻日期。current 保留页面选择的有界分页，previous 固定 `page=1&pageSize=1`，没有下载全部关键词。
- `/keywords` 现役 v1 合同以 additive 字段回显实际生效的 `query`、`campaignId`、`adGroupId`；服务端 summary、count 和 items 继续复用同一 SQL 过滤。前端同时校验 project、revision、coverage、currency、costScale、日期及业务筛选回显，任一不一致均拒绝比较。
- adapter 只用 current items 构建表格，指标卡直接消费 current/previous 的完整筛选范围 summary 和 totalItems。合法空集合与精确零值保持 `READY`/`"0"`，日期越界为 `UNAVAILABLE`，其他失败为 `ERROR`；页面已删除固定 `previous={null}` 占位。
- request generation 覆盖项目、日期、筛选、排序、页码与 page size；迟到响应提交前再次核对 generation，不会覆盖最新页面状态。
- 前端聚焦合同 14/14、前端全量营销 115/115、后端聚焦合同 11/11、后端营销 224/224 通过；ESLint、TypeScript 与 Next.js 生产构建通过，共生成 40 条路由。
- 正式 Chrome 的本地生产构建回归 26/26 通过；网络断言证明两期同 revision、等长相邻日期、previous 最小分页、页码/page size 不改变 summary、query 与 adGroupId 同时应用于两期，并覆盖真实零、422 不可用、503 错误及迟到 generation。
- diff、旧占位和秘密扫描确认：未读取已退役 Dashboard 明细，未新增 compare RPC、全量下载、双版本、feature flag、fallback、百度上游调用、Token/Cookie/.env/原始响应或 0805-002 文件。
- 本 issue 的实现已随 007 revision `17214184f9c0ec2c9508080cb571f6b8b45923c4` 正式发布；生产关键词页已实际请求等长相邻本期/上期，并使用完整筛选范围 summary 和同一快照合同。
