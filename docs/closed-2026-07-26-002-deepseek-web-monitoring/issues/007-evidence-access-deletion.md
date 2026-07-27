---
title: "完善证据鉴权与删除生命周期"
status: closed
type: AFK
blocked_by:
  - "003-project-web-capture-tracer"
---

# 完善证据鉴权与删除生命周期

## Parent

- PRD：`docs/closed-2026-07-26-002-deepseek-web-monitoring/prd.md`
- Tech Spec：`docs/closed-2026-07-26-002-deepseek-web-monitoring/TECH-SPEC.md`
- 对应实施切片：U-002

## User stories covered

- US-5：安全查看页面截图证据。
- US-8：证据缺失或清理失败时得到明确错误。

## What to build

完整覆盖 Web 截图从 staging、正式归属、鉴权读取到记录删除的生命周期。读取接口必须先验证当前记录、artifact 引用和 artifact owner，再以受控流返回文件；任何路径参数、跨用户引用或数据库未声明的 artifact 都不能访问本机文件。

所有正式删除 `QuestionRecord` 的路径采用可补偿删除：先把记录证据目录原子移入隔离区，再执行数据库事务；数据库回滚时恢复，提交后物理清理。提交后清理异常必须返回稳定错误并由启动补偿继续清理，不能重新暴露隔离文件。

## Acceptance criteria

- [x] 普通用户只能读取自己记录引用的 artifact，管理员可以读取所有合法记录证据。
- [x] analysis-only 记录引用原 artifact owner 时，同时验证当前记录和原始记录归属。
- [x] 非 UUID、路径穿越、未声明 artifact、跨用户 record ID 和符号链接逃逸均被拒绝。
- [x] 证据响应使用正确图片类型、`private, no-store`、`nosniff` 和 inline disposition。
- [x] 数据库只保存 artifact ID、哈希、尺寸和有界元数据，不保存绝对路径或图片内容。
- [x] 单条历史删除成功后，对应证据文件同步清理。
- [x] 批量历史删除保留问题集受保护记录，只清理实际删除记录的证据。
- [x] 提示词分析清理和项目永久删除会清理所有实际删除记录的证据。
- [x] 数据库事务回滚时隔离证据恢复，记录仍可正常读取。
- [x] 数据库提交后文件清理失败返回 `web_capture_cleanup_incomplete`，隔离文件无法通过 API 访问并可在启动时继续清理。
- [x] staging、discard、quarantine、restore、commit 和补偿清理均为幂等操作。
- [x] 自动化测试使用临时目录覆盖鉴权、路径安全、四类删除入口和故障注入。

## Blocked by

- `003-project-web-capture-tracer.md`

## Verification

- `node --test tests/DetectionHistoryEvidence.test.js tests/PromptAnalysisCleanupService.test.js tests/ProjectDeletionService.test.js tests/WebCaptureStore.test.js tests/WebCaptureDeletionService.test.js tests/WebCaptureAccessService.test.js tests/GeoProjectsRoutePolicy.test.js`
- 结果：50/50 通过。
- 覆盖：owner/admin 鉴权、原 artifact owner 双重校验、UUID/穿越/符号链接防护、安全图片响应头、单条/批量/提示词/项目四类删除、事务回滚恢复、提交后清理失败与启动补偿。
