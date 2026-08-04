---
title: 营销漏斗数据主数据源与官网无侵入接入边界
date: 2026-08-03
status: accepted
scope: marketing-data
---

# ADR 0001：营销漏斗数据主数据源与官网无侵入接入边界

## 决策状态

本决策自 2026-08-03 起生效，约束市场总览、网站流量、后续官网/客服接入、指标计算、测试和文档。`accepted` 只表示数据合同已经确认；当前官网表单咨询已完成本地实现，但这不表示改动已经提交、部署、设为生产默认或通过正式入口验收。

## 主数据源

| 事实 | 唯一主数据源 | 当前用途 |
| --- | --- | --- |
| 百度广告展现、广告点击、消费 | 百度营销 | 百度推广行和 CPC |
| 网站来源、访问次数、访客数（UV）、浏览量（PV） | 百度统计 | 网站流量及非付费来源的访问事实 |
| 官网表单咨询 | 官网数据库中成功写入且具备会话归因的表单提交 | 独立“官网表单咨询”列，不与 53KF 自动合计 |
| 官网访问到表单咨询的来源关系 | 官网一方埋点随表单提交保存的来源上下文 | 官网表单来源归属与数据质量核验 |
| 53KF 在线客服咨询 | 53KF 中访客实际发送过消息的有效对话 | 客服咨询中的“在线对话”部分 |
| 线索入池 | 内部销售系统的有效线索入池事实 | 线索入池数、CPL 分母 |
| 成交订单数和成交订单金额 | 内部销售系统的成交订单事实 | CPA、成交率、整体转化率、ROAS |

不得把多套流量数据相加、取平均、互相补差或选择“看起来更好”的数字。官网一方访问会话是来源关联和对账证据，不替代百度统计的来源、访问、UV、PV 主数据源。

## 指标与事件语义

- 官网 `contact_click_sessions` 或同义字段只表示点击“联系我们/服务申请”入口的去重会话，是意向诊断指标，不是客服咨询。
- 官网 `submission_sessions` 或同义字段表示成功提交表单的去重会话，只能命名为“表单咨询会话数”；在 53KF 未接入前不得宣称它覆盖全部客服咨询。
- 53KF 咨询必须以有效对话为单位，至少证明访客实际发送过消息；仅打开客服窗口、加载脚本、机器人自动问候或点击浮窗不计为咨询。
- 官网表单的 `pending`、`processing`、`done` 是处理状态，不是线索入池、销售机会或成交状态。
- 官网聚合接口中的 `organic_search` 同时包含百度、必应、Google、搜狗、360 等搜索引擎；聚合行没有记录级 `referrer`，因此必须归入 `UNKNOWN`，不得按同期比例拆分。联系人明细若带有经严格 URL 校验的原始 `referrer`，则可在咨询记录读取时按主机名精确拆成对应搜索来源。
- 只有记录级可信来源键、可审计映射或确认过的人工关联成立时，下游事实才进入具体来源行；来源缺失的历史记录保持“来源未知”或缺失状态。

## 首页取数规则

```text
百度推广：
  展现 / 广告点击 / 广告投入 <- 百度营销
  官网访问 <- 百度统计付费搜索来源
  表单咨询 <- 官网中 source=baidu_paid 的成功表单提交
  在线客服咨询 <- 53KF 中可信归属为百度推广的有效对话

其他访问渠道：
  访问 / UV / PV <- 百度统计
  表单咨询 <- 官网中对应 source 的成功表单提交
  在线客服咨询 <- 53KF 中对应 source 的有效对话
```

跨系统计算咨询率前必须同时满足来源映射、日期、时区、统计粒度和数据覆盖门禁。门禁不满足时展示缺失或部分覆盖，不能把同期总量直接相除。

## 官网无侵入接入合同

2026-08-03 从 `https://gato.com.cn` 生产入口只读验证到以下现有能力：

- `POST /api/v1/auth/login`：返回后台 JWT；真实凭据不得写入文档、前端、日志或 fixture。
- `GET /api/v1/admin/stats/dashboard?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&source_channel=<key>`：返回聚合访问与转化数据。
- `GET /api/v1/admin/contact/list` 及按 ID 详情：按需返回联系人记录；归因相关字段包括 `sourceChannel`、`firstSourceChannel`、`referrer`、`landingPage`、`contactClickPage`、`contactClickPosition`、UTM 字段、`bdVid` 和设备类型。该接口同时含个人信息，只能用于受鉴权的咨询记录读取，不得作为首页常规聚合数据源。
- 可用聚合字段包括 `conversion.summary.visit_sessions`、`contact_click_sessions`、`submission_sessions`，以及 `conversion.source_channels[].source/visits/clicks/submissions`。
- `source_channel` 已验证支持 `baidu_paid`、`organic_search`、`direct`、`referral`、`campaign`；`social` 是允许的上游分类，但本次样本中没有出现。

GoodieAI 的首页常规同步必须只调用聚合统计接口，不得为了首页统计而读取 `/admin/contact/list` 中的姓名、电话、邮箱、IP、咨询内容、访客 ID 或会话 ID。咨询页由已登录用户主动查看时，后端可按需读取列表或单条详情，但必须在服务端严格校验、脱敏并通过审计合同输出；浏览器不能收到官网后台凭据、JWT、访客 ID、会话 ID 或联系点击 ID。接入凭据只能由 GoodieAI 后端环境或密钥管理注入，JWT 只在服务端缓存并在过期或 401 后重新获取。

本地实现固定采用以下边界：官网表单聚合使用 `backend/modules/websiteFormConsultations`、`/api/website-data`、`website_data_schema_migrations` 和前端 `src/lib/websiteData`；按需咨询记录使用 `backend/modules/consultationRecords` 和 `/api/consultations`；百度营销/百度统计继续使用 `backend/modules/marketing`、`/api/marketing` 和 `marketing_schema_migrations`。三条数据链路不得共用客户端、服务、公开响应合同、模块状态或迁移账本，只共享登录鉴权、项目所有权校验等通用基础设施。聚合适配器只保存日期范围、来源键、可归因表单提交会话数和缓存时间，不保存联系人或会话明细。

正式来源目录固定为九键：`BAIDU_PAID`、`DIRECT`、`BAIDU_SEARCH`、`BING_SEARCH`、`GOOGLE_SEARCH`、`OTHER_SEARCH`、`EXTERNAL_REFERRAL`、`UTM_CAMPAIGN`、`UNKNOWN`；`ALL` 只是查询哨兵，不是来源键。旧 `ORGANIC_SEARCH`、`REFERRAL`、`CAMPAIGN`、`SOCIAL`、`UNATTRIBUTED` 不再属于公开合同。

记录级归因按证据优先级执行：可信百度点击标识或百度付费 UTM → `BAIDU_PAID`；任一其他有效 UTM → `UTM_CAMPAIGN`；有效外部 `referrer` 依次识别百度、必应、Google、其他已识别搜索引擎或普通外部网站；无外部证据时，仅允许首次/当前来源明确为 `baidu_paid` 或 `direct` 的记录回退到 `BAIDU_PAID` 或 `DIRECT`，其余全部为 `UNKNOWN`。咨询详情保留上游返回的原始 `referrer` URL 作为重新核验键的证据。

首页聚合接口没有记录级 `referrer`：`baidu_paid` → `BAIDU_PAID`、`direct` → `DIRECT`、`campaign` → `UTM_CAMPAIGN`；`organic_search`、`referral`、`social`、`unknown` 及其他未识别值统一归入 `UNKNOWN`。首页只有收到精确九键聚合事实后才能进入对应百度/必应/Google/其他搜索或外部引荐行，不能改读联系人明细来补足拆分。前端只调用 GoodieAI 的 `/api/website-data`，不得直接调用官网后台。

## 2026-08-03 运行态证据

以下数字只用于证明接口和覆盖边界，不是长期基线：

- 2026-07-05 至 2026-08-03：官网接口返回 `6,663` PV、`1,103` 个访问会话、`34` 个联系入口点击会话、`3` 个带会话归因的表单提交会话。
- 同期官网后台共有 `20` 条表单记录，但只有 `3` 条具备 `sessionId/sourceChannel/landingPage/contactClickId` 等来源字段，归因字段覆盖率为 `15%`。其余历史记录不得补进具体来源行。
- 已归因的 3 个表单提交会话中，直接访问 2 个、自然搜索 1 个、百度付费推广 0 个。
- 2026-08-01 至 2026-08-03 的逐日只读查询合计 3 个可归因表单提交会话，与同区间汇总 3 一致；这只证明逐日聚合合同，不表示生产 GoodieAI 已启用该接口。
- 生产页面嵌入 53KF，但官网聚合接口和表单接口均不提供 53KF 实际对话，因此当前客服咨询仍不完整。
- 2026-08-04 脱敏核验到联系人接口可返回 `sourceChannel=organic_search` 与 `referrer=https://cn.bing.com/`；本地九键分类器将该记录识别为 `BING_SEARCH`。这只证明记录级证据可用，不表示首页聚合已具备引擎拆分，也不表示本轮改动已部署。

## 已知风险与完成门禁

1. 用户提供的官网本地仓库 `/Users/gato/Developer/product_gato_website_full_stack` 的 `main`/`origin/main` 在核验时为 `c4cd5dc`，本地源码不包含生产接口已经返回的来源归因字段和 `conversion` 聚合结构。正式依赖该合同前必须找回并同步生产实际源码、schema、迁移和测试；否则下一次从旧仓库部署可能退役这些能力。
2. 使用共享官网管理员账号只适合无侵入试点。正式长期同步应改为最小权限的只读服务账号或专用 API 密钥；完成前不得把全权限后台账号描述为稳定外部合同。
3. 53KF 官方公开说明支持来源/访问/对话统计与开放 API，但具体账户权限、接口字段、去重规则和历史覆盖尚未验证。完成真实 API 验收前，53KF 咨询保持缺失。
4. GoodieAI 已实现并部署官网适配器、日期范围聚合快照、缓存回退、首页官网表单字段，以及最多 31 日、单批最多 4 个自然日请求的逐日接口；逐日合计已与同区间汇总完成本地真实只读对账。生产尚未注入专用官网项目与只读账号凭据，因此模块保持 `DISABLED`，正式页面不会把缺失数据冒充为零或回退 fixture。
5. 2026-08-04 九键分类器、联系人归因字段校验、原始 `referrer` 证据展示、首页与咨询页九键合同仅完成本地实现和测试；尚未提交、推送、部署或从正式域名验收。

## 被否决的做法

- 用官网一方 PV/UV/访问数替换百度统计。
- 把百度统计和官网一方流量相加、平均或按差额补齐。
- 把联系入口点击、53KF 窗口打开或表单处理完成状态当作客服咨询/线索入池。
- 为补首页来源聚合而读取联系人明细，再以“用完即丢”规避数据最小化要求。
- 把 `organic_search` 按同期比例拆成百度自然、必应自然或其他搜索引擎。
- 在生产源码尚未同步、合同测试尚未建立时宣称官网 API 已形成稳定正式依赖。
