---
title: "可信展示 Web 回答结构与显式引用"
status: closed
type: AFK
blocked_by: []
---

# 可信展示 Web 回答结构与显式引用

## Parent

- `../TECH-SPEC.md` U2
- 覆盖 AC-005、AC-006、AC-012

## What to build

让新采集的 DeepSeek Web 和豆包 Web 回答以受控 Markdown 保存和展示，保留表格、列表、标题、代码和链接等可读结构；显式引用把数字锚点作为序号而不是标题，并使用平台元数据或域名生成可识别的链接标签。存量纯文本保持原样，不猜测恢复已经丢失的 DOM 结构。

## Acceptance criteria

- [x] 新 Web capture 显式保存回答格式，报告只对可信 `markdown_v1` 使用 GFM 渲染。
- [x] 表格、列表、标题、段落、代码块和 HTTP(S) 链接可读，原始 HTML、脚本、事件属性及危险协议不能执行。
- [x] `-1`、`[3]` 等纯数字引用标记，以及 `autolink`、`link`、`url` 等通用占位词，不作为标题；回答显式引用和指标引用源均优先显示平台标题，其次显示域名或 URL。
- [x] 存量 `plain_text` 回答不被 Markdown 解释，原始回答内容不被静默改写。
- [x] 回答格式在报告及标准 CSV 的兼容往返中不丢失，旧 CSV 仍可读取。

## Blocked by

None - can start immediately

## Production evidence

- 验收运行 #7 的新豆包回答按 `markdown_v1` 展示标题、列表、表格与 6 条可点击引用。
- 正式运行 #3 的回答显式引用和指标引用源均不再显示孤立数字或通用占位词，而是显示页面标题或站点域名。
- 运行 #3 的存量回答继续标记为 `plain_text`，原文未被改写。
