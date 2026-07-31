---
title: "收紧检索候选并修复标题乱码"
status: closed
type: AFK
blocked_by:
  - 002-structured-answer-citations.md
---

# 收紧检索候选并修复标题乱码

## Parent

- `../TECH-SPEC.md` U3
- 覆盖 AC-007、AC-008

## What to build

让检索候选只来自经过形状校验的平台搜索结果数组，删除任意响应对象递归捞取 URL 的正式路径；对候选做 URL 规范化、过滤、去重和限量，并在可证明为 UTF-8 单字节误解码时修复标题。页面明确说明检索候选不是回答引用，也不计入引用 KPI。

## Acceptance criteria

- [x] DeepSeek 和豆包只从脱敏 fixture 证明过的搜索结果路径接纳候选，任意深层无关 URL 不再进入结果。
- [x] 平台 UI、登录/反馈页、静态资源、无效协议和明显超长 UI 文本被过滤；规范 URL 去重后最多保存 20 条。
- [x] Web capture 记录观察、接纳、丢弃和截断统计，但这些统计不进入引用 KPI。
- [x] 可证明的 UTF-8 mojibake 标题恢复正常中文，正常中文、英文和不确定文本不被误改。
- [x] 历史标题在读取时使用相同的保守修复且不回写数据库；候选区域默认折叠并解释其证据语义。

## Blocked by

- `002-structured-answer-citations.md`
