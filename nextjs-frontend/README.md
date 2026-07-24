# Next.js Frontend

这是 AI GEO Monitoring System 的 Next.js 前端。

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

浏览器始终请求当前站点的 `/api/*`，不读取后端 IP 配置。Next.js 在服务端把请求转发给 `API_BASE_URL`；未配置时默认使用同机 `http://127.0.0.1:3002`。开发与生产启动命令都监听 `0.0.0.0:3001`，因此局域网可通过服务器当前 IP 访问。

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
