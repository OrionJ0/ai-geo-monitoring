---
title: "正式硬切模块化 Provider 并完成等价验收"
status: open
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

- [ ] 全量单元、特征、集成、数据库无 schema diff 和凭据扫描通过。
- [ ] 正式模块只构造一个 facade、一个内核和每类一个产品客户端，没有双 provider、feature flag 或 runtime fallback。
- [ ] 公开健康接口返回目标 revision，`/api/ready` 为 ready。
- [ ] 正式 OAuth、四报表、统计站点/趋势/来源/页面和全部营销页面从受支持域名通过。
- [ ] 请求预算、来源、日期、精确指标、快照完整性和稳定错误与重构前证据等价。
- [ ] 旧单体实现、专属测试、失效说明和生产引用全部删除，当前文档只描述模块化路径。
- [ ] 阻断失败的恢复方案使用后代 revert revision 快进，不重新启用隐藏旧路径。

## Blocked by

- [Issue 004：抽取百度统计客户端并删除单体产品逻辑](004-extract-tongji-client-and-remove-monolith.md)。
