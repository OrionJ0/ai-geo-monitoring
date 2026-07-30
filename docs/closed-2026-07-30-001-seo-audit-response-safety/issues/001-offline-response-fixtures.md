---
title: "建立离线响应 Fixture 与 Mock Server"
status: closed
type: AFK
blocked_by: []
---

# 建立离线响应 Fixture 与 Mock Server

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-1、US-3、US-5

## What to build

建立一套完全离线、可重复运行的 SEO 响应测试基线，用于复现正常页面、WAF Challenge、限流、资源类型错配和重定向链。测试基线必须能记录收到的请求顺序、次数、时间和审计 UA，使后续分类、限速、熔断和预检实现可以通过确定性证据验收，而不需要反复访问 Hikvision 或其他第三方站点。

EdgeOne 样本使用脱敏后的真实结构或结构等价的合成响应。所有 Cookie、Token、IP、真实 Request ID、访问凭据和可重放参数必须替换为固定假值。

## Acceptance criteria

- [x] Fixture 覆盖正常 HTML、合法 SPA、200 Challenge、普通业务 403、403 WAF、429 与 `Retry-After`、HTML 伪装的 robots/Sitemap、合法 robots、合法 Sitemap XML。
- [x] Mock Server 提供五次重定向后返回正常页面的端点，并能证明一次逻辑访问产生六次真实 HTTP 请求。
- [x] Mock Server 能记录请求顺序、路径、时间、方法和 User-Agent，测试结束后可可靠关闭且不遗留监听端口。
- [x] Fixture 和测试日志不包含真实 Cookie、Challenge Token、Authorization、内部 IP、真实 Request ID 或其他可重放敏感信息。
- [x] 全部测试不访问公网，不依赖 Hikvision、EdgeOne、Cloudflare 或其他第三方服务的实时可用性。
- [x] 测试基线能够区分普通 403、WAF 403、200 Challenge 和合法低正文 SPA，为后续误报测试提供稳定输入。

## Blocked by

None - can start immediately.

## Verification

- `cd backend && node --test tests/SeoAuditResponseFixtures.test.js`
- 结果：1 项通过，0 项失败。
