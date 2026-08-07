# GEO 正式验收误触发优化 PRD

## Problem Statement

当前 `scripts/deploy.mjs` 和 `scripts/deploy-from-bundle.mjs` 整个文件都计入 GEO 010 运行合同指纹。因此，即使只修改部署日志或错误上下文，没有改变 GEO 分析、四入口、配额、调度或数据合同，也会被判定为 GEO 运行合同变化，并额外执行耗时较长的真实 preflight 和四入口 Stage2 验收。

最近一次部署日志改动因此获得了与 GEO 正式硬切相同的验收成本。前置测试、构建和浏览器验收约十余分钟，真实四入口验收又增加数十分钟。问题不在分支数量，也不需要先重写部署系统；最直接的原因是 GEO 指纹范围过宽。

## Solution

只缩小 GEO 010 指纹边界：部署器继续由部署专项测试保护，但不再因为部署脚本任意文本变化自动触发真实 GEO 验收。实际 GEO 运行代码、验收脚本及其依赖变化仍保持完整 preflight 和 Stage2。

不改变现有 Git Bundle、GitHub Actions、服务器测试、前端构建、迁移、systemd、锁或 recovery 流程。

## User Stories

1. As a 发布维护者, I want 部署日志改动不触发真实四入口 AI 验收, so that 部署耗时与实际业务风险匹配。
2. As a 发布维护者, I want 真实 GEO 运行合同变化继续完整验收, so that 提速不会降低正式发布可信度。
3. As a 开发人员, I want 通过现有部署测试证明部署器仍正确调用门禁, so that 不需要把整个部署脚本混入 GEO 业务指纹。

## Scope

- In scope:
  - 从 GEO 010 指纹受控路径中移除两个部署脚本。
  - 增加部署脚本变化不触发 GEO 验收的回归测试。
  - 保持 GEO 运行文件、验收脚本及实际依赖变化仍触发完整验收。
  - 保持 recovery 和显式 `requireGeo010Acceptance` 强制验收。
- Out of scope:
  - 新增发布分类器、策略 manifest 或新的发布档位。
  - 修改 GitHub Actions、服务器测试、构建、迁移、systemd 或 Bundle 格式。
  - 原子 `.next`、部署锁、混合服务状态或结构化资源监控改造。
  - 清理分支、扩容或增加 Swap。
- Later:
  - 只有再次出现构建破坏、锁恢复或资源异常时，再基于新证据单独立项。

## Product Behavior

- 只修改部署日志、阶段提示、错误上下文或部署脚本内部非 GEO 业务逻辑时，部署仍执行现有测试、构建、迁移和公开健康检查，但不调用 GEO 真实 preflight/Stage2。
- 修改 GEO 分析服务、四入口、配额、调度、快照、真实请求策略、`geo010Acceptance.js` 或其实际依赖时，继续执行完整 preflight 和 Stage2。
- 上一次发布处于 recovery，或启动器显式要求完整验收时，不论指纹是否变化都必须验收。
- 无法读取旧版本指纹时继续按“已变化”处理，不得为了提速改成跳过。
- 纯文档变更由维护者不触发生产 workflow；本期不为此新增自动分类代码。
- 当前正在执行的生产部署完成前，本需求保持 `draft`，不修改发布代码。

## Acceptance Criteria

- AC-001: Given 相邻版本只修改 `scripts/deploy.mjs` 的日志内容, When 比较 GEO 010 指纹, Then 返回“合同未变化”。
- AC-002: Given 相邻版本只修改 `scripts/deploy-from-bundle.mjs`, When 比较 GEO 010 指纹, Then 返回“合同未变化”。
- AC-003: Given 相邻版本修改 `backend/scripts/geo010Acceptance.js`, When 比较指纹, Then 返回“合同已变化”。
- AC-004: Given 相邻版本修改任一现有 GEO 合同根或实际依赖, When 比较指纹, Then 返回“合同已变化”。
- AC-005: Given `requireGeo010Acceptance=true`, When 正式服务启动完成, Then Stage2 必须执行，不能被未变化指纹跳过。
- AC-006: Given 启动器处于 recovery, When 候选合同未变化, Then 仍执行完整 preflight 和 Stage2。
- AC-007: Given 旧 revision 无效或缺少受控文件, When 比较指纹, Then 保持 fail-closed 并执行完整验收。
- AC-008: Given 本优化正式发布成功, When 审计部署日志和真实 AI 调用, Then部署专项、构建、迁移和公开健康检查通过，四入口真实 AI 调用为 0。

## Metrics / Success

- 部署器自身变化误触发真实四入口验收的次数为 0。
- 真实 GEO 合同变化漏验次数为 0。
- 同类部署的服务器侧耗时从约 50 分钟回到不含真实 AI 验收的正常基线，目标不超过 15 分钟。
- 不新增生产模块、配置、数据库字段、环境变量或长期兼容路径。

## Constraints

- 必须等当前生产部署完成，并确认公开前后端 revision 一致、`/api/ready` 正常、服务器工作区与部署锁状态明确后才开始实现。
- 正式入口继续使用 GitHub Actions、已校验 Git Bundle、systemd 和公开 revision 门禁。
- GEO 真实变化的验收强度不能降低；只消除部署脚本造成的误触发。
- 不使用提交消息、分支名称、环境变量或人工开关决定是否验收。
- 本需求保持最小改动；发现额外问题先记录，不在本期顺手重构。

## Open Questions

无。当前问题与最小解法均已由代码和部署日志定位。

## Handoff

- PRD path: `docs/closed-2026-08-07-002-production-deployment-optimization/prd.md`
- Current state（2026-08-07）：指纹边界最小化已实现并通过 `npm run test:deployment`（50/50 全部通过）与聚焦审查。两个部署脚本已从 `GEO010_CONTRACT_PATHS` / `GEO010_CONTRACT_LEAF_PATHS` 移除，部署脚本变化不再触发真实四入口验收；`geo010Acceptance.js`、GEO 运行文件及其依赖变化仍触发完整 preflight 与 Stage2；recovery 与显式 `requireGeo010Acceptance` 强制验收不变量保持。**尚未正式发布**：正式发布必须走现役 GitHub Actions + Git Bundle 流程，发布后需核对日志出现“v5 运行合同未变化，无需重复四入口验收”且公开前后端 revision 一致（AC-008）。
- Recommended next step: 按现役 Git Bundle 流程正式发布本优化，并核对部署日志与真实 AI 调用为 0。
