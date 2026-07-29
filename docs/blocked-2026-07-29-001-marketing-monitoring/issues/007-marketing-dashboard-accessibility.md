---
title: "完成营销看板与自动化无障碍"
status: blocked
type: AFK
blocked_by:
  - "006-refresh-token-lifecycle.md"
---

# 完成营销看板与自动化无障碍

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 覆盖：US-003～US-009

## Goal

从正式导航交付只读营销看板，完整呈现项目、账户、覆盖范围、汇总、趋势、推广计划明细和独立状态，并完成自动化键盘与无障碍验收。

## Scope

- 营销项目页与管理员连接/绑定入口。
- 本地快照首屏、run 轮询、完成后整页 revision 重读。
- 日期仅筛选本地 30 天快照。
- 图表、等价数据表和来源外链。
- 增加可复制执行的 Playwright/axe runner 与 `test:marketing:browser` script。
- 浏览器 script 自行管理隔离测试服务的启动/关闭，固定页面 URL、状态 fixtures、报告目录和失败退出规则。
- 本 issue 不做真实 VoiceOver 人工验收，留给 Issue 009。

## Acceptance Criteria

- [ ] 登录用户从真实导航进入有权项目；普通用户看不到连接/绑定管理。
- [ ] 活动项目可刷新，归档项目展示保存覆盖范围并明确只读。
- [ ] 页面首屏不等待百度，刷新中继续展示完整旧快照。
- [ ] module/project、snapshot content/freshness、refresh 和逐绑定 source/binding/阻断状态有独立文案与恢复动作。
- [ ] 页面不存在 `PARTIAL` 或信息流状态。
- [ ] 日期筛选只在 coverage 内生效；错误与控件有可访问关联。
- [ ] 推广计划表包含账户、计划 ID/名称、展现、点击和消费。
- [ ] 完整列表不被静默截断；若契约门要求分页，必须先修订规格。
- [ ] 图表不混用金额与计数数值轴，并提供等价逐日表格。
- [ ] 状态、禁用原因和失败不能只靠颜色表达。
- [ ] 单一持久 polite live region 只在运行语义变化时去重播报；轮询和 revision 更新不移动焦点。
- [ ] 授权结果、账户目录、绑定、暂停、恢复、断开的 loading/empty/success/error 有可访问文案、焦点和重试动作。
- [ ] 对话框定义初始焦点、焦点陷阱、Escape 和关闭后恢复；字段 label 与错误关联。
- [ ] 项目/日期快速切换时旧请求不能覆盖新 revision。
- [ ] 外链明确将离开本站；页面没有任何投放写控件。
- [ ] 320 CSS px、400% 缩放、长文本/大数值、键盘顺序、可见焦点、对比度和 axe 自动检查通过。

## Verification

```bash
npm --prefix nextjs-frontend test
npm --prefix nextjs-frontend run test:marketing:browser
npm --prefix nextjs-frontend run lint
npm --prefix nextjs-frontend run build
node --test backend/tests/marketing/MarketingDashboardApi.test.js
npm --prefix backend test
git diff --check
```

自动化浏览器证据：

- Playwright/axe 报告和截图保存到明确的测试产物目录，任一场景失败使命令非零。
- 仅键盘完成授权发起/结果、账户绑定、暂停、恢复、断开、项目选择、日期筛选、刷新和外链。
- axe 覆盖 loading、403/404/422、授权结果未知、账户目录空/失败、有数据、零数据、陈旧、刷新失败、需重授权和归档。
- 视口覆盖 320px、桌面宽度、400% 缩放和长账户/计划/ID/金额夹具。

## Blocked by

- `006-refresh-token-lifecycle.md`

## 2026-07-29 工程进展

- 已完成营销看板、管理员连接/项目绑定设置和 queryless 授权结果页；未核验时只显示清晰边界，不展示假数据。
- Chrome 浏览器验收已覆盖 fresh data、超长 ID/名称、大数值、键盘焦点、axe、320 CSS px、400% 缩放和截图。
- 页面使用单一 polite live region、逐日图形的等价原生表格、明确离站链接和本地日期筛选。
- 全状态 fixture、真实授权/绑定交互和 VoiceOver 人工路径仍依赖上游与 Issue 009，本 issue 不关闭。
