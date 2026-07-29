---
title: "统一告警、洞察、历史与导出指标语义"
status: closed
type: AFK
blocked_by:
  - "004-question-set-report-and-csv.md"
  - "005-project-dashboard-platform-view.md"
  - "006-project-report-platform-snapshot.md"
---

# 统一告警、洞察、历史与导出指标语义

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-3、US-5、US-6
- 重点验收：AC-007、AC-012 至 AC-016、AC-018、AC-026、AC-T09A、AC-T10

## What to build

让所有剩余正式消费者使用同一版本化指标契约和诚实术语。推荐率、情绪、排名、引用、告警、机会洞察、历史页面和导出都必须正确表达数据来源、样本数与 `N/A`，并清除“综合得分”等超出实际含义的说法。

## Acceptance criteria

- [x] 用户可见的 `visibility_score` 统一称为“品牌提及次数”，不再称为可见度得分或综合得分。
- [x] 推荐率只统计明确推荐并标注“AI 语义分析”；普通列举不计为推荐。
- [x] 情绪标注“AI 语义分析”，平均排名展示有效排名回答数，引用指标继续只依赖平台证据。
- [x] 告警和洞察使用版本化 SOV 与明确的提及次数语义，不读取旧标量或将 `N/A` 转为零。
- [x] 竞品领先类判断和文案明确比较竞品提及次数，不声称综合表现。
- [x] 历史页面和导出能够区分新旧口径，比例展示分子分母，平均值展示有效回答数。
- [x] 前端、导出、告警和洞察回归测试覆盖新版、旧历史、`N/A` 和分析失败。

## Blocked by

- [004-question-set-report-and-csv.md](004-question-set-report-and-csv.md)
- [005-project-dashboard-platform-view.md](005-project-dashboard-platform-view.md)
- [006-project-report-platform-snapshot.md](006-project-report-platform-snapshot.md)

## Verification

- 告警、洞察、问题库、运行结果、历史详情和项目报告 CSV 定向回归：后端 142/142、前端 60/60 通过。
- `npm test`（backend）：828/828 通过。
- `node --test src/utils/*.test.cjs src/utils/*.test.mjs`：259/259 通过。
- 前端 ESLint：通过。
- `npm run build`（nextjs-frontend）：生产构建和 TypeScript 检查通过。
- 新版 SOV 读取会拒绝与分子分母不一致的值；全分析失败的问题集将品牌提及率和推荐率显示为 `N/A`，不会产生伪 `0%`。
