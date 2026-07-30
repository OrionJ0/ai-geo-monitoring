---
title: "完成正式入口硬切与安全回归验收"
status: closed
type: AFK
blocked_by:
  - "002-trusted-response-crawl-stop.md"
  - "003-resolved-url-identity.md"
---

# 完成正式入口硬切与安全回归验收

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- 覆盖用户故事：US-1、US-2、US-3、US-4、US-5

## What to build

从用户实际使用的单页、全站异步任务和报告入口验证新响应可信度链路已经正式生效。验收必须同时证明新分类、评分闸门、逐跳限速计数、WAF/429止损、有界预检和 resolved URL 去重都被真实入口调用，旧的无分类评分路径不再作为默认路径或静默 fallback。

使用离线 Mock Server 和自有或明确授权站点记录实际请求量基线、任务停止原因和用户可见错误。不得使用 Hikvision 或其他未授权第三方站点进行全站扫描、压力测试或反复调参。

## Acceptance criteria

- [x] 单页公开入口对正常页面生成报告，对 WAF、429 和不可分析入口返回明确错误且不生成伪成功历史。
- [x] 全站公开入口在入口、robots 或默认 Sitemap 出现 WAF/429 时立即失败，Mock Server 证明决策点之后目标 origin 的额外请求数为 0。
- [x] 全站正常报告展示真实 final URL、去重后的页面结果、请求计数和明确完成原因；达到页面上限时继续显示截断语义。
- [x] 异步失败任务持久化安全错误码、错误文案、停止原因及有界请求诊断，刷新页面后仍能查看。
- [x] 单页和全站正式入口都调用新响应分类与评分闸门；代码搜索和入口级测试证明旧的无分类评分路径不再被生产调用。
- [x] 分类器、评分闸门、Axios 事务级止损和有界预检作为同一正式版本启用，不存在只启用其中一部分的配置或 fallback。
- [x] 使用可控场景记录页面、robots、Sitemap、链接探活、重定向跳数和渲染尝试的实际计数，为后续是否增加 `maxNetworkRequests` 提供基线。
- [x] 后端相关专项测试和全量测试通过；如涉及前端代码，相关前端测试、类型检查和生产构建通过。
- [x] 登录后的 SEO 检测页面能正确展示正常报告、WAF错误、429提示和真实入口，不把 GoodieAI 被拦截显示为目标站点 SEO 扣分。
- [x] 验收记录明确本期仍未执行 GoodieAI robots 授权、跨实例共享熔断和总请求硬上限，不宣称已经完整实现礼貌爬虫合规。
- [x] 正式验收全过程不对 Hikvision 或其他未授权第三方站点执行全站、高频或压力测试。

## Blocked by

- [002 建立可信响应与风控止损闭环](002-trusted-response-crawl-stop.md)
- [003 按 Resolved URL 合并页面并修复真实入口](003-resolved-url-identity.md)

## Verification

- 正式调用链：`POST /api/seo-audits` → `createPageAuditRuntime()`；`POST /api/seo-audits/site` → `SeoAuditJobService` → `createSiteAuditRuntime()`。两个运行时均显式创建任务级 `SeoSiteClient`，并同时启用分类、评分闸门、逐跳策略和预检，不存在生产 fallback。
- 入口级离线证据：
  - 单页 WAF、429 都只产生 1 次入口请求并返回对应类型化错误。
  - 全站 robots WAF 的请求序列严格为 `/`、`/robots.txt`，之后请求数为 0。
  - 正常 `/cn → /cn/` 基线为 5 次 Axios 请求：页面 3、robots 1、Sitemap 1、链接探活 0；另有 1 个重定向跳和 2 次逻辑渲染尝试，完成原因为 `completed`。
- 异步失败任务刷新验证：任务详情继续返回安全错误码、`stopReason` 和固定结构请求诊断；响应正文和额外诊断字段未写入。
- 后端 SEO 专项：`node --test tests/Seo*.test.js`，156 项通过，0 项失败。
- 本提交临时干净 worktree 后端全量回归：`npm test`，902 项通过，0 项失败。
- 共享工作区全量回归共 904 项，其中 901 项通过；额外 3 项失败来自本需求范围外、尚未提交的 AI 语义分析思考模式改动，不存在于本次提交。
- 前端：`npm run lint` 通过；`npm run build` 通过，TypeScript 检查通过，`/geo/seo-audit` 成功生成。
- 登录页面：在现有已登录正式页面只读确认正常全站报告、真实目标 URL、任务失败页数和技术健康分展示；同步错误与异步错误继续由同一页面的 `message.error` / `job.error.message` 路径展示，WAF/429 不会生成报告对象或进入扣分面板。
- 代码搜索：生产中仅 `SeoAuditRuntimeService` 创建单页/全站服务；全站顶层 `finalUrl` 已使用 `entryFinalUrl`；保留 `validateStatus: () => true` 作为证据采集行为，但所有正式分析入口均受分类闸门保护。
- 边界声明：本期未实现 GoodieAI robots 授权执行、跨实例共享限速/熔断或 `maxNetworkRequests` 总请求硬上限，因此不宣称完整礼貌爬虫合规。
- 全程未向 Hikvision 或其他未授权第三方站点发起全站、高频或压力测试。
