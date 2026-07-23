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
  - 本地开发建议包含：`http://localhost:3001,http://127.0.0.1:3001`
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
- `SEO_RENDER_BROWSER_EXECUTABLE` 全站 JavaScript 渲染抽样使用的 Chrome/Chromium 可执行文件；macOS 和常见 Linux 路径会自动发现，容器或自定义安装位置需显式配置

## Next.js 前端
- `NEXT_PUBLIC_API_BASE_URL` 客户端 axios 使用的 API 地址，开发默认 `http://localhost:3002`
- `NEXT_PUBLIC_API_URL` API 地址别名，开发默认 `http://localhost:3002`
- `NEXT_PUBLIC_SITE_URL` 前端站点地址，开发默认 `http://localhost:3001`
- `API_BASE_URL` Next.js rewrites 使用的后端地址，开发默认 `http://localhost:3002`
- 生产同域部署时，客户端 API 地址建议配置为 `/api`，由 Nginx 反向代理到后端

## 安全建议
- ⚠️ `.env` **绝对不要提交到 Git**；已在 `.gitignore` 中忽略
- ⚠️ 生产环境通过平台注入或安全分发机制配置环境变量
- ⚠️ `JWT_SECRET` **必须设置为强随机口令**（至少32字符，建议使用 crypto.randomBytes 生成）
- ⚠️ 默认管理员密码**仅用于首次初始化**，生产环境首次登录后必须立即修改
- ⚠️ 定期轮换平台 API Key 和 JWT 密钥；当前版本不支持在线轮换 `CONFIG_ENCRYPTION_KEY`
- ⚠️ 生产环境设置 `ALLOWED_ORIGINS` 为实际使用的域名
