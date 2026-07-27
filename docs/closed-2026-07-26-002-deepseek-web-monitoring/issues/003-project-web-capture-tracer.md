---
title: "打通项目单问题 Web 采集闭环"
status: closed
type: HITL
blocked_by:
  - "001-platform-identity-capabilities"
  - "002-persistent-login-preflight"
---

# 打通项目单问题 Web 采集闭环

## Parent

- PRD：`docs/closed-2026-07-26-002-deepseek-web-monitoring/prd.md`
- Tech Spec：`docs/closed-2026-07-26-002-deepseek-web-monitoring/TECH-SPEC.md`
- 对应实施切片：U-002、U-004、U-005、U-006、U-007 的首个纵向闭环

## User stories covered

- US-1：从现有项目运行 DeepSeek 网页版。
- US-3：每个问题使用新对话。
- US-4：确认联网搜索已经开启。
- US-5：查看网页回答和截图证据。
- US-6：继续使用现有 GEO 分析。
- US-10：Web 失败时不回退 API。

## What to build

从现有项目手动运行入口打通第一个真实 DeepSeek Web 闭环：创建记录后通过统一平台门面进入 Web Adapter，取得串行执行权，建立新对话，验证联网搜索，保存搜索状态截图，输入并只发送一次问题，锁定发送后新出现的回答区域，等待生成结束和正文稳定，保存最终正文与回答截图，然后进入现有记录、分析和历史详情。

证据文件使用 staging 后原子提升为记录归属文件；数据库只保存随机 artifact ID、哈希和有界元数据。记录所有者和管理员可以从现有历史详情查看两项证据，不返回本机绝对路径。

## Acceptance criteria

- [x] 从现有项目运行入口选择 `deepseek-web` 会经过统一平台门面和正式项目 executor，不创建旁路任务。
- [x] 查询携带当前记录的有界 owner 上下文；缺少记录归属的 Web 查询被拒绝。
- [x] 每个问题创建新对话，并在发送前确认没有复用上一对话的回答区域。
- [x] 联网搜索通过页面可见状态确认；无法确认时不输入或发送问题。
- [x] 问题作为 CDP 参数或输入事件传递，不拼接到可执行脚本源代码。
- [x] 发送后只接受新出现的当前 assistant turn，旧回答和整页文本不能作为兜底。
- [x] 成功同时满足正文非空、生成结束、正文稳定 3 秒、联网已证实和最终截图成功。
- [x] 成功记录保存最终正文、搜索状态证据、最终回答证据、页面 URL、采集时间、选择器版本、浏览器元数据和回答哈希。
- [x] 截图 API 只接受记录中存在的随机 artifact ID，所有者和管理员可读取，响应不暴露文件路径。
- [x] Web 正文进入现有品牌、竞品、推荐、排名和情绪分析；平台代码始终保留为 `deepseek-web`。
- [x] Web 失败时 DeepSeek API Adapter 调用次数为 0，不创建替代回答或成功指标。
- [x] fake CDP 自动化测试覆盖完整状态机；HITL 验收至少完成一次真实项目问题采集。

## Blocked by

- `001-platform-identity-capabilities.md`
- `002-persistent-login-preflight.md`

## Verification

- fake 页面/CDP、证据 Store、owner 鉴权、平台分流与项目 executor 回归测试：75/75 通过。
- 真实 `ProjectRunService.runProject()` 验收记录 `345` 完成：
  - 平台为 `deepseek-web`；
  - 原回答 1074 字；
  - 页面明确引用 3 条；
  - 搜索状态为已观察；
  - 两项 PNG artifact 已保存；
  - 现有结构化分析和可见性指标成功落库。
- 真实运行中未调用 DeepSeek API fallback；一次性诊断脚本已删除。
