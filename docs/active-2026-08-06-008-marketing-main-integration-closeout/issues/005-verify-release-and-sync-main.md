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
- [x] 秘密、旧路径、fallback、旧文档和 Flash 无关修改扫描通过；
- [x] 本轮营销 diff 的基础及风险专项对抗审查 P0/P1/P2 清零；
- [ ] 发布前确认 0805-002 不在发布/硬切/生产观察；
- [ ] 正式 Git Bundle、systemd、迁移 audit、公开健康和登录态入口验收通过；
- [ ] 本地 `main`、`origin/main`、服务器 `HEAD`、公开前后端 revision 完全一致。

## 本地验收证据

- 阻塞检查点 `7bc1e9e` 已提交；随后合并当时最新本地 `main=b41da59`，最终候选为 `0a16228`，`main` 是候选祖先；
- 合并只带入 9 个 Flash 文件，这 9 个文件逐一与 `main` 比较为零差异，营销工作没有改写 0805-002；
- 最终候选后端全仓：`1133 passed / 1 skipped / 0 failed`；营销：`250/250`；前端营销：`127/127`；部署：`30/30`；
- 后端全仓在一次与浏览器/部署并行的压力运行中出现 `DatabaseConfig` 临时端口连接拒绝；该用例聚焦重跑通过，随后串行全仓复验零失败，未修改业务代码掩盖瞬时端口竞争；
- lint 通过；Next.js 生产构建和 TypeScript 通过，共生成 40 个路由；
- 真实 Chrome 对最终候选的生产构建全套 `59/59`、测试进程零退出，覆盖上期请求跨日期及时取消、stale snapshot 日期钉扎后不重复请求、分页/错误/焦点状态；阻塞解除后仍须在最终发布 SHA 上重跑；
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
2026-08-06 只读复核时 `/health`、`/frontend-health` 和 `/ready` 均正常并返回该 revision；
`origin/main` 仍为 `98467f0`，未在发布阻塞期间推动远端或生产真值。

## 2026-08-06 最新 main 再桥接与生产复核

- 最新本地 `main=8179d63509e386428252048c50a52e11e49fd677` 已使用无提交 merge
  合入候选，自动合并无冲突；002/010 的运行代码、后端测试和状态文档在合并结果中
  与 `main` 零差异；唯一共享的 `keyword-analysis.spec.ts` 因营销资源化测试继续演进而
  相对 `main` 有预期差异，但 `main` 新增的三处类型收窄均已保留；
- 002 当前不是生产关闭状态：目录仍为 `active`，Issue 010 仍为 `in_progress`，最新
  记录明确写明 Git Bundle 部署未执行；`scripts/deploy.mjs` 仍没有 v5 快照字段迁移；
- 服务器只读 SSH 复核：`HEAD=2c6a36e`、工作区干净、两个 systemd 服务 active、
  `backend/database.sqlite` 的 `PRAGMA quick_check=ok`，但
  `question_records.competitor_snapshot` 列不存在；公开 `/api/health` 与
  `/api/frontend-health` 同为 `2c6a36e`，`/api/ready` 返回 200；
- 因本机 swap 使用约 `24740/25600 MB`，最终候选的 `npm run test:marketing` 启动进程
  在执行用例前进入不可中断系统等待，没有测试子进程或结果；本次未把它记为测试失败，
  也未沿用旧候选测试证据宣称新 SHA 已通过；
- 下一门禁保持不变：002 必须先独立完成生产迁移与四入口验收；本机资源恢复后，在最终
  候选 SHA 上重跑后端、营销、前端、部署、构建与真实 Chrome，再制作营销 Bundle。

## 最新候选对抗式复审

- 代码与最小变更：无 P0/P1/P2；相对最新 `main` 的营销有效差异未修改 v5 共享
  services、routes、models；002/010 运行路径与 `main` 零差异，共享浏览器测试的三处
  类型收窄也已保留；
- P0（现实、数据库、SRE）：生产缺少 `competitor_snapshot`，scheduler 启动查询会读取
  新 ORM 列，而正式部署未执行 v5 migration；当前候选不得制作或发布 Bundle；
- P1（数据库）：`migrateV5SnapshotFields.js` 会无条件覆盖 `DB_STORAGE`，必须先修正
  数据库目标选择，并用两个临时数据库证明只迁移显式目标；
- P1（现实）：最终合并组合尚无测试、构建或浏览器结果；002 目录/Issue 状态和现役文档
  仍互相矛盾，不能支持“002 已生产完成”的结论；
- P1（SRE）：生产现有 DeepSeek 配置尚无显式 Pro→Flash 预检/迁移及四入口现场验收；
  readiness 为 200 不能证明分析入口可用；
- P1（发布）：必须先形成不可变候选 SHA，并在该 SHA 上完成验收后才能制包；发布失败
  只允许候选后代的前向修复，不接受重新引入 v4/Pro 的旧路径恢复建议。
