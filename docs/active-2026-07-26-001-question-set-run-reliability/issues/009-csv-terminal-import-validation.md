---
title: "收紧 CSV 导入并阻断伪运行态"
status: open
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

- [ ] imported CSV 只接受约定终态；包含 pending 的文件返回 422 且不创建报告。
- [ ] ID 必须为正整数，计数必须为非负整数。
- [ ] 百分比、排名和时间字段满足 PRD 定义的范围和先后关系。
- [ ] JSON 单元格继续执行结构、长度和类型验证。
- [ ] 错误响应包含稳定 error code、行号、列名和安全说明。
- [ ] 任一行失败时整个导入零写入。
- [ ] imported 报告不会派生 running/paused，不进入自动轮询。
- [ ] imported 报告不显示暂停、继续和执行型重试。
- [ ] 合法现有 CSV v1 保持可导入；新增解释字段采用兼容追加列。
- [ ] 自动化测试覆盖 pending、负数、小数 ID、超范围百分比、非法排名、倒置时间和合法旧文件。

## Blocked by

- [007 保护历史证据并返回操作 Capabilities](007-history-evidence-capabilities.md)
