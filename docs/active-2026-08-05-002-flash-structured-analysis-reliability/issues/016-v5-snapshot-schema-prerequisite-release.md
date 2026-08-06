---
title: "独立发布 v5 快照字段生产前置迁移"
status: in_progress
type: release
blocked_by: []
---

# 独立发布 v5 快照字段生产前置迁移

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## What to build

从当前生产 `2c6a36e4018d36d926a44a1ad2fc8825b7320635` 派生 schema-only
发布，只为既有 `question_records` 增加 nullable JSON 列
`competitor_snapshot`。本发布不得修改 `QuestionRecord` 模型、分析 provider、DeepSeek
配置、v5 运行入口或营销功能；生产继续运行 v4。

迁移 CLI 必须先读取 `.env` 并尊重既有 `DB_STORAGE`/`DATABASE_URL`；只有显式
`--db` 才能覆盖目标。SQLite 文件不存在、不是普通文件、缺少
`question_records` 或缺少有效备份引用时 fail-closed，不得创建错误空库或业务表。
正式 release 备份必须附带不可覆盖 manifest，绑定源库文件身份、整份备份
SHA-256 与 release revision；同 revision 最多保留 conventional 和 retry 两份发布备份。

正式部署固定执行：停止服务 → 备份 → 测试/构建 → v5 snapshot apply →
`--require-ready` audit → 其他既有迁移 → 启动服务。audit 未返回
`missing_columns=[]`、`migration_required=false` 时必须保持服务停止。

## Acceptance criteria

- [x] 显式 `--db` 只迁移指定数据库，环境中的其他数据库不变化；
- [x] 旧库成功新增 nullable `competitor_snapshot`，历史行数和原字段内容不变，新增列历史值为 `NULL`；
- [x] 第二次 apply 为幂等 no-op；
- [x] 数据库不存在或缺少 `question_records` 时 fail-closed；
- [x] SQLite apply 要求已存在的非空备份引用；
- [x] 备份 manifest 原子不可覆盖，并发竞争只能发布一个与源库、revision 一致的结果；
- [x] 部署顺序为 backup → apply → require-ready audit → start，audit 失败不启动；
- [x] 阶段一聚焦测试、后端与部署回归和对抗式审查 P0/P1/P2 清零；
- [ ] 使用正式 Git Bundle 独立发布，记录不可覆盖备份路径；
- [ ] 生产 `PRAGMA quick_check=ok`，新列存在且历史记录未改变；
- [ ] 旧 v4 应用与 `/api/ready` 正常，公开 revision 与 schema-only release 一致。

## Production boundary

本 issue 完成前不得发布 `main@8179d63`、营销候选 `6bef802` 或任何包含 v5 硬切的
组合；不得删除现有营销分支。阶段一只准备数据库，不设置 v5 默认值，也不增加
v4/Pro fallback。

## Local evidence

- TDD 红灯首先证明仓库没有 v5 snapshot 迁移 CLI；后续失败测试固定了部署顺序、
  `require-ready`、schema mismatch、数据库目标、manifest 绑定和并发排他。
- 最终本地树：迁移 CLI `12/12`，备份 `5/5`，部署全量 `34/34`，后端全量
  `1009/1009`，营销 `243/243`，前端单元 `123/123`。
- 对抗式审查覆盖代码、现实证据、最小范围、数据库、安全、性能和 SRE；当前
  P0/P1/P2 全部清零。
- 2026-08-06 发布前只读生产基线：服务器 `HEAD=2c6a36e`、工作区干净、两个 systemd
  服务 active，公开 health/frontend-health/ready 均正常；SQLite 约 24.3 MiB、空闲空间约
  35.7 GiB，`quick_check=ok` 用时 46.74 ms，整库 SHA-256 读取用时 18.86 ms。
- 迁移前 `question_records=100`，旧字段内容脱敏摘要已在本次执行上下文记录，
  `competitor_snapshot` 尚不存在；正式发布后必须就地复算行数与旧字段摘要。
