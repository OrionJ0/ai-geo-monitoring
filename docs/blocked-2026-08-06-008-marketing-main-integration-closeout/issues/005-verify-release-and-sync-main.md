---
title: "完整验收发布并对齐 main"
status: blocked
type: release
blocked_by:
  - "004-use-manifest-report-endpoint.md"
---

# 完整验收发布并对齐 main

## 验收标准

- [x] 后端、营销、前端、部署测试全通过；
- [x] lint、TypeScript、OpenAPI 生成漂移和生产构建通过；
- [x] 真实 Chrome 验收营销页面交互、取消、分页和 revision 钉扎；
- [x] 秘密、旧路径、fallback、旧文档和 Flash 无关修改扫描通过；
- [x] 本轮营销 diff 的基础及风险专项对抗审查 P0/P1/P2 清零；
- [ ] 发布前确认 0805-002 不在发布/硬切/生产观察；
- [ ] 正式 Git Bundle、systemd、迁移 audit、公开健康和登录态入口验收通过；
- [ ] 本地 `main`、`origin/main`、服务器 `HEAD`、公开前后端 revision 完全一致。

## 本地验收证据

- 后端全仓串行复验：`1116 passed / 1 skipped / 0 failed`；营销：`250/250`；前端营销：`127/127`；部署：`30/30`；
- 后端全仓在一次与浏览器/部署并行的压力运行中出现 `DatabaseConfig` 临时端口连接拒绝；该用例聚焦重跑通过，随后串行全仓复验零失败，未修改业务代码掩盖瞬时端口竞争；
- lint 通过；Next.js 生产构建和 TypeScript 通过，共生成 40 个路由；
- 真实 Chrome 全套 `59/59` 通过，覆盖上期请求跨日期及时取消、stale snapshot 日期钉扎后不重复请求、分页/错误/焦点状态；阻塞解除后仍须在最终发布 SHA 上重跑；
- 四个广告读取入口的真实 Express 成功响应与典型错误响应使用同一 OpenAPI 3.1 schema 校验；未知内部错误被公开错误合同脱敏；
- SQLite 精确比率排序受 2,000 身份/5,000 事实硬上限保护，预热后三样本 P95 门禁为 750ms；
- 关键词上期请求只使用 `previousKey` 一套取消真值，页码、页大小和排序不重复读取上期 summary；
- 报告 URL 只来自 manifest；未重新引入旧 Provider、旧 Dashboard 明细数组、双 Token 或 fallback。

## 对抗式审查

- 代码、API、安全、数据库、架构、性能、无障碍和最小变更：无 P0/P1/P2；
- 现实证据与 SRE：发现一个不属于本营销范围、但会阻断整体候选正式发布的 P0，见下节；
- 0805-002 文档状态不在本需求授权范围内，本需求不修改其代码、测试、fixture 或状态文档。

## 正式发布阻塞

当前候选运行模型及调度路径会读取 `question_records.competitor_snapshot`，但正式部署入口
尚未应用 `backend/scripts/migrateV5SnapshotFields.js`。旧生产数据库缺列时可能造成 scheduler
初始化失败、`/ready=503` 并触发 systemd 停服，因此不得制作或发布本营销 Bundle。

解除条件全部归属 0805-002 独立交付：

1. 把该迁移的 apply + audit 纳入正式备份后、启动前流程，或独立移除正式 ORM 对该列的依赖；
2. 证明旧生产 schema 升级后 `missing_columns=[]`、`migration_required=false`；
3. 用升级后的数据库启动候选，证明 scheduler started、`/ready=200`，并从默认 v4 入口完成一条记录冒烟；
4. 生产先完成该独立发布，再把营销候选重新桥接到届时最新 `main` 并重跑全部门禁。

当前正式路径仍为 `https://insight.guangtuo.com` 上的生产 revision `2c6a36e`。新营销治理
修复尚未设为生产默认；既有生产中的资源化 API 与模块化 Provider 不受本轮暂停影响。
