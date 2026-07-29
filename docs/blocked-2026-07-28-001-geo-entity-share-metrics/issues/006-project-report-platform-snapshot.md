---
title: "升级项目报告快照和平台视图"
status: closed
type: AFK
blocked_by:
  - "005-project-dashboard-platform-view.md"
---

# 升级项目报告快照和平台视图

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-3、US-6
- 重点验收：AC-005、AC-010、AC-024、AC-026、AC-034、AC-036 至 AC-038、AC-T07 至 AC-T10、AC-T13

## What to build

让新项目报告快照在生成时一次固化全部平台和各单平台的核心指标视图。报告默认显示全部平台，切换平台只读取快照内视图；历史旧快照继续按原口径展示且不被重算。

## Acceptance criteria

- [x] 新快照保存明确的指标语义版本，并在同一批历史数据上生成全部平台和逐平台视图。
- [x] 全部和单平台视图复用项目看板的唯一聚合逻辑，每个平台不重复查询数据库。
- [x] 平台视图来自报告周期内实际历史记录，项目当前配置不会隐藏已移除平台的数据。
- [x] 报告默认显示全部平台，切换平台不修改或重新生成快照。
- [x] 最新报告接口不跨快照聚合；旧快照保留原值、原名称和历史竞品配置口径标签。
- [x] 报告明确稳定非品牌词问题集合和人工比较基线使用规范，不实现自动问题版本逻辑。
- [x] 行为测试覆盖新旧快照、合并与单平台视图、移除平台、空平台和快照不可变性。

## Blocked by

- [005-project-dashboard-platform-view.md](005-project-dashboard-platform-view.md)

## Verification

- `node --test tests/ReportSnapshotService.test.js`：9/9 通过。
- `npm test`（backend）：823/823 通过。
- `node --test src/utils/*.test.cjs`：234/234 通过。
- 前端 ESLint：通过。
- `npm run build`（nextjs-frontend）：生产构建和 TypeScript 检查通过。
