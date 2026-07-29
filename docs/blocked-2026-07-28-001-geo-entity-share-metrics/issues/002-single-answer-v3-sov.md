---
title: "让单问题运行产出并展示新版 SOV"
status: closed
type: AFK
blocked_by:
  - "001-version-and-migration.md"
---

# 让单问题运行产出并展示新版 SOV

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-2、US-3、US-4
- 重点验收：AC-001 至 AC-004、AC-006、AC-008、AC-009、AC-023、AC-028 至 AC-030、AC-032、AC-T01 至 AC-T03

## What to build

打通一条可演示的单问题新版分析路径：分析模型同时获得当前问题和完整回答，逐个判断非目标企业实体是否为当前竞品并给出理由；程序根据原文确定性计算提及次数和单条 SOV；单条详情通过版本化接口展示分子、分母、竞品、非竞品和理由。

## Acceptance criteria

- [x] 新分析契约包含问题、完整回答、目标品牌上下文和仅作提示的人工竞品信息，不再静默截断回答。
- [x] 每个被提及的非目标 `brand/company` 实体都恰好具有竞品或非竞品判断及非空理由，非法或不完整输出整条失败。
- [x] 人工已配置竞品不会自动进入分母，未配置但构成当前替代关系的实体可以进入分母。
- [x] 程序根据可定位短名称执行重叠消解和独立提及计数，AI 输出不包含次数或 SOV。
- [x] 单条 SOV 正确覆盖仅目标品牌 `100%`、仅竞品 `0%`、双方均无提及 `N/A` 以及多次独立提及。
- [x] 相同原文、关系和契约版本重复计算得到相同分子、分母和 SOV。
- [x] 单条详情展示新版完整名称、分子、分母、竞争实体关系、次数、理由和分析版本。
- [x] 行为测试证明单问题新记录写入新版字段，且不写旧配置竞品 SOV。

## Blocked by

- [001-version-and-migration.md](001-version-and-migration.md)

## Verification

- `node --test tests/AIResponseAnalysisService.test.js tests/ProjectRunService.test.js tests/QuestionSetRunStart.test.js tests/QuestionSetRunService.test.js tests/AIAnalysisSettingsApi.test.js tests/GeoMetricSemanticsService.test.js`：92/92 通过。
- `npm test`（backend）：810/810 通过。
- `node --test src/utils/questionSetReportPage.test.cjs`：12/12 通过。
- `npx eslint src/app/geo/question-set-reports/page.tsx src/utils/questionSetReportPage.test.cjs`：通过。
- `npm run build`（nextjs-frontend）：生产构建和 TypeScript 检查通过。
