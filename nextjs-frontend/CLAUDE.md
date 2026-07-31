# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This project's current product identity is a read-only market data monitoring system, not a single-purpose AI GEO/SEO monitor. It uses a Next.js 16.2.12 frontend (App Router) and Express.js backend. GEO/SEO is the currently formal workflow, but that delivery stage does not redefine the product boundary. A Baidu marketing and analytics module exists as a project-allowlisted `PILOT_DATA_READY` trial; its formal workspace navigation remains hidden until production gates pass. Landing-page consultations, signed order amounts, and manual mapping are the unimplemented long-term path documented in the root `README.md` and `CONTEXT.md`. Legacy repository, service, page, or heading names containing `AI GEO` do not override this positioning.

### Production Truth

- The only supported production URL is `https://insight.guangtuo.com`; `insight.gato.com.cn` is retired.
- `http://182.254.140.163/` is the Nginx default site, not this application. Never use direct-IP output as proof that the app is or is not deployed.
- Production processes run through systemd. The persistent desktop session exists for managed DeepSeek/Doubao Chrome; the backend is not manually launched from that desktop.
- Treat `../docs/DEPLOYMENT.md#当前正式单机实例` as the operational source of truth. Recheck runtime and Git state before claiming that production is healthy or current.

## Development Setup

### Frontend (Next.js)
- **Port**: 3001 in the unified dev script
- **Environment**: `.env.local` contains API configuration
- **Key env vars**:
  - Browser API calls are always relative `/api/*`; do not add a public backend URL
  - `API_BASE_URL`: Server-only Next.js rewrite target (default: http://127.0.0.1:3002)
  - `NEXT_PUBLIC_SITE_URL`: Public frontend URL; leave empty for local/LAN access

**Commands**:
```bash
cd nextjs-frontend
npm run dev                         # Start dev on port 3001 with Turbopack
npm run build    # Build for production
npm run start    # Start production on 0.0.0.0:3001
npm run lint     # Run ESLint
```

### Backend (Express.js)
- **Port**: 3002
- **Database**: SQLite with Sequelize ORM
- **Key features**: JWT authentication, rate limiting, scheduled tasks

**Commands**:
```bash
cd backend
npm run dev      # Start with nodemon
npm start        # Start production
```

## Architecture

### Frontend Structure (Next.js App Router)
```
src/app/
├── layout.tsx           # Root layout with AntdRegistry
├── page.tsx            # 默认登录入口（复用 /login 页面）
├── login/              # 登录页兼容入口
├── register/
├── geo/                # Main GEO functionality
│   ├── layout.tsx      # GEO-specific layout with Header
│   ├── page.tsx        # GEO detection interface
│   ├── dashboard/      # Analytics dashboard
│   ├── history/        # Detection history
│   ├── tasks/          # Scheduled tasks
│   ├── marketing/      # Allowlisted Baidu marketing trial page
│   ├── profile/        # User profile
│   └── notice/         # GEO notices
├── admin/              # Admin panel
│   ├── layout.tsx      # Admin layout with Header
│   ├── users/          # User management
│   ├── memberships/    # Membership plans
│   ├── settings/       # System settings
│   ├── history/        # Admin history view
│   ├── health/         # System health
│   └── notice/         # Admin notices
└── tools/writer/       # Content writing tool
```

### Key Frontend Components
- **`src/lib/axiosConfig.js`**: Global axios configuration with interceptors for:
  - Automatic token injection from localStorage (`agd_token`)
  - 401 error handling (auto-redirects to `/login`)
  - Token expiration warnings (30min/5min before expiry)
  - Helper functions: `setAuthToken()`, `clearAuth()`, `shouldRefreshToken()`, `getCurrentToken()`
  - **Important**: Import from `@/lib/axiosConfig` instead of direct `axios` import
- **`src/components/Login.jsx`**: `/`、`/login` 以及受保护布局共用的登录表单
- **`src/app/geo/layout.tsx`**: GEO 工作台导航与登录态保护
- **`src/app/admin/layout.tsx`**: 管理后台导航、权限与登录态保护

### Backend Structure
```
backend/
├── app.js              # Main Express app with middleware
├── modules/marketing/  # Isolated read-only marketing module and migrations
├── config/database.js  # Sequelize configuration
├── models/             # Sequelize models
├── middleware/         # Custom middleware
│   ├── auth.js        # JWT authentication
│   └── quota.js       # Usage quota checking
├── routes/             # API routes
│   ├── detection.js   # GEO detection endpoints
│   ├── user.js        # User authentication & management
│   ├── schedules.js   # Scheduled task management
│   ├── statistics.js  # Analytics endpoints
│   ├── aiPlatforms.js # Authenticated platform catalog
│   ├── adminAIPlatforms.js # Admin platform configuration
│   ├── membership.js  # Membership plans
│   ├── settings.js    # System settings
│   └── captcha.js     # CAPTCHA generation
└── services/          # Business logic
    └── SchedulerService.js  # Task scheduling
```

### API Architecture
- **Authentication**: JWT tokens stored in localStorage (`agd_token`)
- **Rate Limiting**:
  - General API: 500 requests/15 minutes
  - Schedules API: 1000 requests/15 minutes (higher limit for batch operations)
  - Public endpoints excluded: `/health`, `/captcha`, `/settings/seo`, `/settings/notice`
- **CORS**: Trusts same-machine loopback proxies; other cross-origin requests use `ALLOWED_ORIGINS`
- **API Proxy**: Next.js rewrites `/api/*` to backend (configured in `next.config.ts`)
  - Rewrites use the server-only `API_BASE_URL` env var
  - Client-side axios must remain same-origin and must not contain a backend IP

## Key Technical Patterns

### Authentication Flow
1. Login → JWT token returned → stored in localStorage as `agd_token`
2. `axiosConfig.js` interceptors automatically add `Authorization: Bearer <token>` header
3. 401 errors trigger automatic logout and redirect to `/login`
4. Token expiration warnings at 30min and 5min before expiry

### Rate Limit Avoidance
- **Frontend**: Prefer dedicated batch API endpoints instead of issuing one request per item
- **Backend**: Higher limits for `/api/schedules` endpoint (1000/15min)
- **Polling**: GEO detection uses 30-second intervals (not 1-second)

### State Management
- **Client-side**: React state with localStorage for persistence
- **No global state library**: Uses component state and prop drilling
- **Authentication state**: Derived from localStorage token presence

### UI Framework
- **Ant Design (antd)**: Primary UI component library
- **Important**: Use `orientation="vertical"` not `direction="vertical"` (deprecated)
- **Alert components**: Use `title` prop not `message` (deprecated)

### Next.js Configuration
- **App Router**: All pages use the App Router (`src/app/`)
- **Layouts**: Each route has its own layout (`layout.tsx`) with authentication checks
- **Client Components**: Pages using React state/effects need `'use client'` directive
- **Server Components**: Default, no `'use client'` needed for static pages
- **API Rewrites**: Configured in `next.config.ts` to proxy `/api/*` to backend
- **Environment Variables**: Client-side variables must be prefixed with `NEXT_PUBLIC_`

## Development Guidelines

### API Calls
- **Always import from `@/lib/axiosConfig`** for axios instance (not direct `axios` import)
- Use helper functions: `setAuthToken()`, `clearAuth()` for auth state management
- **For batch operations**, use the matching backend batch endpoint when one exists
- Handle 401 errors gracefully (already handled by interceptors - auto-redirects to login)
- **Important**: Avoid setting `axios.defaults.baseURL` or `axios.defaults.headers.common['Authorization']` in individual components - use the global config

### Marketing Boundaries
- Describe the product as a read-only market data monitoring system. When scope matters, distinguish the formal GEO/SEO workflow, the allowlisted Baidu trial, and the unimplemented full-funnel target.
- Keep the marketing module read-only. Do not add source-system write actions for ads, consultations, leads, opportunities, or orders.
- Do not expose the marketing page in formal workspace navigation until the PRD/Tech Spec production gates are complete.
- Landing-page consultations, the minimum order identity needed for mapping, signed order amounts, and manual cross-system mapping are future work; do not create placeholder facts or describe the Baidu trial as a complete funnel.
- Treat signed order amount as the only required sales-system outcome metric. Effective leads, sales opportunities, order counts, and other sales fields are process context, not required monitoring metrics.
- Keep Baidu contract parsing inside `backend/modules/marketing/adapters/BaiduMarketingClient.js`.

### Error Handling
- API errors are caught and displayed using Ant Design's `message` component
- Network errors should show user-friendly messages
- Token expiration is handled automatically by interceptors

### TypeScript
- Project uses TypeScript with strict mode
- Fix type errors before committing
- Use proper type annotations for function parameters

### Styling
- Tailwind CSS v4 with PostCSS
- Ant Design components for UI
- Custom styles in `src/app/globals.css`

### File Organization
- Page components in `src/app/[route]/page.tsx`
- Layout components in `src/app/[route]/layout.tsx`
- Shared components in `src/components/`
- Utilities in `src/utils/`
- Configuration in `src/lib/`

## Common Development Tasks

### Adding a New API Endpoint
1. Add route in `backend/routes/`
2. Register route in `backend/app.js`
3. Add rate limiting if needed
4. Test with Postman or curl
5. Call from frontend using axios from `@/lib/axiosConfig`

### Creating a New Page
1. Create `src/app/[route]/page.tsx`
2. Add `'use client'` directive if using React state/effects
3. Import necessary components and utilities
4. Add to navigation if needed (update the relevant route layout)

### Debugging API Issues
1. Check browser DevTools Network tab
2. Verify token is being sent (Authorization header)
3. Check backend logs for errors
4. Test endpoint directly with curl:
   ```bash
   curl -H "Authorization: Bearer <token>" http://localhost:3001/api/endpoint
   ```

### Handling Rate Limit Errors
- Reduce batch sizes
- Consider implementing exponential backoff for retries
- Check if endpoint needs higher limit in backend
- Prefer a server-side batch endpoint over repeated client-side mutation requests

## Deployment Notes

### Environment Variables
- Frontend: `.env.local` for development, set in deployment platform for production
- Backend: `.env` file with database credentials, JWT secret, etc.

### Build Process
1. Frontend: `npm run build` creates optimized Next.js build
2. Backend: No build step, runs directly with Node.js

### Port Configuration
- Default: Frontend 3001, Backend 3002
- Change via environment variables:
  - Frontend proxy target: Update server-only `API_BASE_URL`
  - Backend: Update `PORT` in `.env`

## Troubleshooting

### Common Issues
1. **"React has detected a change in the order of Hooks"**: Ensure all hooks are called before any conditional returns
2. **API 401 errors**: Check token expiration, clear localStorage and re-login (auto-handled by interceptors)
3. **Rate limit errors**: Implement `sequentialWithDelay()` for batch operations, increase delays
4. **CORS errors**: On one host verify `API_BASE_URL` uses `127.0.0.1`; for split/container deployments verify `ALLOWED_ORIGINS`
5. **TypeScript errors**: Fix type annotations before proceeding
6. **Ant Design deprecation warnings**:
   - `direction="vertical"` → `orientation="vertical"`
   - `message` prop in Alert → `title` prop
   - `List` component deprecated → use custom layout
7. **API requests not working**: Ensure importing from `@/lib/axiosConfig` not direct `axios`
8. **Port conflicts**: Frontend default 3001, backend default 3002

### Database Issues
- SQLite database file: `backend/database.sqlite`
- Sequelize models auto-sync in development

This documentation should help Claude Code understand the project structure and conventions when working with this codebase.
