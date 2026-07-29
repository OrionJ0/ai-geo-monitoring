---
title: "升级项目看板聚合和平台筛选"
status: closed
type: AFK
blocked_by:
  - "001-version-and-migration.md"
  - "002-single-answer-v3-sov.md"
  - "003-analysis-failure-and-coverage.md"
---

# 升级项目看板聚合和平台筛选

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-1、US-3、US-6
- 重点验收：AC-005、AC-006、AC-011、AC-017、AC-024、AC-026、AC-036 至 AC-038、AC-T04、AC-T07、AC-T08、AC-T10

## What to build

让项目看板只聚合新版指标：每条可计算回答先独立计算 SOV，再等权平均。看板默认合并所选周期内全部实际平台，并允许切换到任一单个平台；项目当前平台配置不得隐藏已经产生的历史记录。

## Acceptance criteria

- [x] 唯一聚合逻辑对单条 SOV 等权平均，不先汇总全部提及次数；返回可计算回答数。
- [x] `N/A` 不进入平均值，零值仍作为可计算回答参与，失败回答只影响覆盖率。
- [x] 品牌提及率、推荐率、平均排名和分析覆盖率同时返回对应样本数。
- [x] 看板默认选择全部平台，单平台筛选只改变回答集合，不改变任何公式。
- [x] 可选平台来自周期内实际历史记录，而不是项目当前配置；移除平台后历史仍可查看。
- [x] 旧口径记录不参与新版汇总或趋势，新旧口径不拼接为连续序列。
- [x] 页面使用完整指标名称并显示有效回答数，不显示未解释的 `n` 或伪零值。
- [x] API 和页面行为测试覆盖合并平台、单平台、空平台、非法平台、移除平台和新旧数据并存。

## Blocked by

- [001-version-and-migration.md](001-version-and-migration.md)
- [002-single-answer-v3-sov.md](002-single-answer-v3-sov.md)
- [003-analysis-failure-and-coverage.md](003-analysis-failure-and-coverage.md)

## Verification

- `node --test tests/ProjectMetricsService.test.js tests/GeoProjectsRoutePolicy.test.js`：44/44 通过。
- `npm test`（backend）：822/822 通过。
- `node --test src/utils/*.test.cjs`：232/232 通过。
- 前端 ESLint：通过。
- `npm run build`（nextjs-frontend）：生产构建和 TypeScript 检查通过。
