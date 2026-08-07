---
title: "营销工作线主分支集成与治理收尾"
status: active
owner: Codex
depends_on:
  - "../closed-2026-08-05-003-baidu-unified-oauth-api-architecture/prd.md"
  - "../closed-2026-08-05-006-marketing-api-resourceization/prd.md"
  - "../closed-2026-08-05-007-marketing-production-data-correctness/prd.md"
  - "../closed-2026-08-05-005-baidu-provider-modularization/prd.md"
---

# 营销工作线主分支集成与治理收尾

## 背景

003 → 006 → 007 → 005 已在独立分支完成并部署，但生产 revision、营销关闭分支、
本地 `main` 与 `origin/main` 分叉。现有营销分支从文档基线
`3897e30159202730861011b71c2ebf58e3dbb7cf` 开始，不能直接合并或覆盖当前
`main`，否则会删除或冲突 0805-002 Flash 工作线。

复审还确认三项治理缺口：

1. 四个广告读取接口尚未全部用同一 OpenAPI 3.1 schema 校验真实成功与典型错误响应；
2. 关键词翻页会重复读取不随分页变化的上期汇总；
3. 百度搜索推广报告 URL 同时存在于 manifest 与客户端字面量，形成双重机器真值。

006 Issue 001 当时先冻结了 JS 常量，OpenAPI 在详情资源拆分后才补入。最终合同已经
存在，但关闭记录必须如实说明这一过程偏差。

## 目标

- 将 003 → 006 → 007 → 005 安全重放到当前最新 `main`，保留全部 Flash 代码、测试和文档事实；
- 用 OpenAPI 3.1/JSON Schema 校验四个正式接口的真实成功响应和代表性错误响应；
- 消除关键词翻页的上期汇总重复内部读取；
- 使百度上游 manifest 成为报告端点的唯一机器真值；
- 完成全量测试、构建、真实 Chrome、秘密扫描与对抗式审查；
- 发布后使本地 `main`、`origin/main`、服务器 `HEAD` 和公开前后端 revision 指向同一已验证提交。

## 非目标

- 不修改 0805-002 的运行代码、测试、fixture、文档状态或生产观察；
- 不改变营销公开 API、数据库业务合同、百度四报表顺序/预算/QPS/双读/原子快照；
- 不重新引入旧 Provider、旧 Dashboard 大响应、双 Token 或运行时 fallback；
- 不把本地或 fixture 验证冒充正式入口验收。

## Issue 顺序

1. 安全重放营销工作线并证明 Flash 零改写；
2. 用 OpenAPI schema 约束四接口实际响应，并记录 006 Issue 001 偏差；
3. 消除关键词翻页重复读取上期汇总；
4. 消除百度报告 URL 双重机器真值；
5. 完整回归、审查、正式发布并对齐全部 `main` 真值。

一次只执行一个 issue；当前 issue 验收和提交后才能进入下一个。

## 验收标准

- [x] 营销历史已基于当前 `main` 安全重放，旧 A1 隔离 merge 未删除 Flash；
- [x] 003、006、007、005 的聚焦集成测试分别通过；
- [x] 四个接口的真实服务响应和代表性错误响应通过同一 OpenAPI schema 校验；
- [x] 关键词页码或 page size 变化只重新请求本期列表，不重复读取相同上期汇总；
- [x] 客户端不再维护 manifest 已声明的第二份报告 URL；
- [x] 本轮营销 diff 的 P0/P1/P2 对抗审查问题清零；
- [x] 后端、营销、前端、部署测试，lint、TypeScript、生产构建和真实 Chrome 通过；
- [ ] 本地 `main == origin/main == server HEAD == public revision`，服务器工作区干净且迁移 audit 通过。

## Handoff

- Issue 001–004 已关闭；Issue 005 的代码候选 `89234bd46b0777b9f2cf80b82e3f4179c40e335a`
  已包含最新 v5 `main`、完整营销工作线和治理修复，代码/API/安全等审查 P0/P1/P2 清零；
- 该候选已通过后端 1202、营销 252、官网 31、咨询 35、部署 48、前端 127、utils 316、
  lint、TypeScript、OpenAPI、40 路由生产构建、真实 Chrome 65 和 PostgreSQL 集成；
- Stage1 数据库前置迁移已在生产独立完成，生产当前 `a2c1fa15800314adc7f4bcf888964e6e355d3599`
  健康但仍运行 v4/Pro；此前缺列风险已解除，统一候选尚未发布；
- 下一步是提交本次证据、在该文档后代发布 SHA 上重跑完整门禁，再通过正式 Git Bundle
  发布。发布必须完成 DeepSeek Pro→Flash 安全配置迁移、四类 HTTP 入口 v5 验收、
  v4/Pro 调用数为 0、历史 v4 报告/CSV 可读、正式 Chrome 和全部 revision 对齐；
- 发布失败只允许候选后代前向修复，不得重新引入 v4/Pro、旧营销实现、隐藏开关或 fallback。
