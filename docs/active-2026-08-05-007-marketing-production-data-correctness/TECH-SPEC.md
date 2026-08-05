---
title: 营销生产数据正确性与双周期回归技术方案
date: 2026-08-05
status: active
source: docs/active-2026-08-05-007-marketing-production-data-correctness/prd.md
scope: deep
---

# 营销生产数据正确性与双周期回归技术方案

## 1. 背景与目标

生产营销数据已接入，但现役后处理仍存在三处已证实的正确性缺口：

- `useAdPerformance.ts` 只读取一次 Dashboard，`adPerformanceAdapter.ts` 把 `previousTrend` 固定为空数组；
- `useKeywordAnalysis.ts` 只读取本期，关键词页指标卡把上期固定为 `null`；
- `BaiduTongjiService.assertSourcePartition()` 在任一来源值为空时跳过完整分区校验；
- 页面报告用上游 page ID 区分事实，却把展示路径规范化为 pathname + search，导致不同事实可能显示为同一路径。

006 将广告读 API 收敛为轻量 Dashboard + revision 钉扎的资源接口。007 不修补即将退役的 Dashboard 大数组，而是在 006 R2 最终合同上完成双周期消费；同时为现役百度统计接口增加向后兼容的完整性和路径消歧元数据。

目标执行链：

```text
003 closed
  → 006 R2 closed
  → 007 correctness closed
  → 005 provider equivalence freeze / implementation
```

005 必须最后执行。否则 005 的 golden 会把“跳过来源对账”和“重复路径无消歧”固化为应保持的行为。

## 2. 范围、非目标与门禁

### 2.1 范围

- 消费 006 最终 `/ad-hierarchy` 和 `/keywords` summary 的本期/上期数据；
- 固定等长相邻周期算法、revision 钉扎和过期响应保护；
- 给网站来源比较增加分区完整性合同；
- 给网站页面记录增加相同路径碰撞元数据；
- 建立脱敏内部标准响应 fixture 和多层回归；
- 从正式入口验证全部营销页面和模块状态。

### 2.2 非目标

- 不改 OAuth、Token、统计用户名或站点绑定；
- 不改 006 的资源边界、分页和旧 Dashboard 退役；
- 不拆 Provider、HTTP 内核或 composition root；
- 不修改百度上游请求方法、报告类型或业务主数据源；
- 不接入官网生产凭据、53KF、销售或营销 AI；
- 不复制生产秘密、原始上游响应或个人信息；
- 不把未分类差额创建为新的 `WebsiteSourceKey`；
- 不把页面比率事实做无证据聚合。

### 2.3 门禁

- CON-001：003 A2 和正式入口验收未关闭时不开始 007。
- CON-002：006 R2 未关闭、旧 Dashboard 明细仍是正式路径时不开始 007。
- CON-003：007 未关闭时不开始 005 的黑盒等价冻结。
- CON-004：006 必须先提供广告层级和关键词的全筛选范围 `summary`。

## 3. 当前系统与目标数据流

### 3.1 广告

006 后目标读取为：

```text
lightweight dashboard(from, to)
  → revision + coverage + currency + costScale
      ├── ad-hierarchy(revision, currentRange) → current summary + hierarchy
      ├── ad-hierarchy(revision, previousRange) → previous summary
      ├── keywords(revision, currentRange, filters, page) → current items + summary
      └── keywords(revision, previousRange, filters, page=1,pageSize=1) → previous summary
```

关键词上期请求只需要 summary。首版仍使用同一资源合同和最小合法分页，不新增专用 `/compare` 或批量 RPC。

### 3.2 百度统计来源

```text
BaiduTongjiClient source report
  → BaiduTongjiService normalize / validate
  → website-traffic-overview sourceComparison
  → frontend source rows + partition state
```

完整性判断属于百度统计 service，因为它掌握全站总量、来源行和空值语义；HTTP route 只序列化稳定合同，前端不重新推断。

### 3.3 百度统计页面

```text
upstream pageId + URL + metrics
  → normalize path while retaining pageId
  → group collision metadata before pagination
  → website-traffic-pages rows
  → stable disambiguated label
```

## 4. 公共合同

### 4.1 广告资源 summary

006 的 `/ad-hierarchy` 和 `/keywords` 响应增加：

```json
{
  "summary": {
    "impressions": "123",
    "clicks": "12",
    "costAmountScaled": "4567"
  }
}
```

规则：

- summary 聚合完整筛选结果，与分页无关；
- 字段只取页面现役指标，不为未来假想卡片扩大；
- 计数和金额使用精确十进制字符串；
- 缺失保持 `null`，不得补零；
- summary、items、count 使用同一 revision、filter 和只读事务；
- `/ad-hierarchy` 的 summary 与该响应三层事实使用同一过滤范围；
- `/keywords` 的 summary 应用与 items 完全相同的 query、campaignId 和 adGroupId 过滤。

这是 006 最终资源合同的一部分，007 只消费，不在前端重新聚合全部分页。

### 4.2 双周期算法

对闭区间 `[from, to]`：

```text
days = to - from + 1
previousTo = from - 1 day
previousFrom = previousTo - (days - 1) days
```

所有日期按项目现役上海完整日语义计算，不用浏览器本地时区对 ISO 字符串做隐式偏移。

双周期响应必须满足：

- 两次详情响应的 `revision` 等于根响应 revision；
- `coverage.currency` 和 `coverage.costScale` 相同；
- 每个响应回显的 `filter` 精确等于请求的有效范围；
- previous 不在 coverage 内时，返回现役稳定越界错误，由 hook 规范化为 `UNAVAILABLE`；
- previous 的错误不清空 current；
- current 的错误使页面进入错误状态；
- 每次项目、日期或筛选变更递增 request generation，旧 generation 结果一律丢弃。

前端内部状态建议：

```ts
type PeriodComparison<T> = {
  current: { state: "READY"; value: T } | { state: "ERROR"; error: Error };
  previous:
    | { state: "READY"; value: T }
    | { state: "UNAVAILABLE"; reasonCode: string }
    | { state: "ERROR"; error: Error };
};
```

`UNAVAILABLE` 与精确零值分开。可重试的上游/服务错误也不能自动降级为无上期。

### 4.3 来源分区完整性

`website-traffic-overview` 在来源比较存在时增加：

```json
{
  "sourceComparison": {
    "rows": [],
    "partition": {
      "metric": "visits",
      "state": "PARTIAL",
      "totalVisits": "83",
      "classifiedVisits": "82",
      "unclassifiedVisits": "1",
      "reasonCode": "SOURCE_COVERAGE_INCOMPLETE"
    }
  }
}
```

006 关闭后的现役 `sourceComparison` 是 `{ metric, state, rows }` 对象。最小 additive 位置冻结为 `sourceComparison.partition`；保留 `rows` 字段与七个既有来源行不变，不增加同级第二份来源数组，也不创建新的来源 key。

状态规则：

| 条件 | state | 行为 |
| --- | --- | --- |
| 总量及全部来源均为精确非负数，合计等于总量 | `COMPLETE` | `unclassifiedVisits = "0"`，reason 为 `null` |
| 任一来源为空，或已分类合计小于总量 | `PARTIAL` | 保留可证明的 total/classified/residual 和稳定 reason |
| 已分类合计大于总量、负数或非法十进制 | `INVALID` | service 抛稳定合同错误，route 返回现役错误信封 |

计算规则：

- `classifiedVisits` 只加总可用的来源行；
- 任一来源为空时不能声称 complete；
- 只有 total 和 classified 都精确且 `classified <= total` 时才返回 residual；否则 residual 为 `null`；
- residual 不进入 rows，不分配 source key，不影响 attribution；
- 前端份额若以全站访问为分母，必须明确显示 partition 状态；不能把可见来源重新归一到 100%。

建议稳定 reason code：

- `SOURCE_METRIC_MISSING`；
- `SOURCE_COVERAGE_INCOMPLETE`；
- `SOURCE_TOTAL_UNAVAILABLE`。

不新增 `UNCLASSIFIED`、`OTHER` 或类似业务来源枚举。

### 4.4 页面路径碰撞

`WebsitePageRow` 保留现有 `key`/`pageId`/`path`，additive 增加：

```json
{
  "pathCollision": {
    "ordinal": 1,
    "count": 3
  }
}
```

无碰撞时 `pathCollision` 为 `null`。

算法：

1. 按现役规则规范化全部过滤后的 URL 为展示 path；
2. 在分页前按 path 分组；
3. 组内按稳定 page identity 排序：生产现役 pageId 已确认是唯一数字字符串，使用 `BigInt` 数值升序；合同同时冻结未来不透明字符串按 Unicode code-point 升序，不使用区域化 collation；
4. 给 count > 1 的行写入 `ordinal` 与 `count`；
5. 再执行现役主排序和分页；主排序相同时把 page identity 作为最终 tie-breaker。

前端标签：`<原路径> · 同路径记录 <ordinal>/<count>`。无碰撞时保持现役路径展示，不增加噪音。

禁止：

- 使用数组下标作为跨请求 identity；
- 把碰撞行 silent dedupe；
- 对退出率、跳出率、平均停留等比率直接相加或平均；
- 为美观隐藏 page identity 差异。

## 5. 错误与空状态

继续使用现役错误信封。007 只在必要时增加稳定 code：

- `TONGJI_SOURCE_PARTITION_INVALID`：已分类大于总量或存在不可能值，HTTP 502；
- 006 现役的 `DASHBOARD_DATE_OUT_OF_RANGE`：上期超 coverage；
- 006 现役 revision、权限、无快照错误保持不变。

PARTIAL 是成功响应中的数据质量状态，不是 5xx。合法零值是字符串 `"0"`；缺失为 `null`；不可用由状态表达，三者不得互换。

## 6. Fixture 与隐私边界

新增 fixture 只位于测试目录，形状从系统内部标准响应手工脱敏得到，不保存抓取脚本输出的原始百度报文。

建议 fixture 集：

- `ad-periods-ready.json`；
- `ad-previous-unavailable.json`；
- `tongji-source-partial-83-82.json`；
- `tongji-page-path-collision.json`；
- `marketing-null-zero-decimal-shapes.json`。

要求：

- project/revision/page IDs 替换为稳定虚构值；
- 关键词、搜索词、站点、统计用户名和账号名使用虚构值或直接删除；
- 不含 Token、Secret、Authorization header、Cookie、联系人、电话、邮箱、IP、会话 ID；
- 在测试中执行敏感键和高风险模式扫描；
- fixture schema 经后端 OpenAPI 合同和前端真实 decoder 双向验证。

本地不开启生产百度模块，也不读取服务器密文。fixture 是回归证据，不是“本地已接入生产”。

## 7. 实现切片

### U1：冻结 006 后合同与脱敏基线

**依赖：** 003、006 已关闭。

冻结轻量 Dashboard、广告层级、关键词、来源比较和页面报告的现役响应；建立五类脱敏 fixture。先让新测试在未修复代码上准确暴露双周期、83/82 和同路径缺口。

### U2：广告与关键词双周期

验证并消费 006 已交付的全筛选 summary；迁移 `useAdPerformance`、`useKeywordAnalysis` 及 adapter。覆盖等长周期、同 revision、筛选、上期不可用、过期响应和精确值。

### U3：来源分区完整性

修改 `BaiduTongjiService` 和流量 presenter，在第三方边界严格解析，在 service 计算 partition，在页面展示完整性状态。删除“任一 null 就完全跳过对账”的静默行为。

### U4：页面路径消歧

在页面事实规范化和分页边界增加稳定碰撞元数据，前端按需展示消歧。保持上游 page identity，不合并指标。

### U5：正式入口验收与关闭

运行聚焦测试、全量相关回归、敏感信息扫描和真实浏览器逐页验证。记录目标 revision、Network 请求、对账值和未接入模块状态；007 关闭后才解除 005 门禁。

## 8. 测试与验证计划

### 8.1 后端

- summary 与完整筛选结果一致，和 pagination 无关；
- summary/items/count 同 revision、filter 和事务；
- source COMPLETE、null PARTIAL、83/82 PARTIAL、classified > total INVALID；
- 精确字符串、超大整数、零、null 和非法十进制；
- path 单行、同路径多行、跨页碰撞、稳定 ordinal、排序 tie-breaker；
- 权限、revision、coverage 和现役错误信封不回归。

### 8.2 前端

- 广告与关键词实际发出 current/previous 两次资源请求；
- 日期区间等长且相邻；
- 同 revision/currency/costScale 校验；
- previous READY、UNAVAILABLE、ERROR 三态；
- current error 不显示陈旧数据；
- generation 防止旧响应覆盖；
- 精确零、null、不可用分别渲染；
- PARTIAL 提示且来源行不重归一；
- 同路径消歧在桌面、移动端和分页后可读。

### 8.3 浏览器

用真实 Chrome 从正式域名验证：

- 广告表现和关键词 Network 均有 current/previous 请求；
- 两周期 filter、revision 与返回 summary 正确；
- 网站流量显示来源覆盖状态；
- 入口页同路径记录可区分；
- 市场总览十进制字符串回归仍通过；
- 搜索词现役上期比较不回归；
- 官网、53KF、销售和 AI 状态没有被补零或误报接入。

## 9. 发布与恢复

007 不新增迁移。按完整功能切片发布时，不建立新旧运行时 fallback。若切片之间合同存在依赖，后端 additive 字段必须先与兼容前端同版或先行发布，删除仅在消费者为零后进行。

阻断性回归使用后代 revert revision 经正式 Git Bundle 快进恢复；不直接修改服务器源码，不恢复旧 Dashboard 大数组，不重新启用 005 前的错误行为。

005 在 007 关闭且生产观察没有本需求 P0/P1 后，重新冻结已修正的 Provider 黑盒基线。

## 10. 风险与缓解

- 双周期增加请求：只读取 summary 所需资源，关键词上期使用最小合法分页；不下载全量分页。
- 上期超 coverage：诚实显示不可用，不扩大 refresh 或伪造零值。
- 来源差额被误当渠道：合同不创建 source key，类型和 UI 文案明确为 coverage evidence。
- path ordinal 随排序变化：先以稳定 page identity 定组内 ordinal，再执行展示排序和分页。
- fixture 泄露生产信息：只保存规范化形状，执行敏感键/模式扫描并人工复核 diff。
- 005 发生基线冲突：把 007 closed 设为 005 Issue 001 的硬依赖。

## 11. 关键技术决策

- KTD-001：顺序固定为 `003 → 006 → 007 → 005`。理由：先稳定边界，再修行为，最后冻结正确行为。
- KTD-002：双周期复用 006 资源和 revision，不新增 compare RPC。理由：避免第二套读模型。
- KTD-003：summary 在服务端按完整筛选范围计算。理由：分页明细不能承担 KPI 汇总。
- KTD-004：来源差额只表达覆盖，不成为业务来源。理由：差值不能证明渠道身份。
- KTD-005：同路径事实消歧而不合并。理由：缺少可靠分母时合并比率会改变语义。
- KTD-006：本地使用脱敏内部响应 fixture，不复制生产 Token。理由：复现需要响应形状，不需要生产权限。
- KTD-007：PARTIAL 是成功数据质量状态，INVALID 才拒绝响应。理由：诚实保留可用数据，同时阻止不可能合同。

## 12. 假设与开放问题

- 006 的 revision 保留窗口足以覆盖页面所选 current 与 previous；超出时按 UNAVAILABLE 处理；
- 006 会在资源合同内交付全筛选 summary；
- 现役百度页面报告保留稳定 page identity；
- source report 的总访问与来源访问采用同一百度统计指标和日期/设备范围。

Issue 001 已用只读规范化生产响应确认：来源差额并非 83/82 单一样本，当前范围还出现 200/198、153/152、89/88 且被误标为 `COMPLETE`；具体上游覆盖原因尚不可证明，因此一律只表达为覆盖证据。现役 pageId 是唯一数字字符串，同路径碰撞在 57 行样本中形成一个 35 行组。广告层级与关键词 summary 冻结为 `impressions`、`clicks`、`costAmountScaled` 三个精确十进制字符串字段，不增加 conversions 占位。

## 13. Handoff

- PRD: `docs/active-2026-08-05-007-marketing-production-data-correctness/prd.md`
- Tech Spec: `docs/active-2026-08-05-007-marketing-production-data-correctness/TECH-SPEC.md`
- Status: `active`；003 与 006 已关闭，当前按 issue 执行。
- First implementation gate: 003 和 006 均已从正式入口验收并关闭。
- Suggested issue split: U1–U5；本次尚未创建 issues。
- Completion condition: 正式入口双周期、来源对账、路径消歧和未接入状态全部验收通过，随后解除 005 门禁。
