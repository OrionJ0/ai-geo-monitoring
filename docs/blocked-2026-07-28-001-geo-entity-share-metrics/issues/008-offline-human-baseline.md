---
title: "完成人工基线和多实体竞品审查"
status: closed
type: HITL
blocked_by:
  - "002-single-answer-v3-sov.md"
---

# 完成人工基线和多实体竞品审查

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-2、US-3、US-4、US-5
- 重点验收：AC-019、AC-020、AC-031、AC-T14

## What to build

升级离线基线流程并由人工完成标注确认，评估新版分析在目标品牌、推荐、排名、情绪和回答级竞品关系上的表现。评估结果只形成离线报告，不进入生产运行逻辑或单条指标门禁。

## Acceptance criteria

- [x] 基线缓存和输出明确使用新版分析契约，旧缓存不能冒充新版结果。
- [x] 40 条样本记录目标品牌提及、次数、推荐、排名、情绪和生产已存指标对比。
- [x] 10 条多实体样本记录完整企业实体清单、别名拆分、竞品真值、错误纳入、错误排除及 SOV 影响。
- [x] 报告包含逐字段结果、推荐混淆矩阵、Wilson 95% 区间、分平台结果和样本限制。
- [x] 未完成标注不能生成正式结论，partial 模式只处理已经完整标注的样本。
- [x] 约 10% 的错误纳入与排除目标只出现在人工评审报告，不被生产代码、配置或运行时读取。
- [x] 人工完成并确认标注和评审结论。

## Blocked by

- [002-single-answer-v3-sov.md](002-single-answer-v3-sov.md)

## Automation completed

- 已从只读原始数据库备份生成 `work/geo-baseline-2026-07-28/`：40 条真实回答，DeepSeek API、DeepSeek Web、豆包和千问各 10 条，其中 10 条标记为多实体复核。
- 工作表固定声明 `ai_structured_v3`、`geo_metric_input_v3` 与 `contextual_competitor_mentions_sov_v1`，并要求 `human_review_confirmed: yes`。
- 多实体真值使用 `entity_labels_json` 记录完整企业实体、人工归并别名、实际提及次数和 `target / competitor / non_competitor` 关系。
- 报告代码已实现逐字段结果、推荐混淆矩阵、Wilson 95% 区间、分平台结果、错误纳入、错误排除、别名拆分和 SOV 偏差。
- `node --test tests/GeoBaselineScripts.test.js`：6/6 通过。
- 未标注状态下执行正式评测，按预期以 41 处未完成项拒绝生成报告。
- 8 个子 agent 完成 40 条分段盲标，2 个子 agent 完成两组独立盲审，3 个子 agent 完成多实体第三轮裁决；40 条核心字段仅 S15 的推荐判定出现一次分歧，其余 39 条完全一致。
- 另由 4 个分组复核 agent 和 1 个跨样本口径审计 agent 专项复核 S15 与 10 条多实体样本；修正 S34 的国产竞品边界和 HomeKit 产品/企业别名混用，S15 经交叉裁决继续判为明确优先认可。
- AI 预标已写入 `work/geo-baseline-2026-07-28/LABELING.md`，用户确认后已写入 `human_review_confirmed: yes`；裁决依据记录在 `work/geo-baseline-2026-07-28/AI-REVIEW.md`。
- 早期 `qwen/qwen3.7-plus` 重跑为 34/40 成功，6 条无效结构输出按 fail-closed 排除；该结果只保留在 `BASELINE-PARTIAL.md` 作为历史阶段记录。
- 2026-07-29 正式分析配置硬切为 `deepseek/deepseek-v4-pro` 后执行 `node backend/scripts/geoBaselineEvaluate.js --refresh`：40/40 成功，38 条首次通过，S06、S39 经一次携带具体校验错误的定向重试后通过。
- 正式 `BASELINE-REPORT.md` 覆盖 40 条目标字段和全部 10 条多实体真值，10 条均可评估；失败样本数为 0。
- 同日以相同 40+10 人工真值比较提示词与思考模式：旧提示词关闭思考的错误排除为 42、可计算性错配 3、SOV MAE 2.77pp、聚合偏差 +4.04pp；`choice_set_few_shot_v1` + DeepSeek high 为 40/40 成功、错误排除 5、可计算性错配 0、SOV MAE 0.47pp、聚合偏差 +0.02pp，榜单一致率 62.5%。
- 硬切后再从生产配置独立全量刷新，仍为 40/40 成功、可计算性错配 0、错误排除 8、SOV MAE 0.51pp、聚合偏差 -0.06pp；榜单一致率回落到 25%、情绪一致率为 80%，证明核心 SOV 改善可复现，但榜单与情绪仍存在模型非确定性。
- 胜出方案已成为唯一正式提示词与 DeepSeek 请求路径；旧提示词和关闭思考开关已删除，缓存增加 `analysis_prompt_revision`，避免旧提示词结果冒充当前基线。

## Completion

40+10 条标注已经多轮独立复核并由用户人工确认，正式报告已经生成。本 issue 完成关闭；该 v3 基线中的 `choice_set_few_shot_v1` + DeepSeek Pro high 结构化失败为 0/40，分析失败仍保持 fail-closed，不会进入品牌指标。v4 当前基线见 `../../blocked-2026-07-29-002-ai-semantic-analysis-quality/`。
