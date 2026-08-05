# 007 脱敏生产形状基线

## 边界

- 核对时间：2026-08-05（Asia/Shanghai）。
- 正式入口：`https://insight.guangtuo.com`；本文初始基线采自 006 R2 revision `d9b0688e28ba9b3a33fcfb061fe7d7235388ec22`，007 已随 revision `17214184f9c0ec2c9508080cb571f6b8b45923c4` 正式修复并验收。
- 生产核对只在服务器内存中使用短期应用会话，读取 GoodieAI 已规范化的内部 API；未输出或保存会话凭据，未复制百度 Token、数据库、`.env`、Cookie、统计用户名、原始百度响应或业务明细。
- Git fixture 是按观察到的结构手工重建的虚构响应，不是生产响应副本；所有项目、revision、账户、页面和词项身份均为 `synthetic-*` 或固定虚构值。

## 冻结合同

广告层级与关键词资源的 `summary` 均只含 `impressions`、`clicks`、`costAmountScaled`，类型为无符号十进制字符串。双周期必须使用同一 revision、coverage currency 和 cost scale；范围按上海完整日形成等长相邻闭区间。上期超 coverage 使用 `422 DASHBOARD_DATE_OUT_OF_RANGE`，前端后续规范化为 `UNAVAILABLE`，不得变成零。

现役来源比较字段为 `sourceComparison: { metric, state, rows }`。分区证据的最小 additive 位置冻结为 `sourceComparison.partition`，不修改 `rows`、不增加第二个来源数组，也不新增 `UNCLASSIFIED` 或 `OTHER` 来源。

页面事实身份冻结为 `key = baidu-page:<pageId>` 和 `pageId`。生产现役 pageId 是唯一数字字符串；同路径组按 `BigInt(pageId)` 升序获得 ordinal。若未来合同允许不透明字符串，则按 Unicode code-point 升序；路径、区域化排序或数组下标都不能成为事实身份。

## 生产规范化观察

来源比较只记录聚合计数：

| 设备与范围 | 全站访问 | 七来源已分类 | 现役状态 | 正确目标 |
| --- | ---: | ---: | --- | --- |
| 全设备，2026-07-30 至 2026-08-05 | 200 | 198 | `COMPLETE` | `PARTIAL` |
| PC，2026-07-30 至 2026-08-05 | 153 | 152 | `COMPLETE` | `PARTIAL` |
| 全设备，2026-08-05 | 89 | 88 | `COMPLETE` | `PARTIAL` |
| PC，2026-08-05 | 70 | 70 | `COMPLETE` | `COMPLETE` |

因此历史审计的 83/82 是稳定边界形状，不是可以命名为某个业务渠道的孤立差额。具体上游覆盖原因未被可靠证明；修复只能返回 total、classified、residual 和原因码，不能把差额加入来源行。

入口页规范化观察共 57 行，57 个 pageId 均为唯一数字字符串；存在一个相同展示路径的碰撞组，组内 35 条不同事实。基线只保留行数和碰撞规模，不保存生产路径、pageId 或指标。

## Fixture 与可执行证据

`tests/fixtures/marketing-production-correctness/` 固定五类形状：

- `ad-periods-ready.json`：同 revision 的本期/上期层级与关键词 summary；
- `ad-previous-unavailable.json`：本期可用、上期越界；
- `tongji-source-partial-83-82.json`：总访问 83、七来源合计 82，现役误标完整；
- `tongji-page-path-collision.json`：两个稳定 pageId 规范化为同一路径且尚无消歧；
- `marketing-null-zero-decimal-shapes.json`：零、缺失、超安全整数和部分趋势。

后端测试以 006 OpenAPI 和现役错误合同验证规范化响应形状；前端测试直接编译并执行现役 TypeScript decoder，验证可接受形状并把三处已知缺口固定为后续 issue 的红灯依据。自动扫描拒绝 Bearer/JWT、秘密字段、邮件、手机号、IP、统计用户名、会话标识和原始响应键。

Issue 001 不修改运行代码、API、数据库、Provider 或生产配置；fixture 只证明本地可重现生产边界，不代表本地连接生产数据。Issue 006 的生产验收记录见[发布并验收营销生产数据正确性](issues/006-release-and-verify-production-correctness.md)。
