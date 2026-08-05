---
title: "用生产只读探针证明统一 OAuth 前提"
status: open
type: HITL
blocked_by: []
---

# 用生产只读探针证明统一 OAuth 前提

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-4：在不可逆切换前先取得真实生产证据。
- US-5：用最小变更证明统一凭据前提，不提前重构运行路径。

## What to build

交付一个只在生产服务器仓库内运行的无状态只读探针，并通过 tooling-only Git Bundle 执行。探针使用当前数据库密文对应的 OAuth Access Token，按现役预算依次验证账户目录、搜索推广四报表、百度统计站点目录和目标站点最小数据请求；不得触发 Token 刷新、重新授权、绑定变更、快照写入或业务服务重启。

输出只保留脱敏状态、日期、行数、哈希和 Token 版本。探针结果是后续实施的硬门禁：同一 Token 双产品通过才可进入 Issue 002；权限、用户名、站点或 Token 前提失败时，需求改为 `blocked`，不能加入双 Token fallback。需要重新授权时必须另行批准维护窗口。

## Acceptance criteria

- [ ] 探针只接受 connection、project 和受限日期参数，不接受 Token、Secret、任意 URL 或任意上游方法。
- [ ] 探针直接读取当前 Access Token，不调用自动刷新、OAuth callback、重新授权或任何百度写 API。
- [ ] 搜索推广账户与计划、单元、关键词、搜索词四份报告使用现役 allowlist、双读、限流和整轮预算完成合同校验。
- [ ] 百度统计使用同一 Token 和已确认 userName 完成 `getSiteList`、目标 site/domain 匹配及最小 `getData` 合同校验。
- [ ] 合法无数据、权限不足、Token 过期、用户名不匹配、站点缺失、限流和上游失败被明确区分。
- [ ] 探针前后连接状态、auth generation、token version、密文、绑定状态和业务事实完全不变，并有自动化副作用断言。
- [ ] 输出不包含完整 connection/site ID、Token、Secret、站点列表、关键词、搜索词或百度原始错误正文。
- [ ] tooling-only revision 不包含迁移、模块装配或业务运行路径变化，也不重启正式 backend/frontend。
- [ ] 双产品通过时保存脱敏证据并解除 Issue 002 门禁；任一硬停止条件成立时目录改为 `blocked`，U2–U5 不开始。

## Blocked by

None - can start immediately.
