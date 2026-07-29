---
title: "从单问题入口完成豆包可信网页采集"
status: blocked
type: AFK
blocked_by:
  - "001-doubao-page-contract-and-resource-baseline.md"
  - "002-managed-web-registry-and-isolated-runtime.md"
  - "003-doubao-login-preflight-and-runtime-status.md"
---

# 从单问题入口完成豆包可信网页采集

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 覆盖用户故事：US-001、US-003、US-004、US-005、US-010

## What to build

从问题库单问题正式入口打通一条完整的豆包 Web 采集路径：创建空白新会话、确认普通模式且“深入研究”未开启、发送问题、等待本次最终回答稳定、提取平台引用、保存模式截图与最终截图，并将结果写入现有运行记录。

通用采集状态机负责固定阶段、输入边界、完成判据和 staged evidence 清理；豆包页面实现只负责经过验证的页面交互。DeepSeek Web 应迁移到同一状态机，不能保留第二套旧采集流程。

普通模式是硬性条件。系统不得主动开启“深入研究”；只有确认未选中，或在唯一残留选中态下关闭一次并再次确认后，才能插入和发送问题。问题一旦发送，不得自动再次提交。

豆包 Web 失败必须返回豆包网页错误，任何失败路径都不得调用豆包 API 或生成替代回答。

## Acceptance criteria

- [x] 用户可以从问题库单问题入口选择“豆包网页版”并创建独立运行记录。
- [x] 每次执行都进入空白新会话，连续问题不存在上下文串扰。
- [x] 搜索关闭时系统会主动开启，并在读取到确定开启状态后继续。
- [x] 普通模式无法确认或残留“深入研究”无法唯一关闭时任务失败，问题发送次数为 0。
- [x] 搜索状态截图成功保存后，系统才允许进入问题发送阶段。
- [x] 当前回答通过唯一新增回答、正文非空、生成结束、页面非忙碌和稳定窗口联合确认。
- [x] 不能唯一识别当前回答、回答超时或回答过大时不会保存成功结果。
- [ ] 当前回答的平台引用从回答范围内提取并限制为安全 HTTP/HTTPS 地址。
- [x] 没有平台引用的回答可以成功，引用列表为空。
- [x] 成功记录包含 `doubao-web`、`doubao-web-ui`、最终正文、搜索证据、最终截图和有界采集信息。
- [x] 截图失败、页面异常和采集失败会丢弃未完成证据。
- [x] 问题发送后发生超时或错误时不会自动再次发送。
- [x] 所有豆包 Web 失败路径中豆包 API 调用次数为 0。
- [x] DeepSeek Web 迁移后保持既有新会话、搜索、回答、截图和错误语义。

阻塞说明：状态机、正式执行器和本地无引用真实回答已经通过；目标 VM 仍需验证登录恢复及有引用回答的最终 DOM 形态。2026-07-29 后新初始化平台默认启用，但这不代表目标 VM 验收完成。

## Blocked by

- `001-doubao-page-contract-and-resource-baseline.md`
- `002-managed-web-registry-and-isolated-runtime.md`
- `003-doubao-login-preflight-and-runtime-status.md`
