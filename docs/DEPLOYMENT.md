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
| 切换时源码版本 | 服务器 `HEAD=f5138ea`。域名切换是基础设施变更，没有同步之后的 `main`；是否最新必须现场比较服务器 `HEAD` 与 `origin/main` |

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

  DEFAULT_ADMIN_USERNAME=admin
  DEFAULT_ADMIN_EMAIL=admin@example.com
  DEFAULT_ADMIN_PASSWORD=<强随机值>

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
  - **部署后立即修改默认管理员密码**
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
- 登录验证：使用默认管理员登录并立即修改密码（见下方安全建议）
- 当前正式实例只通过 `https://insight.guangtuo.com` 验收；不要用直接 IP 的默认
  Nginx 页面替代域名、TLS 和 Host 路由检查。

### 营销模块发布顺序

1. 先完成数据库备份。
2. 执行 `cd backend && npm run migrate:marketing`。
3. 执行 `cd backend && npm run audit:marketing`，确认 4 个版本均已应用且无 checksum 漂移。
4. 保持 `MARKETING_MONITORING_ENABLED=false` 启动并回归 GEO/SEO。
5. 用公网域名检查 `GET /api/health`、`GET /api/ready`，再确认禁用状态的 callback 空请求返回营销模块 503 而不是 404；反向代理不得记录 callback query。
6. 新建本项目专用百度应用，把完整 HTTPS callback 登记为 `https://<域名>/api/admin/marketing/baidu/oauth/callback`，审核通过后取得 `appId`、`secretKey` 和授权链接中的只读 `scope`。
7. 配置 `MARKETING_MONITORING_ENABLED=true`、`MARKETING_MONITORING_PILOT_MODE=true`、试点项目白名单和 `baidu-marketing-docs-2026-07-30`，启动后确认营销状态为 `PILOT_READY`，callback 空请求返回 `OAUTH_CALLBACK_INVALID`。
8. 完成真实授权并确认账户目录后，部署包含脱敏 fixture 的代码，再把契约切到 `baidu-marketing-pilot-2026-07-30`；状态必须为 `PILOT_DATA_READY`，只向白名单项目开放绑定、搜索快照和百度统计实时读取。
9. 真实 Token 与 Refresh Token 保留在服务器数据库密文中，不复制到本地；本地解析、回归和异常测试只使用脱敏 fixture。
10. 补全金额、时区、错误与 refresh 轮换证据；新增零 blocker 的 `VERIFIED` 清单后再关闭试点模式。
11. 生产验收未完成前不添加营销工作台导航；百度不可达不得影响全局 readiness 或旧搜索快照读取。

故障时同时把 `MARKETING_MONITORING_ENABLED` 和 `MARKETING_MONITORING_PILOT_MODE` 恢复为 `false`。若 Token 或主密钥疑似泄露，先阻断连接并在百度控制台撤权，清除本地 Token，轮换应用 Secret 与 `CONFIG_ENCRYPTION_KEY`，然后逐连接重新授权；不得恢复任何旧营销实现或隐式 fallback。

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
