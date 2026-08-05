# 部署与运维

## 当前正式单机实例

> 本节记录 2026-07-31 域名切换完成时已经验证的生产真值。运行状态会变化；
> 回答“现在是否正常”或“服务器是否最新”前，仍需按本节命令重新检查。

| 项目 | 当前值与边界 |
| --- | --- |
| 唯一支持的公网入口 | `https://insight.guangtuo.com` |
| DNS | `insight.guangtuo.com` 的 A 记录指向 `182.254.140.163` |
| HTTP 域名访问 | `http://insight.guangtuo.com` 由 Nginx 重定向到 HTTPS |
| 直接 IP 访问 | `http://182.254.140.163/` 命中 Nginx 默认站点，不是本应用；HTTPS 直连 IP 存在证书主机名不匹配，也不是支持入口 |
| 已退役域名 | `insight.gato.com.cn`；只可在明确标注日期的历史验收记录中作为历史事实出现 |
| Nginx 活动配置 | `/etc/nginx/sites-available/insight`，80/443 的 `server_name` 均为 `insight.guangtuo.com`，反代到 `127.0.0.1:3001` |
| TLS | Let's Encrypt 证书目录 `/etc/letsencrypt/live/insight.guangtuo.com/`；切换时已通过续期 dry-run |
| 前端生产环境 | `/opt/ai-geo-monitoring/nextjs-frontend/.env.production`：`NEXT_PUBLIC_SITE_URL=https://insight.guangtuo.com`、`API_BASE_URL=http://127.0.0.1:3002` |
| 后端生产环境 | `/opt/ai-geo-monitoring/backend/.env`：`HOST=127.0.0.1`；同机同源代理下 `ALLOWED_ORIGINS` 可留空 |
| 百度 callback | 服务器期望 `https://insight.guangtuo.com/api/admin/marketing/baidu/oauth/callback`；百度开发者控制台也必须登记完全相同的地址 |
| 进程入口 | `ai-geo-backend.service` 与 `ai-geo-frontend.service`；正式服务不从 SSH 或远程桌面手工启动 |
| 当前已验证源码版本 | 2026-08-06 百度 Provider 模块化 Git Bundle 已部署 `2c6a36e4018d36d926a44a1ad2fc8825b7320635`；公开前后端 revision、服务器 `HEAD` 一致且工作区干净。是否仍为最新必须现场比较服务器 `HEAD`、`origin/main` 与工作区状态 |

2026-07-31 切换时，公网首页返回 HTTP 200，`/api/ready` 返回 `ready`，证书校验
通过，两个 systemd 服务均为 `active/running`。该结论是带时间的验收证据，不是
永久健康承诺。重新检查时使用：

```bash
curl -f https://insight.guangtuo.com/
curl -f https://insight.guangtuo.com/api/ready
ssh ubuntu@182.254.140.163 'cd /opt/ai-geo-monitoring && git status --short --branch && git rev-parse HEAD && git rev-parse origin/main'
```

百度开发者控制台中的 callback 属于外部人工配置。截至本次文档收敛，服务器
环境已经切换，但控制台新地址尚未得到人工确认；完成确认前，现有服务器密文
Token 应继续保留，但不得宣称在新域名上重新授权已经通过。

### 2026-08-05 公开运行态复核

- 13:58 CST 再次只读请求三个公网接口：后端和前端 revision 仍一致为 `ba0b1eb3a76ae59847594a7647e68e35eb7bd373`，`/api/ready` 仍为 `ready`，SQLite 仍为 WAL、`busy_timeout_ms=5000`、`synchronous=normal`，scheduler 已启动且没有错误。本次没有重新登录页面或 SSH 服务器。
- 14:35 CST 再次只读查询 GitHub，`origin/main` 已前进到 `98467f07f565db23bf2d87722e175c2b6837a0d4`；本批文档提交前本地 `HEAD=e37b52813ba1b58276653764b64f295389e6967c`。`98467f0` 已推送但尚未部署，`e37b528` 仍只在本地；因此不能把本地提交、GitHub 已推送提交或公开生产 revision 互相混称为“已上线”。

- 13:23 CST，`GET https://insight.guangtuo.com/api/health` 返回 HTTP 200，后端 revision 为 `ba0b1eb3a76ae59847594a7647e68e35eb7bd373`。
- `GET https://insight.guangtuo.com/api/frontend-health` 返回 HTTP 200，前端 revision 与后端一致。
- `GET https://insight.guangtuo.com/api/ready` 返回 `ready`；SQLite 为 WAL、`busy_timeout_ms=5000`、`synchronous=normal`，scheduler 已启动且当次响应没有错误。
- SSH 现场确认服务器 `HEAD` 与公开 revision 一致、工作区变更数为 0；服务器 `origin/main=e2197d453c44073c69a87c80f90c2e5f569ad629` 比 `HEAD` 落后 28 个提交。两个正式 systemd service 分别于 12:17:56 和 12:17:58 CST 启动并保持 `active`，没有从 SSH 或第二套进程启动应用。
- 12:17:50–13:23:46 CST 的 systemd journal、Nginx access/error 和 `logs/deployments.log` 已完成只输出计数的敏感信息审计：Token/JWT、OAuth 敏感参数、邮箱、境内手机号、联系人字段和完整上游响应标识均为零命中；Nginx 活动配置不记录请求体、Authorization 或上游响应体。
- 同一窗口内现役 Dashboard 请求 5 次且全部 HTTP 200，旧营销页面和旧报表路由请求均为 0；生产数据库有 2 次成功 `ON_DEMAND` 刷新。最近一次脱敏 run 在同一 `refresh_run_id` 下同时写入计划 768、单元 1765、关键词 4739、搜索词 748 条，证明正式请求链使用四报告实现且未执行旧 provider、fixture 或 fallback。
- 该 revision 继续包含官网九键来源统计、脱敏咨询、独立广告搜索词下钻和营销 AI 分析路由。官网生产凭据仍未配置，模块保持 `DISABLED`；营销 AI 报告后端尚未实现。代码已部署不能表述为这些数据源或报告能力已生产接通。
- 正式营销进程仍为 `MARKETING_MONITORING_PILOT_MODE=true`。本次日志审计只关闭市场工作台 Issue 016，不表示百度模块已从 `PILOT_DATA_READY` 提升为 `READY`；后者继续由营销监控系统的生产准入需求维护。

### 2026-08-04 Git Bundle 正式发布与验收

- GitHub Actions workflow `30876793311` 的 verify 与 deploy 均成功；校验后的 Git Bundle 把服务器 `main` 快进到 `f265bd365e563e828a82dca51028f3d3d4dc40dc`，没有直接编辑服务器源码。
- 发布前备份为 `/opt/ai-geo-monitoring/backend/releases/database.pre-f265bd365e563e828a82dca51028f3d3d4dc40dc.sqlite`。营销迁移 `001`–`013`、官网迁移 `001`–`003` 和咨询详情审计迁移均已应用且无待执行项。
- `ai-geo-backend.service` 与 `ai-geo-frontend.service` 均由 systemd 正常启动；`/api/ready` 返回 `ready`，SQLite 为 WAL 且 scheduler 已启动；`/api/frontend-health` 返回完整 revision `f265bd365e563e828a82dca51028f3d3d4dc40dc`。
- 登录后的正式关键词页显示“百度推广 · 真实数据 · 数据截至 2026-08-03”，共有 863 条有展现关键词、237 条有点击关键词；页面不再出现“广告关键词数据尚未开放”。广告表现返回消费、展现、点击和严格下钻入口，网站流量返回百度统计访问、UV、PV、质量和页面数据。
- 官网代码与迁移已经部署，但生产 `GATO_WEBSITE_FORM_*` 未配置完整，模块保持 `DISABLED`；53KF 保持 `NOT_CONNECTED`；订单页继续诚实显示销售系统 `UNAVAILABLE`。这三项不是部署失败，也不得用 fixture 或假 API 填充。

### 2026-08-05 百度统一 OAuth A1 正式发布与验收

- 独立 Git Bundle 将服务器只快进到 `e8de9d56619a69b5de98f8bee5e9bc5d42d69e41`，Bundle SHA-256 为 `3c0a3734b755c79d76915a4febc5d1d86e8387bf8ca9b5cef622767e7ded69d1`。最终源码树以原正式 revision `ba0b1eb3a76ae59847594a7647e68e35eb7bd373` 为运行基线，只叠加 003 文档和 A1，不含并行的 0805-002 Flash 工作线。
- A1 前恢复备份为 `/opt/ai-geo-monitoring/backend/releases/database.pre-9789ee096798c9309d649c01d63b4c02b36ec524.sqlite`。营销迁移 `001`–`014` 已应用且无 pending；A1 仓库不存在 015，三个旧统计凭据列仍保留，等待 A2 独立迁移删除。
- `ai-geo-backend.service` 与 `ai-geo-frontend.service` 由正式部署入口启动；公开 `/api/health`、`/api/ready`、`/api/frontend-health` 均成功并返回 A1 revision。服务器工作区干净，服务器的 `origin/main` 只是远端跟踪引用，不作为运行真值。
- 现役连接服务已在服务器内存中完成一次真实 OAuth 刷新，Token 版本从 5 增至 6；刷新后搜索推广账户目录、百度统计站点目录和最小趋势请求均通过，两个产品状态均为当前版本 `VERIFIED`。Token、Cookie、数据库和原始百度响应未复制到本地或写入证据。
- `/usr/bin/google-chrome` 从 `https://insight.guangtuo.com` 验收市场总览、广告表现、关键词、搜索词、网站流量和管理页；页面与营销 API 均为 200。管理页仅展示统一 OAuth 和必要统计用户名，旧统计凭据路由返回 404。服务器截图位于 `output/playwright/a1-production-e8de9d5/`。
- 当前正式路径已经硬切为搜索推广和百度统计共用版本化 Access Context；不存在双 Token fallback。旧数据库列只是 A1 观察期恢复边界，不再有现役代码读写；在 A2 正式发布前不得宣称旧字段已完成不可逆退役。

### 2026-08-05 百度统一 OAuth A2 正式发布与验收

- 独立 A2 Git Bundle 将服务器只快进到 `9be1d7672ee639ceca82ce1428c284e86740054d`，Bundle SHA-256 为 `e3ee9cd548b740845ac772e248a91ba6bb2ea66d12eee4a38c73c045f6a1f15e`，与 A1 的 revision 和 Bundle 明确分离；发布树不含并行的 0805-002 工作。
- 停服前当前 Token 版本 6 再次只读验证搜索推广四类报告与百度统计站点/最小趋势均成功；停服后创建 `/opt/ai-geo-monitoring/backend/releases/database.pre-9be1d7672ee639ceca82ce1428c284e86740054d.sqlite`（权限 600），再以 `--expected-latest=015-drop-legacy-tongji-credentials` 应用迁移。迁移账本 checksum 为 `284173897caac7410509e16a24178884acd6f036538252412b99a516b2b05fee`，无 pending。
- 正式 `baidu_marketing_connections` 已删除 `tongji_account_name`、`tongji_access_token_ciphertext`、`tongji_credential_updated_at` 三列；现役代码、路由、UI 和生产工作树不存在旧统计 Token、旧 service、兼容 fallback 或双 Token 配置。A2 前备份仍保留旧列，仅用于已批准的灾难恢复边界。
- 正式部署通过后端完整回归、营销 190 项、官网 31 项、咨询 35 项、前端 104 项、lint、TypeScript/生产构建 40 路由和 Playwright 40 项。前后端只由 `ai-geo-backend.service` 与 `ai-geo-frontend.service` 运行；公开 `/api/health` 与 `/api/frontend-health` 返回 A2 revision，`/api/ready` 返回 `status=ready`。
- A2 后只读探针仍为 Token 版本 6；搜索推广计划 32、单元 74、关键词 183、搜索词 14，百度统计站点 1、趋势行 1，两个产品均为当前版本 `VERIFIED/HAS_DATA` 且探针前后业务状态不变。探针没有刷新 Token、重新授权、暂停绑定或写业务数据，也未复制 Token、Cookie、数据库或原始响应。
- 生产 Chrome 从 `https://insight.guangtuo.com` 验收市场总览、广告表现、关键词、搜索词、网站流量、咨询、订单和设置页；对应正式 API 状态符合真实连接边界。管理页只有统一 OAuth 和一个非秘密统计用户名输入，零密码输入，两个产品分别显示 `VERIFIED`；截图仅保存在服务器 `output/playwright/a2-production-9be1d76/`。
- A2 对抗式审查当时发现发布器停机顺序、瞬时刷新错误状态和 PostgreSQL 迁移并发门禁需要加固，因此原始 A2 发布后 003 暂时保持 `active`。这些问题随后已由桥接与审查加固发布解决；当前关闭证据以下方最新发布记录为准。

### 2026-08-05 A2 发布桥接正式发布与验收

- 独立桥接 Git Bundle 将服务器快进到 `5d11cbc69f56743f3b0a57d6436d4ec895fb0486`，Bundle SHA-256 为 `5000a653e642879a3eba1612056240a90acf5464d2923929c725167a9923af9a`。该提交只包含 Git Bundle workflow、发布器、systemd 管理器及测试，不含应用运行时、schema 或迁移变化。
- 桥接使后续发布在生产 systemd 服务确认完全停止后才快进服务器工作树；任一服务仍活动、PID 非空、停服部分失败或返回状态畸形时，服务器 `HEAD` 保持不变并停止发布。正式域名健康、ready 与前后端精确 revision 也成为发布门禁。
- 正式部署通过后端完整回归、营销 190 项、官网 31 项、咨询 35 项、前端 104 项、lint、TypeScript/40 路由生产构建和真实 Chrome 40 项；营销迁移 audit 为 001–015 全部应用且无 pending。
- 发布后服务器 `HEAD` 与公开 `/api/health`、`/api/frontend-health` 均为 `5d11cbc69f56743f3b0a57d6436d4ec895fb0486`，`/api/ready` 为 `ready`；两个正式 systemd 单元各只有一个主进程。下一业务发布将首次由这套桥接后的 launcher 执行“停服确认 → 快进 → 测试/迁移 → 启动/正式域名验收”。
- OAuth 瞬时刷新冷却、主体不一致终态、PostgreSQL 015 锁与管理页晚到请求隔离仍只在后续候选中，本桥接发布不代表这些运行时加固已上线。

### 2026-08-05 A2 审查加固正式发布与验收

- 正式 Git Bundle 将服务器从发布桥接 revision 快进到 `58469e29214ccc28e989f07d54af873d9c0ba801`，Bundle SHA-256 为 `f7de3d0af29fd6540a3fa3c8d1390660b2a9336367afd8ea7834945adf124e91`；桥接后的 launcher 先确认两个 systemd 服务完全停止，再快进工作树和执行候选部署器。备份为 `/opt/ai-geo-monitoring/backend/releases/database.pre-58469e29214ccc28e989f07d54af873d9c0ba801.sqlite`。
- 正式部署通过后端完整回归 994 项、营销 200 项、官网 31 项、咨询 35 项、前端 104 项、lint、TypeScript/40 路由生产构建和真实 Chrome 41 项。营销迁移 `001`–`015` 全部应用且无 pending，三个旧统计凭据列仍为零。
- 发布后服务器 `HEAD`、公开 `/api/health` 与 `/api/frontend-health` 均精确为 `58469e29214ccc28e989f07d54af873d9c0ba801`，工作区干净，`/api/ready` 为 `ready`；`ai-geo-backend.service` 与 `ai-geo-frontend.service` 各只有一个主进程。
- 生产只读探针在 Token 版本 6 上再次返回搜索推广计划 32、单元 74、关键词 183、搜索词 14，以及百度统计站点 1、趋势行 1；两个产品均为 `VERIFIED/HAS_DATA`，前后业务状态为 `UNCHANGED`，未刷新 Token、重新授权、暂停绑定或写业务数据。
- `/usr/bin/google-chrome` 从唯一正式域名验收市场总览、广告表现、关键词、搜索词、网站流量、咨询、订单和管理设置页。八个入口均为 200；管理页分别显示两个 `VERIFIED`，更新弹窗只有一个非秘密用户名文本框、零密码框和统一 OAuth 说明。截图仅保存在服务器 `output/playwright/a2-hardening-production-58469e2/`。
- 当前正式路径已使用统一 Access Context、刷新租约与冷却、绑定验证上下文栅栏和管理页晚到请求隔离；旧统计 Token、旧路由、旧 service、fallback、feature flag 和现役双 Token 文档均不存在。003 已满足关闭条件，下一实施门禁为 006。

### 2026-08-06 营销 API 资源化 R1 正式发布与验收

- 初始 R1 候选 `c65f6c6e30c193a6ec978b3552a3911a4e5f5499` 发布后，生产核验发现搜索词页仍从完整 Dashboard 明细数组解析下钻身份，因此没有把该候选作为 R1 关闭版本。修正提交 `d5695402d9b39c0ce04108bc36b6d4aa02daac13` 已用独立完整 Git Bundle 正式快进发布，Bundle SHA-256 为 `a4577c12ca84996417878cacc8fff5e76d3bf3a42d19ce109b042897aa62d513`；未混入并行的 0805-002 工作，也没有直接编辑服务器源码。
- 发布前备份为 `/opt/ai-geo-monitoring/backend/releases/database.pre-d5695402d9b39c0ce04108bc36b6d4aa02daac13.sqlite`，权限 `600`。正式部署通过后端 994 项、营销 210 项、官网 31 项、咨询 35 项、前端 104 项、lint、TypeScript/40 路由生产构建和单 worker Chrome 45 项；营销迁移 `001`–`015` 全部应用且无 pending。
- 发布后服务器 `HEAD`、公开 `/api/health` 与 `/api/frontend-health` 均精确为 `d5695402d9b39c0ce04108bc36b6d4aa02daac13`，`/api/ready` 为 `ready`，服务器工作区干净；`ai-geo-backend.service` 和 `ai-geo-frontend.service` 各只有一个活动主进程。部署器已删除上传 Bundle。
- `/usr/bin/google-chrome` 从唯一支持域名验收市场总览、广告表现、关键词、关键词下钻搜索词和全量搜索词。详情资源全部携带并回显同一 opaque revision，分页分别为关键词 10/10、搜索词本期 20/20、上期 1/1；截图只保存在服务器 `output/playwright/r1-production-d569540/`。市场总览中官网表单模块按既有生产配置保持 `DISABLED/503`，没有被营销 fallback 或 fixture 掩盖。
- 当前正式路径为：市场总览继续读取完整 Dashboard 根；广告表现、关键词和搜索词先读取同一根 revision，再分别调用 `/ad-hierarchy`、`/keywords` 和本期/上期 `/search-terms`。三个详情 hook/page 已不读取 Dashboard 四个明细数组；关键词下钻通过账户、计划、单元和关键词名称事实元组稳定消歧，不向搜索词伪造 `keywordId`。
- R1 仍按 additive 边界保留 Dashboard 四个旧数组和旧 adapter/测试，以便市场总览在 R2 前继续运行；它们不是详情页 fallback。轻量 Dashboard 硬切、旧数组与兼容代码删除必须由后续独立 R2 Bundle 完成，当前不得把 R1 描述为旧合同已退役。

### 2026-08-06 营销 API 资源化 R2 正式发布与验收

- 独立 R2 Git Bundle 将服务器从 R1 `d5695402d9b39c0ce04108bc36b6d4aa02daac13` 快进到 `d9b0688e28ba9b3a33fcfb061fe7d7235388ec22`，Bundle SHA-256 为 `be6bee67cc62fb4d17c27de5742ea3a88a23808aaf12b94f53fa28f690aca1b4`。发布树不含并行 0805-002 工作；正式部署器先确认两个 systemd 服务停止，再创建 `/opt/ai-geo-monitoring/backend/releases/database.pre-d9b0688e28ba9b3a33fcfb061fe7d7235388ec22.sqlite`、快进、验证、迁移、构建和重启，最后删除上传 Bundle。
- 迁移 `016-revisioned-ad-snapshot-facts` 已应用并复审无 pending；四张广告事实表以 `refresh_run_id` 区分 revision，当前与上一成功 revision 保留事实，生产账本观测到两个 `SUCCEEDED/retained` revision。关键词和搜索词查询计划均命中各自 `refresh_run_id` 索引。
- 正式部署通过后端完整回归 994 项、营销 219 项、官网 31 项、咨询 35 项、前端 104 项、lint、TypeScript/40 路由生产构建和真实 Chrome 45 项。发布后服务器 `HEAD`、公开 `/api/health` 与 `/api/frontend-health` 均为 R2 revision，`/api/ready` 为 `ready`，工作区干净；两个 systemd 单元各只有一个活动主进程。
- 正式 Dashboard 解码响应为 2,869 B，schema 为 `marketing_dashboard_v2`，不再含 `campaigns`、`adGroups`、`keywords`、`searchTerms`。三个详情资源与 Dashboard 回显相同 revision、日期与来源；层级响应 889,563 B，关键词第一页 50/921、67,692 B，搜索词第一页 50/345、39,271 B，分页均未超过 page size，详情响应均包含 `Vary: Authorization`。
- 30 次正式 HTTPS 采样 P95：Dashboard 47.61 ms、广告层级 181.04 ms、关键词 140.26 ms、搜索词 54.05 ms。相比 R1 完整 Dashboard 的 1,061,845 B，市场总览根响应降低到 2,869 B；各详情页只组合轻量根与自己的资源，不再传输完整四数组。
- `/usr/bin/google-chrome` 从 `https://insight.guangtuo.com` 打开市场总览、广告表现、广告关键词和全量广告搜索词；四页正式根节点与表格均可见，营销请求均为 200。Network 分别使用 Dashboard、`ad-hierarchy`、`keywords`、`search-terms`，没有 `view/includeDetails` 兼容查询，也没有浏览器直连百度。
- 生产观察窗记录 140 次结构化广告读取成功、0 次失败、0 个秘密标记、0 个服务错误；Nginx 记录 Dashboard 39、层级 33、关键词 33、搜索词 37 次请求，旧兼容查询为 0。当前正式默认路径已经硬切轻量 Dashboard + 三个 revision 钉扎资源；旧四数组、adapter、fallback、测试和现役文档已经删除，不存在长期 API 双版本。
- 预验证后代恢复 revision 为 `c167453568cf9dd27fda442529b424f2a5fc5963`，Bundle SHA-256 为 `63eff4e357802d97309efe4a1b6fa734fa0da3d60b66e8ceb35e3ff8dab1e42e`。该版本永久保留迁移 016、checksum 与部署最高迁移，只恢复完整 R1 运行合同；仅在 R2 阻断失败时允许继续快进，恢复后不得关闭 006，必须修复 R2 并重复正式 Network、响应预算、日志和浏览器门禁。本次 R2 验收未触发恢复。

### 2026-08-06 营销生产数据正确性正式发布与验收

- Git Bundle 将服务器从 R2 `d9b0688e28ba9b3a33fcfb061fe7d7235388ec22` 快进到 `17214184f9c0ec2c9508080cb571f6b8b45923c4`，SHA-256 为 `37ccf67d5aff553c9030dc23a2e72d26ea1a6c2e2c436b0209eb5c6b37366ef7`；远端 `refs/heads/feature/marketing-003-006-007-005` 精确包含该 revision。发布树未包含并行 0805-002 工作；正式部署入口停服、备份、快进、验证、迁移、构建、启动并删除上传 Bundle，没有直接编辑服务器源码。
- 部署通过后端 994 项、营销 231 项、官网 31 项、咨询 35 项、前端 123 项、lint、TypeScript、40 路由生产构建和真实 Chrome 56 项；营销迁移 `001`–`016` 全部 applied 且无 pending。发布后服务器 `main/HEAD`、公开 `/api/health` 与 `/api/frontend-health` 都为目标 revision，工作区干净，`/api/ready` 为 ready；两个正式 systemd 单元各一个 MainPID，warning 日志为空。
- 正式 Chrome 打开市场总览、广告表现、关键词、全量搜索词和网站流量。广告层级、关键词、搜索词的 current/previous 请求均为 200，本期 `2026-07-30` 至 `2026-08-05`、上期 `2026-07-23` 至 `2026-07-29`，三组都等长相邻且分别共用同一快照 revision、`CNY` 与 `costScale=2`。
- 网站流量在生产当次缺少可靠全站访问分母时返回 `PARTIAL / SOURCE_TOTAL_UNAVAILABLE`，总访问与 residual 保持 `null`，页面没有把已分类合计伪造成总量或渠道。入口页同路径组在刷新、切换升序、分页和 `390×844` 响应式操作中保持合法稳定 ordinal；历史 `83/82 → PARTIAL` 由脱敏生产形状合同与 Chrome 回归覆盖，不通过修改生产范围或猜测来源制造该样本。
- 浏览器中的营销响应全部成功；唯一 503 是既有 `DISABLED` 官网区间/逐日接口。咨询页继续显示官网模块不可用和 53KF 未完成，订单页继续显示销售系统未接入，线索/成交依赖指标保持缺失；营销 AI 正式页明确未启用且不会读取来源数据。营销正确性路径没有新增旧 Dashboard fallback、第二套 API 或隐藏 feature flag。
- 验收使用仅存在于服务器进程和浏览器内存的短期应用 JWT，未输出、落盘或复制 Cookie/Token；它验证正式前端、API、鉴权和生产数据，但不把密码登录流程描述为本次验收范围。完整证据见[007 Issue 006](closed-2026-08-05-007-marketing-production-data-correctness/issues/006-release-and-verify-production-correctness.md)。

### 2026-08-06 百度 Provider 模块化正式硬切与验收

- 正式 Git Bundle 将服务器从正确性 revision `17214184f9c0ec2c9508080cb571f6b8b45923c4` 快进到 `2c6a36e4018d36d926a44a1ad2fc8825b7320635`，SHA-256 为 `ce76b5515a575d3386701d65ea31ae87e98aba46d16d9799e760557f4172cf1a`。部署器完成 Bundle 校验、停服、`database.pre-2c6a36e4018d36d926a44a1ad2fc8825b7320635.sqlite` 备份、快进、测试、迁移、构建、systemd 启动与上传 Bundle 删除；发布树没有并行 0805-002 工作，也没有直接编辑服务器源码。
- 部署通过后端 994 项、营销 243 项、官网 31 项、咨询 35 项、前端 123 项、lint、TypeScript、40 路由生产构建和真实 Chrome 56 项；营销迁移 001–016 全 applied 且无 pending。服务器 `main/HEAD`、公开 `/api/health` 与 `/api/frontend-health` 都为目标 revision，工作区干净、部署锁不存在，`/api/ready` 为 ready；两个正式 systemd 单元各一个 MainPID。
- 当前唯一 Provider 路径是 `backend/modules/marketing/index.js → BaiduMarketingClient facade → {BaiduOAuthClient, BaiduSearchAdsClient, BaiduTongjiClient} → 同一 BaiduHttpKernel`。composition root、公开 facade、API、数据库和页面合同未变；旧 facade 内的单体产品逻辑、重复 transport/allowlist、双 Provider、feature flag 和 runtime fallback 均不存在。
- 生产只读统一 OAuth 探针在 Token 版本 6 上以同一 Access Context 验证推广计划 32、单元 74、关键词 183、搜索词 14，以及百度统计站点 1、趋势 1；两个产品均为 `VERIFIED/HAS_DATA`，前后状态 `UNCHANGED`。扩展只读探针进一步验证站点 5、趋势 1、质量 1、全来源 5、搜索引擎 4、入口页 27、受访页 46，前后状态仍为 `UNCHANGED`；探针未刷新 Token、写缓存或复制敏感响应。
- 正式 API 手动刷新返回 `202 → SUCCEEDED`，覆盖 `2026-07-07` 至 `2026-08-05`。轻量 Dashboard 和三个详情资源全部 200 并钉扎同一 revision；关键词 921、搜索词 345。数据库只读审计确认成功运行序号 55 的四张事实表分别有 766、1757、4662、706 条日事实，全部只关联同一个保留的 `refresh_run_id`。
- `/usr/bin/google-chrome` 从唯一支持域名打开市场总览、广告表现、关键词、全量搜索词、网站流量、咨询和订单；七页文档与目标根节点均为 200，无页面异常或登录回退。百度营销、百度统计和默认项目 API 全部 200；官网表单四个 503 继续准确反映既有 `DISABLED` 配置，不是 Provider 回归。
- 目标 revision 发布后的 117 行服务日志中，错误模式、秘密模式、刷新失败和旧 Provider/fallback 模式均为 0。若后续发生阻断性回归，只允许创建后代 revert revision 并用正式 Git Bundle 快进恢复；本次无 schema 变化，不恢复数据库，也不增加隐藏旧路径。完整证据见[005 Issue 005](closed-2026-08-05-005-baidu-provider-modularization/issues/005-production-hard-cut-and-equivalence-closeout.md)。

## 前提条件
- 已安装 `Node.js >= 20.9` 与 `npm >= 9`
- 服务器具备 Nginx 或其他反向代理能力
- 已准备域名与证书（建议启用 HTTPS）

## Vercel 部署
- 前端可以部署到 Vercel，Root Directory 选择 `nextjs-frontend`。
- 后端当前是常驻 Express 服务并依赖 SQLite/定时任务，不建议直接部署为 Vercel Serverless Function。
- Vercel 前端通过 `API_BASE_URL` 反代到外部后端，详细步骤见 [Vercel 部署](VERCEL.md)。

## 环境变量与配置
- 本地开发可先复制模板：
  ```bash
  cp backend/.env.example backend/.env
  cp nextjs-frontend/.env.example nextjs-frontend/.env.local
  ```
- 在服务器创建 `backend/.env` 并设置关键变量（示例）：
  ```bash
  HOST=127.0.0.1
  PORT=3002
  NODE_ENV=production
  JWT_SECRET=<强随机值，至少32字符>
  # 同机 loopback 代理不依赖此项；分域或非 loopback 代理时必须填写
  ALLOWED_ORIGINS=https://example.com,https://www.example.com

  # 生产禁止启动期创建默认管理员；账号必须走受控的现有用户管理流程
  DEFAULT_ADMIN_BOOTSTRAP_ENABLED=false

  # 用于加密数据库中的 AI 平台密钥（32 字节 Base64 或 64 位十六进制）
  CONFIG_ENCRYPTION_KEY=<加密主密钥>

  # 内部部署可设为 true；公网或存在不可信账号时必须保持 false
  SEO_AUDIT_ALLOW_PRIVATE_TARGETS=false

  # 可选代理
  HTTPS_PROXY=http://proxy.example.com:8080
  ```
- 在 `nextjs-frontend/.env.production` 中设置前端构建变量（示例）：
  ```bash
  NEXT_PUBLIC_SITE_URL=https://example.com
  API_BASE_URL=http://127.0.0.1:3002
  ```
- **重要**：
  - `JWT_SECRET` 必须使用强随机值（建议使用 `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` 生成）
  - 浏览器始终请求同源 `/api/*`，不得把 `127.0.0.1:3002` 或服务器 IP 写进客户端环境变量
  - `API_BASE_URL` 是 Next.js 服务端代理目标；同机部署保持 `http://127.0.0.1:3002`
  - `HOST=127.0.0.1` 让 Express 不接受局域网或公网直连；代理位于另一个容器或另一台机器时才改为 `0.0.0.0`，并同时使用私有网络、防火墙和 `ALLOWED_ORIGINS`
  - `ALLOWED_ORIGINS` 用于前后端分域、非 loopback 代理或直接跨域调试，多个域名用逗号分隔
  - SEO 检测请求由后端服务器发出；`localhost` 指后端服务器。内部环境如需检测本机或局域网站点，可将 `SEO_AUDIT_ALLOW_PRIVATE_TARGETS=true`，重启后直接填写目标局域网 URL，无需维护逐 IP 白名单
  - 开启私网检测后，公开自助注册会自动关闭；内部账号由现有用户管理入口创建，不需要增加管理员/普通用户的检测权限分层
  - 私网检测是一项受控 SSRF 能力：所有登录用户都能请求后端可达的普通 Web 服务，因此公网部署、存在外部账号或内网含敏感 HTTP 管理面时必须关闭
  - 生产必须设置 `DEFAULT_ADMIN_BOOTSTRAP_ENABLED=false` 和 `DEMO_USER_ENABLED=false`；不得依赖公开默认管理员账号
- 生产建议配置 `DATABASE_URL` 使用托管 Postgres（如 Supabase）。未配置时会使用 SQLite（`backend/config/database.js`，默认 `database.sqlite`）。

## 构建与运行（生产）

- Ubuntu 正式环境固定使用仓库 `deploy/systemd/` 中的 `ai-geo-backend.service` 和 `ai-geo-frontend.service`，不使用 PM2 或 Docker。
- 两个 systemd 服务都以 `ubuntu` 普通用户运行；前端只监听 `127.0.0.1:3001`，后端监听 `127.0.0.1:3002`。
- 安装 unit、启用开机启动和首次切换见 [单机原地部署](SINGLE_HOST_DEPLOYMENT.md)。
- 日常正式发布由 `.github/workflows/deploy-production.yml` 上传已校验 Git Bundle；服务器无需访问 GitHub。Bundle 快进完成后复用部署脚本，并在 `AI_GEO_PROCESS_MANAGER=systemd` 时通过 systemd 停止、启动和验证服务。完整配置与人工引导步骤见[单机原地部署](SINGLE_HOST_DEPLOYMENT.md)。
- 查看状态与日志：

```bash
npm run prod:status
systemctl status ai-geo-backend.service ai-geo-frontend.service
journalctl -u ai-geo-backend.service -u ai-geo-frontend.service
```

## Nginx 反向代理示例
- 单域部署（前后端同域，避免跨域）：
  - 假设 Next.js 前端在本机 `http://127.0.0.1:3001`，后端在本机 `http://127.0.0.1:3002`
```
server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com;

    # SSL 证书配置（示例）
    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    # 后端 API 反代（保持 /api 前缀）
    location /api/ {
        proxy_pass http://127.0.0.1:3002/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_http_version 1.1;

        # SSE 建议关闭缓冲并延长超时
        proxy_buffering off;
        proxy_read_timeout 1h;
    }

    # Next.js 前端
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## 验证与健康检查
- 存活检查：`GET https://<你的域名>/api/health`，只表示 HTTP 进程存活。
- 就绪检查：`GET https://<你的域名>/api/ready`。只有返回 `200` 且 `status=ready` 才能接入流量；SQLite 部署还必须显示 `journal_mode=wal`、`busy_timeout_ms>=5000`、`synchronous=normal`，并确认 scheduler 已启动且首次 recovery 无错误。
- 问题集可靠性迁移前先生成可恢复的数据库备份并执行 `PRAGMA quick_check`；迁移后运行 `cd backend && npm run audit:run-ownership`，确认新运行无悬空归属、重复槽位或完整性错误。未完成生产迁移和回滚确认时不得把需求标记为已关闭。
- AI 平台配置：管理员登录 `/admin/settings`，人工填写 API Key 和供应商明确支持的模型请求参数，再分别执行“测试连接”和“检测联网能力”。腾讯混元还需先在 TokenHub“工具管理”领取联网搜索免费资源包或开通后付费；普通对话成功但没有 `search_results` 时仍是“证据不足”
- 登录验证：使用已由受控用户管理流程创建的管理员账号，不启用启动期默认管理员 bootstrap
- 当前正式实例只通过 `https://insight.guangtuo.com` 验收；不要用直接 IP 的默认
  Nginx 页面替代域名、TLS 和 Host 路由检查。

### 营销模块发布顺序

1. 先完成数据库备份。
2. 执行 `cd backend && npm run migrate:marketing`。
3. 执行 `cd backend && npm run audit:marketing`，确认当前仓库列出的全部版本均已应用且无 checksum 漂移。
4. 保持 `MARKETING_MONITORING_ENABLED=false` 启动并回归 GEO/SEO。
5. 用公网域名检查 `GET /api/health`、`GET /api/ready`，再确认禁用状态的 callback 空请求返回营销模块 503 而不是 404；反向代理不得记录 callback query。
6. 新建本项目专用百度应用，把完整 HTTPS callback 登记为 `https://<域名>/api/admin/marketing/baidu/oauth/callback`，审核通过后取得 `appId`、`secretKey` 和授权链接中的只读 `scope`。
7. 配置 `MARKETING_MONITORING_ENABLED=true`、`MARKETING_MONITORING_PILOT_MODE=true`、试点项目白名单和 `baidu-marketing-docs-2026-07-30`，启动后确认营销状态为 `PILOT_READY`，callback 空请求返回 `OAUTH_CALLBACK_INVALID`。
8. 完成百度营销 dev2 OAuth 后，在设置中心另行填写百度统计“数据 API”页面签发的商业账号账户名与 Token；保存前系统必须用它实时读取站点目录，验证失败不得落库。两套 Token 属于不同授权体系，不得相互替代。
9. 确认搜索账户和百度统计站点目录后，部署包含脱敏 fixture 的代码，再把契约切到 `baidu-marketing-pilot-2026-07-30`；状态必须为 `PILOT_DATA_READY`。管理员必须把项目明确绑定到选定的搜索账户与百度统计站点，运行时不得按“唯一活动站点”自动猜测。
10. 百度营销 Access/Refresh Token 和百度统计 Data API Token 都只保留在服务器数据库密文中，不复制到 Git；本地解析、回归和异常测试只使用脱敏 fixture。临时人工联调文件必须被 Git 忽略并限制为仅当前用户可读。
11. 补全金额、时区、错误与 refresh 轮换证据；新增零 blocker 的 `VERIFIED` 清单后再关闭试点模式。
12. 生产验收未完成前不扩大项目白名单；百度不可达不得影响全局 readiness 或旧搜索快照读取。

故障时同时把 `MARKETING_MONITORING_ENABLED` 和 `MARKETING_MONITORING_PILOT_MODE` 恢复为 `false`。若 Token 或主密钥疑似泄露，先阻断连接并在百度控制台撤权，清除本地 Token，轮换应用 Secret 与 `CONFIG_ENCRYPTION_KEY`，然后逐连接重新授权；不得恢复任何旧营销实现或隐式 fallback。

### 官网表单模块发布顺序

官网模块与百度营销模块分别迁移、启停和验收；不得把官网迁移加入 `marketing_schema_migrations`。标准 `npm run deploy` 会在营销迁移复审后单独执行官网数据迁移。

1. 保持 `GATO_WEBSITE_FORM_ENABLED=false`，先执行 `cd backend && npm run migrate:website-data`。
2. 执行 `cd backend && npm run audit:website-data`，确认仓库现列 `001` 至 `003` 全部应用到 `website_data_schema_migrations` 且 checksum 无漂移；再执行 `npm run audit:consultation-records`，确认咨询详情审计迁移已应用且 checksum 无漂移。
3. 由部署环境注入官网只读服务身份；不得把账号、密码或官网 JWT 写入 Git、部署日志或前端。共享管理员身份只允许短期试点。
4. 配置官网模块开关、固定官网根地址、唯一项目 ID、超时和缓存 TTL；先检查 `GET /api/website-data/status` 返回 `READY`。
5. 以有权访问该项目的 GoodieAI 用户分别请求区间接口 `GET /api/website-data/projects/:projectId/form-consultations?from=YYYY-MM-DD&to=YYYY-MM-DD` 和最长 31 日的逐日接口 `GET /api/website-data/projects/:projectId/form-consultation-days?from=YYYY-MM-DD&to=YYYY-MM-DD`。确认两者的 `sourceSystem=GATO_WEBSITE`、`consultationType=WEBSITE_FORM`、`dataCoverage=ALL_FORM_RECORDS`，逐日合计等于同区间汇总，九键合计等于 `summary.formConsultationRecords`，且响应不包含联系人、原始 URL、官网流量或 53KF 字段。
6. 从正式首页和咨询页确认表单总数、来源分布使用同一合同：有有效必应 `referrer` 的记录进入 `BING_SEARCH`，其他搜索引擎和外部引荐按严格主机规则分类，缺少可信来源证据的全部进入 `UNKNOWN`，不得丢弃。
7. 官网接口故障时只允许回退相同项目、相同日期范围的最后成功聚合快照，不得影响百度 API 或全局 `/api/ready`。需要停用时仅设置 `GATO_WEBSITE_FORM_ENABLED=false`，不要回滚百度模块。

## 安全与合规建议
- ⚠️ **JWT_SECRET 必须设置为强随机值**（至少32字符），使用默认值会导致严重安全风险
- ⚠️ **生产禁用默认管理员 bootstrap 和 demo 用户；管理员账号通过受控用户管理流程创建与轮换**
- ⚠️ 分域或非 loopback 代理部署时，**设置 ALLOWED_ORIGINS** 为实际使用的域名，不要使用通配符
- ⚠️ 防火墙只向公网开放 80/443；3002 默认只监听本机，3001 仅供反向代理或受控内网使用
- ⚠️ 启用 HTTPS（Nginx/TLS），并配置有效的 SSL 证书
- ✅ 系统已包含以下安全措施：
  - Helmet 安全头中间件（自动添加安全相关 HTTP 头）
  - 速率限制（通用 API 500次/15分钟，定时任务 API 1000次/15分钟，登录 5次/15分钟）
  - 请求体大小限制（1MB）防止 DoS 攻击
  - CORS 信任同机 loopback 代理；其他跨域访问仅允许显式配置的域名
  - 完整的认证授权（所有 API 都需要身份验证）
  - 所有权验证（用户只能访问自己的数据）
  - 会员过期自动降级
  - 配额原子操作（防止竞态条件）
- 如需前后端分域部署，必须在 `.env` 中配置 `ALLOWED_ORIGINS`
- 建议配置 WAF（如 Cloudflare、AWS WAF）提供额外防护
- 定期更新依赖包：`npm audit fix`

## 常见问题排查
- API Key 未配置：管理员进入 `/admin/settings` 的“AI 平台”页签人工填写；平台配置不会从 `.env` 导入
- 联网能力显示“证据不足”：说明模型调用成功，但供应商协议没有返回可验证的搜索证据，或当前没有配置官方强制联网参数；腾讯混元应检查 TokenHub“工具管理”的联网搜索资源，其他平台不要据此擅自复制混元参数
- 429/网络错误：后端已包含重试与代理支持，设置 `HTTPS_PROXY`/`HTTP_PROXY` 即可
- SSE 推流中断：检查 Nginx `proxy_buffering off` 与 `proxy_read_timeout` 配置
- CORS 错误：同机部署先确认 `API_BASE_URL=http://127.0.0.1:3002`；分域或容器代理再检查 `ALLOWED_ORIGINS`
- 认证失败（401）：确保请求头包含 `Authorization: Bearer <token>`
- 权限不足（403）：检查用户是否有权访问该资源（用户只能访问自己的数据）
- 速率限制（429）：默认限制通用 API 500次/15分钟，定时任务 API 1000次/15分钟，登录 5次/15分钟
- JWT 配置错误：确保 `JWT_SECRET` 已设置为强随机值

## 进程管理

正式 unit 以仓库文件为唯一模板，不在服务器手写第二份：

- `deploy/systemd/ai-geo-backend.service`
- `deploy/systemd/ai-geo-frontend.service`

修改 unit 后先执行 `systemd-analyze verify`，再执行 `systemctl daemon-reload` 和受控重启。不得通过 PM2、`nohup`、旧 PID 文件或另一套 Node 命令提供静默 fallback。
