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
- [ ] 只提交本目标相关文件，推送远端并按正式 Git Bundle 流程快进服务器 `main`。
- [ ] 审计并应用迁移，两个 systemd 服务正常，从 `https://insight.guangtuo.com` 登录逐页验证。
- [ ] 日志不含 Token、联系人明文或完整上游敏感响应；证明新实现为默认且旧 fallback 未执行。
- [x] Run Report 给出逐页结果、真实调用证据、测试数量、生产状态、外部阻塞和回滚边界。

## 当前生产发布阻塞（2026-08-04）

- 桥接提交 `2bbd8c4` 已推送到 GitHub `main`，服务器尚未安装该桥接版本。
- workflow `30842859133` 因 `AI_GEO_DEPLOY_ENABLED=false` 跳过；`30842939667` 在 SCP 前因 production Environment 缺少 SSH secrets 失败，未连接服务器、未停止服务、未执行迁移。
- 发布开关已恢复为 false。必须先配置四个 SSH secrets、确认 forced-command 公钥与主机指纹、安排数据库恢复值守，再单独部署桥接；第二阶段业务提交在桥接成功前不得推送。

## 本地最终证据（2026-08-04）

- 测试：后端 994/994、营销 131/131、官网数据 28/28、咨询记录 35/35、前端单元 72/72、部署专项 26/26、Playwright 23/23；lint 和 38 路由 production build 通过。
- 无 mock 页面入口：本地 production build 登录后逐页访问市场总览、广告表现、关键词分析、网站流量、原始咨询、订单结果和 AI/GEO/SEO 页面；请求均走真实 GoodieAI API，未注册网络拦截。
- 官网事实：市场总览当前区间返回 3 个可归因成功提交会话（直接 2、自然搜索 1）；原始咨询 30 日列表返回 20 条脱敏表单记录。两者不是同一指标，不做强行归因。
- 诚实缺失：本机无百度真实 Token，营销能力门关闭且不请求 Dashboard；53KF 为 `NOT_CONNECTED`；订单生产态为 `UNAVAILABLE` 且没有订单 API 请求。
- Run Report：`work/market-workbench-real-data-run-report-20260804.html`（工作区报告，不进入 Git）。
