---
title: 百度 Provider 模块化重构技术方案
date: 2026-08-05
status: draft
source: docs/draft-2026-08-05-005-baidu-provider-modularization/prd.md
scope: deep
---

# 百度 Provider 模块化重构技术方案

## 1. 背景与目标

当前 `backend/modules/marketing/adapters/BaiduMarketingClient.js` 在一个类中同时处理 OAuth、搜索推广、百度统计和共享网络安全。003 会统一 Token 上下文，006 会整理公开营销读 API，007 会修复双周期和百度统计后处理；三者都不应承担 provider 物理拆分。

005 在 003、006、007 全部关闭后进行纯行为保持重构，目标结构为：

```text
现有 service / composition root
              │
              ▼
    BaiduMarketingClient facade
       ├── BaiduOAuthClient
       ├── BaiduSearchAdsClient
       └── BaiduTongjiClient
                 │
                 ▼
          BaiduHttpKernel
```

facade 只构造和委托；产品客户端互不依赖；所有网络调用只经过一个安全内核。

## 2. 范围与非目标

### 2.1 范围

- 冻结现有 facade 的构造、方法、输出和错误合同；
- 抽取唯一错误定义和安全 HTTP 内核；
- 抽取 OAuth/账户、搜索推广和百度统计三个客户端；
- 保持现有 facade 路径、导出和测试注入；
- 保持 manifest、预算、限流、双读、parser 和错误语义；
- 审计唯一 manifest 与实际出站调用、官方来源、验证日期/状态、预算和脱敏 fixture 的可追溯性；
- 增加脱敏 request trace、依赖方向和实例共享测试；
- 删除旧单体产品逻辑并完成生产硬切验收。

### 2.2 非目标

- 不修改 003 的凭据、状态或迁移；
- 不修改 006 的 API、分页、快照选择器或前端；
- 不修改 007 的双周期、来源分区、页面路径消歧或 fixture 合同；
- 不修改数据库、缓存和快照事务；
- 不引入 SDK、registry、任务系统、feature flag 或 fallback；
- 不建立独立 composition root 整理；
- 不支持多账号或实时/定时合同漂移监测平台；
- 不为百度上游 API 建 OpenAPI、完整官方文档镜像或第二套手写端点清单。

### 2.3 执行顺序

005 必须对 007 修正后的行为做等价重构。003、006、007 可以按各自真实依赖推进，但 005 的开始门禁固定为：

```text
003 closed + 006 closed + 007 closed → 005 implementation
```

不允许把 005 提前到 007 之前；否则会冻结已知错误行为并造成统计 parser 重复搬移。实现前必须重新冻结 facade 合同。

## 3. 当前系统认知

### 3.1 构造与消费者

`backend/modules/marketing/index.js` 加载百度合同 manifest 并构造一个 `BaiduMarketingClient`。同一 provider 被注入授权、连接、账户目录、广告刷新和百度统计服务。测试也允许注入一个实现相同方法的 fake。

005 保留这一入口，不要求现有服务分别依赖三个产品客户端。

### 3.2 可观察方法

| 分组 | 现役方法 |
| --- | --- |
| 共享安全 | `assertAllowed`、`requestJson` |
| OAuth / 账户 | `buildAuthorizationUrl`、`verifyCallbackSignature`、`exchangeAuthorizationCode`、`refreshAccessToken`、`listAccounts` |
| 搜索推广 | `createSearchReportBudget`、四个单报告读取、`fetchSearchReports` |
| 百度统计 | `listTongjiSites`、趋势、质量、来源和页面报告读取 |

现有模块还导出 `BaiduMarketingError`、`BaiduContractBlockedError` 和 `decimalNumberToScaledText`。005 保持导出名称及错误 class identity。

### 3.3 搜索推广不变量

- 计划 `2290316`、单元 `2284618`、关键词 `2602783`、搜索词 `2307838`；
- 第一轮和第二轮都按计划、单元、关键词、搜索词读取；
- 两轮通过与行顺序无关的摘要验证稳定性；
- 四份报告共用一个整轮预算；
- QPS 状态按 report type 隔离；
- 请求数、行数、响应字节和总时间预算保持现值；
- 精确金额、层级 ID/名称和搜索词无伪造 `keywordId` 合同不变；
- adapter 返回四份事实，数据库原子事务继续属于刷新服务。

### 3.4 百度统计不变量

- 站点目录与数据报告保持不同上游方法；
- Access Token、`userName`、`site_id` 由 003 完成后的上下文传入；
- 趋势日期完整，设备和来源使用现役枚举；
- 质量、来源和页面报告受 manifest 能力开关保护；
- 页面报告保持分页、去重、总量和整轮时间预算；
- 上游响应严格解析，合法无数据不等于错误。

### 3.5 上游合同现状

`backend/modules/marketing/contracts/baidu/` 已经以版本化 manifest 记录实际使用的 OAuth、账户、搜索推广和百度统计端点，并关联官方来源、证据日期、能力状态和脱敏 fixture。这已是上游机器合同的正确基础，005 只做完整性审计与拆分后可追溯保持，不新建并行文档体系。

## 4. 需求、约束与规则

- REQ-001：保留 `BaiduMarketingClient` 构造、导出和现役方法行为。
- REQ-002：建立三个互不依赖的产品客户端。
- REQ-003：三个客户端共享一个 `BaiduHttpKernel` 实例。
- REQ-004：内核统一执行 allowlist、HTTPS、超时、响应预算、JSON 和网络错误。
- REQ-005：产品客户端拥有自己的请求、parser、分页、预算和产品错误。
- REQ-006：四报表请求顺序、限流、双读和原子快照不变。
- REQ-007：百度统计站点、趋势、来源、质量和页面合同不变。
- REQ-007A：007 的来源分区完整性、INVALID 错误和同路径消歧合同在拆分前后不变。
- REQ-008：拆分前后使用相同黑盒特征测试。
- REQ-009：正式切换后删除旧单体实现。
- REQ-010：每个实际出站调用必须可追溯到唯一 manifest 中的方法/地址、报告编号或统计 method、字段、官方来源、验证日期/状态和预算。
- REQ-011：manifest 条目必须与脱敏 fixture、严格 parser 和黑盒 request trace 通过合同测试建立对应关系。

- CON-001：003、006 或 007 任一未关闭时禁止开始 005。
- CON-002：生产凭据不得进入本地、fixture、日志、文档或 Git。
- CON-003：共享内核不得提供关闭 allowlist、无限 timeout 或原始请求日志选项。
- CON-004：不新增迁移、配置、公开 API 或第二套 transport。
- CON-005：任何可观察行为变化必须另立需求，不能更新 golden 规避失败。
- CON-006：不新建百度上游 OpenAPI、官方文档镜像、第二套手写端点清单或在线漂移平台。

- PAT-001：保持 CommonJS、现有 manifest 和 Node 测试模式。
- PAT-002：第三方响应只在产品边界解析和校验。
- PAT-003：service 继续依赖 provider 能力，不直接 new 产品客户端。
- PAT-004：测试 transport、时钟和 wait 继续可注入。
- PAT-005：官方文档只在 manifest `sources` 中留链接和支持范围；开发文档只指向 manifest，不复制可漂移字段表。

## 5. 模块与接口合同

### 5.1 兼容 facade

`BaiduMarketingClient` 构造时：

1. 执行与拆分前等价的配置校验；
2. 从 manifest 解析一次 allowlist；
3. 创建一个共享 HTTP 内核；
4. 创建三个产品客户端；
5. 搜索客户端单独持有 QPS 和整轮预算状态；
6. facade 方法直接委托并原样返回或抛错。

禁止 facade：

- 为产品创建独立 transport；
- 在失败后调用旧实现；
- 缓存 Token；
- 复制 parser、报告常量或分页；
- 根据开关选择新旧客户端。

### 5.2 安全 HTTP 内核

内核只接收：

| 输入 | 规则 |
| --- | --- |
| method | 精确命中 allowlist 方法 |
| URL | HTTPS，无用户名、密码、未预期 query 或 hash，origin + pathname 精确命中 |
| JSON | 产品客户端构造，内核不记录业务字段 |
| timeout | 不超过已验证全局或产品剩余预算 |
| maxResponseBytes | 不超过产品固定上限或整轮剩余字节 |

输出为解析后的 JSON，并可携带仅供预算核算、不可枚举的原始响应字节元数据。

稳定网络错误保持：

| 场景 | code | status | retryable |
| --- | --- | --- | --- |
| allowlist / URL 违规 | `BAIDU_OUTBOUND_NOT_ALLOWED` | 500 | false |
| HTTP 非成功 | `BAIDU_HTTP_ERROR` | 502 | 429 或 5xx 时 true |
| 响应超预算 | `BAIDU_RESPONSE_TOO_LARGE` | 502 | false |
| 非 JSON | `BAIDU_RESPONSE_INVALID` | 502 | false |
| 超时 | `BAIDU_REQUEST_TIMEOUT` | 504 | false |
| 网络失败 | `BAIDU_UPSTREAM_UNAVAILABLE` | 502 | true |

HTTP 失败、Content-Length 超限或流式读取超限时继续取消 body，取消失败不能覆盖原错误。

### 5.3 OAuth 客户端

拥有授权 URL、回调签名、授权码交换、Refresh Token 上游调用、账户目录分页和 OAuth 响应规范化。Secret Key 只由 OAuth 客户端使用，不传给搜索或统计客户端。

### 5.4 搜索推广客户端

拥有四份报告配置选择、请求、parser、精确值、分页、QPS、整轮预算、双读和稳定摘要。`fetchSearchReports` 输出继续为：

```text
{ campaigns, adGroups, keywords, searchTerms }
```

字段、精确字符串、错误码和搜索词无 `keywordId` 语义保持不变。

### 5.5 百度统计客户端

拥有站点、趋势、质量、来源和页面请求，以及对应 envelope、日期、指标、分页和行规范化。它不负责 Token 生命周期、用户名持久化、站点绑定、缓存或来源归因。

### 5.6 错误与导出

唯一共享错误模块定义 `BaiduMarketingError` 和 `BaiduContractBlockedError`，旧 facade 文件 re-export 同一 class identity。`decimalNumberToScaledText` 可由搜索客户端拥有，但继续从旧路径导出。

### 5.7 Manifest 所有权

产品客户端只从同一个已加载 manifest 取得端点、报告编号/统计 method、字段、能力开关和预算。运行代码不得在新模块中重复一份同义常量表；无法由 manifest 追溯的官方调用不得通过拆分门禁。

manifest 只记录已实际消费的最小合同。官方文档冲突、缺少响应证据或未经真实账号确认时，保持未验证/fail-closed，不扩充推测字段。

## 6. 关键技术决策

- KTD-001：保留兼容 facade。理由：最小化消费者迁移和回归面。
- KTD-002：共享安全内核，不建通用产品基类。理由：安全策略相同，产品协议不同。
- KTD-003：错误 class identity 唯一。理由：`instanceof` 也是可观察合同。
- KTD-004：只构造一个搜索客户端。理由：多实例会分散 QPS 和整轮预算状态。
- KTD-005：原始响应字节使用内核私有元数据。理由：预算需要真实字节，业务响应不需要。
- KTD-006：使用旧实现上的黑盒特征测试，不保留旧 runtime differential。理由：等价证明不应制造第二条生产路径。
- KTD-007：不整理公开 API、数据正确性或 composition root。理由：它们分别属于 006、007 和现役装配边界。
- KTD-008：一次生产硬切，无 feature flag。理由：避免双路径扩大安全和运维状态。
- KTD-009：上游只维护一份版本化 manifest，用 fixture、parser 和 trace 合同测试证明。理由：百度文档不是我方可生成接口，复制官方说明只会增加漂移面。

## 7. 目标结构

```text
backend/modules/marketing/adapters/
├── BaiduMarketingClient.js
└── baidu/
    ├── BaiduErrors.js
    ├── BaiduHttpKernel.js
    ├── BaiduOAuthClient.js
    ├── BaiduSearchAdsClient.js
    └── BaiduTongjiClient.js
```

依赖方向固定为：

```text
service → facade → product client → HTTP kernel → shared errors
```

产品客户端之间禁止直接 require。只有两个以上产品完全相同的技术不变量才允许进入极小无状态 helper，禁止新建杂物型 `utils.js`。

## 8. 实现切片

### U1：冻结拆分前合同

**目标：** 在旧实现上建立脱敏黑盒特征基线。

**依赖：** 003、006、007 已关闭，且 007 生产观察无遗留 P0/P1。

**涉及文件：**

- `backend/tests/marketing/BaiduMarketingClient.test.js`；
- `backend/tests/marketing/BaiduHierarchyClient.test.js`；
- `backend/tests/marketing/BaiduOutboundAllowlist.test.js`；
- 现有百度脱敏 fixtures；
- 新增 request trace 测试 helper。

**方案：** 冻结方法表面、请求序列、脱敏 body、timeout、响应字节、等待、取消、输出、错误四元组和原子快照；审计每个实际出站调用的 manifest 可追溯性，并固定 manifest↔fixture↔parser↔trace 关系；百度统计 golden 必须包含 007 的 COMPLETE/PARTIAL/INVALID 与同路径记录形状。

**测试场景：** OAuth、账户分页、四报表、预算、统计报告、allowlist、HTTP、超时、超大响应、非 JSON、class identity 和 Secret 扫描。

**验收方式：** 新特征测试在旧实现上全部通过，且没有修改运行代码。

### U2：安全内核与 OAuth

**目标：** 抽取唯一错误、安全内核和 OAuth 客户端。

**依赖：** U1。

**涉及文件：** facade、新增错误/内核/OAuth 客户端及对应测试。

**方案：** 先统一错误 identity，再让内核接管网络边界，OAuth 方法通过 facade 委托；搜索和统计剩余逻辑也临时使用同一内核。中间状态不得发布。

**测试场景：** 配置、state、签名、Token、账户分页、allowlist、超时、取消和 request trace。

**验收方式：** OAuth 与内核特征合同等价，仓库只剩一个 transport/allowlist 实现。

### U3：搜索推广客户端

**目标：** 移动四报表逻辑、预算和 QPS 状态。

**依赖：** U2。

**涉及文件：** facade、搜索客户端、层级测试、预算测试和快照原子性测试。

**方案：** 保持四报表固定顺序、双读、摘要、分页和精确值；facade 只委托。

**测试场景：** 稳定/不稳定、乱序事实、重复、父子冲突、分页、预算、QPS、搜索词语义和事务失败。

**验收方式：** 搜索 request trace 和返回完全一致，没有额外请求或写入变化。

### U4：百度统计客户端与旧逻辑清理

**目标：** 移动全部统计逻辑，使 facade 只剩构造、委托和 re-export。

**依赖：** U3。

**涉及文件：** facade、统计客户端、统计 service 测试、模块测试和依赖边界测试。

**方案：** 移动站点、趋势、质量、来源、页面 parser 和预算；删除 facade 中产品常量、parser、分页和 fallback。

**测试场景：** 站点、日期、设备、来源、能力开关、分页、去重、合法无数据、统一 Token 失败和共享 transport。

**验收方式：** 全部 golden 通过，旧单体产品实现和重复安全逻辑搜索为 0。

### U5：生产硬切

**目标：** 发布新结构并从正式入口证明无行为变化。

**依赖：** U4、全量测试、安全扫描和恢复准备通过。

**涉及文件：** provider 新结构、相关测试、架构说明和生产验收证据。

**方案：** 无迁移、无配置、无双跑；使用正式 Git Bundle 和 systemd 发布，阻断性回归用后代 revert revision 快进恢复。

**测试场景：** 正式健康、OAuth、四报表、统计趋势/来源/页面、营销页面、日志脱敏和请求预算。

**验收方式：** 新结构是唯一正式路径，旧实现与旧文档删除，页面和数据语义不变。

## 9. 验收标准

- AC-001：Given 003、006 或 007 任一未关闭，When 检查门禁，Then 005 不开始。
- AC-002：Given 现有消费者，When 替换 facade 内部实现，Then 无调用方修改。
- AC-003：Given 任一请求，When 发出网络调用，Then 只经过一个内核。
- AC-004：Given OAuth 与账户目录，When 对比拆分前后，Then 请求、输出和错误一致。
- AC-005：Given 四报表，When 完成双读，Then 顺序、预算、QPS、输出和快照一致。
- AC-006：Given 统计报告，When 执行正常和异常场景，Then 输出、分页、预算、007 来源分区/页面消歧和错误一致。
- AC-007：Given 产品模块，When 分析依赖，Then 产品间无直接调用。
- AC-008：Given 正式模块，When 构造，Then 只有一个 facade、一个内核和每类一个客户端。
- AC-009：Given 正式入口，When 验证营销页面，Then API、数据、日期、来源和状态不变。
- AC-010：Given 全仓，When 搜索旧实现和 fallback，Then 生产引用为 0。
- AC-011：Given 现役百度出站调用，When 审计合同，Then 每个调用可追溯到唯一 manifest 条目、官方来源、验证日期/状态、预算和脱敏 fixture。
- AC-012：Given 仓库文档与运行常量，When 搜索重复真值，Then 不存在上游 OpenAPI、官方文档镜像、第二套端点清单或产品客户端重复合同常量。

## 10. 测试与验证计划

- 单元：facade、内核、OAuth、搜索、统计和错误 identity；
- 特征：脱敏请求、输出、错误、预算、等待和取消；
- 集成：授权、连接、刷新、Dashboard、统计缓存、快照原子性；
- 数据库：SQLite/PostgreSQL 无 schema diff，migration audit 保持原状态；
- 安全：allowlist、响应预算、凭据与日志扫描；
- 上游合同：manifest 完整性、官方来源/验证状态、fixture/parser/trace 可追溯性和重复常量搜索；
- 生产：公开 revision、真实四报表、统计站点/趋势/页面和全部营销页面。

生产数据可能被百度回补，因此生产验收比较合同、来源、完整性和预算，不盲目要求重构前后所有数值字节相等；确定性等价由 fixture 和 trace 证明。

## 11. 发布与恢复

发布前确认 003、006、007 已关闭、当前无百度 P0/P1。完成测试后用一个完整 revision 发布，无 pending migration。

阻断性失败时停止继续刷新，创建 005 后代 revert revision，通过正式 Git Bundle 快进并重新验证上一正式 provider。因为无数据库变化，不恢复数据库；不完整写入继续由现役原子事务保护。

## 12. 风险与缓解

- 安全内核过宽：限制为网络安全参数，不放产品字段和分页；
- 错误 identity 分裂：唯一错误模块并测试 `instanceof`；
- 搜索客户端多实例：模块测试断言单实例和共享 transport；
- 搬移时顺手改行为：U1 先冻结合同，行为变化另立需求；
- 只测返回漏掉请求变化：trace 同时断言 method、path、body、timeout、bytes、wait 和 cancel；
- facade 留下重复逻辑：依赖边界测试限制其只构造和委托；
- 隐藏消费者：实现前重新盘点仓库、部署脚本和诊断工具。
- manifest 只剩文档作用：产品客户端的端点、报告编号/方法、字段、能力和预算必须从 manifest 取值，用依赖/常量搜索防止拆分后复制。

## 13. 假设与开放问题

- 003 完成后统计只使用统一 OAuth 上下文；
- 006 不改变 provider 方法和第三方合同；
- 007 已修复并冻结来源分区、页面消歧和相关错误语义；
- manifest 继续是正式百度端点真值；
- 实现前需复核 003、006、007 是否新增 facade 方法或消费者。

发现仓库外消费者时先登记迁移范围，不保留完整旧实现作为长期兼容。

## 14. 后续衔接

- 可拆 issue：U1 特征合同、U2 内核/OAuth、U3 搜索推广、U4 百度统计/清理、U5 发布。
- 建议第一个 issue：在旧实现仍为正式真值时冻结脱敏黑盒合同。
- 是否适合 TDD：适合，先让旧实现通过特征测试，再逐产品移动。
- Tech Spec path: `docs/draft-2026-08-05-005-baidu-provider-modularization/TECH-SPEC.md`
- Recommended next step: 待 003、006、007 全部关闭后复核方案，再开始 Issue 001。
