---
title: "退役旧趋势链并完成正式入口验收"
status: open
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

- [ ] 仓库搜索和部署访问日志证明旧固定趋势接口没有剩余消费者，或已记录完整迁移阻塞。仓库消费者已清零；生产日志因当前机器缺少 SSH 身份仍待核验。
- [x] 无消费者时删除旧公开路由、专属 service 包装、测试和现役 API 文档，不保留 fallback。
- [x] 后端营销测试、前端测试、浏览器测试、lint 和 build 全部通过。
- [x] 代码和文档不再把旧标签或旧趋势接口写成当前正式流程。
- [ ] 通过正式 Git Bundle workflow 发布，不直接编辑服务器源码。
- [ ] 从 `https://insight.guangtuo.com` 登录后验证新请求实际命中、旧请求未命中。
- [ ] 首页、广告表现页和网站流量页在相同范围的共享指标完成对账。
- [ ] 官网、53KF、线索和订单继续按真实生产状态显示，不用 fixture 补齐。
- [ ] 正式 selector、页面截图、网络请求、revision 和服务器版本证据写入需求目录。本地证据与生产发布前基线见 `../acceptance-evidence.md`。

## Blocked by

None. 当前剩余门禁是生产 SSH / GitHub 身份，不是实现 issue 依赖。
