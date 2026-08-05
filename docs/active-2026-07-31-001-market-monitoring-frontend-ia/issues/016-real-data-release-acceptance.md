---
title: "真实数据本地验收、正式发布与生产逐页验收"
status: open
type: AFK
blocked_by:
  - "生产发布与正式域名验收"
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
- [ ] 日志不含 Token、联系人明文或完整上游敏感响应；证明新实现为默认且旧 fallback 未执行。
- [x] Run Report 给出逐页结果、真实调用证据、测试数量、生产状态、外部阻塞和回滚边界。

## 当前生产外部阻塞（2026-08-04）

- Git Bundle workflow 已有成功发布基线；本次共享工作台与数据韧性候选仍须按同一正式流程部署，并以公网健康检查返回的构建修订为准。
- 官网代码与迁移已部署，但生产仍缺专用官网项目与只读账号凭据，模块为 `DISABLED`。
- 53KF 仍缺当前账户可执行的只读 API 合同和凭据；销售系统按范围约束保持 `UNAVAILABLE`。

## 本地最终证据（2026-08-04）

- 本次候选测试：后端 994/994、营销 150/150、前端单元/合同 80/80、部署专项 26/26、独占 production server 的 Playwright 28/28；lint 和 38 路由 production build 通过。
- 无 mock 页面入口：本地 production build 登录后逐页访问市场总览、广告表现、关键词分析、网站流量、咨询数据、订单结果和 AI/GEO/SEO 页面；请求均走真实 GoodieAI API，未注册网络拦截。
- 官网事实：市场总览当前区间返回 3 个可归因成功提交会话（直接 2、自然搜索 1）；咨询数据页的原始咨询 30 日列表返回 20 条脱敏表单记录。两者不是同一指标，不做强行归因。
- 诚实缺失：本机无百度生产 Token；真实四报表在生产使用数据库密文 Token 只读刷新。官网生产为 `DISABLED`，53KF 为 `NOT_CONNECTED`；订单生产态为 `UNAVAILABLE` 且没有订单 API 请求。
- 生产真实页：关键词页显示 863 条有展现、237 条有点击关键词，广告表现显示消费/展现/点击，网站流量返回访问 53、UV 45、PV 112；AI 项目看板和引用来源返回既有真实记录。
- Run Report：`work/market-workbench-real-data-run-report-20260804.html`（工作区报告，不进入 Git）。
