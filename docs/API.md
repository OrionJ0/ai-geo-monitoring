# 接口文档

> 统一前缀：`/api`
> **重要**：除了健康检查、验证码、公共 SEO 设置和公共通知接口外，其他业务接口都需要身份验证。

## 认证说明

> ⚠️ **除明确标注为公开的接口外，所有接口都需要在请求头中携带有效的 JWT Token**

### 请求头格式
```
Authorization: Bearer <token>
```

### 认证相关响应
- `401 Unauthorized` - 未提供 token 或 token 无效
- `403 Forbidden` - 无权限访问该资源（如访问他人数据）
- `429 Too Many Requests` - 超过速率限制

### 速率限制
- **通用 API**：500 次/15 分钟
- **定时任务 API**：1000 次/15 分钟
- **受管 Web 只读运行状态**：每个精确状态路径 1000 次/15 分钟；不消耗通用 API 预算，但仍先要求认证
- **登录接口**：5 次/15 分钟

## 健康与就绪检查
- `GET /api/health`：进程存活检查，不表示数据库、调度器或恢复流程已就绪。
- `GET /api/ready`：数据库、调度器和首次恢复的就绪检查；任一必需检查失败返回 `503`。SQLite 响应同时返回实际 `journal_mode`、`busy_timeout_ms` 和 `synchronous`。

## 验证码（公开接口，无需认证）
- `GET /api/captcha/new` 获取文本验证码（题目与有效期）
- `GET /api/captcha/image` 获取图形验证码（SVG 与有效期）

## 用户
- `POST /api/users/register` 注册（公开）
  - 参数：`username`、`email`、`password`、`captcha_id`、`captcha_answer`
  - 开启 `SEO_AUDIT_ALLOW_PRIVATE_TARGETS=true` 的内部部署会关闭自助注册，返回 `403 SELF_REGISTRATION_DISABLED`；内部账号由用户管理创建
- `POST /api/users/login` 登录（公开，有速率限制）
  - 返回：`token` 与用户信息
- `GET /api/users/profile/:userId` 获取用户信息（需登录）
  - **权限验证**：只能查看自己的信息，管理员可查看所有
- `PUT /api/users/profile/:userId` 更新用户邮箱（需登录）
  - **权限验证**：只能修改自己的信息，管理员可修改所有
- `GET /api/users/quota/:userId` 获取会员等级与配额摘要（需登录）
  - **权限验证**：只能查看自己的配额
- 管理员接口（需管理员权限）：
  - `GET /api/users` 用户列表（分页与搜索）
  - `POST /api/users` 创建用户
  - `PUT /api/users/:id` 更新用户状态/角色/会员
    - `status=inactive` 停用用户：立即禁止登录并使已有令牌失效，保留历史项目、报告、监测、配额和审计数据
    - `status=active` 重新启用用户
  - 当前不提供永久删除用户接口
  - `PUT /api/users/:id/password` 重置用户密码

## AI 检测（需认证）
- `GET /api/detection/brands` 获取品牌列表
- `POST /api/detection/create` 创建检测任务
  - 参数：`question` 必填；`platforms`、`brand`、`brand_keywords`/`highlightKeywords` 可选
- `GET /api/detection/status/:recordId` 获取任务状态与结果摘要
- `GET /api/detection/record/:recordId/web-captures/:artifactId` 按记录平台读取受管 Web 页面证据
  - 仅接受记录 `result_summary.web_capture.artifacts` 中声明的不透明 artifact ID
  - 记录所有者和管理员可读；复用证据时同时校验原始 artifact owner
  - 成功返回 `image/png`、`Content-Disposition: inline` 和 `Cache-Control: private, no-store`
  - 不返回证据绝对路径；证据不存在、未被记录引用或无权访问时返回稳定错误
- `GET /api/detection/stream` 流式获取AI结果（SSE）
  - 参数：`platform`、`question`、`brand`、`brand_keywords`
  - 必须通过 `Authorization: Bearer <JWT>` 传递凭据；查询参数或 Cookie 中的完整 JWT 会被拒绝。浏览器客户端应使用支持请求头和流式响应的 `fetch`，不得把令牌写入 URL
- `GET /api/detection/history` 获取所有用户检测历史（管理员）
  - 参数：`page`、`limit`、`user_id`、`platform`、`status`、`q`、`brand`
- `GET /api/detection/history/:userId` 获取检测历史
  - 参数：`page`、`limit`、`platform`、`status`、`q`、`brand`
  - **权限验证**：只能查看自己的历史，管理员可查看所有
- `DELETE /api/detection/record/:id` 删除单条历史记录
  - **权限验证**：只能删除自己的记录，管理员可删除所有
  - 非受保护记录删除成功后按记录平台同步清理其 Web 页面证据
- `DELETE /api/detection/history/:userId` 批量删除历史记录
  - **权限验证**：只能删除自己的记录，管理员可删除所有

## 问题库与问题集（需认证）

### 统一发布候选 GEO 指标契约

- 新运行的 `analysis_contract_version` 固定为 `ai_structured_v5`，结构版本为 `geo_metric_input_v5`、结构合同 revision 为 `three_track_partial_v2`，`metric_semantics_version` 固定为 `contextual_competitor_mentions_sov_v2_scoped`。两阶段诊断与冻结竞品快照随记录持久化；v4/v1 及更早记录只按已存历史结构、问题集报告和 CSV 导出兼容读取。
- 本节描述本地统一候选的接口合同；生产启动桥 `387ae45` 仍运行 v4/Pro，完成统一候选发布和四入口验收前不得把本节称为生产正式真值。
- 单条 `sov` 是判别联合：`status=calculated` 时提供 `value`、`numerator` 和 `denominator`；目标品牌与竞品均未提及时返回 `status=not_applicable`、`value=null` 和 `0/0`。
- 聚合 `sov_summary.average` 是可计算单回答 SOV 的等权平均，`calculable_answers` 是参与平均的回答数。分析失败不进入品牌指标，只进入 `analysis_coverage_rate`。
- 当前接口不会为新记录返回无版本含义的旧 SOV 标量。历史运行和历史快照继续按已存版本展示原值与“历史竞品配置口径”，不参与新版聚合。

- `GET /api/geo-projects/:projectId/prompts` 查询项目问题列表及近期表现
- `POST /api/geo-projects/:projectId/prompts` 新建单问题
  - 请求体：`question` 必填；`question_set_id`、`tags`、`platforms`、`enabled` 可选
- `POST /api/geo-projects/:projectId/prompts/batch` 批量新增问题
  - 请求体：`questions` 为 1–100 个非空字符串；`question_set_id`、`tags`、`platforms`、`enabled` 统一应用到整批问题
  - 批次内和库内的规范化重复问题会跳过，响应返回 `created_count`、`skipped_count`、`created` 与 `skipped`
- `PUT /api/geo-projects/:projectId/prompts/:promptId` 编辑单问题
- `DELETE /api/geo-projects/:projectId/prompts/:promptId` 删除单问题
- `POST /api/geo-projects/:projectId/prompts/:promptId/run` 独立运行一个启用问题
  - 必须通过 `Idempotency-Key` 请求头或请求体 `idempotency_key` 提交 8–128 位幂等键；两处同时存在时必须相同
  - 使用与问题集相同的原子 run、配额、任务、报告和失败重试模型，但 `question_set_id` 为 `null`
  - 返回 `202 Accepted`、`question_set_run_id`、计划/跳过平台、`idempotent_replay` 和 `report_url`
- `GET /api/geo-projects/:projectId/question-sets` 查询问题集及成员问题
- `POST /api/geo-projects/:projectId/question-sets` 新建问题集
  - 请求体：`name` 必填；`description`、`question_ids` 可选
- `PATCH /api/geo-projects/:projectId/question-sets/:questionSetId` 编辑问题集名称、说明或成员
- `DELETE /api/geo-projects/:projectId/question-sets/:questionSetId` 删除问题集；成员问题仅解除归属，不会被删除
- `POST /api/geo-projects/:projectId/question-sets/:questionSetId/run` 将问题集内所有启用问题按可用监测平台加入并发队列
  - 必须通过 `Idempotency-Key` 请求头或请求体 `idempotency_key` 提交 8–128 位幂等键；两处同时存在时必须相同
  - 同一用户、项目和幂等键的相同请求返回原 `question_set_run_id`，不会再次预留配额或创建任务；同键不同请求返回 `409 IDEMPOTENCY_KEY_REUSED`
  - 每个启用问题都使用当前项目配置的全部可用模型；单问题自身保存的平台范围不会限制问题集运行
  - run、配额预留和全部任务在一个事务内创建；返回 `202 Accepted`、`question_set_run_id`、`accepted_count`、计划/跳过平台、`idempotent_replay` 和 `report_url`
- `GET /api/geo-projects/:projectId/question-set-runs` 分页查询当前项目的单问题与问题集运行历史
  - Query 参数：`page` 默认 1；`pageSize` 默认 20，最大 100；`questionSetId` 可选，仅返回指定问题集的历史；不传时也包含单问题运行
  - `questionSetId` 必须是正整数；非法值返回 `400 Bad Request`
  - 返回运行来源、当前状态、本次汇总和分页信息，不在列表中返回逐条回答
- `GET /api/geo-projects/:projectId/question-set-runs/:runId` 获取一次单问题或问题集运行的独立报告
  - 报告只聚合关系字段归属的本次任务，包含 `execution_summary`、失败阶段、完整性摘要、逐问题逐平台结果和服务端计算的 pause/resume/retry capabilities
  - `control_state` 区分 `running / pausing / paused / terminal / read_only`；`execution_summary.executing + execution_summary.queued = execution_summary.pending`，行级 `execution_state` 区分正在执行与等待处理，不返回内部执行 token 或租约 owner
  - 新 Web 回答可声明 `answer_format=markdown_v1`；存量或未声明格式的回答按 `plain_text` 返回。显式引用的 `display_index` 与标题分离，`retrieval_candidate` 仅供核查且不进入引用 KPI
  - snapshot-only 与 imported 报告保持可读、可导出，但执行型 capability 为 false 并返回稳定禁用原因
- `POST /api/geo-projects/:projectId/question-set-runs/:runId/pause` 暂停原生运行
  - soft pause 只阻止领取新的排队任务，不强制中断已启动的外部平台请求；有任务收尾时返回 `control_state=pausing`
  - 重复暂停返回 `200` 和 `idempotent_replay=true`；终态或只读报告仍拒绝操作
- `POST /api/geo-projects/:projectId/question-set-runs/:runId/resume` 继续原生运行
  - 条件更新保证只有一个并发请求取得恢复权并启动调度；重复继续返回 `200` 和 `idempotent_replay=true`，不会创建第二次调度
- `POST /api/geo-projects/:projectId/question-set-runs/:runId/retry-failed` 重新提交原生运行中的失败项；必须提供 `Idempotency-Key` 请求头或同值 `idempotency_key` 请求体，二者同时存在时必须一致
  - 请求体可传 `idempotency_key`（8–128 位字母、数字、点、下划线、冒号或连字符），也可使用 `Idempotency-Key` 请求头；同一运行和同一键只创建一批重试记录
  - 返回 `202 Accepted`；结构化分析失败且已保存完整原回答时，只调用独立分析 API，不再调用监测平台且不消耗检测配额
  - 监测调用失败、原回答缺失等其他失败项，使用设置中心当前的监测平台模型、平台专用参数和全局运行参数，不复用失败时的旧模型配置
  - 只替换该报告中的失败槽位，样本总数不变；旧失败记录保留在数据库中，新记录通过 `result_summary.retry.previous_record_id` 关联上一尝试
  - 运行中、正在重试、没有失败项或导入报告返回 `409 Conflict`；当前不可用的平台会跳过，全部不可用时返回 `400 Bad Request`
  - 重试只按实际重新调用监测平台的数量原子扣减检测配额；配额不足时整批事务回滚，不留下待处理记录
  - 返回 `analysis_only_count`、`full_monitoring_count`、`quota_consumed`、`retry_batch_id` 和 `idempotent_replay`
- `GET /api/geo-projects/:projectId/question-set-runs/:runId/export` 导出一次运行报告
  - 返回 UTF-8 BOM 的 `text/csv` 文件，schema 为 `question_set_run_v1`
  - 固定单表结构，一行对应一个问题与一个平台结果；数组字段、失败阶段、分析诊断和重试链路使用 JSON 单元格保存以支持无损回导
- `POST /api/geo-projects/:projectId/question-set-runs/import` 导入标准运行报告 CSV
  - 请求：原始 CSV 文本，`Content-Type: text/csv`，最大 5MB、5000 条数据行
  - 校验：schema 版本、必要列、终态 `status`、正整数 ID、非负计数、0–100 百分比、正数排名、时间顺序、JSON 结构和引用链接协议；仅允许 HTTP/HTTPS 引用链接
  - 校验失败返回 `422`，并给出稳定 `code`、`row` 和 `column`；整份文件原子拒绝，不写入部分报告
  - 返回：`201 Created` 和只读导入报告；不会创建或覆盖问题、问题集，也不会计入项目汇总指标

### 项目看板与项目报告

- `GET /api/geo-projects/:projectId/dashboard` 获取当前项目的新版指标看板
  - Query 参数：`days` 为 1–365 天；`platform` 默认为 `all`，也可指定周期内实际出现的平台代码
  - 平台列表来自查询周期内实际历史记录，不受项目当前平台配置删减影响
  - 新运行只聚合 `contextual_competitor_mentions_sov_v2_scoped`，返回分析覆盖率、品牌提及率、推荐率、有效排名回答数、带开放发现范围状态的 `sov_summary`、实际竞品提及次数和趋势；历史 v1 只读且不与 v2 静默拼接
- `POST /api/geo-projects/:projectId/reports/generate` 生成不可变项目报告快照
  - 请求体：`days` 为 1–365 天
  - 同一批查询结果一次固化 `all` 与各实际平台的 `metric_views`；切换平台不重新查询或修改快照
- `GET /api/geo-projects/:projectId/reports/latest` 获取最新项目报告快照
  - 新快照返回顶层 `metric_semantics_version` 及 `metric_views`
  - 历史旧快照保持生成时的原字段、原数值和旧口径标签，不用当前公式重算

## SEO 检测（需认证）

- `POST /api/seo-audits` 检测一个 HTML 页面
  - 请求体：`url` 必填，可省略 `http://` 或 `https://`
  - 返回：新保存的 `auditId`、最终 URL、状态码、响应时间、0–100 基础分、问题统计、优先修复项、六类检查结果与搜索/分享预览
  - 检查项：每项包含 `title`（检查对象）、`finding`（具体发现）、`status`、`severity`、`value`（检测事实）、`description`（影响）和 `recommendation`（建议）
  - 内容有效性：`robots.txt` 和 Sitemap 必须含有效内容；Title、Meta Description、Canonical、H1、JSON-LD、Open Graph 与图片 Alt 不会因空标签而通过；根 `/sitemap.xml` 不可用或无效时，才会继续实际抓取并校验 `robots.txt` 中最多 3 个自定义 Sitemap，已有一个有效 Sitemap 后停止额外可用性探测
  - 爬虫权限：响应的 `crawlerAccess` 按当前页面路径分别展示 Google、Bing、百度和重要 AI 爬虫在 `robots.txt` 中的允许、禁止或无法判断状态；搜索与 AI 搜索爬虫纳入评分，用户触发访问及 AI 训练/数据使用策略不计分
  - 判定边界：`robots.txt` 返回普通 4xx 或内容为空表示“未声明抓取限制”，但独立的 `robots-txt` 有效性检查仍会报缺失/空内容；429、5xx、网络失败或非空但无法解析的文件返回“无法判断”。允许状态不能证明真实 UA 已成功访问、收录或引用
  - 响应闸门：页面、robots 和 Sitemap 在解析前按预期类型分类；WAF、429、普通 HTTP 错误或不可分析入口不会生成成功报告。GoodieAI 出口被 WAF 拦截不能据此推断搜索引擎也被拦截
  - 搜索平台标签：固定从站点首页分别检查 Google、Bing、百度 HTML 验证 Meta 标签，但不能据此断言平台后台当前已验证，也不识别 DNS 或验证文件方式
  - 评分配置：响应包含 `scoreVersion`、`ruleVersion` 和 `summary.totalWeight`；规则权重、严重程度、主要阈值和 `crawlerProfiles` 集中在 `backend/config/seoAuditRules.js`；当前规则版本 `2026-07-31-v7` 中 Keywords 权重为 1，Sitemap 和爬虫权限权重均为 7；图片仅在缺少 `alt` 属性时失败，显式 `alt=""` 作为可能的装饰图提示，不直接扣分
  - 保存规则：检测成功后完整报告写入当前用户的 SQLite 历史记录；保存失败时本次请求不返回成功
  - 安全边界：默认拒绝本机和私网目标。内部部署设置 `SEO_AUDIT_ALLOW_PRIVATE_TARGETS=true` 后，允许所有已登录用户检测后端 `localhost`、loopback 和 RFC1918 IPv4 字面地址；单次任务只能访问提交 URL 的精确来源。带用户名/密码的网址、链路本地/云元数据等特殊地址始终拒绝
- `POST /api/seo-audits/site` 创建全站异步检测任务
  - 请求体：`url` 必填；以该 URL 为入口，只发现同源 HTTP/HTTPS 页面
  - 返回：`202 Accepted`，`data.id` 为任务编号，初始 `status` 为 `queued`，`progress.phase` 为 `queued`
  - 发现来源：真实入口 URL、页面内链、根目录 `/sitemap.xml`、robots 声明的 Sitemap；支持 Sitemap index、片段移除，并按重定向后的 resolved URL 合并页面；报告保留 requested URL、final URL 和重定向别名
  - 抓取限制：默认上限 200 页、页面并发 4、同一 origin 请求启动间隔至少 250ms、最多读取 20 个 Sitemap、递归深度 3；达到页面预算后不再递归更多 Sitemap。主任务只探活未覆盖的站内目标，预算为至少 10 个、每个成功页面 2 个、全任务最多 50 个网络探活；已检测页面的状态直接复用，不占探活预算。站外链接仍保留在逐页链接数据中，但不发出网络请求，也不参与“失效内链”检查。达到上限时任务仍完成，但报告 `site.truncated` 为 `true`
  - 有界预检：在请求入口前先读取对应 origin 的 robots，并在每个重定向目标发出页面请求前重复核验目标 origin；明确禁止 GoodieAI 的入口不会收到页面请求。随后验证一个默认 Sitemap，再进入递归 Sitemap 与页面循环
  - 抓取止损：确认 WAF 或 429 后停止本任务对该 origin 的后续请求；同一应用实例中的其他任务共享同域启动间隔和有效熔断窗口，429 按 `Retry-After` 到期恢复，WAF 使用短期冷却。多实例部署仍需外部协调器
  - 请求诊断：成功报告的 `site.crawlDiagnostics` 固定记录页面、robots、Sitemap、链接探活请求数、重定向跳数、逻辑渲染尝试数和完成原因
  - 专项报告：`report.sitewide.version` 当前为 `sitewide-audit-v4`；`sitemap-coverage` 独立比较有效 Sitemap 页面清单与已知可索引页面，没有有效页面地址时返回 `unknown`，疑似孤儿页与内链来源质量也不会误报为通过
  - 导航证据：`navigation_crawlability` 返回无有效 `href` 的 `<a>`、有明确页面跳转证据的非语义化控件及交互后才创建的链接；只有点击样式、`cursor-pointer` 或通用点击事件的 `span`/`div` 不判定为 SEO 链接错误
  - 证据边界：浏览器导航抽样只触发 Header/Nav 控件的 hover/focus，不点击链接或业务按钮；渲染器不可用且静态 HTML 没有确定问题时，导航检查返回 `unknown`，不会伪装为通过
  - 网络边界：所有全站任务均不探测站外链接；私网任务还不会执行 JavaScript 渲染抽样。报告的 `networkPolicy` 会明确标记私网任务的这两项为 `not_checked`
  - 容错：单页失败写入逐页账本并继续；所有入口均失败时任务标记 `failed`，且不写入伪成功历史
- `GET /api/seo-audits/runtime` 获取当前 SEO 检测运行能力
  - `privateTargetsEnabled` 表示后端是否开启本机和局域网检测
- `GET /api/seo-audits/jobs/:jobId` 查询当前用户的全站任务
  - 运行中返回 `status` 与 `progress`（发现、检测和失败页数）
  - 完成后返回 `auditId` 与完整 `report`；失败时返回安全的 `error.code`、`error.message`，`progress` 可包含 `stopReason`、`retryAt` 和固定结构 `crawlDiagnostics`
  - 权限验证：只能读取当前用户自己的任务；任务不存在或不属于当前用户时统一返回 404
- `GET /api/seo-audits` 分页获取当前用户的检测历史摘要
  - Query 参数：`page` 默认 1；`pageSize` 默认 10，最大 50
  - 返回：`items` 与 `pagination`；`summary.mode` 区分 `site` / `page`，`summary.pages` 为检测页数，摘要不包含完整报告正文
- `GET /api/seo-audits/:id` 获取一条完整历史报告
  - 权限验证：只能读取当前用户自己的记录；记录不存在或不属于当前用户时统一返回 404
- `GET /api/seo-audits/:id/export` 导出当前用户的一条历史报告
  - 返回：UTF-8 BOM 的 `text/csv` 文件，schema 为 `seo_audit_report_v1`
  - 表格结构：固定 26 列，以 `record_type` 区分 report、issue、check、page、page_issue、platform、crawler、page_crawler；`record_json` 保留该行结构化数据，其中 report 行用于无损回导
- `POST /api/seo-audits/import` 导入标准 SEO CSV
  - 请求：原始 CSV 文本，`Content-Type: text/csv`，最大 10MB、20000 条数据行
  - 校验：列顺序、schema 版本、唯一 report 行、报告模式、网址、分数、摘要和模式必需数据；公式型可见字段在导出时会加前缀防止电子表格执行
  - 返回：`201 Created` 和新历史报告；导入记录归属当前用户，保留 `sourceAuditId`、`sourceCheckedAt`，并以导入时间作为新历史时间

请求示例：

```json
{
  "url": "https://example.com/"
}
```

成功响应摘要：

```json
{
  "success": true,
  "data": {
    "auditId": 42,
    "finalUrl": "https://example.com/",
    "statusCode": 200,
    "score": 82,
    "summary": {
      "total": 21,
      "passed": 17,
      "issues": 4,
      "critical": 0,
      "high": 1,
      "medium": 2,
      "low": 1
    },
    "priorities": [],
    "categories": []
  }
}
```

历史列表响应摘要：

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 42,
        "finalUrl": "https://example.com/",
        "score": 82,
        "grade": "good",
        "summary": { "issues": 4 },
        "checkedAt": "2026-07-23T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 10,
      "totalItems": 1,
      "totalPages": 1
    }
  }
}
```

常见业务错误码：

- `INVALID_URL`：网址格式不正确
- `UNSUPPORTED_PROTOCOL`：不是 HTTP/HTTPS 地址
- `URL_CREDENTIALS_NOT_ALLOWED`：网址包含用户名或密码
- `PRIVATE_NETWORK_URL`：目标或重定向地址属于本机/私网
- `PRIVATE_TARGETS_DISABLED`：目标是允许类型的本机/局域网地址，但部署未开启私网检测
- `PRIVATE_TARGET_ORIGIN_CHANGED`：私网任务跳转或访问了不同协议、主机或端口
- `SELF_REGISTRATION_DISABLED`：当前内部部署已开启私网检测，因此不接受公开自助注册
- `DNS_LOOKUP_FAILED`：域名无法解析
- `UPSTREAM_TIMEOUT`：目标网站响应超时
- `UPSTREAM_UNAVAILABLE`：无法连接目标网站
- `UPSTREAM_HTTP_ERROR`：入口返回普通不可用 HTTP 状态
- `SEO_AUDIT_BLOCKED_BY_WAF`：当前 GoodieAI 审计身份或出口被目标站点安全策略拦截
- `SEO_AUDIT_RATE_LIMITED`：目标站点返回 429，当前任务停止后续同源请求
- `SEO_AUDIT_INVALID_RESPONSE`：入口成功响应不包含可分析的 HTML
- `TARGET_CONNECTION_REFUSED`：私网目标主机可达，但对应端口没有服务监听
- `TARGET_NETWORK_UNREACHABLE`：私网检测时，后端服务器没有到目标局域网的可用网络路径
- `PAGE_TOO_LARGE`：页面内容超过限制

## 定时任务（需认证）
- `POST /api/schedules` 创建每日定时任务
  - 参数：`question`、`platforms`、`daily_time`、`timezone`、`brand`、`brand_keywords`
- `GET /api/schedules` 列出当前用户定时任务
- `PUT /api/schedules/:id` 更新定时任务
  - **权限验证**：只能操作自己的任务
- `DELETE /api/schedules/:id` 删除定时任务
  - **权限验证**：只能删除自己的任务
- `POST /api/schedules/:id/run` 立即执行一次历史独立定时任务；该管理操作是显式非幂等的人工触发，不属于项目 `monitoring_enabled` 自动监测正式验收入口
  - **权限验证**：只能执行自己的任务

## AI 平台目录（需认证）
- `GET /api/ai-platforms` 获取未归档平台目录及是否可选择，不返回 API Key。
- `GET /api/ai-platforms/:platformCode/runtime-status` 获取受管 Web 平台全局只读运行快照；当前只允许 `deepseek-web` 与 `doubao-web`，原 DeepSeek URL 保持不变，未知或 API 平台返回 404。
  - `GET /api/ai-platforms/deepseek-web/runtime-status`
  - `GET /api/ai-platforms/doubao-web/runtime-status`
  - 响应设置 `Cache-Control: private, no-store`，只返回 `schema_version`、`platform`、`enabled`、`state`、`running_count`、`queued_count`、`pending_count`、`needs_action`、`action_code`、`reason_code` 和 `observed_at`。
  - `state` 为 `idle`、`busy`、`login_required`、`verification_required`、`unavailable` 或 `shutting_down`；状态是无副作用快照，不启动 Chrome、不执行 preflight，也不替代真实运行前检查。
  - `pending_count` 只统计请求平台的可执行或已持有效租约 pending 记录；已暂停且没有有效租约的休眠记录不计入。`running_count` 只表示该平台真实页面采集，只能为 0 或 1；`queued_count = max(pending_count - running_count, 0)`。
  - 响应不包含问题、回答、运行/记录 ID、PID、本机路径、浏览器凭据或内部异常。读取失败返回通用 `500`，不会禁用现有运行入口。

## AI 平台管理（需管理员权限）
- `GET /api/admin/ai-platforms` 获取管理列表。
- `POST /api/admin/ai-platforms` 新增 OpenAI Chat Completions 或 Responses 兼容平台。
- `PUT /api/admin/ai-platforms/:id` 编辑平台、默认模型和 `request_options`；API Key 留空表示保留。
- `PATCH /api/admin/ai-platforms/:id/enabled` 启用或停用平台。
- `GET /api/admin/ai-platforms/:id/web-session` 读取受管 Web 平台的管理员会话状态；响应禁止缓存，只返回平台、浏览器是否可用、Profile 是否已初始化、登录验证状态、稳定原因码和最近验证时间，不返回路径或网页凭据。
- `POST /api/admin/ai-platforms/:id/web-session/open` 关闭该平台已有受管窗口并打开同一专用 Profile 的 Chrome，供管理员人工登录或切换账号；操作期间该平台以 `web_login_required` 阻断新采集，其他 Web 平台不受影响。
- `POST /api/admin/ai-platforms/:id/web-session/verify` 主动检查当前官方页面和唯一输入区。返回 `ready`、`login_required`、`verification_required`、`selector_mismatch` 或 `unavailable`；只有 `ready` 会清除该平台的登录熔断。
- `GET /api/admin/ai-platforms/:id/models` 使用该平台已保存的连接配置临时读取供应商 `GET /models`；成功时合并当前默认模型、去重并完整返回，不做“常用/最新”筛选，同时返回 `persisted: false`，模型目录不落库。
- `GET /api/admin/ai-platforms/:id/api-key` 由管理员主动读取该平台现有 API Key；响应设置 `Cache-Control: no-store`，平台列表仍不返回明文。
- `DELETE /api/admin/ai-platforms/:id/api-key` 清除 API Key。
- `DELETE /api/admin/ai-platforms/:id` 删除自定义平台；为保留历史记录含义，服务端采用软删除。
- `POST /api/admin/ai-platforms/:id/test` 主动测试连接，不改变启用状态。
- `POST /api/admin/ai-platforms/:id/test-web-search` 独立检测联网能力；可提交 `{ "input": "测试问题" }`，返回 `success`、`failed` 或 `inconclusive`，以及本次 `input`、模型文本和供应商响应体。输入输出仅随当前响应返回，数据库只保存状态、时间和简短结论，不改变平台启用状态。

上述 `web-session` 接口只允许 `deepseek-web` 和 `doubao-web`，API 平台调用会返回 `unsupported_platform_capability`。打开的专用 Chrome 位于后端机器的持久桌面会话中，不会把第三方网页登录嵌入设置页。

## 会员方案（需管理员权限）
- `GET /api/membership/plans` 获取全部会员方案
- `PUT /api/membership/plans/:level` 更新指定会员方案
- `POST /api/membership/plans/resetAll` 批量重置为默认值
- `POST /api/membership/plans/:level/reset` 重置指定等级为默认值

## 设置
- 管理员接口（需管理员权限）：
  - `GET /api/settings` 获取允许的系统设置项
  - `PUT /api/settings` 更新设置
  - `GET /api/settings/analysis-api` 获取当前 AI 结构化分析平台与独立模型
  - `GET /api/settings/analysis-api/prompt` 获取正式运行使用的版本化分析提示词模板、期望 JSON 结构、独立调用策略 `request_profile`，以及按当前已保存平台和模型生成的脱敏实际请求预览 `request_parameters`
  - `PUT /api/settings/analysis-api` 通过 `{ "platform_code": "deepseek", "model_name": "deepseek-v4-flash" }` 选择已启用且配置完整的正式分析平台；DeepSeek 不接受与平台默认 Flash 模型不同的运行时覆盖
  - `POST /api/settings/analysis-api/test` 提交当前问题、品牌、别名和一段完整原回答，临时返回测试输入、证据结构、程序派生结果和 API 原始输出；测试内容不落库
  - 分析调用固定关闭联网，使用独立的温度、超时和尝试次数，不设置应用层输入或输出 Token 上限；这些值不继承或修改监测平台的同名参数
- 公开接口（无需认证）：
  - `GET /api/settings/seo` 获取公共 SEO 设置
  - `GET /api/settings/notice` 获取系统通知

## 统计（需认证）
- 管理员接口（需管理员权限）：
  - `GET /api/statistics/overview` 管理员概览统计
- 用户接口（需认证）：
  - `GET /api/statistics/user/:userId` 用户维度统计
    - **权限验证**：只能查看自己的统计
  - `GET /api/statistics/keywords/:userId` 品牌关键词统计
    - **权限验证**：只能查看自己的统计
  - `GET /api/statistics/platform-comparison/:userId` 平台对比统计
    - **权限验证**：只能查看自己的统计
  - `GET /api/statistics/trends/:userId` 趋势分析
    - 参数：`days` 可选，默认 30
    - **权限验证**：只能查看自己的统计

## 营销监控

营销模块默认关闭；未知或越级使用的契约会 fail-closed。所有外部 ID 和指标均以十进制或不透明字符串返回。

本节是现役 GoodieAI 接口的人类可读摘要，不是完整字段真值。006 实施时将为其负责的广告读取路由交付唯一 OpenAPI 3.1 合同；在该文件实际交付并随 R1/R2 切换前，当前运行真值仍以本节、路由代码和现役合同测试为准。

百度营销与百度统计的上游合同不进入 GoodieAI OpenAPI；仓库只维护实际使用部分，并以 `backend/modules/marketing/contracts/baidu/` 中的版本化 manifest、脱敏 fixture 和合同测试为机器真值，不在此复制百度整套官方文档。

- `GET /api/marketing/status`：读取模块状态，不探测百度网络；授权试点返回 `PILOT_READY`，真实数据只读试点返回 `PILOT_DATA_READY`。
- `GET /api/marketing/projects/:projectId/dashboard`：读取轻量百度广告快照根；可同时传 `from`、`to` 筛选当前本地覆盖范围。响应包含 revision、状态、绑定、coverage、filter、范围汇总、逐日趋势、四类计数和刷新状态，不返回四类明细数组。
- `GET /api/marketing/projects/:projectId/ad-hierarchy`：按 Dashboard 返回的同一 `revision` 读取计划、单元、关键词三层结构及完整筛选范围 summary；不返回搜索词。
- `GET /api/marketing/projects/:projectId/keywords`：按同一 `revision` 服务端筛选、排序和分页关键词，返回与当前页无关的完整筛选范围 summary。
- `GET /api/marketing/projects/:projectId/search-terms`：按同一 `revision` 服务端筛选、排序和分页搜索词；搜索词不返回 `keywordId`，不得由名称补造。
- 上述四个 GoodieAI 内部读取接口的唯一机器可读合同是 [`backend/modules/marketing/contracts/goodieai-marketing-ad-read.openapi.json`](../backend/modules/marketing/contracts/goodieai-marketing-ad-read.openapi.json)。本节只保留人工摘要；请求、响应、空值、错误、缓存、数据源和“读取不调用百度上游”的精确定义以 OpenAPI 3.1 为准。前端 wire type 通过 `npm run generate:marketing-api-contract` 生成，并用 `npm run check:marketing-api-contract` 校验同步。
- `GET /api/marketing/projects/:projectId/website-traffic-overview?device=all|pc|mobile&from=YYYY-MM-DD&to=YYYY-MM-DD&source=ALL|BAIDU_PAID|DIRECT|BAIDU_SEARCH|BING_SEARCH|GOOGLE_SEARCH|OTHER_SEARCH|EXTERNAL_REFERRAL&metric=visits|visitors|pageviews|bounceRate|averageVisitTime|averageVisitPages&includeSourceComparison=true|false`：网站流量和市场总览共用的正式区间合同，返回当前/上一周期汇总、单一渠道/指标趋势和来源质量。仅 `source=ALL&metric=visits` 可以启用 `includeSourceComparison=true`；此时额外返回七个固定渠道的本期汇总、占比、周期变化和逐日访问趋势，单渠道读取失败时按行返回 `UNAVAILABLE`，不会抹掉其他渠道；`sourceComparison.state` 只表示趋势可用性，additive `sourceComparison.partition` 独立返回 visits 分类覆盖。分区总量与七行精确相等时为 `COMPLETE`；来源缺失、总量缺失或合计不足时为 `PARTIAL`，reason 分别为 `SOURCE_METRIC_MISSING`、`SOURCE_TOTAL_UNAVAILABLE`、`SOURCE_COVERAGE_INCOMPLETE`。residual 只表示覆盖差额，不创建来源、不参与归因或份额重归一；负数、非法十进制、子来源差额为负或 classified 大于 total 时以 502 `TONGJI_SOURCE_PARTITION_INVALID` 拒绝可信展示。渠道目录固定为百度推广、直接访问、百度搜索、必应搜索、Google 搜索、其他搜索和外部引荐；没有访问也保留渠道行。`device=all` 表示不向百度添加设备过滤；当前/上一周期必须是等长、连续的自然日。响应用 `capabilities`、`selectedMetricState` 和来源比较状态区分已验证真实数据、无数据与未开放能力。百度推广行的站内访问只来自百度统计 `BAIDU_PAID`，不得用 Dashboard 广告点击数代替。
- `GET /api/marketing/projects/:projectId/website-traffic-pages?device=all|pc|mobile&from=YYYY-MM-DD&to=YYYY-MM-DD&view=landing|visited&page=1&pageSize=20&sortBy=...&sortOrder=ascend|descend&query=...`：网站流量页入口页面/受访页面的独立分页合同。服务端显式遍历百度上游分页；页面稳定键使用上游 `pageId`，百度没有返回页面标题时 `title=null`，不得把 URL 冒充标题。规范化后相同 path 的事实仍保留独立 `key/pageId`，并在完整过滤结果分页前返回稳定 `pathCollision.ordinal/count`；无碰撞时该字段为 `null`，不得据此合并浏览量、比率或平均值。只展示与项目绑定站点同域的 URL，`dataQuality.excludedCrossDomainRows` 返回被排除的本机或跨域污染行数；公开分页总数是经过域名与查询过滤后的可展示行数。
- `POST /api/marketing/projects/:projectId/refresh-runs`：请求体只接受 `triggerType`；固定读取最近 30 个上海自然日。
- `GET /api/marketing/projects/:projectId/refresh-runs/:runId`：读取同项目运行状态。
- `/api/marketing/projects/:projectId/baidu-bindings*`：管理员创建、暂停、恢复或删除整个百度搜索账户绑定。
- `POST /api/admin/marketing/baidu/authorization-attempts`：管理员创建一次性连接或重授权尝试。
- `GET /api/admin/marketing/baidu/authorization/launch`：使用 HttpOnly launch Cookie 跳转百度授权页。
- `GET /api/admin/marketing/baidu/oauth/callback`：公开 HTTPS callback；只接受百度文档规定的 `appId/authCode/state/userId/timestamp/signature`，验签成功后换 Token，最后跳转无查询参数结果页。
- `GET /api/admin/marketing/baidu/authorization-results/current`：发起管理员读取一次性脱敏授权结果。
- `GET /api/admin/marketing/baidu/connections`：管理员读取连接列表。
- `GET /api/admin/marketing/baidu/connections/:connectionId/accounts`：管理员读取官方 `getUserInfo` 返回的主账户与子账户目录。
- `POST /api/admin/marketing/baidu/connections/:connectionId/disconnect`：本地断开、清 Token 并暂停相关绑定。

`PILOT_READY` 只开放上述授权、callback、Token、连接和账户目录接口；所有项目绑定、看板、刷新和调度接口返回 `MARKETING_PILOT_AUTH_ONLY`。`PILOT_DATA_READY` 仅对服务端项目白名单开放百度搜索账户绑定、搜索报表快照和百度统计读取；它不等同于正式 `READY`。广告快照的本地正式代码路径一次读取计划、单元、关键词和搜索词四份报告并全成全败；不存在计划级静默 fallback。网站流量的 `trend/time/a` 访问次数、UV、PV、质量指标，`source/all/a` / `source/engine/a` 来源汇总，以及 `visit/landingpage/a` / `visit/toppage/a` 页面报告都已取得同站点真实账号响应证据并由 manifest 开放运行；字段顺序、无数据标记、设备过滤、分页和响应上限仍由严格解析器约束。来源表中的跳出率、平均访问时长、平均访问页数仍没有通过“来源—质量指标”关联验证，固定返回缺失值；`sourcePageLinkage=false`，来源选择也不会联动页面报告。能力被关闭时客户端必须在 transport 前 fail-closed，不填 fixture、不把缺失值改成零。真实 App ID、SecretKey、Access Token、Refresh Token 和百度统计 Token 只保存在服务器环境与加密数据库中。系统不会向百度调用任何写接口，也不支持信息流、计划子集、创意、落地页或销售数据。

2026-08-05 起，固定 30 日公开接口 `tongji-trend` 与 `tongji-source-trends` 已退役并返回 404；消费方必须使用带明确日期范围的 `website-traffic-overview`，不存在兼容 fallback。

## 官网表单数据（需认证）

官网数据与百度数据是两套独立 API。官网表单由 `backend/modules/websiteFormConsultations` 承载并固定挂载在 `/api/website-data`；百度营销与百度统计继续由 `backend/modules/marketing` 承载并挂载在 `/api/marketing`。两者不共用外部客户端、服务、响应合同、模块状态、快照表或迁移账本，只共享应用登录鉴权和项目访问控制。

- `GET /api/website-data/status`：读取官网表单模块自己的 `DISABLED`、`MISCONFIGURED`、`SCHEMA_MISSING` 或 `READY` 状态，不探测百度接口。
- `GET /api/website-data/projects/:projectId/form-consultations?from=YYYY-MM-DD&to=YYYY-MM-DD`：后端分页读取指定日期范围内的全部官网联系人记录，逐条执行九键来源分类后返回总数和来源分组；闭区间最长 180 日。
- `GET /api/website-data/projects/:projectId/form-consultation-days?from=YYYY-MM-DD&to=YYYY-MM-DD`：从同一批联系人记录按 `Asia/Shanghai` 构建 `days[]`、区间汇总和来源汇总；闭区间最长 31 日，逐日合计必须等于区间总数。

该合同固定返回 `sourceSystem=GATO_WEBSITE`、`consultationType=WEBSITE_FORM`、`dataCoverage=ALL_FORM_RECORDS` 和 `summary.formConsultationRecords`。每条表单记录必须且只能进入九键之一，来源缺失、无效或无法识别时进入 `UNKNOWN`。响应不得包含姓名、电话、邮箱、IP、表单内容、访客/会话 ID、原始 `referrer` URL、官网流量或 53KF 数据；单次超过 10,000 条时整体失败，不返回部分统计。

官网模块默认关闭。相关代码与 website-data 迁移已部署，但正式启用前仍必须注入服务端专用只读凭据并确认 `/api/website-data/status` 为 `READY`；截至 2026-08-04，生产模块保持 `DISABLED`，不得把“代码已部署”描述为“官网数据已上线”。

## 原始咨询记录（需认证）

原始咨询记录由独立 `backend/modules/consultationRecords` 模块承载并固定挂载在 `/api/consultations`。该模块提供脱敏记录摘要与按需详情，不进入 `/api/marketing`，也不参与 `/api/website-data` 的统计计算。官网表单和 53KF 使用各自独立的 adapter、来源合同与覆盖状态；没有真实明细接口时返回明确的部分覆盖状态，不生成占位记录或合计两类咨询。该组敏感读取接口只接受 `Authorization: Bearer`，明确拒绝 URL Query 或 Cookie 中的 JWT，避免凭据进入浏览器历史和代理日志。

- `GET /api/consultations/status`：读取记录模块能力、审计 schema 状态，以及官网表单和 53KF 各自的 `sourceState`、`recordCoverage` 与稳定 `reasonCode`。该接口不调用第三方网络。
- `GET /api/consultations/projects/:projectId/records`：分页读取咨询摘要。请求前先校验用户对项目的访问权。
  - 必填 Query：`from`、`to`，格式为 `YYYY-MM-DD`，闭区间最长 180 天。
  - 可选 Query：`page`（默认 1）、`pageSize`（默认 10，最大 100）、`type=ALL|WEBSITE_FORM|ONLINE_CHAT`、`source`、`device=ALL|PC|MOBILE|OTHER|UNKNOWN`、`q`（最多 100 字）、`sortBy=occurredAt|consultationType|source`、`sortOrder=asc|desc`。
  - 固定返回 `schemaVersion=consultation_records_v1`、`items`、`pagination`、`coverageState` 和独立 `sources`。`items` 只包含时间、类型、来源、落地页摘要、咨询内容摘要、设备、脱敏联系人和是否可读取详情；不返回完整表单正文、完整对话、上游凭据、第三方响应或未脱敏联系方式。adapter 内部返回的每条记录必须携带项目绑定，服务在公开序列化前再次与请求项目核对并移除该内部字段。
- `GET /api/consultations/projects/:projectId/records/:recordId`：按需读取一条完整只读详情。
  - 先校验项目访问权和审计 schema，再从记录所属 adapter 读取；成功响应写入 `CONSULTATION_DETAIL_VIEW` 审计记录后才返回正文。
  - `WEBSITE_FORM` 详情返回完整表单内容和结构化字段；`ONLINE_CHAT` 详情只返回访客实际发言及相关客服回复形成的有效对话。机器人问候、窗口打开和纯系统消息不得进入有效对话。
  - 两种详情都只返回脱敏联系人；服务端输出边界会再次遮蔽电话、邮箱和 IP，不信任 adapter 自报的脱敏状态。表单字段、对话消息和累计正文均有硬上限；来源系统链接必须为 adapter 允许的 HTTPS 地址。接口不提供回复、编辑、分配、转线索或订单操作。
  - 审计记录只保存用户、项目、来源系统、咨询类型、记录 ID 的 SHA-256 指纹和时间，不保存正文、联系方式、IP、凭据或完整第三方响应。

列表成功响应摘要：

```json
{
  "schemaVersion": "consultation_records_v1",
  "projectId": "1",
  "coverage": {
    "from": "2026-07-05",
    "to": "2026-08-03",
    "timeZone": "Asia/Shanghai"
  },
  "coverageState": "NONE",
  "sources": [
    {
      "sourceSystem": "GATO_WEBSITE",
      "consultationType": "WEBSITE_FORM",
      "sourceState": "AGGREGATE_ONLY",
      "recordCoverage": "NONE",
      "reasonCode": "WEBSITE_FORM_RECORD_API_UNVERIFIED"
    },
    {
      "sourceSystem": "KF53",
      "consultationType": "ONLINE_CHAT",
      "sourceState": "NOT_CONNECTED",
      "recordCoverage": "NONE",
      "reasonCode": "KF53_API_UNVERIFIED"
    }
  ],
  "items": [],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "totalItems": 0,
    "totalPages": 0
  }
}
```

错误响应沿用 `{ "error": { "code", "message" } }`。日期、分页、枚举或搜索参数无效返回 `422`；普通用户请求不存在或不属于自己的项目统一返回 `404`，避免枚举租户状态；审计 schema 不可用时详情 fail-closed 返回 `503`，不得在无法审计时返回敏感详情。只有模块创建的稳定错误可向客户端公开；第三方或未知异常的状态、代码和正文不得透传。

## 响应状态码
- `200 OK` - 请求成功
- `400 Bad Request` - 请求参数错误
- `401 Unauthorized` - 未认证或 token 无效
- `403 Forbidden` - 无权限访问该资源
- `404 Not Found` - 资源不存在
- `429 Too Many Requests` - 超过速率限制
- `500 Internal Server Error` - 服务器内部错误

## 响应格式
成功响应：
```json
{
  "success": true,
  "data": { ... },
  "message": "操作成功"
}
```

错误响应：
```json
{
  "success": false,
  "message": "错误描述"
}
```
