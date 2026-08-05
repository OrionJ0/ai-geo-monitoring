---
title: "按真实需求重新评估百度信息流"
status: closed
type: HITL
resolution: cancelled
blocked_by:
  - "009-production-baidu-acceptance.md"
---

# 按真实需求重新评估百度信息流

> 处置（2026-08-05）：取消该占位需求。当前没有已确认的信息流业务、账户和只读权限，不继续把“也许以后会做”保留为现役 issue。若出现真实需求，应新建独立 PRD/Tech Spec，并重新验证合同，不从搜索推广实现类推。

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 阶段：Later，不属于第一期

## Goal

只有真实业务正在使用百度信息流、已获得相应只读权限，并且搜索推广完成生产验收后，才重新开展信息流需求和技术设计。本 issue 不预先实现 FEED。

## Scope

- 人工确认真实使用场景、负责人、账户和需要观察的指标。
- 确认只读权限、目录、报表、金额、日期、分页和数据规模。
- 评估 FEED 是否应与搜索共用项目快照，或作为独立快照。
- 新建独立 PRD、Tech Spec、迁移和实施 issues。
- 不直接修改第一期搜索表、API 或状态枚举。

## Acceptance Criteria

- [ ] Issue 009 已完成，搜索推广正式入口稳定。
- [ ] 至少一个真实账户有持续信息流投放和明确监控需求。
- [ ] 百度应用获得信息流只读权限，不需要写权限。
- [ ] 真实契约和脱敏证据完整，不从搜索接口类推。
- [ ] 新 PRD 明确渠道合并口径、刷新原子性、失败状态和 UI。
- [ ] 新 Tech Spec 明确 schema migration、API 兼容、精确值和生产验收。
- [ ] 未满足全部门禁时保持 Later，不向核心 schema 加 `channel`，不展示 FEED 入口。

## Verification

```bash
test -d backend/modules/marketing
test -d nextjs-frontend/src/app/geo/marketing
set +e
rg -n 'FEED|信息流|channel' backend/modules/marketing nextjs-frontend/src/app/geo/marketing nextjs-frontend/src/components/marketing
status=$?
set -e
test "$status" -eq 1
git diff --check
```

在本 issue 仍为 Later 时，上述搜索结果应为空或仅存在明确的“未支持”文案；不得存在可执行 FEED 代码、迁移字段或隐藏开关。

## Closure

- 不实现 FEED，不修改当前搜索推广 schema、API 或导航。
- 后续若重新立项，不复用本 issue 的完成状态或未验证假设。
