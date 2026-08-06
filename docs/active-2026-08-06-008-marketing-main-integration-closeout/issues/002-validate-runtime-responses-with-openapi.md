---
title: "用 OpenAPI 校验四接口实际响应"
status: open
type: tdd
blocked_by:
  - "001-replay-marketing-onto-latest-main.md"
---

# 用 OpenAPI 校验四接口实际响应

## 验收标准

- [ ] 先增加会因当前浅层断言而暴露缺口的失败合同测试；
- [ ] Dashboard、ad-hierarchy、keywords、search-terms 的实际成功响应均由同一 OpenAPI schema 校验；
- [ ] 代表性 401、409、422、503 错误响应由对应 OpenAPI schema 校验；
- [ ] 校验覆盖嵌套类型、required、enum、数组项和额外字段边界；
- [ ] 前端生成类型仍来自同一 OpenAPI，漂移检查通过；
- [ ] 006 Issue 001 如实记录“先冻结 JS 常量、后补 OpenAPI”的过程偏差。
