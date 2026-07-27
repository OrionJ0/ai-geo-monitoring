# GoodieAI GEO Monitoring System

GoodieAI GEO Monitoring System 是一个面向 Generative Engine Optimization（GEO）的监测系统，用于观察品牌在 AI 搜索、AI 问答和大模型回答中的曝光、提及、推荐与引用来源表现。

## 系统演示

### 品牌项目工作台
![品牌项目工作台](docs/images/readme-projects.png)

### 项目可见度看板
![项目可见度看板](docs/images/readme-dashboard.png)

### 问题库管理
![问题库管理](docs/images/readme-prompts.png)

### 情绪判断与最近指标
![情绪判断与最近指标](docs/images/readme-sentiment.png)

### 信源引用与 URL 明细
![信源引用与 URL 明细](docs/images/readme-sources.png)

## 核心功能

- 品牌项目创建、归档、恢复与删除
- GEO 检测任务创建、调度与执行记录
- 多平台 AI 回答结果监测，预置豆包、DeepSeek、千问和腾讯混元，并支持管理员新增 OpenAI Chat Completions 或 Responses 兼容平台
- DeepSeek 真实网页监测：`deepseek-web` 使用后端所在机器的专用 headed Chrome、人工登录和持久会话，从问题库的单问题、问题集及项目自动监测入口串行采集页面最终回答、引用和截图；它与 `deepseek` API 样本完全独立，失败时不会回退 API
- 平台级模型请求参数配置、连接测试与联网能力检测
- 由独立 AI 分析 API 抽取全部品牌/公司、目标实体映射、提及、候选顺序与推荐关系，程序据此计算品牌提及、推荐和排名；分析调用使用独立的结构化参数并在设置中心展示，不会改写监测平台参数；来源证据区分平台引用、回答正文链接、平台检索候选和分析补充来源，只有平台引用进入引用率与引用次数 KPI
- AI 回答情绪判断，支持正向、中性、负向标签与风险项沉淀
- 问题库支持单条与文本批量新增、分类、平台选择与历史结果追踪
- 问题运行与问题集管理：手动运行统一从问题库发起；单问题和问题集都通过幂等键原子创建 run、配额和任务，并生成独立运行报告，失败项可幂等重试；定时执行按持久时槽去重，任务终态受执行租约保护，已有完整原回答时只重做结构化分析；支持仅含终态数据的标准 CSV 导出和只读回导
- 技术 SEO 双模式检测：默认异步发现并检测最多 200 个同域路由，也保留精确 URL 的单页快速复测；执行 23 项可配置页面规则，并在全站模式追加重复标题/描述、Canonical 聚类与冲突、重定向、失效链接、疑似孤儿页、内链来源质量、导航链接可抓取性、站点 URL 一致性、hreflang、Sitemap 差异、JavaScript 渲染抽样和历史问题差异；每次成功检测按账户保存，可分页查看，并支持标准长表 CSV 导出及重新导入历史
- 引用来源按自有来源、竞品来源、第三方来源聚合分析，并保留域名、URL、平台、问题分类和出现时间
- 用户登录、权限、会员等级与额度管理
- 管理后台：用户、任务、会员、系统配置与运行记录管理
- 本地 SQLite 自动初始化，生产环境支持外部 Postgres 数据库

## 分析能力

### 情绪判断

系统会在品牌被 AI 回答提及时，对回答语义进行情绪判断，并在项目看板、最近指标和历史记录中展示情绪标签。当前结果会归一为正向、中性、负向等状态，便于识别品牌在 AI 回答中的推荐倾向、风险表述和口碑变化。

### 信源引用

系统会从联网回答和模型返回的元数据中提取来源，并区分四种证据角色：平台标注的引用、回答正文链接、平台联网检索候选、分析模型补充来源。只有第一类进入引用率、引用次数和来源聚合 KPI；引用率的分子与分母都只使用 `explicit-citation-v2` 可验证样本，没有可验证样本时界面显示“暂无可验证样本”且不会触发引用缺口告警或机会。其余三类保留在单次问题报告中供核查，不会虚增引用指标。无法证明证据角色的旧记录显示为“历史混合来源”，只供参考且不进入核心 KPI；系统不会在启动时猜测并改写旧数据。品牌官网及其子域名归为自有来源，竞品官网归为竞品来源；维护的媒体域名归为媒体内容，其他未命中已知内容类型的外部域名归为其他第三方来源。

## 适用场景

- 品牌在 AI 搜索结果中的可见性监测
- GEO / AEO / AI Search Optimization 数据分析
- 生成式搜索引擎中的竞品曝光研究
- AI 平台回答内容、情绪倾向与引用来源的长期追踪
- 问题表现、平台差异与优化机会分析

## 当前架构

- 前端：Next.js，目录为 `nextjs-frontend/`
- 后端：Node.js + Express，目录为 `backend/`
- 数据库：本地默认 SQLite；生产环境可通过 `DATABASE_URL` 使用外部 Postgres
- 部署方式：支持前后端分离部署，也可以部署到自有服务器或支持 Node.js 常驻服务的平台
- API 访问：前端可通过 `/api/*` 代理到后端服务

## 快速开始

首次安装依赖：

```bash
npm install
cd backend && npm install
cd ../nextjs-frontend && npm install
```

创建本地环境变量文件：

```bash
cp backend/.env.example backend/.env
cp nextjs-frontend/.env.example nextjs-frontend/.env.local
```

然后编辑 `backend/.env`，至少填写：

- `JWT_SECRET`
- `DEFAULT_ADMIN_PASSWORD`
- `CONFIG_ENCRYPTION_KEY`（用于加密数据库中的 AI 平台密钥）

本地开发也可以在 `backend/` 目录运行 `npm run setup:local-key`，生成不会回显内容的本机专用加密主密钥；生产环境仍应由部署系统安全注入。

生产环境还应通过环境变量注入 `DATABASE_URL` 等部署配置。只有前后端分域、代理不在本机 loopback 或需要直接跨域访问后端时，才需要把实际前端域名加入 `ALLOWED_ORIGINS`。预置平台的非敏感接口信息会在启动时初始化；模型和 API Key 由管理员登录后在 `/admin/settings` 维护，系统不会从 `.env` 自动导入或回退读取平台密钥。

JavaScript SEO 渲染抽样会启动真实浏览器访问目标站点。只有部署环境已通过容器、网络命名空间或等价出口策略隔离浏览器网络时，才应设置 `SEO_RENDER_NETWORK_ISOLATED=true`；否则该检查返回“证据不足”。可用 `SEO_RENDER_BROWSER_EXECUTABLE` 指定 Chrome/Chromium 路径。

首次使用 DeepSeek Web，或登录、人工验证、账号切换和页面选择器故障恢复后，正式环境必须在虚拟机持久桌面中执行完整流程：

```bash
npm run prod:stop
npm run web:login -- deepseek-web
npm run prod:start
```

在登录命令打开的 Chrome 中人工完成登录或验证，确认对话输入区可用后关闭登录浏览器，再启动新的受管后端。新后端进程会清除旧进程中的登录、验证或选择器熔断；只完成网页登录但不重启后端，不视为恢复完成。随后在管理设置中启用“DeepSeek 网页版”，并从问题库运行单个问题或问题集；项目自动监测仍可按计划触发，但品牌项目页不再提供项目级手动运行入口。

第一版仅支持单后端进程、单账号、单页面串行采集和后端所在机器上可用的桌面会话。成功任务结束后浏览器会话继续复用，避免重复登录；浏览器连接、命令或生成超时等异常会关闭并回收当前会话，下一条任务重新启动；后端关闭时也会关闭浏览器。系统不接收账号密码、Cookie 或 Authorization 配置，不自动处理验证码，不调用网页私有接口，也不把 Web 失败转换为 DeepSeek API 结果。详细环境项见 [环境变量](docs/ENVIRONMENT.md)。

市场部内部部署采用共享 `admin`：所有同事访问共同项目和报告，同时也继承现有完整管理员权限，系统无法提供人员级操作审计。共享账号的发放、轮换和离职撤权由公司内部账号流程负责。系统 `admin` 与 DeepSeek 服务账号是两套身份；DeepSeek 凭据只由虚拟机运维负责人在专用 Chrome 中维护。虚拟机不得休眠，远程桌面断开不能销毁图形会话；数据库、专用 profile 和证据目录都必须位于持久磁盘。`/api/ready` 只表示主应用、数据库和调度器就绪，DeepSeek Web 的当前状态以认证接口 `/api/ai-platforms/deepseek-web/runtime-status` 为准。

统一启动前后端：

```bash
npm run dev
```

默认地址：

- 前端登录页：`http://localhost:3001`
- SEO 检测页（登录后）：`http://localhost:3001/geo/seo-audit`
- 浏览器 API：当前前端地址下的 `/api/*`，例如 `http://localhost:3001/api/health`
- 后端内部地址：`http://127.0.0.1:3002`（默认只监听 loopback，只供同机代理和运维检查）
- 后端就绪检查：`http://127.0.0.1:3002/api/ready`（数据库、调度器或首次恢复未就绪时返回 503）

前端显式监听 `0.0.0.0:3001`。局域网其他电脑可直接访问 `http://<服务器局域网IP>:3001`，浏览器仍请求同源 `/api/*`，无需因服务器 IP 变化修改前端代码。

## 常用命令

```bash
npm run dev          # 同时启动后端和 Next.js 前端
npm run dev:backend  # 只启动后端
npm run dev:frontend # 只启动前端
npm run web:login -- deepseek-web # 人工登录或恢复 DeepSeek Web 会话
npm run build        # 构建 Next.js 前端
npm run lint         # 检查 Next.js 前端
```

后端测试：

```bash
cd backend
npm test
```

## 生产部署

内部单机环境可以使用仓库自带的原地部署命令：

```bash
npm run deploy:check
npm run deploy
```

该流程支持 macOS 和 Linux，允许部署期间停机，只保留一份经过完整性检查的 SQLite 最新快照，并使用脱离终端的生产进程。服务器重启或进程崩溃后需要人工执行 `npm run prod:start`。首次接管、失败处理和运行限制见 [单机原地部署](docs/SINGLE_HOST_DEPLOYMENT.md)。

生产环境建议：

- 发布流量前同时检查 `/api/health` 与 `/api/ready`；只有 `/api/ready` 返回 `ready` 才表示数据库并发配置、调度器和首次恢复均已就绪
- 浏览器只访问同源 `/api/*`；Next.js 默认在服务端转发到 `http://127.0.0.1:3002`
- 公网使用 Nginx/Caddy 只开放 80/443，3001/3002 不直接暴露
- 前端和后端也可以分离部署，此时通过 `API_BASE_URL` 指定后端源站并配置 CORS 白名单
- 后端需要运行在支持常驻 Node.js 进程的环境中
- 数据库建议使用外部 Postgres，并通过 `DATABASE_URL` 配置

后端生产环境必须配置强随机 `JWT_SECRET`、`DATABASE_URL` 和实际使用的 AI 平台密钥；前后端分域或非 loopback 代理部署还必须配置生产域名白名单 `ALLOWED_ORIGINS`。不要把真实配置文件、访问令牌、数据库连接串或 API Key 提交到仓库。

更多部署细节见 [部署与运维](docs/DEPLOYMENT.md)。

## 默认账号

- 管理员用户名默认由 `backend/.env` 中的 `DEFAULT_ADMIN_USERNAME` 控制
- 管理员初始密码由 `backend/.env` 中的 `DEFAULT_ADMIN_PASSWORD` 控制
- 生产环境部署后必须立即修改默认管理员密码

不要在 README、Issue、提交记录或聊天记录中公开生产账号、密码、JWT、API Key、数据库连接串等敏感信息。

## 文档

- [文档总览](docs/README.md)
- [接口文档](docs/API.md)
- [环境变量](docs/ENVIRONMENT.md)
- [部署与运维](docs/DEPLOYMENT.md)
- [安全加固说明](docs/SECURITY.md)
- [历史：SEO 检测 MVP 方案与竞品调研](docs/solutions/2026-07-22-seo-audit-mvp.md)
- [全站 SEO 审计实现与验证](docs/solutions/2026-07-23-seo-site-audit.md)
