# 官网表单生产接入与首页性能优化 Tech Spec

> 关联 PRD：同目录 `prd.md`。本需求只做前端展示层与官网模块生产配置，不改营销数据口径，不引入 Agent/工具调用/新状态库。生产配置必须等待专用最小权限只读身份，禁止用共享管理员凭据作为临时方案。

## 1. 现状与根因

### 1.1 官网表单生产 DISABLED

- 模块：`backend/modules/websiteFormConsultations/`。`config.js:40-96` 在 `GATO_WEBSITE_FORM_ENABLED` 为 `true` 且缺少必需键时判 `MISCONFIGURED`；生产完全未设置这些键 → `DISABLED`。
- `index.js:76-85`（`requireReady`）：非 `READY` 一律 503，`error.code` 兜底 `WEBSITE_FORM_MODULE_DISABLED`，message「官网表单咨询模块当前不可用」。
- 生产迁移 `001-003` 已在 `website_data_schema_migrations` 应用（2026-08-04）；快照表为空（模块从未拉取）。
- 本地 `.env` 配置完整（`gato` 身份、`PROJECT_ID=6`）且真实数据对账通过；生产项目为 `1`（广拓）。

### 1.2 首页慢

- `MarketingOnDemandDashboardService.read()`（`backend/modules/marketing/services/MarketingOnDemandDashboardService.js:66-88`）在 `shouldRefresh`（`snapshotFreshnessState ∈ {NA,STALE}`，`FRESHNESS_MS=10*60*1000`）时 `await this.refresh()` 同步等百度 4 层报表 + 快照事务（实测 23 秒）。
- 首页 `useMarketOverview`（`nextjs-frontend/src/lib/marketing/useMarketOverview.ts`）mount 即拉 dashboard，故首屏卡。
- 官网模块 DISABLED 时，`useWebsiteFormConsultations`（10 分钟 interval + visibilitychange）与 `useWebsiteFormConsultationDays`（consultations 页挂载 ×2）每次发必然 503 请求。

## 2. 目标一：官网表单生产接入

### 2.1 生产配置清单（`backend/.env`）

```text
GATO_WEBSITE_FORM_ENABLED=true
GATO_WEBSITE_FORM_BASE_URL=https://gato.com.cn
GATO_WEBSITE_FORM_PROJECT_ID=1
GATO_WEBSITE_FORM_USERNAME=<专用最小权限只读身份>
GATO_WEBSITE_FORM_PASSWORD=<由部署注入>
GATO_WEBSITE_FORM_HTTP_TIMEOUT_MS=10000
GATO_WEBSITE_FORM_CACHE_TTL_MS=600000
```

校验规则（`config.js`）：`BASE_URL` 必须精确 `https://gato.com.cn`；`PROJECT_ID` 正整数；`HTTP_TIMEOUT_MS` 100–60000；`CACHE_TTL_MS` 60000–3600000。

### 2.2 操作顺序

1. 取得专用最小权限只读身份，并验证它只能读取本需求所需的表单统计/记录合同；凭据未就绪时停止，不修改生产启用状态。
2. 备份生产数据库与 `.env`。
3. 写入上述配置（不输出密码明文）。
4. `systemctl restart ai-geo-backend.service`。
5. 验收：
   - `GET /api/website-data/status` → `{ moduleState: 'READY' }`（`index.js:74`）。
   - `GET /api/website-data/projects/1/form-consultations?from=..&to=..` 与 `form-consultation-days` → `sourceSystem=GATO_WEBSITE`、`consultationType=WEBSITE_FORM`；逐日合计等于区间汇总。
   - 首页市场总览官网表单列显示真实数据。
6. 文档更新（见第 4 节）。

### 2.3 边界

- 共享管理员账号不进入生产配置，也不能作为短期试点；缺少专用最小权限只读身份时，模块继续保持 `DISABLED`。
- 不得把官网表单咨询描述为 53KF/线索/订单；响应不含联系人、会话明细或官网流量字段（沿用现有模块合同）。

## 3. 目标二：首页性能优化

### 3.1 官网 503 会话级跳过（前端）

新增 `nextjs-frontend/src/lib/websiteData/moduleState.ts`（模块级单例）：

```ts
let websiteFormDisabledMessage: string | null = null;
export function rememberWebsiteFormDisabled(message: string): void { /* 首次写入 */ }
export function readWebsiteFormDisabledMessage(): string | null { return websiteFormDisabledMessage; }
```

两个 hook 均增加：
- `read()` 开头（`enabled/projectId/from/to` 检查之后）：
  - `readWebsiteFormDisabledMessage()` 非空 → 直接置 `SOURCE_ERROR` + `errorCode='WEBSITE_FORM_MODULE_DISABLED'` + 缓存文案，**不发请求**。
- `catch` 中：`details.code === 'WEBSITE_FORM_MODULE_DISABLED'` 时 `rememberWebsiteFormDisabled(details.message)`。

受影响文件：
- `nextjs-frontend/src/lib/websiteData/useWebsiteFormConsultations.ts`
- `nextjs-frontend/src/lib/websiteData/useWebsiteFormConsultationDays.ts`

约束：保留 `10 * 60 * 1000` interval 结构（`website-form-consultations.test.cjs` 断言存在）；不引入 `/api/marketing` 引用（测试 `doesNotMatch /\/api\/marketing/`）。页面展示仍走现有 `SOURCE_ERROR` 分支（market-overview 单元格 `MissingValue`、consultations `Alert`），只是文案来自缓存而非每次 503。

### 3.2 ON_DEMAND 刷新异步化（后端）

`MarketingOnDemandDashboardService.read()`（`:66-88`）改造为"有旧快照异步、无快照同步"：

```ts
// 伪代码：应保留 refreshes Map 去重与 failedRefreshes 冷却
async read(input) {
  const current = await this.dashboardService.read({ projectId: input.projectId });
  if (!this.shouldRefresh(current)) {
    if (input.from === undefined && input.to === undefined) return current;
    return this.dashboardService.read(input);
  }
  const key = String(input.projectId);
  if (在失败冷却期) return this.dashboardService.read(input);
  if (current.revision) {
    // 有旧快照：后台刷新，不 await，立即返回当前（STALE）
    this.refresh(input.projectId).catch(() => this.failedRefreshes.set(key, this.clock()));
  } else {
    // 无快照（首载）：同步等待，失败且无 revision 时保持抛错
    await this.refresh(input.projectId);
    this.failedRefreshes.delete(key);
  }
  return this.dashboardService.read(input);
}
```

响应已含 `activeRun`（`MarketingDashboardService.present` 返回活跃 run），前端据此轮询。

### 3.3 前端刷新轮询

`useMarketOverview.ts` 增加轮询（**只用 `setTimeout` 递归，禁用 `setInterval`**——`market-overview.test.cjs` 断言 `doesNotMatch /setInterval/`）：

- 触发条件：`ad.state === 'STALE'` 且 `ad.data?.activeRun?.runId` 非空。
- 每 ~3s `GET /api/marketing/projects/:id/refresh-runs/:runId`（端点已存在，`marketingDashboardRoutes.js:152-169`）。
- `SUCCEEDED` → 停轮询 + `fetchOverview(true)` 静默重拉。
- `FAILED` → 停轮询（保留 STALE 旧数据与现有失败提示）。
- 卸载时清理计时器。

`activeRun` 为可选字段，`assertMarketingDashboardResponse` 不强校验（已确认现有 adapter 不要求）。

## 4. 文档与待办更新

- `docs/DEPLOYMENT.md#当前正式单机实例`：只有在专用只读凭据和正式入口验收完成后，才把官网表单从“凭据未配置 `DISABLED`”改为“生产已接入”；保留 53KF/线索/订单未接入边界。
- `docs/README.md`：更新页面实施状态表中市场总览/咨询数据行。
- `CONTEXT.md`：营销监控语言开头阶段说明同步更新（百度已上线、官网试点已接入、53KF/线索/订单未接入）。
- `MARK_LATER.md`：在专用最小权限只读身份未提供时保留阻塞事项，不创建“先共享账号上线、以后再换”的技术债。

## 5. 测试与验收

- 后端：`cd backend && npm test`（营销模块全量；`MarketingOnDemandDashboard.test.js` 4 用例按异步语义重写）。
- 前端：`cd nextjs-frontend && npm test && npm run lint && npm run build && npm run test:marketing:browser`。
- 测试文件：
  - `backend/tests/marketing/MarketingOnDemandDashboard.test.js`：首载同步刷新、10 分钟复用、有旧快照异步触发（await 后台完成再断言 revision/providerCalls）、STALE 失败返回旧快照、跨日恢复。
  - `nextjs-frontend/tests/marketing/website-form-consultations.test.cjs`：新增 DISABLED 跳过断言。
  - `nextjs-frontend/tests/marketing/market-overview.test.cjs`：保留 `/setInterval/` 反断言（用 setTimeout），新增 `refresh-runs` 轮询断言。
- 生产验收：见 `prd.md` Acceptance Criteria。

## 6. 风险与并发

- 工作区有其他并发提交；本需求仅新增/修改：`moduleState.ts`、两个官网 hook、`MarketingOnDemandDashboardService.js`、`useMarketOverview.ts`、对应测试、需求文档；**不改** `market-overview/page.tsx`（由 `closed-2026-08-05-001` 独立处理）。
- 提交时只 `git add` 本需求目标文件。
- ON_DEMAND 异步化改变"刷新与本次响应原子绑定"语义：有旧快照时首屏为 STALE 旧数据，后台刷新完成由前端轮询自动更新；首载仍同步保证数据。
