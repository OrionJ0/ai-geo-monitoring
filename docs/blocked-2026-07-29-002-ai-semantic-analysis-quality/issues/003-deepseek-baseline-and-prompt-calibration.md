---
title: "DeepSeek Pro 离线基线与提示词校准"
status: closed
type: HITL
resolution: superseded
blocked_reason:
  - "等待用户确认 SOV 聚合偏差轻微波动是否可接受"
  - "等待用户确认 12 条补充情绪 AI 预标为人工基线"
---

# DeepSeek Pro 离线基线与提示词校准

> 处置（2026-08-05）：取消把 DeepSeek Pro v4 的 SOV 轻微偏差与 12 条情绪预标确认作为未来发布门禁。当前正式分析仍是 v4，但已确认的 Flash 结构化失败由[Flash v5 可靠性改造](../../active-2026-08-05-002-flash-structured-analysis-reliability/prd.md)承接，并以冻结语料 A/B/C、分阶段事实抽取和正式入口硬切重新验收。下方未勾选项保留为历史结果，不代表已经达标。

## Parent

- `../prd.md`
- `../TECH-SPEC.md`

## What to build

使用现有 40 条常规样本和 10 条多实体人工基线，以 DeepSeek Pro 隔离重跑 v4，并与 v3 报告直接比较实体、竞争关系、品牌排名、情绪和 SOV。补充覆盖正面、中性、负面和目标未提及的情绪边界集。

根据具体错误样本调整概念说明、示例分布和输出前自检，不加入企业名单、关键词词典、编号解析或固定句式规则。执行、报告生成和初步复核自动完成；新增情绪基线在写入人工确认状态前由用户确认。

## Acceptance criteria

- [x] 基线运行不向分析器传入人工竞品或企业清单。
- [x] v3 缓存不会冒充 v4，新结果写入独立实验目录。
- [x] 40+10 样本使用真实 DeepSeek Pro 完成 v4 重跑并生成可比较报告。
- [x] 新情绪边界集覆盖正面、中性、负面和目标未提及，并有可复核原回答。
- [x] 显式排名漏识别少于 v3 基线的 6 条，无序回答不新增虚假排名。
- [x] 10 条多实体样本中的竞品漏判少于 v3 基线的 8 个。
- [ ] SOV 可计算率、平均绝对误差和总体偏差不低于 v3 基线表现。
- [x] DeepSeek Pro 结构化分析失败率不高于 v3 实测结果。
- [x] 调整后的提示词仍不存在企业名单、情绪词典、排名正则或固定句式规则。
- [ ] 用户确认新增情绪标注后，才将其人工确认状态改为完成。

## Evidence

- 正式实验：`work/geo-baseline-2026-07-28/experiments/semantic-evidence-v6/BASELINE-REPORT.md`
  - DeepSeek Pro 40/40 分析成功。
  - `brand_mentioned`、`brand_mentions`、`brand_rank` 均为 100% 一致；排名误报、漏报、错名次均为 0。
  - 10 条多实体样本错误排除 0，SOV 全部可计算。
  - SOV MAE 从 v3 的 0.51pp 降至 0.34pp；聚合偏差从 -0.06pp 变为 -0.11pp。偏差绝对值略增，因此按严格字面暂不勾选该项，等待确认是否接受该波动。
- 情绪边界实验：`work/geo-sentiment-baseline-2026-07-29/BASELINE-PARTIAL.md`
  - 正面、中性、负面和目标未提及各 3 条，12/12 分析成功，情绪一致率 100%。
  - `work/geo-sentiment-baseline-2026-07-29/LABELING.md` 仍为 `human_review_confirmed: no`，等待用户确认。
- v6 提示词只使用任务目标、概念边界、多样化示例和静默自检；没有企业名单、情绪词典、排名正则或固定句式运行规则。

## Closure

- 原阻塞项已取消，不再请求用户为旧 Pro v4 方案背书。
- v4 仍是当前正式路径；在 v5 完成入口级硬切和旧运行时退役前，父需求目录继续保持 `blocked`。
