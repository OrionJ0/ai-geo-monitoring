---
title: "正式硬切模块化 Provider 并完成等价验收"
status: closed
type: HITL
blocked_by:
  - "004-extract-tongji-client-and-remove-monolith.md"
---

# 正式硬切模块化 Provider 并完成等价验收

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-3：市场页面和数据合同在重构后保持不变。
- US-4：正式运行只有一条新路径，不保留旧实现或 fallback。

## What to build

把模块化 facade、三个产品客户端和唯一安全内核作为正式唯一 Provider 发布，从公开生产入口验证 OAuth、四报表、百度统计及全部营销页面。完成等价证据、旧实现清理、恢复演练说明和现役架构文档更新后，才能关闭 005。

## Acceptance criteria

- [x] 全量单元、特征、集成、数据库无 schema diff 和凭据扫描通过。
- [x] 正式模块只构造一个 facade、一个内核和每类一个产品客户端，没有双 provider、feature flag 或 runtime fallback。
- [x] 公开健康接口返回目标 revision，`/api/ready` 为 ready。
- [x] 正式 OAuth、四报表、统计站点/趋势/来源/页面和全部营销页面从受支持域名通过。
- [x] 请求预算、来源、日期、精确指标、快照完整性和稳定错误与重构前证据等价。
- [x] 旧单体实现、专属测试、失效说明和生产引用全部删除，当前文档只描述模块化路径。
- [x] 阻断失败的恢复方案使用后代 revert revision 快进，不重新启用隐藏旧路径。

## Blocked by

- [Issue 004：抽取百度统计客户端并删除单体产品逻辑](004-extract-tongji-client-and-remove-monolith.md)。

## 验收证据

- Issue 001 的同一份冻结黑盒合同在拆分前提交 `2764080ffb191ce841bf4d929b1b7cb2d003ca0d` 的临时只读 worktree 与最终候选上均为 7/7；最终模块边界/安全聚焦 35/35、营销回归 243/243、后端顶层 994/994、官网 31/31、咨询 35/35、部署合同 30/30、前端合同 123/123 全部通过。ESLint、TypeScript、40 路由生产构建与真实 Chrome 56/56 通过。
- 一次性 SQLite 与 PostgreSQL 验证均应用营销迁移 001–016 并通过快照失败保留合同；005 没有新增或修改数据库迁移、运行模型、公开 API、页面或 composition root。生产迁移 audit 为 `PILOT_DATA_READY/ready`、001–016 全 applied、pending 为空。
- 对抗式审查覆盖代码、现实证据、最小变更、架构与应用安全；发布前 P0/P1/P2 均清零。凭据扫描对新增行和 Provider 运行目录为零泄露；历史命中仅为测试 Secret canary，没有生产 Token、Cookie、Authorization、原始百度响应或 0805-002 文件进入提交。
- 正式发布 revision 为 `2c6a36e4018d36d926a44a1ad2fc8825b7320635`，Git Bundle SHA-256 为 `ce76b5515a575d3386701d65ea31ae87e98aba46d16d9799e760557f4172cf1a`。项目部署器完成 Bundle 校验、停服、备份、快进、全量测试、迁移、构建与 systemd 恢复；备份为 `/opt/ai-geo-monitoring/backend/releases/database.pre-2c6a36e4018d36d926a44a1ad2fc8825b7320635.sqlite`。发布树未包含并行 0805-002 工作。
- 公开 `/api/health`、`/api/frontend-health` 精确返回目标 revision，`/api/ready` 为 `ready`。服务器 `main/HEAD` 精确为目标 revision、工作区干净、部署锁不存在；`ai-geo-backend.service` 与 `ai-geo-frontend.service` 各只有一个活动 MainPID。服务器 `origin/main` 是陈旧跟踪引用，不是运行真值。
- 生产只读统一 OAuth 探针在 Token 版本 6 上以同一 Access Context 返回推广计划 32、单元 74、关键词 183、搜索词 14，百度统计站点 1、趋势 1；两个产品均为 `VERIFIED/HAS_DATA` 且前后状态 `UNCHANGED`。扩展只读统计探针另验证站点 5、趋势 1、质量 1、全来源 5、搜索引擎 4、入口页 27、受访页 46，前后状态同样 `UNCHANGED`。
- 正式 API 手动刷新返回 `202 → SUCCEEDED`，覆盖 `2026-07-07` 至 `2026-08-05`。轻量 Dashboard 与 `ad-hierarchy`、`keywords`、`search-terms` 均为 200 且钉扎同一 revision；关键词 921、搜索词 345。数据库只读审计确认成功运行序号 55 被保留，四张事实表分别有 766、1757、4662、706 条日事实，且每张表只关联该同一 `refresh_run_id`。
- `/usr/bin/google-chrome` 从唯一支持入口 `https://insight.guangtuo.com` 打开市场总览、广告表现、关键词、全量搜索词、网站流量、咨询和订单七页；全部文档与目标根节点为 200，无页面异常或登录回退。百度营销、统计与默认项目 API 全部 200；四个 503 只来自既有明确 `DISABLED` 的官网表单区间/逐日接口，页面按既有合同降级。
- 当前正式唯一调用链为 `backend/modules/marketing/index.js → BaiduMarketingClient facade → {BaiduOAuthClient, BaiduSearchAdsClient, BaiduTongjiClient} → 同一 BaiduHttpKernel`。facade 只构造和委托，产品客户端互不依赖；唯一 transport/allowlist 位于内核。旧单体产品逻辑、重复安全实现、双 Provider、feature flag、runtime fallback 和当前文档入口均为零。
- 目标 revision 发布后日志窗口共 117 行，错误模式、秘密模式、刷新失败和旧 Provider/fallback 模式均为 0。发布前旧进程曾有一次 `BAIDU_REQUEST_TIMEOUT`，不属于目标 revision；本次正式刷新与随后 API/页面验证均成功。
- 若后续出现阻断性回归，恢复流程是在本提交后创建显式 revert 后代提交，通过相同正式 Git Bundle 快进发布并重新执行 OAuth、四报表、统计和页面门禁；005 没有 schema 变化，因此不恢复数据库，也不得直接编辑服务器、非快进回退或引入隐藏旧路径。

## Git 提交

- `2764080ffb191ce841bf4d929b1b7cb2d003ca0d`：冻结黑盒等价合同。
- `67515280fda887c42c6240533d9563ad6b803fae`：抽取安全内核与 OAuth 客户端。
- `aa100a0fed3df01937194b2c3ffd79a6f48d4272`：抽取搜索推广客户端。
- `327c762e2a48e558b531e334975d890be5c060aa`：抽取百度统计客户端并清理单体产品逻辑。
- `2c6a36e4018d36d926a44a1ad2fc8825b7320635`：封闭安全内核边界并形成正式发布候选。
