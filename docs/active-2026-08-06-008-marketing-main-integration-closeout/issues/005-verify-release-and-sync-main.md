---
title: "完整验收发布并对齐 main"
status: in_progress
type: release
blocked_by: []
---

# 完整验收发布并对齐 main

## 验收标准

- [x] 后端、营销、前端、部署测试全通过；
- [x] lint、TypeScript、OpenAPI 生成漂移和生产构建通过；
- [x] 真实 Chrome 验收营销页面交互、取消、分页和 revision 钉扎；
- [x] PostgreSQL 营销迁移和 GEO 指标语义集成通过；
- [x] 秘密、旧路径、fallback、旧文档和无关修改扫描通过；
- [x] 代码、API、安全、数据库、架构、性能、无障碍、SRE、现实证据和最小变更审查的代码候选 P0/P1/P2 清零；
- [ ] 正式 Git Bundle、systemd、迁移 audit、公开健康和登录态入口验收通过；
- [ ] 本地 `main`、`origin/main`、服务器 `HEAD`、公开前后端 revision 完全一致。

## 2026-08-07 最终本地候选证据

- 代码与测试候选为 `89234bd46b0777b9f2cf80b82e3f4179c40e335a`，工作区干净；候选包含当前 `main` 的完整 v5 硬切和已发布营销工作线，不删除 Flash 代码，也不恢复 v4/Pro 或旧营销 fallback。
- 后端全仓 `1202/1202`；营销 `252/252`；官网表单 `31/31`；咨询详情 `35/35`；部署 `48/48`。
- 前端营销 `127/127`，全量 utils `316/316`；lint、TypeScript、OpenAPI 生成漂移均通过；以完整候选 SHA 注入 revision 的 Next.js 生产构建成功并生成 40 个路由。
- 真实 Chrome 使用生产构建和单 worker 完成 `65/65`。首次多 worker 运行在 44 项后挂起，串行诊断进一步发现搜索词 fixture 未回显新合同要求的筛选字段；fixture 修复后，搜索词聚焦 `3/3` 与最终全套 `65/65` 均通过。没有把挂起或旧 SHA 证据算作通过。
- PostgreSQL 一次性测试库完成营销迁移 `001`–`016`、原子快照/失败保留和 GEO 指标语义迁移；测试容器随后删除。
- 四个广告读取入口的真实 Express 成功响应和典型错误响应使用同一 OpenAPI 3.1 schema 校验；`Vary: Authorization`、缓存/重试头和搜索词全部已应用筛选回显均受合同约束。
- v5 CSV 信任边界已加固：文件级 HMAC 覆盖来源项目、来源完整性状态、表头和有序完整行；未收敛/缺记录原生运行不能签名；无签名历史导入始终保持 `unverified_import`，服务端 KPI 为 unavailable/null，页面隐藏指标并将逐行引用标记为“未验证”。

## 对抗式审查

- `engineering-code-reviewer`、`testing-api-tester`、`security-appsec-engineer` 对最终代码候选均返回 P0=0、P1=0、P2=0；最后两次 SHA 变化只涉及测试隔离密钥和浏览器 fixture，复核确认未改变生产运行时或削弱断言。
- `engineering-minimal-change-engineer`、`engineering-software-architect`、`testing-accessibility-auditor`、`engineering-database-optimizer`、`testing-performance-benchmarker`、`engineering-sre` 已返回 P0=0、P1=0、P2=0。
- `testing-reality-checker` 先前保留的缺口是“尚未正式发布、文档仍引用旧候选”；本节已修正旧候选证据，但生产部分只有 Git Bundle 发布、四入口 v5、正式 Chrome 和 revision 对齐后才能清零。

## 当前正式路径与下一门禁

- 生产仍为 `https://insight.guangtuo.com` 上的 `a2c1fa15800314adc7f4bcf888964e6e355d3599`，仍运行 v4/Pro；两个 systemd 单元和 `/api/ready` 正常。
- Stage1 数据库前置迁移已经独立完成：v5 快照审计为 `missing_columns=[]`、`schema_mismatches=[]`、`migration_required=false`，旧 v4 应用保持正常。此前 `competitor_snapshot` 缺列和迁移脚本错误目标风险不再阻塞 Stage2。
- 下一步只允许把本节文档作为候选后代提交后，在该最终发布 SHA 上重跑完整矩阵；随后重新核对生产锁、服务器/远端/公开 revision、工作区和 migration audit，制作正式 Git Bundle。
- 统一发布必须迁移官方 builtin DeepSeek 的 `deepseek-v4-pro` 到 `deepseek-v4-flash`，保留 API Key、enabled 和凭据；自定义 base URL 或未知身份继续 fail-closed。发布后必须从单问题、问题集、自动监测和 analysis-only 四个 HTTP 入口证明 v5/Flash 生效、v4/Pro 调用数为 0，并证明历史 v4 报告/CSV 仍可读。
- 在上述生产证据成立前，002 和本目录继续保持 `active`，不得宣称生产硬切或删除现有营销分支。
