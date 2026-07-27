---
title: "保持历史、报告与导出的 Web 样本隔离"
status: closed
type: AFK
blocked_by:
  - "005-citation-analysis-retry"
  - "006-question-set-scheduled-runs"
  - "007-evidence-access-deletion"
---

# 保持历史、报告与导出的 Web 样本隔离

## Parent

- PRD：`docs/closed-2026-07-26-002-deepseek-web-monitoring/prd.md`
- Tech Spec：`docs/closed-2026-07-26-002-deepseek-web-monitoring/TECH-SPEC.md`
- 对应实施切片：U-007

## User stories covered

- US-2：分别查看 DeepSeek API 和 DeepSeek Web。
- US-5：在历史中复核网页回答、引用和截图。
- US-6：Web 样本继续进入现有分析和报表。

## What to build

在现有历史、问题历史、问题集报告、平台对比和导出中完整呈现 `deepseek-web`，并始终与 `deepseek` 分开。历史详情显示回答、明确引用、检索候选、联网状态、采集时间、选择器版本和证据链接；没有 Web 证据的 API 或旧记录保持原有展示。

所有平台筛选、标签、聚合键和 CSV 字段使用真实平台代码，不通过显示名称或供应商归一化合并样本。前端继续使用现有页面和共享 API 客户端，不新建 Web 管理中心。

## Acceptance criteria

- [x] 管理员历史和用户问题历史都把 `deepseek` 与 `deepseek-web` 显示为两个独立平台。
- [x] 历史筛选可以单独筛选 `deepseek-web`，不会同时返回 `deepseek`。
- [x] Web 历史详情显示最终正文、明确引用、检索候选、联网状态、采集时间、选择器版本和两项证据。
- [x] 证据链接只包含记录 ID 和随机 artifact ID，不包含本机路径。
- [x] API 和不带 `web_capture` 的旧历史继续正常展示，不出现空的 Web 证据组件。
- [x] 问题集报告与平台对比以平台代码聚合，不把 API/Web 指标相加。
- [x] CSV 和其他现有导出保留 `deepseek-web` 原代码及“DeepSeek 网页版”名称。
- [x] 网页样本模型字段显示 `deepseek-web-ui` 或历史保存值，不推测后台模型版本。
- [x] 被修改的前端 API 请求使用项目共享客户端。
- [x] 自动化测试覆盖历史筛选、证据展示、问题集报告、平台对比和 CSV 隔离。
- [x] 前端 lint、构建和现有相关测试通过。

## Blocked by

- `005-citation-analysis-retry.md`
- `006-question-set-scheduled-runs.md`
- `007-evidence-access-deletion.md`

## Verification

- `node --test tests/DetectionHistoryEvidence.test.js tests/QuestionSetRunService.test.js tests/ProjectMetricsService.test.js`
- 结果：39/39 通过；覆盖管理员/用户历史精确筛选、问题集 Web 元数据、平台代码聚合和 CSV 身份。
- `node --test src/utils/*.test.cjs`
- 结果：189/189 通过；覆盖 API/旧记录隐藏 Web 组件、引用角色分组、安全证据 URL、模型不推测及既有前端行为。
- `npm run lint`
- 结果：通过；仅保留一个与本需求无关的既有 `_` 未使用 warning。
- `npm run build`
- 结果：生产构建、TypeScript 检查和 28 个静态页面生成通过。
