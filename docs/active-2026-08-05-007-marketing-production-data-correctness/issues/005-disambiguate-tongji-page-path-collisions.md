---
title: "交付百度统计同路径页面消歧"
status: closed
type: AFK
blocked_by: []
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

- [x] 无路径碰撞时 `pathCollision` 为 null，API 和页面保持现役简洁展示。
- [x] 同一路径多条事实保留各自稳定 key/pageId，并返回稳定 ordinal 和完整 count。
- [x] 碰撞 count 和 ordinal 在分页前按完整过滤结果计算，跨页、改变 page size 或重复请求后保持稳定。
- [x] 数字 page ID 按数值排序，不透明字符串按冻结规则排序；主排序相同时以 page identity 稳定兜底。
- [x] 页面显示“原路径 · 同路径记录 ordinal/count”，桌面、移动端和分页场景均可读。
- [x] 不使用数组下标作为身份，不静默去重，不隐藏 page identity 差异。
- [x] 不合并浏览量和任何比率/平均值，不新增无法证明的页面聚合事实。
- [x] API 采用 additive 字段，现役过滤、排序、分页、精确指标、权限和空状态不回归。
- [x] 后端、API、adapter 和页面测试覆盖单行、同路径多行、跨页碰撞、稳定排序和无碰撞场景。

## Verification

- 后端：`npm run test:marketing` 228 项通过；最终聚焦 provider parser、service、API 与脱敏基线 57 项通过。
- 前端：`npm test` 119 项通过；`npm run lint`、`npx tsc --noEmit`、`npm run build` 通过，生产构建生成 40 个路由。
- 真实浏览器：生产构建下运行网站流量 Chrome 用例 8 项通过；同一路径三条事实在桌面第一页显示 `1/3`、`2/3`，第二页及 390px 视口显示 `3/3`。
- 身份与排序：数字 ID 使用 `BigInt` 数值升序；不透明 ID 使用 Unicode code-point 升序，并覆盖会与 UTF-16 code-unit 顺序不同的字符样本。
- 数据边界：只增加 `pathCollision`，未合并、去重或重算任何浏览量、比率与平均值；无碰撞明确返回 `null`。
- 正式路径：仍由 `/api/marketing/projects/:projectId/website-traffic-pages` 服务网站流量页；本 issue 尚未发布，生产仍运行上一正式 revision。

## Blocked by

None - can start immediately. 生产发布和观察窗口不得与 003、006 重叠。
