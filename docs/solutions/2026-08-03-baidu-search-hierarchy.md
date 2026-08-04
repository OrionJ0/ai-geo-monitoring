# 百度搜索推广完整层级接入

- 日期：2026-08-03
- 状态：已部署并通过正式入口真实数据验收；后台同口径人工对账与规模化分页决策仍待完成
- 适用模块：`backend/modules/marketing`、`/api/marketing`、`/geo/ad-performance`

## 结论

百度搜索推广广告事实使用四份彼此独立的官方报告，不再把推广计划报告当作全部层级：

| 数据集 | reportType | 本地事实表 | 稳定身份 |
| --- | ---: | --- | --- |
| 推广计划 | `2290316` | `baidu_campaign_daily_metrics` | 账户 ID + 计划 ID + 日期 |
| 推广单元 | `2284618` | `baidu_ad_group_daily_metrics` | 账户 ID + 计划 ID + 单元 ID + 日期 |
| 投放关键词 | `2602783` | `baidu_keyword_daily_metrics` | 账户 ID + 计划 ID + 单元 ID + 关键词 ID + 日期 |
| 搜索词 | `2307838` | `baidu_search_term_daily_metrics` | 账户/计划/单元/关键词名称/搜索词/状态/匹配方式的哈希 + 日期 |

官方依据：

- [推广计划报告](https://dev2.baidu.com/content?sceneType=0&pageId=102474&nodeId=698&subhead=)
- [推广单元报告](https://dev2.baidu.com/content?sceneType=0&pageId=102475&nodeId=699&subhead=)
- [关键词报告](https://dev2.baidu.com/content?sceneType=0&pageId=102476&nodeId=705&subhead=)
- [搜索词报告](https://dev2.baidu.com/content?sceneType=0&pageId=102477&nodeId=704&subhead=)

## 不可违反的语义边界

严格广告结构是：

```text
监控项目
  → 百度账户
    → 推广计划 campaignId
      → 推广单元 adGroupId
        → 投放关键词 wInfoId
```

搜索词不是上述结构的第五级。百度搜索词报告返回 `campaignId`、`adGroupId`、关键词名称和 `queryWord`，但不返回 `wInfoId`。因此：

- 搜索词只能稳定关联到账户、推广计划和推广单元；
- 关键词名称保留为上游证据，不作为关键词实体主键；
- API 的 `searchTerms` 不得出现补造的 `keywordId`；
- 前端广告结构树下钻到投放关键词为止，搜索词应使用独立分析视图；
- 不得用名称连接伪装成确定的关键词归属。

## 运行路径

1. `BaiduMarketingClient.fetchSearchReports()` 依次调用四份官方报告，严格校验响应信封、分页总数、账户、字段和精确数值。
2. `MarketingRefreshService` 校验每层重复事实、总行数预算和父子 ID/名称一致性。
3. 四个数据集在同一事务中替换，并共享同一个 `refresh_run_id`；任一数据集失败时保留上一份完整快照。
4. `MarketingDashboardService` 在同一 revision 和日期范围内分别聚合并返回：
   - `campaigns`
   - `adGroups`
   - `keywords`
   - `searchTerms`
   - `hierarchyCounts`
5. `/geo/ad-performance` 使用 ID 组合构建“项目 → 计划 → 单元 → 关键词”树，不从父级指标推断子级。

代码不保留只调用 `fetchSearchReport()` 的正式兼容 fallback。部署新版本时若合同缺少任一报告定义，刷新应明确失败，不能退回计划级数据并继续标成完整快照。

## 数据与 API 边界

- 百度广告和百度统计仍属于 `backend/modules/marketing` 与 `/api/marketing`，但广告快照和 Tongji 访问事实使用独立服务、凭据及表。
- 官网表单咨询始终属于 `backend/modules/websiteFormConsultations` 与 `/api/website-data`，不得放进百度层级对象或营销快照表。
- `campaigns`、`adGroups`、`keywords`、`searchTerms` 是 additive 响应字段；计数与金额继续使用十进制字符串，外部 ID 使用不透明字符串。
- 当前内部试点完整返回最近 30 个已结束的上海自然日聚合层级数组；查询时所在自然日仍在增长，不进入基础快照。真实账号规模超过现有 25 万总事实安全预算或页面可用负载时，必须单独设计分页/懒加载合同，不得静默截断。

## 当前验证证据

已完成：

- 四报告官方字段、reportType、日期范围、QPS 和分页合同测试；
- 四类合成真实形状响应的严格解析测试；
- 三张新增事实表迁移与幂等迁移审计；
- 四层同次原子提交、父子不一致拒绝、失败保留旧快照；
- Dashboard 四组 additive 响应和搜索词无 `keywordId`；
- 广告表现下钻到关键词、层级筛选、前端测试与 Next.js 生产构建。
- 2026-08-03 使用服务器现有生产 Token 只读请求 2026-07-29 至 2026-08-02：计划 98 行、单元 224 行、关键词 524 行、搜索词 45 行；全部稳定 ID、日期和父子关系通过严格解析，搜索词没有 `keywordId`。
- 2026-08-04 已部署的生产 revision `0813473` 首次四层刷新把仍在增长的上海当天纳入 offset 分页，百度跨页返回 1143 条关键词重复行和 60 条搜索词重复行，触发 `REPORT_DUPLICATE_FACT` 并保留旧快照。随后在服务器上使用同一生产账号做不写库的只读诊断：改读截至前一日的 30 个完整自然日后，关键词 4556/4556、搜索词 734/734 均无重复。该诊断不代表本候选补丁已部署或已写入生产快照。
- 为防止关闭区间仍因上游订正或默认排序漂移产生混合分页，四份报告每次刷新连续读取两轮并比较完整规范化事实集；不一致时返回 `BAIDU_REPORT_SNAPSHOT_UNSTABLE`，不写入新快照。
- 候选实现对两轮分页共享合同 QPS 限速，并在同一项目的全部绑定间共享整轮资源预算；首轮仅保留无序 SHA-256 摘要，避免同时驻留两套完整报表，单请求超时也覆盖流式正文。按需刷新失败时继续返回旧 revision，但市场总览、广告表现和关键词分析必须显示 `STALE`、失败码和截止日期。

2026-08-04 生产闭环：

- Git Bundle workflow `30876793311` 已部署 `f265bd365e563e828a82dca51028f3d3d4dc40dc`，营销迁移 `001`–`013` 无待执行项，两个 systemd 服务正常；
- 登录后的正式关键词页显示截至 2026-08-03 的 863 条有展现关键词、237 条有点击关键词，且不再出现“广告关键词数据尚未开放”；
- 广告表现显示同区间消费、展现和点击，网站流量显示百度统计真实数据；新建生产浏览器页没有控制台 error/warn；
- 旧计划级 provider 没有作为正式 fallback，刷新失败只允许保留上一份完整 revision 并显示 `STALE`。

尚未完成的是与百度后台按相同账户、日期、时区和口径进行人工四层合计对账，以及根据后续真实规模决定是否拆分 Dashboard 层级读取或改为分页懒加载。这些不影响当前白名单生产路径已切换的事实。
