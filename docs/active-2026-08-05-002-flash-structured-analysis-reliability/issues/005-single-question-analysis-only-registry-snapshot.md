---
title: "接入单问题与 analysis-only 不可变快照"
status: open
type: AFK
blocked_by:
  - "003-competitor-registry-resolver-and-request-invariance.md"
  - "004-field-level-semantics-and-scoped-sov.md"
---

# 接入单问题与 analysis-only 不可变快照

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## What to build

让单问题候选运行完整保存 v5 三轨结构、注册表快照身份和分阶段诊断，并让 analysis-only 严格重放原记录的回答、引用与注册表快照。竞品表在原运行后发生变化时，历史重试结果不能读取实时配置而漂移。

该切片保持现有事务原子性和监测配额边界：外部模型调用不进入数据库事务；结构与完成状态在同一事务落库；analysis-only 不重新访问豆包、DeepSeek Web 等监测平台。

## Acceptance criteria

- [ ] 单问题候选运行保存稳定的注册表快照版本、哈希、条目数量、每实体匹配状态和完整 v5 状态结构。
- [ ] analysis-only 复用原回答哈希、引用、平台证据和原注册表快照，不访问监测平台、不消耗监测配额。
- [ ] 原运行后修改竞品表再执行 analysis-only，仍使用原快照；新建运行使用新快照和新哈希。
- [ ] 对相同回答，新旧注册表快照不会改变阶段 1 或阶段 2 请求体，只能改变最终回接的身份元数据。
- [ ] 模型调用、指标写入和记录完成保持既有事务边界；事务或租约失败不会留下半条 v5 指标。
- [ ] 单问题候选失败时保存有界诊断和完整原回答，且不会静默调用 v4、Pro 或监测平台。

## Blocked by

- [003-competitor-registry-resolver-and-request-invariance.md](003-competitor-registry-resolver-and-request-invariance.md)
- [004-field-level-semantics-and-scoped-sov.md](004-field-level-semantics-and-scoped-sov.md)
