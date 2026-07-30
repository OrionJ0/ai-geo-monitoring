---
title: "建立可信响应与风控止损闭环"
status: closed
type: AFK
blocked_by:
  - "001-offline-response-fixtures.md"
---

# 建立可信响应与风控止损闭环

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-1、US-2、US-3、US-5

## What to build

为单页和全站 SEO 检测建立一条完整的可信响应与止损路径。每个响应先根据预期资源类型分类，只有正常响应可以进入页面评分或 robots/Sitemap 解析。每次真实出站 HTTP 请求及重定向跳转都必须经过限速和计数；确认目标站点 WAF 或收到 429 后，当前任务立即停止该 origin 的后续请求。

全站模式在递归 Sitemap 和页面循环前执行入口、robots、默认 Sitemap 三步有界预检。普通 robots/Sitemap 缺失、业务 403 或格式无效只影响对应资源；确认 WAF、429 或入口不可分析才停止任务。失败任务返回安全、可行动的错误原因和停止诊断，不创建技术健康分或成功历史。

该 issue 同时完成响应分类器、评分闸门、Axios 事务级限速计数、WAF/429 熔断和有界预检。上述能力不得拆成可单独进入正式入口的半成品。

## Acceptance criteria

- [x] 正常 HTML 在单页和全站正式服务入口继续进入现有 SEO 分析，现有评分行为保持兼容。
- [x] 200 Challenge 和带明确 Challenge 证据的 403 均不会进入 Cheerio 页面分析、SEO 检查或技术健康评分。
- [x] 普通业务 403、合法 SPA、低正文页面或单一 MIME 异常不会被误判为 WAF。
- [x] robots/Sitemap 返回普通 HTML 错误页时不进入对应有效性解析，也不自动熔断整个目标站点。
- [x] 目标入口是普通不可用响应时任务以入口错误失败；非入口普通页面错误继续使用逐页失败语义。
- [x] 每次真实 HTTP 请求均在发送前取得速率许可；默认并发为 2，同一 origin 的请求启动间隔不短于 500ms。
- [x] 五次重定向产生六次请求计数和五个重定向跳数，每一跳都继续执行现有 URL、DNS、私网和重定向安全检查。
- [x] 确认目标 origin WAF 后，本任务不会再向该 origin 发出请求；错误文案明确说明 GoodieAI 审计身份或出口被拦截，且不能据此判断搜索引擎是否被阻止。
- [x] 收到 429 后保存合法的建议重试时间、停止当前任务后续同源请求且不在 worker 内长时间等待或自动重试。
- [x] 全站预检严格按入口、robots、一个默认 Sitemap 的顺序执行；任一步确认 WAF/429 后均不进入后续发现、抓取、链接探活或渲染。
- [x] 外域链接探活遇到 WAF/429 只停止该外域后续探活，不把目标站点报告判为 WAF。
- [x] 成功报告包含有界请求计数和完成原因；失败任务包含错误码、停止原因和安全诊断，且不保存完整响应正文、Cookie 或 Token。
- [x] 单页和全站正式入口都走新评分闸门，不存在分类失败后继续旧评分路径的 fallback。
- [x] 现有 SSRF、DNS rebinding、私网地址、响应体积、超时、重定向和用户隔离回归测试继续通过。

## Blocked by

- [001 建立离线响应 Fixture 与 Mock Server](001-offline-response-fixtures.md)

## Verification

- `node --test tests/SeoAuditResponseFixtures.test.js tests/SeoSiteClient.test.js tests/SeoAuditService.test.js tests/SeoSiteAuditService.test.js tests/SeoAuditRuntimeService.test.js tests/SeoAuditJobService.test.js tests/SeoAuditApi.test.js tests/SeoAuditSiteApi.test.js`
- 结果：63 项通过，0 项失败。
- 验证覆盖：分类器、评分闸门、五跳重定向计数、500ms 同域间隔、WAF/429 熔断、有界预检、外域熔断隔离、任务安全诊断和正式运行时任务级 client。
