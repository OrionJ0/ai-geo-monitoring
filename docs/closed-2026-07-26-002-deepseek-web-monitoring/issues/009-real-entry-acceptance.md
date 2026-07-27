---
title: "完成真实入口验收并正式启用 DeepSeek Web"
status: closed
type: HITL
blocked_by:
  - "004-web-runtime-safety"
  - "006-question-set-scheduled-runs"
  - "007-evidence-access-deletion"
  - "008-history-report-export-separation"
---

# 完成真实入口验收并正式启用 DeepSeek Web

## Parent

- PRD：`docs/closed-2026-07-26-002-deepseek-web-monitoring/prd.md`
- Tech Spec：`docs/closed-2026-07-26-002-deepseek-web-monitoring/TECH-SPEC.md`
- 对应实施切片：U-008

## User stories covered

- US-1 至 US-10。

## What to build

从用户实际入口完成 DeepSeek Web 的最终验证和正式切换。验收使用用户在专用 Chrome 中人工登录的真实页面，不使用账号密码自动化、复制浏览器凭据或调用网页私有接口。

验证人工登录后的会话跨服务重启复用、项目手动运行、问题集运行、项目自动监测、连续新对话、联网状态、正文、明确引用、截图、现有分析、错误熔断、删除清理和 API/Web 样本隔离。只有真实入口和全量回归通过后才启用内置平台并把需求状态改为完成。

## Acceptance criteria

- [x] 人工登录命令成功后正常关闭 Chrome，启动和再次重启后端都能复用同一会话。
- [x] 真实项目运行能够自动创建新对话、确认联网、发送问题并保存正文、引用和两项截图证据。
- [x] 连续两个问题产生不同的新对话或新 turn 证据，不复用上一回答。
- [x] 真实问题集运行通过同一 Adapter 完成并生成现有报告。
- [x] 真实项目自动监测通过同一 Adapter 完成并写入项目历史。
- [x] 同一问题的 `deepseek` 与 `deepseek-web` 产生两条独立记录，历史、指标、报告和导出不合并。
- [x] 未登录 profile 返回 `web_login_required`，排队 Web 任务快速失败；API 平台不进入 Web 队列。
- [x] 验证页、选择器失配、超时和截图失败使用对应稳定错误，且没有部分成功结果。
- [x] 删除普通历史和永久删除测试项目后，对应证据文件被清理。
- [x] 代码搜索证明不存在 Web→API fallback、浏览器 Token/Cookie 环境变量、私有接口主动调用或敏感请求头持久化。
- [x] 自动化后端测试、前端测试、lint 和 production build 全部通过。
- [x] 验收记录经过脱敏，不包含账号、密码、认证头、Cookie、页面账号标识或本机 profile 绝对路径。
- [x] 正式启用后，项目选择实际走 DeepSeek Web Adapter。
- [x] README、环境文档、项目上下文和需求文档准确说明当前正式路径、人工登录方式、限制与无回退规则。

## Blocked by

- `004-web-runtime-safety.md`
- `006-question-set-scheduled-runs.md`
- `007-evidence-access-deletion.md`
- `008-history-report-export-separation.md`

## Verification

### 真实入口

- 使用已有人工登录的专用 Chrome 会话，连续两次重启后端后，均从
  `POST /api/geo-projects/:projectId/prompts/:promptId/run` 完成真实网页采集。
- 最终代码审查修正目录安全和 Network 观察窗口后，再从同一正式入口完成一条 Web 记录：正文、4 条明确引用、7 条发送后检索候选、联网状态、两项截图和分析指标均成功保存。
- 真实问题集一次运行两个问题，两个结果均确认联网、保存最终正文、明确引用/检索候选和两项 PNG 证据；两次页面会话指纹不同。
- 项目自动监测由正式 30 秒调度 tick 认领持久化执行槽并完成两条 Web 记录；验收后关闭该项目的自动监测。
- 同一问题同时运行 `deepseek` 与 `deepseek-web` 时生成两个独立记录：API 记录没有 Web 证据，Web 记录使用 `deepseek-web-ui` 并带完整采集证据。
- 使用全新、未登录且不复制任何会话凭据的隔离 profile 验证 `web_login_required`；两个排队任务均快速失败，熔断状态为 `login_required`。

### 证据、分析与清理

- 通过正式证据读取 API 分别打开联网状态图和最终回答图，响应为 `image/png`、`private, no-store`、`inline`；人工查看确认前者显示联网已选中，后者显示最终回答和页面引用。
- 实测结构化分析失败时仍保留完整 Web 原回答、引用和截图，不创建伪造指标。
- 通过正式历史删除接口删除普通记录后，证据目录同步删除；归档并永久删除一次性测试项目后，其记录和证据同步删除。
- profile、证据目录和 PNG 文件权限分别为仅当前运行用户可访问的 `0700` 与 `0600`。

### 错误与安全

- 单元/集成测试覆盖人工验证、选择器失配、联网状态失配、生成超时、截图失败、浏览器关闭、队列熔断和 Web→API 零回退。
- 页面网络观测仅订阅当前页面响应并读取有界同源 JSON；生产 Web 代码没有认证头读取/重放、Cookie/Token 配置、网页私有接口主动请求或敏感请求头落盘。
- 验收使用未登录隔离 profile 验证失效状态，没有破坏或复制真实登录 profile，也没有使用账号密码自动登录。

### 自动化回归

- 后端：`npm test`，734/734 通过。
- 前端工具测试：`node --test src/utils/*.test.cjs`，189/189 通过。
- 前端 lint：0 error；保留一条与本需求无关的既有 unused-variable warning。
- 前端 production build：Next.js 编译、TypeScript 检查和 28 个静态页面生成全部通过。

## Closeout

- 内置平台 `deepseek-web` 已启用，正式 Adapter 为 `deepseek_web`，默认网页模型标识为 `deepseek-web-ui`。
- 正式入口为现有项目手动运行、问题集运行和项目自动监测，三者共用 `ProjectRunService → AIPlatformService → WebPlatformService → DeepSeekWebAdapter`。
- `deepseek` API 路径继续独立存在；它不是 Web 的旧实现或 fallback，任何 Web 失败都不会调用它。
- 旧独立检测定时任务、直接检测/SSE、分析平台、问题生成和模型目录均通过 capability 拒绝 `deepseek-web`。
