---
title: "交付百度统计同路径页面消歧"
status: open
type: AFK
blocked_by:
  - "001-freeze-contract-and-sanitized-baseline.md"
---

# 交付百度统计同路径页面消歧

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-3：相同展示路径的入口页记录可以稳定区分。
- US-4：本地可以复现并回归生产同路径记录。

## What to build

让页面报告在保留百度上游稳定 page identity 的前提下，为规范化后相同 path 的事实增加稳定碰撞元数据，并在入口页展示可读的序号标签。碰撞分组和组内 ordinal 必须在完整过滤结果上、分页前计算；主排序相同时使用稳定 page identity 作为最终 tie-breaker。

本切片只消除展示歧义，不删除或合并事实。浏览量、跳出率、退出率、平均停留等指标保持每条上游事实原值；没有可证明分母时不得求和、平均或选一条覆盖其他记录。

## Acceptance criteria

- [ ] 无路径碰撞时 `pathCollision` 为 null，API 和页面保持现役简洁展示。
- [ ] 同一路径多条事实保留各自稳定 key/pageId，并返回稳定 ordinal 和完整 count。
- [ ] 碰撞 count 和 ordinal 在分页前按完整过滤结果计算，跨页、改变 page size 或重复请求后保持稳定。
- [ ] 数字 page ID 按数值排序，不透明字符串按冻结规则排序；主排序相同时以 page identity 稳定兜底。
- [ ] 页面显示“原路径 · 同路径记录 ordinal/count”，桌面、移动端和分页场景均可读。
- [ ] 不使用数组下标作为身份，不静默去重，不隐藏 page identity 差异。
- [ ] 不合并浏览量和任何比率/平均值，不新增无法证明的页面聚合事实。
- [ ] API 采用 additive 字段，现役过滤、排序、分页、精确指标、权限和空状态不回归。
- [ ] 后端、API、adapter 和页面测试覆盖单行、同路径多行、跨页碰撞、稳定排序和无碰撞场景。

## Blocked by

- [Issue 001：冻结 006 后合同并建立脱敏回归基线](001-freeze-contract-and-sanitized-baseline.md)。
