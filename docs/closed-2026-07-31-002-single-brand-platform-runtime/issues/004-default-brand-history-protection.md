---
title: "保护默认品牌生命周期和历史监测数据"
status: closed
type: AFK
blocked_by:
  - 001-admin-single-brand-workspace.md
---

# 保护默认品牌生命周期和历史监测数据

## Parent

- `../prd.md`
- `../TECH-SPEC.md` U4

## What to build

默认品牌在领域服务层禁止归档和永久删除；品牌资料调整只影响后续运行，已有问题记录、来源证据和可见度指标不删除，仅使可重新生成的报告快照失效。

## Acceptance criteria

- [x] 默认品牌归档返回 `default_project_lifecycle_protected` / 409。
- [x] 默认品牌永久删除返回同一稳定错误且不执行级联删除。
- [x] 品牌资料修改不调用项目分析数据清理，不减少历史记录或指标。
- [x] 品牌资料修改后已生成报告失效，下一次运行使用新品牌资料。
- [x] 设置页明确提示“仅影响后续运行，历史不重算或删除”。

## Blocked by

- `001-admin-single-brand-workspace.md`
