# Next.js Frontend

这是 GoodieAI 只读市场数据监控系统的 Next.js 前端。GEO/SEO 是当前正式数据工作流，百度营销与百度统计是页面入口已展示但真实数据仍受白名单保护的试点；不得将当前页面范围解释为项目仍是单一 GEO/SEO 监测系统。完整定位和实施状态见根目录 `README.md` 与 `CONTEXT.md`。

当前唯一支持的生产入口是 `https://insight.guangtuo.com`。旧域名已退役，直接
访问 `http://182.254.140.163/` 只会命中 Nginx 默认站点；完整运行真值见
`../docs/DEPLOYMENT.md#当前正式单机实例`。

## Getting Started

项目根目录已提供统一启动脚本，开发时优先在根目录执行：

```bash
npm run dev
```

如需单独启动前端：

```bash
cd nextjs-frontend
npm run dev
```

默认登录页地址：`http://localhost:3001`。

## Environment

开发环境可在 `.env.local` 中配置：

```bash
NEXT_PUBLIC_SITE_URL=
API_BASE_URL=http://127.0.0.1:3002
```

浏览器始终请求当前站点的 `/api/*`，不读取后端 IP 配置。Next.js 在服务端把请求转发给 `API_BASE_URL`；未配置时默认使用同机 `http://127.0.0.1:3002`。开发命令和手工 `npm run start` 默认监听 `0.0.0.0:3001`，可用于受控局域网调试；Ubuntu 正式环境不执行这个手工入口，而由 systemd unit 固定监听 `127.0.0.1:3001` 并经 Nginx 对外服务。

Vercel 部署时：

```bash
NEXT_PUBLIC_SITE_URL=https://your-vercel-domain.vercel.app
API_BASE_URL=https://api.example.com
```

`API_BASE_URL` 填后端源站根地址，不要带 `/api`。

## Commands

```bash
npm run build
npm run start
npm run lint
```

部署细节见 `../docs/DEPLOYMENT.md` 和 `../docs/VERCEL.md`。
