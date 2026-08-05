---
title: "发布并验收营销生产数据正确性"
status: active
type: HITL
blocked_by:
  - "002-deliver-ad-performance-period-comparison.md"
  - "003-deliver-keyword-period-comparison.md"
  - "004-deliver-tongji-source-partition.md"
  - "005-disambiguate-tongji-page-path-collisions.md"
---

# 发布并验收营销生产数据正确性

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-1：广告和关键词真实双周期在生产可用。
- US-2：来源覆盖状态在生产诚实可见。
- US-3：同路径入口页记录在生产可区分。
- US-4：本地回归证据与生产响应形状一致。
- US-5：正式入口逐页验收后才关闭需求并解除 005 门禁。

## What to build

完成 007 的发布、生产观察和关闭证据。先运行聚焦合同、前端、浏览器和敏感信息回归，再通过正式 Git Bundle 工作流发布；从唯一支持域名使用真实 Chrome 逐页检查市场总览、广告表现、关键词、搜索词、网站流量和入口页，并把页面显示与 Network 响应逐项对账。

验收同时确认官网、53KF、销售线索、成交订单和营销 AI 的真实模块状态没有被补零或误报接入。只有目标 revision、双周期、来源分区、同路径消歧、隐私扫描和遗留 P0/P1 全部通过后，才能关闭 007 并解除 005 Issue 001 的门禁。

## Acceptance criteria

- [x] Issue 002–005 全部通过各自自动化验收，聚焦与相关全量回归无阻断失败。
- [x] fixture、代码、日志和 Git diff 的秘密及个人信息扫描为零，人工复核确认没有生产 Token、原始报文或真实敏感业务明细。
- [ ] 正式 backend/frontend revision 与目标 Git Bundle 一致，公开健康与 `/api/ready` 通过，部署未启动第二套服务。
- [ ] 广告表现和关键词页面的 Network 均存在 current/previous 请求，两个周期日期等长相邻并使用同一 revision、currency 和 cost scale。
- [ ] 可用上期显示真实比较；上期不可用显示不可用；精确零、null 和错误没有互相冒充。
- [ ] 网站流量页面显示生产来源分区状态，总访问、已分类访问和 residual 与接口精确一致，residual 未变成业务来源。
- [ ] 入口页相同规范化路径记录具有稳定消歧标签，刷新、排序、分页和响应式场景不产生身份漂移或指标合并。
- [ ] 市场总览十进制字符串修复和搜索词现役周期比较继续通过真实浏览器回归。
- [ ] 官网、53KF、销售线索、成交订单和营销 AI 按真实连接状态展示，未接入数据不补零、不计算 CPA/成交率、不宣称已接入。
- [ ] 生产观察期内本需求 P0/P1 为零；若出现阻断回归，只使用后代 revert revision 经正式流程恢复，不重新启用旧 Dashboard 或隐藏 fallback。
- [ ] 验收证据记录目标 revision、请求路径、filter、状态码、关键对账值和页面结果；fixture 或本地测试没有被当成生产证据。
- [ ] 007 目录关闭后，005 Issue 001 才可开始，并以 007 修正后的行为冻结 Provider 等价合同。

## Blocked by

- [Issue 002：交付广告表现真实双周期比较](002-deliver-ad-performance-period-comparison.md)。
- [Issue 003：交付关键词真实双周期比较](003-deliver-keyword-period-comparison.md)。
- [Issue 004：交付百度统计来源分区完整性](004-deliver-tongji-source-partition.md)。
- [Issue 005：交付百度统计同路径页面消歧](005-disambiguate-tongji-page-path-collisions.md)。

## 发布前证据（2026-08-06）

- 后端：营销测试 `231/231`，全后端测试 `994/994`。
- 前端：单元/合同测试 `123/123`，ESLint、TypeScript 和 40 路由生产构建通过。
- 真实 Chrome：营销全套 `56/56`；覆盖广告/关键词双周期、对象级上期身份缺失、来源 `COMPLETE/PARTIAL/INVALID`、全站逐日访问缺失、同路径消歧、响应式和键盘/无障碍树。
- 对抗式复审：代码、现实证据、最小变更、API 和无障碍专项均为 P0/P1 零；保留一个不阻断发布的 P2——关键词翻页会重复读取不变的上期汇总，未在正确性需求中扩大修改范围。
- 隐私：最终 diff 未包含生产 Token、Cookie、`.env`、数据库、原始百度响应或个人信息；命中的 `access-token-fixture` 是既有测试使用的显式合成占位值。
- 当前正式入口仍为 `https://insight.guangtuo.com`，生产 revision 仍为上一版 `d9b0688e28ba9b3a33fcfb061fe7d7235388ec22`；本节只证明发布候选，生产验收项保持未勾选。
