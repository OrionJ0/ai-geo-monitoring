---
title: "允许部分平台运行并按原运行快照重试"
status: closed
type: AFK
blocked_by:
  - 002-global-enabled-platform-scope.md
---

# 允许部分平台运行并按原运行快照重试

## Parent

- `../prd.md`
- `../TECH-SPEC.md` U3

## What to build

统一 API 与受管 Web 平台的运行前检查语义：单个平台不可用时只跳过该平台，其他平台继续；失败重试只处理原运行记录中的平台，并按重试时实时可用性决定是否提交。

## Acceptance criteria

- [x] Web 平台登录失效且其他平台可用时，运行仍成功创建其他平台任务。
- [x] 跳过平台及原因写入运行响应和报告快照。
- [x] 配额和记录数只计算实际可执行任务。
- [x] 全部平台不可用时不扣配额、不创建记录。
- [x] 重试以原失败记录的平台为候选，不受品牌/问题遗留范围变化影响，也不追加旧运行之后新启用的平台。

## Blocked by

- `002-global-enabled-platform-scope.md`
