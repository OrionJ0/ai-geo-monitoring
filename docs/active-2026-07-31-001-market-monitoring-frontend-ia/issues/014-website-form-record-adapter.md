---
title: "官网表单记录级真实只读接入"
status: closed
type: AFK
blocked_by:
  - "013-page-data-interface-inventory.md"
---

# 官网表单记录级真实只读接入

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)
- [数据接入矩阵](../data-integration-matrix.md)

## What to build

以失败测试起步，把官网现有 `GET /api/v1/admin/contact/list` 和 `GET /api/v1/admin/contact/:id` 接入 `WebsiteFormRecordAdapter`。GoodieAI 必须严格解析上游分页和记录字段，只执行只读请求，在服务端完成脱敏，保留项目所有权与详情审计门禁，不保存或输出原始联系人、IP、JWT、密码和完整上游响应。

## Acceptance criteria

- [x] 上游列表、详情、分页、日期、重认证、超时、异常状态和畸形响应有失败测试与严格合同测试。
- [x] 正式模块配置可用时官网来源为 `AVAILABLE/FULL`，禁用或配置无效时保持 `AGGREGATE_ONLY/NONE`。
- [x] 列表和详情只返回 `consultation_records_v1` 允许字段；姓名、电话、邮箱脱敏，IP 永不返回。
- [x] GoodieAI 项目所有权在任何上游调用前校验，详情审计写入失败时 fail closed。
- [x] 本地使用独立凭据完成真实只读调用与页面对账；上游尚无可验证的只读角色合同，作为生产凭据配置前的外部权限风险保留。
- [x] production build 的真实页面网络证据证明命中 `/api/consultations`，不启用 fixture。

## Closure evidence

- 2026-08-04：真实只读区间返回 3 条记录；列表字段全部掩码，详情合同通过禁止原始联系人/IP 检查。
- 浏览器页面请求 `/api/consultations/projects/6/records`，官网来源可用，53KF 独立为 `NOT_CONNECTED`，整体覆盖为 `PARTIAL`。
- `backend/tests/websiteFormConsultations/` 与 `backend/tests/consultationRecords/` 覆盖响应解析、鉴权、所有权、审计、迁移、异常与来源隔离。
