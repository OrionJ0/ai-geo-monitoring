# 文档总览

本目录包含项目的使用说明、接口文档、环境变量与部署指南。

## 快速开始

- 首次安装依赖：
  - `npm install`
  - `cd backend && npm install`
  - `cd ../nextjs-frontend && npm install`
- 统一启动前后端：
  - 在项目根目录执行 `npm run dev`
  - Next.js 前端登录页默认运行在 `http://localhost:3001`
  - 浏览器 API 统一走前端同源 `/api/*`
  - 后端内部默认运行在 `http://127.0.0.1:3002`
  - 存活检查：`GET http://localhost:3001/api/health`
  - 就绪检查：`GET http://localhost:3001/api/ready`
- 单独启动：
  - 后端：`npm run dev:backend`
  - Next.js 前端：`npm run dev:frontend`

## 目录说明

- `API.md`：后端接口说明（路径、参数、返回示例）
- `ENVIRONMENT.md`：环境变量与敏感信息管理
- `DEPLOYMENT.md`：部署与运维建议
- `SECURITY.md`：安全加固说明与最佳实践
- `closed-2026-07-23-002-ai-platform-settings/`：全局 AI 平台设置中心、临时模型目录、分析结构化协议与 OpenAI 兼容协议收敛的已完成需求
- `active-2026-07-23-004-question-set-run-reports/`：单问题与问题集独立运行报告、AI 实体/关系结构化指标、失败重试可靠性、标准 CSV 往返与 A4 竖版 PDF 的当前修复需求
- `closed-2026-07-26-001-question-set-run-reliability/`：已完成的问题集运行原子启动、调度防重、执行租约、恢复收敛、历史证据保护和发布验收
- `closed-2026-07-26-002-deepseek-web-monitoring/`：已完成的 DeepSeek 真实网页串行采集、人工登录会话、引用/截图证据、API/Web 样本隔离，以及问题库单问题/问题集和自动监测入口验收
- `blocked-2026-07-27-001-market-team-vm-web-queue/`：市场部共享 admin、虚拟机单实例、DeepSeek Web 公共排队状态；实现和自动化验收完成，等待目标虚拟机多浏览器发布验收
- `active-2026-07-27-002-doubao-web-monitoring/`：豆包 Web 注册表、隔离运行时、可信采集、设置页账号管理、双平台状态与正式任务链路已完成本地实现；2026-07-30 起新安装的全部平台预置默认停用，由管理员主动启用；本地真实单问题采集已通过，仍需目标虚拟机完成问题集、自动监测和双浏览器资源验收
- `blocked-2026-07-28-001-geo-entity-share-metrics/`：回答内竞品提及占比（SOV）的版本边界、v3 完整输入分析、回答级等权聚合、分析失败隔离、平台视图、历史兼容和人工基线；Issue 008 人工基线已关闭，等待 Issue 009 的真实入口验收
- `blocked-2026-07-29-002-ai-semantic-analysis-quality/`：v4 全实体语义抽取、竞品/排序/情绪原文证据、DeepSeek Pro 基线校准和全入口硬切已完成实现与技术验收，等待 SOV 波动口径和补充情绪人工基线确认
- `active-2026-07-29-001-marketing-monitoring/`：轻量只读营销监控；真实 OAuth、账户目录、搜索推广 30 日分页报表和百度统计站点/趋势响应已用脱敏 fixture 固化，`PILOT_DATA_READY` 仅向项目白名单开放绑定、搜索快照和统计实时读取；正式导航仍隐藏，等待金额/时区、Refresh Token 与完整生产验收
- `solutions/2026-07-22-seo-audit-mvp.md`：历史/已退役的单页 SEO MVP 竞品调研、规则范围和验证记录
- `solutions/2026-07-23-seo-site-audit.md`：全站异步抓取、配置化评分、SQLite 任务与历史报告的正式实现和验证证据
- `closed-2026-07-30-001-seo-audit-response-safety/`：响应可信度分类、WAF/429 止损、同域节流、有界预检和 resolved URL 去重的 PRD、技术方案与验收 issues
- `solutions/2026-07-30-ai-geo-production-deployment.md`：AI-GEO systemd、受信代理、生产验证、服务器修改台账与回滚记录

## 重要约定

- 所有后端接口前缀为 `/api`（参考 `backend/app.js`）
- **所有需要认证的接口都必须携带有效的 JWT Token**
- 管理员接口需要管理员身份；用户接口需要登录令牌
- `.env` 与 `database.sqlite` 不应被提交到仓库（已在项目根 `.gitignore` 忽略）

## 安全特性

- **完整认证授权**：所有检测、统计相关接口都需要身份验证
- **所有权验证**：用户只能访问自己的数据，防止水平越权
- **速率限制**：
  - 通用 API：500 次/15 分钟
  - 定时任务 API：1000 次/15 分钟
  - 登录接口：5 次/15 分钟（防暴力破解）
- **安全HTTP头**：使用 Helmet 中间件自动添加安全相关头
- **请求大小限制**：1MB 限制防止 DoS 攻击
- **SEO 抓取防护**：默认拒绝本机/私网地址；内部部署可显式开启本机与 RFC1918 地址检测。无论是否开启，均拒绝带凭据网址、链路本地/云元数据等特殊地址，并限制私网任务只能访问提交 URL 的精确来源
- **CORS 白名单**：仅允许配置的域名跨域访问
- **会员自动降级**：过期会员自动降级为免费用户
- **配额原子操作**：使用数据库原子操作防止竞态条件

## 功能特性

- 多平台检测：系统预置豆包、DeepSeek、千问和腾讯混元的非敏感接口信息；混元新预置使用 TokenHub `hy3-preview` 与 `web_search_options.enable=true`，仍需在 TokenHub“工具管理”开通搜索资源并完成联网能力检测；管理员在 `/admin/settings` 配置密钥，也可新增 OpenAI 兼容平台。
- 批量问题：支持按行输入多个问题并同时检测。
- 关键词高亮与统计：对原文进行关键词高亮，并统计出现次数（含英文词边界）。
- 历史记录：按时间、平台、状态筛选，支持查看详情、删除、清空、导出。
- 流式结果（SSE）：部分平台结果以增量流式显示，提升反馈速度。
- 统计看板：展示总检测次数、平均推荐率、平均曝光率。
- 导出能力：
  - 历史记录导出为 CSV（中文平台与状态、关键词统计列）。
  - 历史详情一键导出为 PNG 图片（`YYYYMMDD-问题.png`）。

## 技术架构

- 前端：Next.js + React + Ant Design
  - Markdown 渲染：`react-markdown` + `remark-gfm`
  - 关键词高亮：自定义 `remarkKeywordHighlight`
  - 图片导出：`html-to-image`
- 后端：Node.js（Express）
  - ORM/数据库：Sequelize + SQLite（`database.sqlite`）
  - 路由：REST API + SSE 流式接口

## SEO 检测

- 页面入口：`/geo/seo-audit`（需登录）
- 检测模式：默认“全站检测”异步扫描同域链接、默认 Sitemap、robots 声明 Sitemap 和 Sitemap index，最多检测 200 页；“单页检测”只分析输入的精确 URL
- 响应与风控：页面、robots、Sitemap 和链接探活按预期类型分类，只有正常响应进入对应分析；WAF/429 不计为站点 SEO 扣分，并停止本任务对该 origin 的后续请求。默认页面并发为 4，同域请求启动间隔至少 250ms；全站递归前依次预检入口、robots 和默认 Sitemap
- URL 身份：全站按实际重定向后的 resolved URL 合并页面，报告同时保留用户提交入口、真实 final URL、重定向链和别名；Canonical 仍只作为 SEO 声明，不参与抓取去重
- 当前能力：执行 23 项页面基础检查，返回带版本号的技术健康度；全站报告另有不改写 v4 分数的 `sitewide-audit-v4` 专项审计层，检测重复标题/描述、Canonical 聚类与冲突、重定向链/循环、失效内外链、疑似孤儿页、内链来源质量、导航链接可抓取性、站点 URL 一致性、hreflang、Sitemap 页面覆盖、JavaScript 渲染抽样及相对上次报告的问题变化
- 报告行动清单：顶部“优先修复内容”统一汇总页面技术问题、跨页专项问题和缺失的平台验证标签；导航问题默认只展示少量导航项名称与统一出现范围，完整标签和页面证据折叠在“查看详情”
- 有效性规则：`robots.txt`、Sitemap、Title、Meta Description、Canonical、H1、JSON-LD、Open Graph 和图片 Alt 均校验实际内容，文件返回 200、标签存在或 `robots.txt` 声明 Sitemap 本身不等于通过；Sitemap 可用性与页面覆盖独立展示，无有效页面清单时覆盖、疑似孤儿页和内链来源质量均为“暂时无法检查”
- 爬虫权限：按每个被检测路径解析 `robots.txt`，展示 Googlebot、Bingbot、Baiduspider 和重要 AI 搜索、用户触发、训练类 token；搜索/AI 搜索阻断纳入评分，其余作为授权信息不计分。全开放只表示 robots 未声明限制，不能证明真实抓取、收录或引用
- 搜索平台：固定从站点首页分别检查 Google、Bing、百度非空 HTML 验证标签；该结果只表示页面源码信号，不能证明平台后台当前已验证，也不检测 DNS 或验证文件方式
- 权重维护：`backend/config/seoAuditRules.js` 集中维护规则版本、严重程度、权重、阈值、爬虫画像、页面上限、并发和 Sitemap 深度；Keywords 默认权重为 1，Sitemap 和爬虫权限默认权重均为 7
- 历史与任务：全站任务进度和成功报告均写入本地 SQLite（生产仍兼容 Postgres），服务重启会重新入队未完成任务；进度按执行阶段和已检测页数单调增长，不使用持续变化的已发现页数作为实时分母；历史按当前用户隔离，并兼容旧单页报告
- 数据往返：当前报告可导出 `seo_audit_report_v1` 标准长表 CSV；表格按 report、issue、check、page、platform、crawler 等记录类型展开，固定列可用于筛选分析，原文件可重新导入为当前账户的新历史报告
- 当前边界：浏览器渲染只抽样最多 3 页；链接网络探活按成功页面动态分配，至少 10 个、每页 2 个且全任务最多 50 个，未完整覆盖时明确标记证据不足；尚未执行 GoodieAI 自身 robots 授权、跨实例共享限速/熔断或总请求硬上限，也不提供真实 Core Web Vitals、关键词排名、搜索引擎收录量或外链数据库
- 竞品调研见 `solutions/2026-07-22-seo-audit-mvp.md`；正式全站实现见 `solutions/2026-07-23-seo-site-audit.md`

## 项目结构

```
backend/        # Node.js (Express) 后端
  .env          # 部署环境变量（数据库、JWT、平台密钥加密主密钥等）
  app.js        # 应用主文件
  config/       # 数据库配置
  models/       # Sequelize 模型
  routes/       # API 路由
  services/     # 业务逻辑服务
docs/           # 项目文档
nextjs-frontend/ # Next.js 前端
  src/app/      # App Router 页面
  src/components/
  public/
```

## 使用说明

- 在首页选择检测平台，输入问题与关键词（支持批量问题，逐行输入）。
- 点击“开始检测”后，可在结果区看到实时/流式文本与关键词统计。
- 打开右侧“历史记录”抽屉，支持：筛选、分页、查看详情、删除、清空、导出。
- 统计卡片显示累计与平均指标，便于宏观把控模型表现。

## 导出功能

### 导出历史记录（CSV）
- 入口：右侧“历史记录”抽屉中的“导出”。
- 列：`检测时间、问题、平台、状态、关键词统计`。
- 平台与状态中文化；关键词统计以 `关键词 × 次数`，多项用 `；` 分隔。
- 自动处理 CSV 字段中的逗号/引号/换行，避免列错位。
- 文件名：`history_export.csv`。

### 导出历史详情为图片（PNG）
- 入口：在“历史记录”列表点击“查看详情”，弹窗右上点击“导出图片”。
- 导出范围：弹窗中详情内容区（基本信息 + 详细结果），不包含操作按钮。
- 文件名：`YYYYMMDD-问题.png`。
  - 日期来源：服务端记录时间 `createdAt`，按 UTC 计算 `YYYYMMDD`，与服务器日期严格一致。
  - 问题文本：清理不合法文件名字符（`\ / : * ? " < > |`），并截断至约 60 字符。
- 清晰度：`html-to-image`，背景白色、像素倍率 2。

## 后端 API（概要）

- `GET /api/detection/history/:userId` — 查询历史记录
  - Query 参数：`page, limit, platform, status, q`
- `DELETE /api/detection/history/:userId` — 清空（按筛选范围）历史
- `DELETE /api/detection/record/:id` — 删除单条记录
- `GET /api/detection/status/:recordId` — 轮询某条记录的状态
- `GET /api/detection/stream?user_id=&platform=&question=&brand_keywords=` — 启动流式（SSE）
- `GET /api/statistics/user/:userId` — 用户统计数据
- `GET /api/ai-platforms` — 当前 AI 平台目录（需登录）
- `/api/admin/ai-platforms/*` — AI 平台管理、模型请求参数、启停、连接测试、联网能力检测，以及受管 Web 登录状态、专用 Chrome 登录和账号切换（需管理员）

更多字段与返回示例详见 `API.md`。

## 生成参数与可调项

- 生成温度（后端服务层）：`temperature = 0.7`。
- 并发、重试、默认超时和最大 Token：由管理员在 `/admin/settings` 的“运行设置”页签维护；平台可覆盖超时和最大 Token。

## 开发与运维建议

- 同时运行前后端时优先使用根目录 `npm run dev`；如需变更端口，请同步调整启动脚本、Next.js rewrites 与后端 `PORT`。
- 若 CSV 在 Excel/Numbers 中显示乱码，请确保以 UTF-8 打开或使用导入向导。
- 图片导出时若内容较长，建议滚动至需要的区域后再导出，以获得最佳视觉效果。

## 许可与声明

本项目用于学习与演示目的，默认不包含商业授权条款。若需商用或二次开发，请根据实际情况补充许可证并遵循各平台 API 使用规范。
