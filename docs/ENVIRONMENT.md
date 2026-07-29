# 环境变量与敏感信息

> ⚠️ **部署级敏感值放在 `backend/.env`，不要提交到仓库；AI 平台 API Key 由管理员在设置中心填写并加密入库。**

## 创建本地配置

从模板复制本地配置文件：

```bash
cp backend/.env.example backend/.env
cp nextjs-frontend/.env.example nextjs-frontend/.env.local
```

然后编辑 `backend/.env`，至少填写：

- `JWT_SECRET`
- `DEFAULT_ADMIN_PASSWORD`
- `CONFIG_ENCRYPTION_KEY`

本地开发可在 `backend/` 目录执行以下命令生成本机专用主密钥。命令不会回显密钥，并会把 `.env` 权限收紧为仅当前用户可读写：

```bash
npm run setup:local-key
```

生产环境不要依赖该本地命令，应由部署系统安全注入并备份稳定的 `CONFIG_ENCRYPTION_KEY`。

真实 `.env` 文件已被 `.gitignore` 忽略，模板文件 `.env.example` 可以提交。

## 基本
- `HOST` 后端监听地址，默认 `127.0.0.1`，同机 Next.js/Nginx 代理无需修改；只有容器或跨机器私网代理才显式设置 `0.0.0.0`
- `PORT` 后端服务端口，开发环境当前使用 `3002`；代码默认值为 `3000`
- `NODE_ENV` 运行环境（`development`/`production`）
- `JWT_SECRET` **用户登录令牌签名密钥（必须设置强随机值，至少32字符）**

## 安全配置
- `ALLOWED_ORIGINS` CORS 允许的域名列表，逗号分隔
  - 浏览器通过同机 Next.js/Nginx 代理访问时，后端按 TCP loopback 信任代理请求，不依赖访问者使用的局域网 IP
  - 前后端分域、代理运行在容器网络或需要直接跨域访问后端时，必须显式列出实际前端域名
  - 本地直接跨端口调试可包含：`http://localhost:3001,http://127.0.0.1:3001`
  - 生产示例：`https://example.com,https://www.example.com`

## 管理员初始化
- `DEFAULT_ADMIN_USERNAME` 默认管理员用户名（用于初始化 `id=1` 用户）
- `DEFAULT_ADMIN_EMAIL` 默认管理员邮箱
- `DEFAULT_ADMIN_PASSWORD` 默认管理员密码（仅用于初始化，**部署后必须立即修改**）

## 会员与设置
- `DEFAULT_MEMBERSHIP_LEVEL` 默认会员等级（`free`/`pro`/`enterprise`），初始化设置表时使用
- `QUOTA_LOW_THRESHOLD` 配额低阈值（0-1之间的小数），用于通知提示

## AI 平台
- `CONFIG_ENCRYPTION_KEY`：AI 平台 API Key 的数据库加密主密钥；必须是 32 字节 Base64 或 64 位十六进制值。
- `AI_PLATFORM_PRIVATE_HOST_ALLOWLIST`：可选，允许访问私网 AI 服务的精确 `host:port` 白名单，多个值用逗号分隔。
- 代理（可选）：`HTTPS_PROXY` 或 `HTTP_PROXY` 或 `PROXY_URL`

平台名称、Base URL、默认模型和 API Key 不再使用环境变量。管理员必须在 `/admin/settings` 的“AI 平台”页签人工配置；正式运行没有 `.env` 平台密钥回退。

### 受管 Web 本机会话

DeepSeek Web 与豆包 Web 分别使用真实、headed Chrome 和独立持久 profile。正式环境首次使用，或登录、验证、账号切换和选择器类故障恢复时，在虚拟机的持久桌面会话中按平台执行完整流程：

```bash
npm run prod:stop
npm run web:login -- <deepseek-web|doubao-web>
npm run prod:start
```

登录、验证码和其他人工验证全部在登录命令打开的 Chrome 中由运行后端机器的管理员完成；确认输入区可用后必须关闭登录浏览器，再执行 `prod:start`。新后端进程会清除旧进程内的登录、验证或选择器熔断；只完成网页登录但不重启后端，不视为恢复完成。系统不接受 Cookie、Authorization、账号或密码配置，也不会自动绕过验证。

正式项目、问题集和项目自动监测使用平台注册表中的独立 FIFO：同平台串行，`deepseek-web` 与 `doubao-web` 可并行。Web 失败只记录对应错误，不会回退到同品牌 API。

- `DEEPSEEK_WEB_CHROME_EXECUTABLE`：可选 Chrome 可执行文件；未设置时自动检查受支持的本机安装路径。
- `DEEPSEEK_WEB_PROFILE_DIR`：可选专用 profile，默认 `backend/.runtime/deepseek-web/profile`；不能指向日常 Chrome 或仓库受版本控制目录。
- `DEEPSEEK_WEB_EVIDENCE_DIR`：可选证据目录，默认 `backend/.runtime/deepseek-web/evidence`。
- `DEEPSEEK_WEB_TIMEOUT_SECONDS`：可选交互超时，允许 30–600 秒，默认 180 秒。
- `DOUBAO_WEB_CHROME_EXECUTABLE`：可选豆包专用 Chrome 可执行文件；未设置时使用相同的受支持本机路径探测。
- `DOUBAO_WEB_PROFILE_DIR`：可选豆包专用 profile，默认 `backend/.runtime/doubao-web/profile`；不得与 DeepSeek Web、日常 Chrome 或其他后端实例共用。
- `DOUBAO_WEB_EVIDENCE_DIR`：可选豆包证据目录，默认 `backend/.runtime/doubao-web/evidence`。
- `DOUBAO_WEB_TIMEOUT_SECONDS`：可选豆包交互超时，允许 30–600 秒，普通模式默认 600 秒；计时从问题发送后开始，避免将供应商较慢的真实联网搜索误判为失败。

`.runtime/` 已被版本控制忽略。profile 目录权限会收紧为 `0700`，同一时刻只允许后端或登录命令中的一个进程持有；冲突会返回 `web_profile_in_use`。

生产环境覆盖的数据库、两个平台的 Profile 和证据目录都必须位于持久磁盘。后端必须从持续存在的图形桌面会话启动；虚拟机不得休眠，远程桌面断开不能销毁该会话。两个 Profile 彼此独立，也不得与日常 Chrome、SEO 渲染浏览器或另一套后端共用。全新安装默认启用两个 Web 预置，但默认启用不等于登录有效或目标机器已经验收；正式运行仍由实时预检决定。

## 数据库
- `DB_STORAGE` SQLite 数据库文件路径（默认：`database.sqlite`）
- `DATABASE_URL` Postgres 连接串；生产环境配置后会优先使用 Supabase/Postgres
- 未配置 `DATABASE_URL` 时，后端继续使用 SQLite（默认 `database.sqlite`），已在 `.gitignore` 忽略

## 营销监控（默认关闭）

- `MARKETING_MONITORING_ENABLED`：只有真实百度搜索推广契约和生产门禁完成后才可设为 `true`。
- `MARKETING_MONITORING_ALLOWED_PROJECT_IDS`：试点项目 ID 逗号列表；正式扩大范围需显式设为 `*`。
- `BAIDU_MARKETING_CLIENT_ID` / `BAIDU_MARKETING_CLIENT_SECRET`：获批百度应用凭据，只能由部署环境注入。
- `BAIDU_MARKETING_REDIRECT_URI`：百度登记的稳定 HTTPS callback，禁止 query、fragment 和 URL 凭据。
- `BAIDU_MARKETING_CONTRACT_VERSION`：必须对应仓库内状态为 `VERIFIED`、无 blocker、声明真实适配器已实现且带生产出站 allowlist 的不可变契约目录。
- `BAIDU_MARKETING_HTTP_TIMEOUT_MS`：百度只读请求超时，允许 100–60000 毫秒。

当前 `baidu-marketing-pending-2026-07-29` 是阻塞清单，不可用于启用模块。配置不完整、未知版本或阻塞版本只会让营销路由 fail-closed，不影响 GEO/SEO 全局 `/api/ready`。

## SEO 设置（可选）
- `SEO_TITLE` 网站 SEO 标题
- `SEO_DESCRIPTION` 网站 SEO 描述
- `SEO_KEYWORDS` 网站 SEO 关键词
- `SEO_ROBOTS` 搜索引擎爬虫策略（默认：`index,follow`）
- `SEO_AUDIT_ALLOW_PRIVATE_TARGETS`：内部部署专用开关，默认 `false`。设为 `true` 后，所有已登录用户均可检测后端服务器的 `localhost`、loopback 地址和 RFC1918 IPv4 字面地址（`10/8`、`172.16/12`、`192.168/16`），无需逐个添加 IP。公网或存在不可信账号的部署必须保持 `false`。
  - 开启后公开自助注册会自动关闭；请从现有用户管理入口创建内部账号。
  - SEO 请求由后端服务器发出，因此页面输入的 `localhost` 永远指向后端所在服务器，不是访问页面的浏览器电脑。
  - 检测另一台电脑时，被测服务必须监听可被局域网访问的地址（通常是 `0.0.0.0`），页面中直接填写该电脑可被后端访问的局域网 URL。
  - 本地 HTTP 服务应输入完整的 `http://主机:端口/`；省略协议会按 HTTPS 处理。
  - 每次任务只允许访问提交 URL 的精确来源（协议、主机和端口均相同）；跳转到其他私网来源会被拒绝。链路本地、云元数据和其他特殊地址始终禁止。
  - 私网全站检测不会探测站外链接，也不会执行 JavaScript 渲染抽样；报告会把这些项目标成“未检查”，不会伪装成通过。
- `SEO_RENDER_BROWSER_EXECUTABLE` 全站 JavaScript 渲染抽样使用的 Chrome/Chromium 可执行文件；macOS 和常见 Linux 路径会自动发现，容器或自定义安装位置需显式配置

## Next.js 前端
- 浏览器 API 地址不可配置，始终使用当前站点的相对路径 `/api/*`
- `NEXT_PUBLIC_SITE_URL` 前端公开站点地址；本地和局域网访问时留空，正式上线时填写最终 HTTPS 域名
- `API_BASE_URL` 仅在 Next.js 服务端使用，默认 `http://127.0.0.1:3002`，不要带末尾 `/api`
- 前端开发和生产启动命令均监听 `0.0.0.0:3001`，换机器或局域网 IP 不需要修改客户端配置

## 安全建议
- ⚠️ `.env` **绝对不要提交到 Git**；已在 `.gitignore` 中忽略
- ⚠️ 生产环境通过平台注入或安全分发机制配置环境变量
- ⚠️ `JWT_SECRET` **必须设置为强随机口令**（至少32字符，建议使用 crypto.randomBytes 生成）
- ⚠️ 默认管理员密码**仅用于首次初始化**，生产环境首次登录后必须立即修改
- ⚠️ 定期轮换平台 API Key 和 JWT 密钥；当前版本不支持在线轮换 `CONFIG_ENCRYPTION_KEY`
- ⚠️ 前后端分域或代理不通过本机 loopback 时，设置 `ALLOWED_ORIGINS` 为实际使用的域名
