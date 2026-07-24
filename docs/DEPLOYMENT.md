# 部署与运维

## 前提条件
- 已安装 `Node.js >= 18` 与 `npm >= 9`
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

  DEFAULT_ADMIN_USERNAME=admin
  DEFAULT_ADMIN_EMAIL=admin@example.com
  DEFAULT_ADMIN_PASSWORD=<强随机值>

  # 用于加密数据库中的 AI 平台密钥（32 字节 Base64 或 64 位十六进制）
  CONFIG_ENCRYPTION_KEY=<加密主密钥>

  # 可选：允许检测的受控本机/私网网站，必须精确到 host:port
  SEO_AUDIT_PRIVATE_HOST_ALLOWLIST=localhost:4173,127.0.0.1:4173,192.168.1.50:4173

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
  - SEO 检测请求由后端服务器发出；`localhost` 指后端服务器。检测另一台开发机时应填写该机器可被后端访问的局域网 IP，并在 `SEO_AUDIT_PRIVATE_HOST_ALLOWLIST` 中加入对应的精确 `IP:端口`
  - **部署后立即修改默认管理员密码**
- 生产建议配置 `DATABASE_URL` 使用托管 Postgres（如 Supabase）。未配置时会使用 SQLite（`backend/config/database.js`，默认 `database.sqlite`）。

## 构建与运行（生产）
- 安装依赖：
  - `npm ci`
  - `cd backend && npm ci`
  - `cd ../nextjs-frontend && npm ci`
- 前端构建：
  - 在项目根目录执行 `npm run build`
- 后端：
  - `cd backend && npm run start`
  - 建议使用进程管理器接管（PM2 或 systemd），并将日志滚动输出
- 前端：
  - `cd nextjs-frontend && npm run start`
  - 建议通过进程管理器接管 Next.js 服务，并由 Nginx 反向代理到 Next.js 监听端口

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
- 健康检查：`GET https://<你的域名>/api/health`
- AI 平台配置：管理员登录 `/admin/settings`，人工填写 API Key 和供应商明确支持的模型请求参数，再分别执行“测试连接”和“检测联网能力”
- 登录验证：使用默认管理员登录并立即修改密码（见下方安全建议）

## 安全与合规建议
- ⚠️ **JWT_SECRET 必须设置为强随机值**（至少32字符），使用默认值会导致严重安全风险
- ⚠️ **部署后立即修改默认管理员密码**
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
- 联网能力显示“证据不足”：说明模型调用成功，但供应商协议没有返回可验证的搜索证据，或当前没有配置官方强制联网参数；不要据此擅自复制其他平台参数
- 429/网络错误：后端已包含重试与代理支持，设置 `HTTPS_PROXY`/`HTTP_PROXY` 即可
- SSE 推流中断：检查 Nginx `proxy_buffering off` 与 `proxy_read_timeout` 配置
- CORS 错误：同机部署先确认 `API_BASE_URL=http://127.0.0.1:3002`；分域或容器代理再检查 `ALLOWED_ORIGINS`
- 认证失败（401）：确保请求头包含 `Authorization: Bearer <token>`
- 权限不足（403）：检查用户是否有权访问该资源（用户只能访问自己的数据）
- 速率限制（429）：默认限制通用 API 500次/15分钟，定时任务 API 1000次/15分钟，登录 5次/15分钟
- JWT 配置错误：确保 `JWT_SECRET` 已设置为强随机值

## 进程管理示例（可选）
- 使用 systemd（示例）：
```
[Unit]
Description=AI GEO Monitoring System Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/ai-geo-monitoring-system/backend
Environment=NODE_ENV=production
EnvironmentFile=/srv/ai-geo-monitoring-system/backend/.env
ExecStart=/usr/bin/node app.js
Restart=always

[Install]
WantedBy=multi-user.target
```
- 安装后执行：`systemctl daemon-reload && systemctl enable --now ai-geo-monitoring-system-backend.service`
- Next.js 前端也可使用独立 systemd 服务托管，核心命令为：
  - `WorkingDirectory=/srv/ai-geo-monitoring-system/nextjs-frontend`
  - `ExecStart=/usr/bin/npm run start`
