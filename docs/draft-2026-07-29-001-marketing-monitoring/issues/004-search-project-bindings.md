---
title: "完成搜索账户级项目绑定"
status: open
type: AFK
blocked_by:
  - "003-baidu-oauth-and-disconnect.md"
---

# 完成搜索账户级项目绑定

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 覆盖：US-002、US-007

## Goal

让管理员从已授权连接中选择整个百度搜索推广账户绑定项目，并支持暂停、恢复、改绑和解除绑定。

## Scope

- 迁移 `baidu_project_bindings`。
- 实现账户目录适配、绑定列表、新增、暂停、恢复和删除。
- 一个项目可绑定多个账户；同一真实外部账户第一期只能属于一个活动项目。
- 不读取推广计划目录，不支持计划子集、channel 或 scope revision。

## Acceptance Criteria

- [ ] 只有管理员可读取账户目录和修改绑定；项目查看权限不等于绑定管理权限。
- [ ] 只显示已确认具备 SEARCH 只读能力且属于当前连接的账户。
- [ ] 保存和恢复前服务端重新读取或验证账户归属，不信任前端名称。
- [ ] 契约未证明全局 ID 前数据库按 `(project_id, connection_id, external_account_id)` 防重，服务层禁止同一 canonical account 同时属于多个活动项目。
- [ ] 绑定只接受 connectionId 和 externalAccountId，不接受 campaign ID、channel 或 scope type。
- [ ] 暂停任一绑定后完整旧快照可查看，但整个项目不得刷新，并显示受影响账户和恢复动作。
- [ ] 连接断开、进入 `REAUTH_REQUIRED` 或开始重授权会暂停相关绑定并递增版本；授权成功后不会自动恢复。
- [ ] 恢复时确认连接、账户和项目，递增 binding version，并使旧口径活动快照失效。
- [ ] 新增、改绑和删除后旧项目口径不得继续作为当前活动快照。
- [ ] 归档项目禁止新增、暂停、恢复、改绑和删除绑定。
- [ ] 所有操作只改本地关联，不调用百度写接口。

## Verification

```bash
node --test backend/tests/marketing/BaiduAccountDirectory.test.js
node --test backend/tests/marketing/BaiduProjectBindingsApi.test.js
node --test backend/tests/marketing/BaiduBindingLifecycle.test.js
npm --prefix backend run audit:marketing
npm --prefix backend test
git diff --check
```

证据：

- 测试覆盖超大外部 ID、跨连接/跨项目重复账户、伪造账户、断开暂停、重授权不自动恢复和归档项目。
- 测试覆盖混合品牌账户提示和 dashboard 逐绑定健康状态。
- 出站请求清单只包含已确认账户目录只读接口。

## Blocked by

- `003-baidu-oauth-and-disconnect.md`
