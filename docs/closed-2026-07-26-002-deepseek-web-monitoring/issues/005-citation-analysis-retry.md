---
title: "接入页面引用、现有分析与证据重试"
status: closed
type: AFK
blocked_by:
  - "003-project-web-capture-tracer"
---

# 接入页面引用、现有分析与证据重试

## Parent

- PRD：`docs/closed-2026-07-26-002-deepseek-web-monitoring/prd.md`
- Tech Spec：`docs/closed-2026-07-26-002-deepseek-web-monitoring/TECH-SPEC.md`
- 对应实施切片：U-004、U-006

## User stories covered

- US-5：查看网页明确引用和页面证据。
- US-6：继续使用现有品牌、竞品、情绪、排名和引用分析。

## What to build

把当前回答可见的引用标记、关联来源卡片和可见 HTTP/HTTPS 链接标准化为明确引用；把页面自然 Network 响应中通过白名单提取但没有可见关联的来源保留为检索候选。Network 只被动观察当前页面请求，不读取或重放认证凭据，不以网络正文替代 DOM 正文。

让明确引用进入现有引用 KPI，让检索候选保持可审计但不增加引用次数。结构化分析失败时仍保存原回答、引用和 Web 证据；analysis-only 重试复用已经保存的回答与原始 artifact owner，不重新访问 DeepSeek 页面。

## Acceptance criteria

- [x] 当前回答可见且可关联的来源保存为 `explicit_citation`。
- [x] 只在 Network 候选中出现、没有页面可见关联的来源最多保存为 `retrieval_candidate`。
- [x] 只有 `explicit_citation` 进入引用率、引用次数和来源 KPI。
- [x] 没有明确引用时保存空明确引用列表，其他成功条件满足后记录仍可完成。
- [x] 引用 URL 只接受 HTTP/HTTPS，非法协议、超长 URL 和重复来源被拒绝或规范化。
- [x] Network 监听不重放请求，不保存认证头、Cookie、完整响应体或未知字段。
- [x] Network 响应体受精确 origin、资源类型、content type 和 2 MiB 内存上限约束。
- [x] Web 采集成功但结构化分析失败时，原回答、引用、截图和采集元数据仍被持久化。
- [x] 分析失败记录没有成功指标，但可以进入现有 analysis-only 重试。
- [x] analysis-only 重试不再次调用 Web Adapter，不重复复制截图文件，并保持原证据可鉴权读取。
- [x] 成功和失败终态都以有界 merge 保留 `web_capture`，不会被关键词或失败摘要覆盖。
- [x] 自动化测试覆盖 DOM 明确引用、Network-only 候选、无引用、分析失败和 analysis-only 重试。

## Blocked by

- `003-project-web-capture-tracer.md`

## Verification

- `node --test tests/DeepSeekWebAdapter.test.js tests/ProjectRunService.test.js tests/QuestionSetRunApi.test.js tests/QuestionSetRetryPersistence.test.js`
- 结果：66/66 通过。
- 覆盖：DOM 明确引用、受限 Network 候选、URL 规范化、无引用成功、KPI 角色过滤、分析失败保留原始证据、analysis-only 零 Web 调用与原 artifact owner 复用。
