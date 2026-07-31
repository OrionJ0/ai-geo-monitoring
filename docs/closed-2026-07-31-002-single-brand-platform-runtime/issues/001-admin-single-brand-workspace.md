---
title: "将默认品牌资料和竞品迁入管理员工作台"
status: closed
type: AFK
blocked_by: []
---

# 将默认品牌资料和竞品迁入管理员工作台

## Parent

- `../prd.md`
- `../TECH-SPEC.md` U1

## What to build

管理员在设置中心的工作台页签直接维护唯一默认品牌的资料、自动监测和竞品；未配置默认品牌时保留一次性迁移选择。旧项目管理地址跳转到新入口，品牌与竞品写操作只允许管理员。

## Acceptance criteria

- [x] 设置中心可读取和保存默认品牌名称、别名、官网、行业、核心关键词、自动监测与每日时间。
- [x] 同一页面可新增、编辑和删除默认品牌的竞品。
- [x] 页面不再显示品牌级平台选择器。
- [x] `/geo/projects` 跳转到 `/admin/settings#workspace`。
- [x] 普通用户不能创建、修改、归档、删除品牌或修改竞品。

## Blocked by

None - can start immediately.
