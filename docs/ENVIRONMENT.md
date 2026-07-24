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

## 数据库
- `DB_STORAGE` SQLite 数据库文件路径（默认：`database.sqlite`）
- `DATABASE_URL` Postgres 连接串；生产环境配置后会优先使用 Supabase/Postgres
- 未配置 `DATABASE_URL` 时，后端继续使用 SQLite（默认 `database.sqlite`），已在 `.gitignore` 忽略

## SEO 设置（可选）
- `SEO_TITLE` 网站 SEO 标题
- `SEO_DESCRIPTION` 网站 SEO 描述
- `SEO_KEYWORDS` 网站 SEO 关键词
- `SEO_ROBOTS` 搜索引擎爬虫策略（默认：`index,follow`）
- `SEO_AUDIT_PRIVATE_HOST_ALLOWLIST`：允许 SEO 检测访问的本机或私网目标精确 `host:port` 白名单，多个值用逗号分隔。例如后端所在机器的前端运行在 3001 端口时，可设置 `localhost:3001,127.0.0.1:3001`；需要检测另一台开发机的 4173 端口时，可追加类似 `192.168.1.50:4173` 的地址。未列出的本机、私网地址和端口继续被拒绝；生产环境除非确实需要检测受控内网站点，否则应保持为空。
  - SEO 请求由后端服务器发出，因此页面输入的 `localhost` 永远指向后端所在服务器，不是访问页面的浏览器电脑。
  - 检测另一台电脑时，被测服务必须监听可被局域网访问的地址（通常是 `0.0.0.0`），页面中填写该电脑的局域网 URL，并在后端白名单中加入对应的精确 `IP:端口`。
  - 本地 HTTP 服务应输入完整的 `http://主机:端口/`；省略协议会按 HTTPS 处理。
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
