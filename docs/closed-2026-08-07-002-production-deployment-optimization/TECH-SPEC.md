---
title: GEO 正式验收误触发优化技术方案
date: 2026-08-07
status: closed
source: docs/closed-2026-08-07-002-production-deployment-optimization/prd.md
scope: standard
---

# GEO 正式验收误触发优化技术方案

## 1. 背景与目标

`scripts/deploy.mjs` 当前把自身和 `scripts/deploy-from-bundle.mjs` 同时放入 `GEO010_CONTRACT_PATHS` 与 `GEO010_CONTRACT_LEAF_PATHS`。候选部署器使用这份列表分别计算新旧 revision 指纹，所以部署日志、错误文案等任意变化都会令 `isGeo010ContractChanged()` 返回 true，继而触发真实 preflight 和四入口 Stage2。

本方案只修正这一个边界：部署器属于发布协议，不属于 GEO 业务运行合同。移除两个路径，并用现有部署专项测试保护门禁调用关系。

## 2. 范围与非目标

- 范围：修改现有 GEO 指纹路径、补充回归测试、更新本需求文档。
- 非目标：新增模块或配置文件；修改 workflow、Bundle、服务器测试、构建、迁移、锁、recovery、systemd 或前端产物。
- 延后事项：原子构建、资源观测、锁恢复只有再次发生并取得直接证据后再独立评估。

### 实施前置门禁

当前生产部署必须先完成。开始实现前重新确认：

1. 部署任务已有终态且没有活动部署进程。
2. 公开 `/api/health`、`/api/frontend-health` revision 一致，`/api/ready.status=ready`。
3. 服务器 `HEAD`、目标 revision、工作区和 `.runtime/deploy.lock` 状态明确。

证据满足后，只把本目录从 `draft-` 改为 `active-`，再修改代码。

## 3. 当前系统认知

- `computeGeo010ContractFingerprint()` 只对受控路径及实际使用的外部包锁摘要计算 SHA-256。
- `isGeo010ContractChanged()` 使用候选版本的同一算法比较新旧 revision；旧 revision 无效或读取失败时返回 true。
- `backend/scripts/geo010Acceptance.js` 已在受控路径中，真实验收行为本身会触发指纹变化。
- `scripts/deploy.mjs` 的 Stage2 条件是 `requireGeo010Acceptance || isGeo010ContractChanged(...)`。
- `scripts/deploy-from-bundle.mjs` 在 recovery 时即使合同未变化，也会要求完整 preflight，并把 `requireGeo010Acceptance=true` 传给正式部署器。
- `tests/deployCli.test.mjs` 已覆盖指纹、依赖闭包和 Stage2 条件；`tests/deployBundle.test.mjs` 已覆盖 recovery 与强制验收传递。

## 4. 技术变更

### 4.1 指纹边界

在 `scripts/deploy.mjs` 中：

1. 从 `GEO010_CONTRACT_PATHS` 删除：
   - `scripts/deploy.mjs`
   - `scripts/deploy-from-bundle.mjs`
2. 从 `GEO010_CONTRACT_LEAF_PATHS` 删除同样两个路径。
3. 保留其他 GEO 根、递归相对依赖展开、实际使用外部包锁摘要和旧 revision fail-closed 行为不变。

不新增“部署协议版本号”、分类器、manifest 或跳过开关。部署脚本正确性继续由 `npm run test:deployment` 证明。

### 4.2 强制验收不变量

以下行为不得随指纹缩小而改变：

- `backend/scripts/geo010Acceptance.js` 或 GEO 运行依赖变化时，指纹必须变化。
- `requireGeo010Acceptance=true` 时 Stage2 必须执行。
- recovery 必须执行完整 preflight，并把强制验收传到 Stage2。
- Stage2 失败不能写 `SUCCESS`。
- 旧 revision 不可读时必须按变化处理。

## 5. 涉及文件

- `scripts/deploy.mjs`
- `tests/deployCli.test.mjs`
- `tests/deployBundle.test.mjs`（仅当现有 recovery 断言不足时补测试）
- `docs/closed-2026-08-07-002-production-deployment-optimization/prd.md`
- `docs/closed-2026-08-07-002-production-deployment-optimization/TECH-SPEC.md`

不创建新的生产代码文件。

## 6. 实施与测试

本需求只有一个实现切片，使用 TDD：

### U1. 缩小 GEO 指纹并证明门禁不变

**目标：** 部署器变化不再触发真实 GEO 验收，真实 GEO 变化和 recovery 仍完整验收。

**依赖：** 实施前置门禁完成。

**方案：** 先在现有临时 Git 仓库 fixture 中增加失败测试，再删除两个受控路径，最后运行部署专项与完整 CI。

**测试场景：**

1. 只改 `scripts/deploy.mjs` 日志：`isGeo010ContractChanged=false`。
2. 只改 `scripts/deploy-from-bundle.mjs`：false。
3. 修改 `backend/scripts/geo010Acceptance.js`：true。
4. 修改现有 GEO 根及间接依赖：true。
5. 旧 revision 无效或缺文件：true。
6. `requireGeo010Acceptance=true`：Stage2 执行。
7. recovery：完整 preflight 且 Stage2 执行。

**验收方式：** 部署专项全部通过；CI 完整验证通过；正式发布后公开 revision 正常，日志明确跳过 Stage2，真实四入口 AI 调用为 0。

## 7. 验收标准

- AC-001: Given 部署脚本只有日志变化, When 比较相邻 revision, Then GEO 指纹不变化。
- AC-002: Given GEO 验收脚本或运行依赖变化, When 比较相邻 revision, Then GEO 指纹变化。
- AC-003: Given recovery 或显式强制验收, When 正式服务启动, Then Stage2 仍执行。
- AC-004: Given 本优化正式发布, When 查看部署日志, Then出现“v5 运行合同未变化，无需重复四入口验收”，且部署成功。
- AC-005: Given 发布完成, When 请求三个公开健康入口, Then前后端 revision 等于目标 SHA，ready 为正常。

## 8. 风险与缓解

- 风险：未来部署器修改可能破坏 Stage2 调用，但指纹不再自动触发真实验收。
- 缓解：保留并加强部署专项不变量测试；任何修改部署器的提交必须通过 `npm run test:deployment` 和 CI，不用昂贵真实 AI 调用替代代码合同测试。
- 风险：某个真实 GEO 文件未包含在现有根或依赖闭包中。
- 缓解：本期不重写现有根集合；测试继续覆盖递归依赖。发现真实遗漏时只补该业务根，不把整个部署器重新加入。

## 9. 发布与回滚边界

1. 当前部署结束并完成前置核验。
2. 本目录改为 `active`，完成测试先行的最小代码修改。
3. 通过完整 CI 后使用现役 Git Bundle 正式发布。
4. 该候选只改变部署协议，不改变 GEO 运行合同；预期不执行真实 preflight/Stage2，服务器其余测试、构建、迁移和公开健康检查保持原样。
5. 若生产发现应验未验，立即将遗漏的具体 GEO 业务文件加入受控根并发布后代修复；不增加隐藏开关或双实现。

## 10. 后续衔接

- 不需要拆分多个 issue，可直接使用 `$tdd` 或 `$prd-issue-tdd` 完成单一切片。
- 预计生产代码改动仅为受控路径删除，主要工作量在回归测试和正式入口验证。
