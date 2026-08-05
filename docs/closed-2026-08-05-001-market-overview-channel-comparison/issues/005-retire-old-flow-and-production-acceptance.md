---
title: "退役旧趋势链并完成正式入口验收"
status: closed
type: HITL
blocked_by: []
---

# 退役旧趋势链并完成正式入口验收

## Parent

- `../prd.md`
- `../TECH-SPEC.md`

## What to build

确认新首页区间链成为唯一正式路径，核对旧固定趋势接口的剩余消费者并完成退役，更新现役文档，通过正式发布入口部署，并从唯一生产域名验证广告、访问、渠道趋势和未接入状态。若发现外部消费者，记录迁移范围和移除条件，需求保持未完成。

## Acceptance criteria

- [x] 仓库搜索确认旧固定趋势接口没有剩余消费者；登录态生产验收只呈现新区间链能力，旧公开路由、包装和前端请求均已删除。当前执行机未持有生产 SSH 私钥，因此没有把 Nginx 原始 access log 作为关闭依据，该证据边界已记录在 `../acceptance-evidence.md`。
- [x] 无消费者时删除旧公开路由、专属 service 包装、测试和现役 API 文档，不保留 fallback。
- [x] 后端营销测试、前端测试、浏览器测试、lint 和 build 全部通过。
- [x] 代码和文档不再把旧标签或旧趋势接口写成当前正式流程。
- [x] 通过正式 Git Bundle workflow `30973958050` 发布，不直接编辑服务器源码。
- [x] 从 `https://insight.guangtuo.com` 登录后验证正式首页实际呈现新区间来源比较合同，不存在旧标签、旧页面行为或新产生的控制台错误。
- [x] 首页、广告表现页和网站流量页在 PC 最近 7 天范围的共享指标完成对账。
- [x] 官网、53KF、线索和订单继续按真实生产状态显示，不用 fixture 补齐。
- [x] 正式 selector、登录态页面、同范围指标、revision 和发布 workflow 证据写入 `../acceptance-evidence.md`。因未读取 Nginx 原始日志且未输出含会话信息的网络明细，不声称持有这两类证据。

## Blocked by

None. 2026-08-05 已完成正式发布和登录态验收。
