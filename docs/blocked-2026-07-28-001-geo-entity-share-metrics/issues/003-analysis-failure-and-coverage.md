---
title: "正确处理分析失败和分析覆盖率"
status: closed
type: AFK
blocked_by:
  - "001-version-and-migration.md"
  - "002-single-answer-v3-sov.md"
---

# 正确处理分析失败和分析覆盖率

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-1、US-6、US-7
- 重点验收：AC-011、AC-017、AC-021、AC-027、AC-030、AC-032、AC-T05、AC-T10

## What to build

让已采集回答在结构化分析失败时保持原始事实和可核验引用，但不产生任何品牌表现指标。项目和运行结果必须把失败只反映为分析覆盖率下降，并向用户展示稳定、脱敏的失败原因。

## Acceptance criteria

- [x] 分析平台不可用、输入超限、输出截断、关系缺失和结构非法具有稳定错误码及用户可读状态。
- [x] 分析失败保留完整原回答、平台引用、分析契约版本和指标语义版本，不创建新版指标记录。
- [x] analysis-only 重试继续使用完整原回答和新版契约，不调用截断、分段或旧分析实现。
- [x] 品牌提及率、SOV、推荐率、排名和情绪均排除失败回答，失败回答只进入分析覆盖率分母。
- [x] 分析覆盖率展示成功分析数、已采集回答数和值；不存在把缺失指标转换为零的路径。
- [x] 日志只记录记录标识、平台、版本、阶段和错误码，不记录完整问题、完整回答、原始模型输出或密钥。
- [x] 行为测试覆盖成功、各类失败、失败后重试和终态并发保护。

## Blocked by

- [001-version-and-migration.md](001-version-and-migration.md)
- [002-single-answer-v3-sov.md](002-single-answer-v3-sov.md)

## Verification

- `node --test tests/AIPlatformRequestService.test.js tests/AIResponseAnalysisService.test.js tests/ProjectRunService.test.js tests/QuestionSetRunService.test.js`：98/98 通过。
- `node --test src/utils/questionSetReportPage.test.cjs`：13/13 通过。
- `npx eslint src/app/geo/question-set-reports/page.tsx src/utils/questionSetReportPage.test.cjs`：通过。
- `npm test`（backend）：815/815 通过。
- `npm run build`（nextjs-frontend）：生产构建和 TypeScript 检查通过。
