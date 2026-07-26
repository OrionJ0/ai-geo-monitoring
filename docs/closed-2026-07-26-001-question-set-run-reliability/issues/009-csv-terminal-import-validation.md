---
title: "收紧 CSV 导入并阻断伪运行态"
status: closed
type: AFK
blocked_by:
  - "007-history-evidence-capabilities"
---

# 收紧 CSV 导入并阻断伪运行态

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-7

## What to build

把 CSV 当作不可信边界输入，只允许导入不可执行的终态历史，并为每类数字、时间和复杂字段建立业务范围校验。错误需要定位到具体行和列，任何失败都不得写入半份报告。

导入后的报告通过统一 capabilities 保持只读，不轮询、不显示暂停、继续或执行型重试。

## Acceptance criteria

- [x] imported CSV 只接受约定终态；包含 pending 的文件返回 422 且不创建报告。
- [x] ID 必须为正整数，计数必须为非负整数。
- [x] 百分比、排名和时间字段满足 PRD 定义的范围和先后关系。
- [x] JSON 单元格继续执行结构、长度和类型验证。
- [x] 错误响应包含稳定 error code、行号、列名和安全说明。
- [x] 任一行失败时整个导入零写入。
- [x] imported 报告不会派生 running/paused，不进入自动轮询。
- [x] imported 报告不显示暂停、继续和执行型重试。
- [x] 合法现有 CSV v1 保持可导入；新增解释字段采用兼容追加列。
- [x] 自动化测试覆盖 pending、负数、小数 ID、超范围百分比、非法排名、倒置时间和合法旧文件。

## Verification

- CSV 在任何数据库写入前完成整文件校验；API 断言 `pending` 返回 422 和 `NON_TERMINAL_STATUS`，同时 run 数量保持不变。
- `source_run_id`、`record_id`、`question_id` 采用正整数约束；引用和提及次数采用非负整数约束；SOV 限制为 0–100，排名必须为正数。
- 运行和记录时间执行先后关系校验；复杂 JSON 单元格限制为 100,000 字符，并校验数组、对象及引用来源字段类型。
- 字段级错误响应稳定返回 `code`、`row`、`column`，不回显 CSV 原始内容或底层异常。
- 保持 `question_set_run_v1` 和原必需列不变；分析契约、旧引用解释和竞品基线作为六个尾部可选列追加，旧文件缺列仍可导入。
- 导入报告继续由服务端 capabilities 固定为只读，且终态行不会派生 `running` / `paused` 或进入前端轮询。
- 新增 CSV 边界测试 7/7 通过；CSV、API 与报告服务关联回归 29/29 通过；后端完整回归 662/662 通过。

## Blocked by

- [007 保护历史证据并返回操作 Capabilities](007-history-evidence-capabilities.md)
