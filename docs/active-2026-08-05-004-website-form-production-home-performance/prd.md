# 官网表单生产接入与首页性能优化 PRD

## Problem Statement

1. **官网表单咨询生产不可用**：`websiteFormConsultations` 模块代码、迁移与前端展示已部署并通过本地真实只读对账，但生产服务器从未注入 `GATO_WEBSITE_FORM_*` 凭据，模块保持 `DISABLED`（`WEBSITE_FORM_MODULE_DISABLED`）。因此首页市场总览每次进入都向 `/api/website-data` 发出必然 503 的请求，并显示"官网表单咨询读取失败 / 官网表单咨询模块当前不可用"红字。市场负责人无法在生产看到真实官网表单咨询数据。
2. **首页加载慢**：市场总览首页在百度广告快照过期（距上次成功刷新超过 10 分钟）时，后端 `MarketingOnDemandDashboardService.read()` 会**同步等待**现场调用百度 4 层报表 API 并提交快照后才返回（实测一次耗时 23 秒）。首页 mount 即请求 dashboard，导致首屏"等好几秒"。此外，官网模块 `DISABLED` 时，`useWebsiteFormConsultations`（每 10 分钟 interval）与 `useWebsiteFormConsultationDays` 会反复发出必然失败的无意义请求。

## Solution

### 目标一：官网表单生产接入（试点）

取得并验证专用、最小权限、服务端只读身份后，在生产服务器注入 `GATO_WEBSITE_FORM_*` 配置，使官网表单模块从 `DISABLED` 变为 `READY`，首页市场总览的官网表单列展示真实表单记录的九键聚合数据，消除 503 红字。共享管理员身份不得作为生产试点捷径；凭据未就绪前，本目标保持阻塞且生产继续诚实返回 `DISABLED`。

### 目标二：首页性能优化

1. **官网 503 前端会话级跳过**：前端新增官网模块会话级 DISABLED 状态。首次收到 `WEBSITE_FORM_MODULE_DISABLED`（503）后，本次 SPA 会话内不再重复发送官网表单请求（挂载、10 分钟 interval、visibilitychange 均短路），直接使用缓存的原因文案展示"官网表单咨询未接入"。
2. **ON_DEMAND 刷新异步化**：后端 `MarketingOnDemandDashboardService.read()` 改为"有旧快照异步、无快照同步"：
   - 快照过期且有旧快照（`current.revision` 非空）时，**立即返回旧快照**（STALE），后台 fire-and-forget 触发刷新，前端不再等百度。
   - 首次访问无快照时保持同步等待，保证首屏有数据。
   - 前端 `useMarketOverview` 在收到 STALE + `activeRun.runId` 时轮询 `GET /api/marketing/projects/:id/refresh-runs/:runId`，刷新成功（`SUCCEEDED`）后静默重拉 dashboard 展示新数据。

## User Stories

1. As a 市场负责人, I want to 在生产首页看到真实的官网表单咨询数据, so that 我不需要切换到本地或凭据不全的状态才能核对表单来源表现。
2. As a 市场负责人, I want to 官网模块未接入时只看到一次"未接入"说明而不是每次进入都刷红字, so that 页面不重复发出必然失败的请求。
3. As a 市场负责人, I want to 广告快照过期时页面先展示最近一份快照而不白等数秒, so that 我可以快速浏览首页，数据随后在后台刷新后自动更新。
4. As an 管理员, I want to 只用专用最小权限身份启用官网表单, so that 生产接入不会继承共享管理员的多余权限，也不需要在上线后补做高风险凭据轮换。

## Scope

### In scope

- 取得并验证专用最小权限只读身份后，配置生产 `GATO_WEBSITE_FORM_ENABLED=true`、`BASE_URL=https://gato.com.cn`、`PROJECT_ID=<默认项目>`、`USERNAME`、`PASSWORD`、超时与缓存 TTL。
- 生产官网模块启用后的就绪检查与真实区间/逐日数据验收。
- 前端官网表单请求的会话级 DISABLED 短路（两个 hook 共用模块级状态）。
- 后端 ON_DEMAND 刷新异步化（有旧快照 fire-and-forget，无快照同步）。
- 前端市场总览对刷新运行的状态轮询与刷新完成后的静默重拉。
- 同步更新 `docs/DEPLOYMENT.md`、`docs/README.md`、`CONTEXT.md` 与 `MARK_LATER.md`。

### Out of scope

- 新建或改造后端 `/api/marketing-analysis`、数据库模型、队列或真实 AI 调用。
- 引入 Agent、工具调用、MCP、React Query/SWR 或其他状态库。
- 官网表单数据与百度/53KF/线索/订单的跨系统归因计算。
- 把周末无投放的百度广告日补零或伪造为完整趋势（市场总览渠道对比由 `closed-2026-08-05-001` 独立需求处理）。
- 新增第二套官网模块实现或隐藏 fallback。

### Later

- 53KF 在线客服、线索入池、成交订单真实只读接口接入后的展示。

## Product Behavior

### 1. 官网表单生产接入

- 配置生效后 `GET /api/website-data/status` 返回 `moduleState: READY`。
- `GET /api/website-data/projects/:id/form-consultations?from=..&to=..` 返回 `sourceSystem=GATO_WEBSITE`、`consultationType=WEBSITE_FORM` 的真实数据；`form-consultation-days` 逐日合计与区间汇总一致。
- 首页市场总览"官网表单咨询"列显示真实会话数，不再显示 503 错误文案。
- 文档与页面不得把官网表单咨询描述为 53KF 在线客服、有效线索或成交订单。

### 2. 官网 503 会话级跳过

- 模块 `DISABLED` 时，首次进入页面仍发起一次官网请求并收到 503；此后本 SPA 会话内（含页面切换、10 分钟 interval、visibilitychange）不再重复发起，直接展示缓存的"官网表单咨询未接入"原因。
- 模块恢复 `READY`（生产配置生效后）后，刷新浏览器即恢复真实请求。
- 不删除 10 分钟 interval 结构，仅在 DISABLED 时短路 `read()`。

### 3. ON_DEMAND 刷新异步化

- 百度广告快照过期且有旧快照：`GET /api/marketing/projects/:id/dashboard` 立即返回旧快照（`snapshotFreshnessState=STALE`）并携带 `activeRun`，后台开始刷新。
- 首次无快照：仍同步等待刷新完成，保证首次访问有数据；刷新失败且无快照时对前端抛错（保持现有语义）。
- 前端在 `STALE` 且有 `activeRun.runId` 时，每约 3 秒轮询刷新运行状态，`SUCCEEDED` 后静默重拉 dashboard 展示新数据；`FAILED` 后停止并保留 STALE 旧数据与失败提示。
- 刷新运行仍受进程内去重、失败冷却和数据库 `active_project_key` 单槽约束，不产生并发重复刷新。

## Acceptance Criteria

1. 专用最小权限只读身份的权限边界已验证，生产 `/api/website-data/status` 返回 `READY`；`form-consultations` 与 `form-consultation-days` 返回真实数据，逐日合计等于区间汇总。
2. 生产首页市场总览官网表单列显示真实数据，无"官网表单咨询模块当前不可用"红字。
3. 官网模块 DISABLED 时，浏览器 Network 中官网表单请求每会话仅 1 次，10 分钟 interval 不再重复发 503。
4. 广告快照 STALE 时，首页立即渲染旧快照（不白等数秒），后台刷新完成后页面自动更新为新数据；首载仍能拿到数据。
5. 后端营销模块测试（含 ON_DEMAND 4 用例异步语义重写）全绿；前端单元测试、lint、production build、浏览器测试全绿。
6. `docs/DEPLOYMENT.md`、`docs/README.md`、`CONTEXT.md` 只有在专用只读凭据和正式入口验收完成后才写“官网表单生产已接入”，并继续保留“53KF/线索/订单未接入”边界；凭据未就绪时必须保持 `DISABLED`，不得用共享管理员身份绕过门禁。
