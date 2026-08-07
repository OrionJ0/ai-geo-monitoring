---
title: "用 OpenAPI 校验四接口实际响应"
status: closed
type: tdd
blocked_by:
  - "001-replay-marketing-onto-latest-main.md"
---

# 用 OpenAPI 校验四接口实际响应

## 验收标准

- [x] 先增加会因当前浅层断言而暴露缺口的失败合同测试；
- [x] Dashboard、ad-hierarchy、keywords、search-terms 的实际成功响应均由同一 OpenAPI schema 校验；
- [x] 代表性 401、409、422、503 错误响应由对应 OpenAPI schema 校验；
- [x] 校验覆盖嵌套类型、required、enum、数组项和额外字段边界；
- [x] 前端生成类型仍来自同一 OpenAPI，漂移检查通过；
- [x] 006 Issue 001 如实记录“先冻结 JS 常量、后补 OpenAPI”的过程偏差。

## 验收证据

- 红灯：新增测试首先因运行时 OpenAPI validator 不存在而以 `MODULE_NOT_FOUND` 失败；
- 第一轮实际响应校验进一步发现 ad-hierarchy、keywords、search-terms 的
  `coverage.lastSuccessfulAt` 为 SQLite 时间文本，不符合 OpenAPI 的 RFC 3339
  `date-time`；共享 selector 统一序列化后通过；
- Ajv 8 的 JSON Schema 2020-12 校验开启 strict/allErrors，并由 `ajv-formats`
  验证日期；额外字段、嵌套错误类型和错误信封均有反例；
- 聚焦 17/17、营销全量 244/244 通过，类型生成 `--check` 由合同测试执行通过；
- 正式生产尚未发布本修复，当前正式路径不变。
