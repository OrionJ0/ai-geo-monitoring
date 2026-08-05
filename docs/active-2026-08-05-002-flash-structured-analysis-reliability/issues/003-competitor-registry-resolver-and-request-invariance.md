---
title: "实现模型外竞品注册表归一与请求不变性"
status: open
type: AFK
blocked_by:
  - "001-freeze-v5-evaluation-contract.md"
  - "002-deterministic-target-fact-and-remove-self-repair.md"
---

# 实现模型外竞品注册表归一与请求不变性

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## What to build

复用现有竞品主数据作为项目级已核验身份注册表，在阶段 1 的原文实体已经锚定后执行纯程序身份匹配。匹配只能附加 `matched / unmatched / ambiguous` 身份元数据；表外实体和歧义实体必须保留，表内但回答未出现的品牌没有进入分析结果的路径。

阶段 1 和阶段 2 都必须与注册表内容解耦。阶段 2 使用匹配前的 grounded 实体投影；注册表结果只在语义判断完成后按实体 ID 回接，不能成为竞品关系、推荐或排序先验。

## Acceptance criteria

- [ ] 空注册表生成合法稳定快照，且完整分析不因空表、未命中或歧义增加失败或模型调用。
- [ ] 唯一名称/别名命中返回 `matched`；零命中返回 `unmatched`；多身份命中返回 `ambiguous` 且不任选一个。
- [ ] 回答同时出现表内和表外品牌时，两者均进入相同的阶段 2 合同；表外实体不会被删除、降级或自动判为非竞品。
- [ ] 注册表匹配前后的实体 occurrence、source ID、绝对位置、表面词和提及次数深度相等，注册表制造实体数为 0。
- [ ] 同一 source map 搭配空、正常和加入无关品牌的注册表时，阶段 1 最终 prompt、消息和 HTTP body 字节级一致。
- [ ] 同一 grounded 实体目录搭配空、正常和冲突注册表时，阶段 2 实体投影和最终请求体字节级一致。
- [ ] 注册表命中、未命中或歧义不触发任何附加模型调用；正常 2 次、最坏 4 次预算保持不变。

## Blocked by

- [001-freeze-v5-evaluation-contract.md](001-freeze-v5-evaluation-contract.md)
- [002-deterministic-target-fact-and-remove-self-repair.md](002-deterministic-target-fact-and-remove-self-repair.md)
