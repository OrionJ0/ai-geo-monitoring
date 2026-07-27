---
title: "固化虚拟机单实例与共享 admin 运维约束"
status: blocked
implementation_status: complete
type: HITL
blocked_by:
  - "target-vm-operations-acceptance"
---

# 固化虚拟机单实例与共享 admin 运维约束

## Parent

- PRD：`docs/blocked-2026-07-27-001-market-team-vm-web-queue/prd.md`
- Tech Spec：`docs/blocked-2026-07-27-001-market-team-vm-web-queue/TECH-SPEC.md`
- 对应实施切片：U3

## User stories covered

- US-1：市场部只通过个人浏览器访问统一部署的系统。
- US-6：市场部统一使用现有 admin 和共同项目。
- US-7：虚拟机运维负责人统一维护 DeepSeek 服务账号。
- US-9：正式环境保持单后端实例。

## What to build

把“一台虚拟机、一个后端、一个 DeepSeek 服务账号、一个持久 profile”的运行边界固化为可重复执行的部署和运维流程。优先复用现有生产进程管理、端口检查和 profile 锁；只有验证发现真实缺口时，才对单实例保护做最小补强。本切片不依赖新状态接口，可以与 001 并行；状态 API 契约和 `docs/API.md` 由 001 负责，最终结合状态接口的双浏览器验收由 004 负责。

文档应明确 Chrome 运行在虚拟机的持久桌面会话中，虚拟机不得休眠，远程桌面断开不得销毁会话，数据库、profile 和证据必须位于持久磁盘。市场部统一使用现有共享 admin，接受完整管理员权限和无法识别真实操作人的限制；系统 admin 与 DeepSeek 服务账号始终是两套身份。

## Acceptance criteria

- [ ] 正式启动只使用受管生产命令，重复启动不会产生第二个受管后端实例。
- [ ] 固定端口和 profile lock 能阻止第二个进程同时操作同一 DeepSeek profile。
- [ ] 不属于当前受管实例的 PID 不会被覆盖、误判或终止。
- [ ] 正常停止后端时关闭专用 Chrome 并释放 profile lock。
- [ ] 人工登录和切换 DeepSeek 账号的正式流程为：停止生产服务、在虚拟机桌面执行登录命令、人工确认输入区可用、关闭登录浏览器、恢复生产服务。
- [ ] 文档明确恢复生产服务会启动新后端进程并清除登录、验证或选择器类进程内熔断；只完成网页登录但不重启后端不视为恢复完成。
- [ ] 部署说明明确后端必须从持续可用的图形桌面会话环境运行。
- [ ] 部署说明明确虚拟机不得休眠，远程桌面断开不能销毁桌面会话。
- [ ] 数据库、profile 和证据目录明确要求位于持久磁盘，且 profile 不与日常 Chrome 或 SEO 浏览器共用。
- [ ] 所有市场部同事使用现有共享 admin，文档明确其完整权限、无人员级审计和公司内部密码轮换责任。
- [ ] DeepSeek 服务账号凭据只由虚拟机运维负责人维护，不进入应用配置、数据库、日志、Issue 或示例命令。
- [ ] `/api/ready` 继续只表示主应用、数据库和调度器就绪，不承诺 DeepSeek Web 可用。
- [ ] 在目标虚拟机完成停止、人工登录和启动验证；状态检查和双浏览器访问终验留给 004。

## Blocked by

- 目标虚拟机的停止、人工登录、启动、Chrome 关闭和 profile lock 释放验收。

## 实施与自动化验收记录

- `README.md`、`docs/ENVIRONMENT.md`、`docs/SINGLE_HOST_DEPLOYMENT.md` 与 `backend/.env.example` 已明确单 VM、单后端、单服务账号、持久桌面、持久磁盘和共享 `admin` 风险。
- 生产进程管理测试已证明重复启动复用同一受管 PID；未知存活 PID 不会被覆盖、误判或终止。
- Web 运行服务测试已覆盖单 FIFO、单活动页面、关闭中拒绝新工作、会话关闭和 profile lock 释放。
- `/api/ready` 的含义保持为主应用、数据库和调度器就绪，不承诺 DeepSeek Web 可用。
- 自动化证据：`tests/processManager.test.mjs`、`tests/marketTeamVmOperationsDocs.test.mjs`、`WebPlatformService.test.js` 与部署测试均通过。
- 未关闭原因：上述进程与 profile 行为仍需在目标虚拟机的真实图形桌面和 Chrome 中确认。
