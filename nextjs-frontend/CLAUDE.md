# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This project's current product identity is a read-only market data monitoring system, not a single-purpose AI GEO/SEO monitor. It uses a Next.js 16.2.12 frontend (App Router) and Express.js backend. GEO/SEO is the currently verified formal workflow, but that delivery stage does not redefine the product boundary. The repository contains the full market workspace navigation and local design implementations for market overview, ad performance, keyword analysis, website traffic, consultations, and order results. Current local real-data support includes Baidu paid advertising facts and CPC, Baidu Tongji website-source visits, and attributable website form consultations from the separate `/api/website-data` contract. The consultation record UI also has a strict `/api/consultations` contract and a locally live-verified, server-side-masked website record adapter; 53KF remains independently `NOT_CONNECTED`. The order-result UI has no production data source and its complete fixture is development-only. Website form consultations do not include 53KF online chats or all historical form records. 53KF conversations, lead-pool entries, order count, order amount, and dependent KPIs remain unavailable and render as honest missing states. The complete four-report hierarchy, richer Tongji quality/page reads, website-form additions, and current page batch described here have not been deployed; production must be verified independently. `../docs/README.md#当前前端页面实施状态`, `../docs/visual-design-spec.md`, the root `README.md`, and `CONTEXT.md` are the current authorities. Legacy repository, service, page, or heading names containing `AI GEO` do not override this positioning.

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
npm run start    # Direct/manual start on 0.0.0.0:3001; formal Ubuntu production uses systemd on 127.0.0.1:3001
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

### Current boundaries

- App Router pages live under `src/app/`; shared components live under `src/components/`; browser API clients and hooks live under `src/lib/`.
- `src/app/geo/layout.tsx` owns workspace navigation and login protection. `src/app/admin/layout.tsx` owns administrator navigation and permissions.
- `src/lib/axiosConfig.js` is the only shared browser Axios entry. It owns `agd_token`, auth headers, expiry warnings, and 401 redirects; never import Axios directly or set a component-level global base URL.
- Browser requests remain same-origin `/api/*`. `next.config.ts` forwards them to the server-only `API_BASE_URL`; never expose the backend IP in client code.
- Backend route ownership is explicit: Baidu advertising/Tongji use `backend/modules/marketing` and `/api/marketing`; website form aggregates use `backend/modules/websiteFormConsultations` and `/api/website-data`; read-only consultation-record contracts use `backend/modules/consultationRecords` and `/api/consultations`.
- Authentication uses JWT. General rate limiting is 500 requests per 15 minutes and schedules use 1000; prefer bounded batch endpoints over browser request fans.
- CORS trusts same-machine loopback proxies; every other cross-origin caller must be present in `ALLOWED_ORIGINS`.

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
- The full market navigation already exists in the repository. Do not infer production availability from local code; verify the canonical production entry before claiming it is live.
- Use `../docs/visual-design-spec.md` as the visual and homepage-metric authority. The source chain is impressions → visits/clicks → website-form consultations / online-chat consultations → lead-pool entries → completed orders, and the order stage includes both count and amount.
- Use completed-order count for CPA, close rate, and overall conversion rate; use order amount for ROAS. Never infer a missing count from amount.
- Only assign records to a source when a trustworthy source key or confirmed manual mapping exists. Do not turn contemporaneous ad, site, consultation, and sales totals into attribution facts.
- Keep Baidu advertising and Tongji endpoints under `/api/marketing`. Keep attributable website form aggregates under the independent `/api/website-data` module and contract. Do not share source clients, response fields, module status, or migration ledgers between them.
- Name the website value “官网表单咨询”; it covers attributable successful submission sessions only. Never relabel it as total customer-service consultations, 53KF conversations, all form records, leads, or orders. When the upstream aggregate cannot prove total form records, keep total, unattributed count, and attribution rate unavailable.
- `src/app/geo/market-overview/page.tsx` implements the approved V2 visual and interaction contract. Unsupported downstream data and metrics remain missing by design; report UI completion, data-contract completion, commit, deployment, and production verification as separate stages with direct evidence.
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
