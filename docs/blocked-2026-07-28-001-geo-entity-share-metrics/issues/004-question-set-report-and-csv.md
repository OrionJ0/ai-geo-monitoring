---
title: "升级问题集报告、PDF 和 CSV"
status: closed
type: AFK
blocked_by:
  - "001-version-and-migration.md"
  - "002-single-answer-v3-sov.md"
  - "003-analysis-failure-and-coverage.md"
---

# 升级问题集报告、PDF 和 CSV

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-3、US-4、US-6
- 重点验收：AC-007、AC-008、AC-010、AC-024、AC-026、AC-029、AC-035、AC-T09、AC-T09A、AC-T13

## What to build

让单次问题集报告只使用本次运行的数据展示新版 SOV 和逐条竞争关系证据，同时保持历史 native、快照和导入报告的旧值、旧名称及只读能力。PDF 和 CSV 必须携带可判定的指标版本并正确表达 `N/A`。

## Acceptance criteria

- [x] 新旧问题集报告统一提供版本化 `sov` 和 `sov_summary`，正式页面不通过字段缺失或数值猜测版本。
- [x] 新报告展示新版 SOV、有效回答数、分析覆盖率、竞争实体次数和判断理由；历史报告显示历史竞品配置口径。
- [x] 新报告不返回或生成无版本语义的旧 SOV 标量，历史兼容响应保持原值。
- [x] 问题集聚合只读取当前运行，不受项目其他批次的平台或问题集合变化影响。
- [x] PDF 正确展示 `0%`、`100%`、`N/A`、长理由和多实体列表。
- [x] CSV 在旧格式尾部扩展新版字段；旧文件继续可导入，新文件不把新版 SOV 写入旧列。
- [x] CSV 校验拒绝混合指标版本、非法分子分母、非法关系和无效竞争实体证据。
- [x] 新旧报告与 CSV 往返测试通过，且不会把历史数据纳入新版项目聚合。

## Blocked by

- [001-version-and-migration.md](001-version-and-migration.md)
- [002-single-answer-v3-sov.md](002-single-answer-v3-sov.md)
- [003-analysis-failure-and-coverage.md](003-analysis-failure-and-coverage.md)

## Verification

- `node --test tests/QuestionSetRunCsvValidation.test.js tests/QuestionSetRunService.test.js tests/QuestionSetRunApi.test.js`：39/39 通过。
- `npm test`（backend）：818/818 通过。
- `node --test src/utils/*.test.cjs`：231/231 通过。
- 前端 ESLint：通过。
- `npm run build`（nextjs-frontend）：生产构建和 TypeScript 检查通过。
