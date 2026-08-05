---
title: "全入口硬切与真实验收"
status: open
type: AFK
blocked_by:
  - "003-deepseek-baseline-and-prompt-calibration.md"
---

# 全入口硬切与真实验收

## Parent

- `../prd.md`
- `../TECH-SPEC.md`

## What to build

完成 v4 在单问题、问题集、定时监测和 analysis-only 重试中的正式硬切，并从真实入口证明新分析实际生效、失败不会污染指标、历史 v3 仍可读取。

所有当前运行文档和版本说明同步指向 v4。v3 只保留历史读取能力，不保留生产默认值、隐藏开关、失败 fallback 或继续推荐旧路径的文档。

## Acceptance criteria

- [x] 新单问题、问题集、定时监测和 analysis-only 重试记录统一写入 `ai_structured_v4`。
- [x] 新分析结构统一为 `geo_metric_input_v4`，SOV 指标语义继续为 `contextual_competitor_mentions_sov_v1`。
- [x] 真实 DeepSeek Pro 请求使用设置页所显示的模型和请求参数。
- [x] 从全部正式入口至少各取得一条数据库、API、页面或日志验收证据。
- [x] 入口级测试同时证明 v4 被调用且 v3 未被调用。
- [x] v4 分析失败时保留完整原回答，不写部分指标，也不回退 v3。
- [x] 历史 v3 报告保持原值和原结构，并明确显示为历史版本。
- [x] 生产代码中不存在 v3 默认值、v3 fallback、竞品提示分析输入或程序情绪/排名规则。
- [x] README、CONTEXT、API 文档、文档索引和相关需求说明不再把 v3 描述为当前正式路径。
- [x] 全量相关测试、前端构建和真实入口验收已执行；整个需求仍需等待 Issue 003 的质量确认后才能关闭。

## Evidence

- 入口级后端回归：
  - `ProjectRunService.test.js` 覆盖单问题、问题集共用执行链和 analysis-only 失败隔离。
  - `QuestionSetRunStart.test.js`、`QuestionSetRunService.test.js` 覆盖问题集记录与报告。
  - `SchedulerService.test.js`、`ScheduledExecutionClaim.test.js` 覆盖定时监测。
  - `GeoRuntimeHardCut.test.js` 证明正式分析只有 v4 路径，无 v3 fallback、竞品提示或输入截断回退。
- 本轮完整后端回归 880/880，定时调度相关回归 88/88，前端工具测试 248/248，Next.js 生产构建与 TypeScript 检查通过。
- 独立临时数据库与 `127.0.0.1:3111/3112` 真实 UI/API 入口验证：
  - 管理员登录、平台配置、分析平台选择和 `GET /api/settings/analysis-api/prompt` 均通过。
  - 当时接口返回 `ai_structured_v4`、`semantic_evidence_few_shot_v6`、`deepseek-v4-pro`、JSON mode、高强度思考、120 秒、2 次尝试、关闭 Web 搜索和 `token_limit=null`；2026-07-30 后正式默认值改为关闭思考，管理员可在二次确认后显式修改分析请求参数。
  - 设置页真实结构化测试首次成功，识别 3 个企业实体、2 个竞品关系，目标品牌排名 3，SOV 为 1/3。
  - 单问题首次完整监测保留了 2371 字原回答，但两次 v4 输出均因 `sentiment.evidence` 无法定位而 fail-closed；没有写入 `visibility_metrics`。
  - analysis-only 重试复用与失败记录 SHA-256 完全相同的原回答，不重新调用监测平台；重试后 SOV 为 13/42（30.95%），情绪为中性。
  - 真实问题集 2/2 完成，分析覆盖率 100%；SOV 分别为 11/31（35.48%）和 4/17（23.53%），排序题目标品牌排名 3。
  - 定时入口首次真实运行暴露执行租约和原回答持久化参数未透传，导致合法 worker 被判为迟到 worker；已补回归测试并最小修复。
  - 修复后同一定时 API 返回 HTTP 200、1/1 完成；记录写入 `ai_structured_v4`，保存 1694 字原回答，SOV 为 8/31（25.81%），目标品牌排名 3。
  - 问题库按回答级 SOV 做宏平均：排序题 `(23.53% + 25.81%) / 2 = 24.67%`；失败记录不进入指标分母。
  - 临时服务已正常关闭，未修改正式数据库；隔离临时数据库在证据汇总后删除。
- 真实 DeepSeek Pro 主基线 40/40 成功，情绪边界基线 12/12 成功；失败重试不写部分指标。
- 本轮报告：[`work/run_report_ai_semantic_v4_real_e2e_20260729.html`](../../../work/run_report_ai_semantic_v4_real_e2e_20260729.html)。
- 本 issue 的全入口技术验收已经执行。首次证据定位失败说明模型稳定性仍需由 Issue 003 继续扩大样本确认，因此暂不关闭整个需求目录。

## Blocked by

- `003-deepseek-baseline-and-prompt-calibration.md`
