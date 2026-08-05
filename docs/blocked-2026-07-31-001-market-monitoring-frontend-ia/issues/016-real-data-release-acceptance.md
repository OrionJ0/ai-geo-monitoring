---
title: "真实数据本地验收、正式发布与生产逐页验收"
status: closed
type: HITL
blocked_by: []
---

# 真实数据本地验收、正式发布与生产逐页验收

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- [数据接入矩阵](../data-integration-matrix.md)

## Acceptance criteria

- [x] 后端单元、合同、鉴权、迁移、集成测试和前端页面/hook 测试全部通过。
- [x] lint、Next.js production build 和部署检查通过。
- [x] 本地 production build 登录后逐页验证；Playwright 网络证据证明请求真实内部 API，生产路径未启用 fixture。
- [x] 有本地独立只读凭据的来源完成真实上游调用与页面对账；缺少权限的来源保持诚实阻塞。
- [x] 修复代码范围内 P0/P1 审查发现并完成五类 custom agent 复审；API、安全、数据库代码复审均通过，SRE 与 reality checker 仅保留生产外部阻塞。
- [x] 只提交本目标相关文件，推送远端并按正式 Git Bundle 流程快进服务器 `main`。
- [x] 审计并应用迁移，两个 systemd 服务正常，从 `https://insight.guangtuo.com` 登录逐页验证。
- [x] 日志不含 Token、联系人明文或完整上游敏感响应；证明新实现为默认且旧 fallback 未执行。
- [x] Run Report 给出逐页结果、真实调用证据、测试数量、生产状态、外部阻塞和回滚边界。

## 当前生产边界（2026-08-05）

- 本 issue 对应代码已通过正式 Git Bundle workflow 发布，公网健康、服务器 `HEAD` 与前后端 revision 一致；发布后日志敏感信息扫描和无旧 fallback 执行证据已于 2026-08-05 补齐，本 issue 已关闭。
- 官网代码与迁移已部署，但生产仍缺专用官网项目与只读账号凭据，模块为 `DISABLED`。
- 53KF 仍缺当前账户可执行的只读 API 合同和凭据；销售系统按范围约束保持 `UNAVAILABLE`。

## 2026-08-05 11:36 暂时阻塞记录（已解除）

- 11:36 CST 重新请求 `/api/health`、`/api/frontend-health` 与 `/api/ready`：前后端均报告 revision `6894789199afac645c007721d1e70e99a7caca6c`，readiness 为 `ready`。
- 使用正式域名现有登录态进入 `/geo/market-overview`、`/geo/keyword-analysis` 和 `/geo/keyword-analysis/search-terms`；页面显示百度真实数据，关键词页的搜索词证据链接可进入精确下钻，全量搜索词页显示 61 条本期记录。
- 正式页面标记为“百度推广 · 真实数据”；部署 revision 中 fixture 仍受 `NODE_ENV !== 'production'` 硬门约束，搜索词、关键词和广告表现都读取现役 `GET /api/marketing/projects/:projectId/dashboard`。后端正式刷新入口调用四报告 `fetchSearchReports()`，没有从刷新服务回退到旧单报告 provider。
- 上述证据已经闭合“新页面和新 Dashboard 为实际生产路径、页面未运行开发 fixture”；它不能替代服务器日志全文扫描。
- 11:36 时连接 `ubuntu@182.254.140.163` 曾返回 `Permission denied (publickey,password)`，当时无法读取限定时间窗的 Nginx 与 systemd journal，因此本 issue 暂时改为 `blocked`。
- 该阻塞随后已通过用户授权的临时 SSH 会话解除；实际关闭证据见下一节。审计只输出敏感模式命中计数与请求链摘要，没有复制日志原文、Token、联系人信息或完整上游响应。

## 2026-08-05 生产日志审计与关闭证据

- 审计窗口固定为当前 systemd 服务启动前 6 秒至 SSH 退出：2026-08-05 12:17:50–13:23:46 CST。公开 `/api/health`、`/api/frontend-health` 与服务器 `HEAD` 均为 `ba0b1eb3a76ae59847594a7647e68e35eb7bd373`，`/api/ready` 为 `ready`；服务器工作区变更数为 0，两个正式 service 均为 `active`。
- systemd journal 共 12 行，最大单行 119 字节，超过 4096 字节的行数为 0。Access/Refresh Token 键、Bearer/JWT 形态、OAuth `code/state/ticket` 参数、邮箱、境内手机号、联系人字段、原始/上游响应标识、四报表载荷字段、开发 fixture 和旧 provider/fallback 模式的命中数全部为 0。
- Nginx access 共 508 行，其中现役 `GET /api/marketing/projects/:projectId/dashboard` 为 5 次且全部 HTTP 200；旧营销页面、旧报表路由、Token/OAuth 敏感查询参数、邮箱、境内手机号和超长请求行命中数全部为 0。Nginx error 为 0 行；活动配置没有记录 `$request_body`、Authorization 或上游响应体的变量。
- `logs/deployments.log` 共 54 行，最大单行 51 字节；JWT、邮箱、境内手机号、敏感查询参数、原始/上游响应标识和超过 4096 字节的行数全部为 0。服务端源码中营销响应日志调用和全后端 `req.body` 日志调用计数也均为 0。
- 当前服务启动后产生 2 次成功 `ON_DEMAND` 刷新且没有失败运行。最近一次脱敏 run `b0d1d4ff…` 于 13:12:28 CST 完成，在同一 `refresh_run_id` 下同时写入推广计划 768、推广单元 1765、关键词 4739、搜索词 748 条事实。
- 正式调用链为 `MarketingOnDemandDashboardService → MarketingRefreshService.fetchSearchReports() → BaiduMarketingClient.fetchSearchReports()`；刷新服务只接收 `campaigns/adGroups/keywords/searchTerms` 四集合并原子落库。客户端内部的单数 `fetchSearchReport()` 仅是四集合中的推广计划读取器，不是旧单报告 provider，也不存在失败后回退分支。
- 前后端进程均报告 `NODE_ENV=production`，关键词、搜索词和广告表现 fixture 受 `NODE_ENV !== 'production'` 硬门限制；运行日志中的 fixture 命中数为 0。生产仍明确保持 `MARKETING_MONITORING_PILOT_MODE=true`，从 `PILOT_DATA_READY` 提升到 `READY` 的责任继续由营销监控系统维护，不因本 issue 关闭而被误报为完成。
- 审计全程只输出计数、最大长度、脱敏 run 前缀和调用链摘要；没有把日志原文、Token、联系人信息、请求体或上游响应复制到本地、仓库或 issue。

## 本地最终证据（2026-08-04）

- 本次候选测试：后端 994/994、营销 150/150、前端单元/合同 80/80、部署专项 26/26、独占 production server 的 Playwright 28/28；lint 和 38 路由 production build 通过。
- 无 mock 页面入口：本地 production build 登录后逐页访问市场总览、广告表现、关键词分析、网站流量、咨询数据、订单结果和 AI/GEO/SEO 页面；请求均走真实 GoodieAI API，未注册网络拦截。
- 官网事实：市场总览当前区间返回 3 个可归因成功提交会话（直接 2、自然搜索 1）；咨询数据页的原始咨询 30 日列表返回 20 条脱敏表单记录。两者不是同一指标，不做强行归因。
- 诚实缺失：本机无百度生产 Token；真实四报表在生产使用数据库密文 Token 只读刷新。官网生产为 `DISABLED`，53KF 为 `NOT_CONNECTED`；订单生产态为 `UNAVAILABLE` 且没有订单 API 请求。
- 生产真实页：关键词页显示 863 条有展现、237 条有点击关键词，广告表现显示消费/展现/点击，网站流量返回访问 53、UV 45、PV 112；AI 项目看板和引用来源返回既有真实记录。
- Run Report：`work/market-workbench-real-data-run-report-20260804.html`（工作区报告，不进入 Git）。
