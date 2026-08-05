---
title: "抽取唯一安全 HTTP 内核与 OAuth 客户端"
status: open
type: AFK
blocked_by:
  - "001-freeze-provider-equivalence-contract.md"
---

# 抽取唯一安全 HTTP 内核与 OAuth 客户端

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-1：OAuth、搜索推广和百度统计拥有明确产品边界。
- US-2：所有百度调用继续共用一套安全网络控制。
- US-3：现役消费者不感知内部拆分。

## What to build

让现有 facade 通过一个共享安全 HTTP 内核完成全部百度网络请求，并把授权 URL、回调签名、授权码交换、Token 刷新和账户目录完整迁入 OAuth 客户端。搜索推广与百度统计在本切片结束时也必须经过同一内核，但仍可暂留各自产品逻辑，且中间状态不得发布。

## Acceptance criteria

- [ ] facade 只构造一个 HTTP 内核，所有百度产品请求都经过该实例。
- [ ] 内核统一执行 HTTPS/allowlist、timeout、响应体预算、JSON 解析、取消和稳定网络错误，不包含产品字段或分页规则。
- [ ] OAuth 与账户目录从 facade 调用到上游、规范化输出和错误的黑盒合同与 Issue 001 完全一致。
- [ ] Secret Key 只进入 OAuth 客户端，不传递给搜索推广或百度统计客户端。
- [ ] 旧路径导出的错误 class 和精确值 helper identity 保持不变。
- [ ] 仓库只有一个 transport、allowlist 和共享网络错误实现，不存在可关闭安全控制的选项。

## Blocked by

- [Issue 001：冻结百度 Provider 黑盒等价合同](001-freeze-provider-equivalence-contract.md)。
