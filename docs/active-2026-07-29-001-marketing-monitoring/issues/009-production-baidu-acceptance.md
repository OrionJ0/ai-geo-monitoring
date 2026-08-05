---
title: "完成真实百度搜索生产验收"
status: blocked
type: HITL
blocked_by:
  - "008-release-readiness.md"
---

# 完成真实百度搜索生产验收

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 覆盖：US-001～US-009

## Goal

在稳定公网 HTTPS callback、已审核百度应用和真实搜索推广账户中，从正式入口完成授权、账户级绑定、固定窗口刷新、数据核对、Refresh Token grant、安全扫描和人工无障碍验收。

## Scope

- 必须使用真实正式入口和真实百度 callback。
- 可以脱敏保存证据，不保存认证秘密或可识别客户信息。
- mock、直接改数据库或独立调用 service 不能替代本 issue。

## Acceptance Criteria

- [ ] callback 使用百度登记并与部署配置完全一致的稳定公网 HTTPS 地址。
- [ ] 应用只获批当前需要的搜索推广只读权限。
- [ ] 管理员从正式设置页创建同源 launch，完成百度授权并回到 queryless 结果页。
- [ ] 业务负责人确认试点用户的现有项目查看权限可以查看广告账户、计划和消费。
- [ ] 管理员从真实账户目录建立整个账户绑定，不存在计划子集。
- [ ] 市场负责人从正式导航先看到本地快照，再观察后台刷新。
- [ ] 项目全部绑定成功后整体更新；受控单账户失败时完整旧快照不变。
- [ ] 汇总、逐日合计和全部推广计划合计互相一致。
- [ ] 展现、点击、消费与百度后台在相同账户、日期、时区和统计时点下一致。
- [ ] 连续刷新不产生重复事实，归档后不能刷新。
- [ ] 实际执行一次 refresh grant，并按真实响应的缺失/相同/新 Refresh Token 行为正确保存。
- [ ] refresh grant 后仍能读取账户目录和搜索报表，晚到凭据不能覆盖。
- [ ] 数据库和验收产物只有必要密文/脱敏信息，无 Secret、Token、授权码或原始 state。
- [ ] 真实代理、APM、应用日志、浏览器历史和 Referer 扫描无秘密。
- [ ] 使用固定 VoiceOver/键盘脚本覆盖授权成功/失败、绑定、日期错误、自动/手动刷新、失败保留旧快照、需重授权、零数据、归档、逐日表格和外链；P0/P1 为零，P2 有登记。
- [ ] 页面和真实出站证据都不存在百度写操作。
- [ ] 百度故障期间 GEO/SEO 正式入口正常。
- [ ] “前往百度营销”的最终目标地址真实可达；深链不可用时明确使用通用入口及其账户切换提示。

## Verification

```bash
npm --prefix backend test
npm --prefix backend run test:marketing
npm --prefix nextjs-frontend test
npm --prefix nextjs-frontend run test:marketing:browser
npm --prefix nextjs-frontend run lint
npm --prefix nextjs-frontend run build
npm --prefix backend run audit:marketing
npm run deploy:check
git diff --check
```

人工证据包：

- 建立 AC→证据矩阵；每项记录 commit、环境、时间、操作者、第二复核人、脱敏 run/connection ID、产物路径和校验值，没有直接证据不得勾选。
- 部署版本、回调登记、权限和契约版本；
- 脱敏授权、绑定、刷新与 refresh grant 时间线；
- 同口径百度后台核对表；
- 受控失败后旧快照保留证据；
- 真实代理/APM/浏览器秘密扫描结果；
- 固定 VoiceOver/键盘步骤、预期名称/角色/播报/焦点和实际结果。

## Blocked by

- `008-release-readiness.md`
- 正式 HTTPS 域名、获批百度应用、真实账户和生产部署权限。

## 2026-07-30 阻塞记录

- 用户已说明有服务器和域名，但尚未提供该环境的部署方式、域名值或操作权限；本项目专用百度应用、实际 scope 与真实账户也尚未提供。
- 代码已提供只开放 OAuth/账户检查的 `PILOT_READY`，可以安全部署后采集真实证据；正式绑定、报表、调度和导航仍不会生效。
- mock、单元测试、浏览器 fixture 和本地数据库不得替代本 issue 的真实生产证据。
- 因此正式导航保持隐藏，模块默认关闭，Issue 009 不关闭。

## 2026-07-30 已完成的试点证据

- 公网 HTTPS callback、获批应用、动态 state 授权、Token 加密落库和真实账户目录已完成。
- 搜索报表和百度统计站点/趋势接口均从服务器发起只读请求并成功返回；本地只保存脱敏 fixture。
- 尚未从部署后的 `PILOT_DATA_READY` 页面完成账户绑定、快照与百度后台同口径核对，也未实际触发 Refresh Token grant 和代理/APM 秘密扫描，因此本 issue 仍为 blocked。
