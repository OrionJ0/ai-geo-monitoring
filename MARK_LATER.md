# Mark Later

现行数据源决策和接入红线见 `docs/adr/0001-marketing-funnel-data-source-of-truth.md`。

## 可推进

### P1

- [ ] 2026-08-03：对齐官网生产聚合接口与源码合同
  - 背景：`product_gato_website_full_stack` 本地 `main`/`origin/main` 在核验时为 `c4cd5dc`，缺少线上已经返回的 `conversion` 和来源归因结构；直接依赖线上响应会留下下一次旧版本部署退役接口的风险。
  - 来源：
    - `docs/adr/0001-marketing-funnel-data-source-of-truth.md`
    - `/Users/gato/Developer/product_gato_website_full_stack`
  - 下一步：定位官网当前生产部署对应的实际源码和数据库 schema，逐项对齐路由、字段、迁移与测试，并把稳定聚合合同纳入版本管理。
  - 验收标准：
    1. 生产实际源码、schema 和迁移可追溯；
    2. 聚合响应有脱敏合同测试；
    3. 从正式部署入口证明旧仓库部署不会退役该合同。

### P2

目前没有事项。

### P3

目前没有事项。

## 等待中

- [ ] 2026-08-03：官网表单接入改用最小权限身份并完成生产验收
  - 来源：
    - `docs/adr/0001-marketing-funnel-data-source-of-truth.md`
    - `docs/blocked-2026-07-31-001-market-monitoring-frontend-ia/issues/016-real-data-release-acceptance.md`
  - 已完成前置：本地已实现独立官网聚合适配器、JWT 服务端缓存、响应校验、区间与最多 31 日逐日聚合、缓存回退、独立 API/迁移账本和首页展示；常规读取不包含联系人明细，2026-08-01 至 2026-08-04 的逐日合计已与同区间汇总完成真实只读对账。
  - 等待：官网生产源码/schema/迁移/测试与线上聚合合同完成对齐，并取得最小权限只读服务账号或专用 API 密钥。
  - 恢复后：配置生产密钥、执行独立官网迁移、部署，并从正式域名验收模块状态、区间与逐日真实接口和首页来源展示。

- [ ] 2026-08-03：接入 53KF 有效对话
  - 来源：
    - `docs/adr/0001-marketing-funnel-data-source-of-truth.md`
  - 等待：确认当前 53KF 账户的开放 API 权限、字段、限流、历史覆盖和去重合同。
  - 恢复后：只读验证来源和实际访客消息字段，仅把访客真实发送过消息的对话计为在线客服咨询。

## 以后再说

- [ ] 2026-08-03：完成客服咨询到成交订单的来源全链路
  - 背景：官网表单、53KF、线索池和订单分别属于不同主数据源，不能用同期总量或比例伪造归因。
  - 来源：
    - `docs/adr/0001-marketing-funnel-data-source-of-truth.md`
    - `docs/blocked-2026-07-31-001-market-monitoring-frontend-ia/prd.md`
  - 后续步骤：
    1. 在官网表单本地接入基础上完成生产验收，并独立接入 53KF 有效对话；
    2. 确认表单与在线对话并列计数或跨渠道去重规则；
    3. 接入销售系统线索入池与成交订单数/金额；
    4. 建立来源覆盖门禁、部分覆盖状态和指标版本；
    5. 接入首页并从正式入口证明新链路生效、缺失数据未被伪造成零值。

## 已完成

- [x] 2026-08-04：完成两阶段 Git Bundle 正式发布
  - 完成时间：2026-08-05 11:01
  - 来源：
    - `docs/SINGLE_HOST_DEPLOYMENT.md`
    - `docs/DEPLOYMENT.md`
    - `docs/blocked-2026-07-31-001-market-monitoring-frontend-ia/issues/016-real-data-release-acceptance.md`
  - 结果：桥接提交已安装，正式 workflow `30876793311` 将业务 revision `f265bd3` 快进部署；后续 workflow `30900162256` 又通过同一 Git Bundle 正式链路发布 `6894789`。服务器源码未被直接编辑，systemd、迁移与公网健康均已恢复。
  - 验证：`/api/health` 与 `/api/frontend-health` 报告同一完整 revision，GitHub Actions 结论为 `success`；精确运行证据见 `docs/DEPLOYMENT.md#当前正式单机实例`。

- [x] 2026-08-03：实现 GoodieAI 官网表单聚合适配器与首页本地接入
  - 结果：新增独立 `backend/modules/websiteFormConsultations`、`/api/website-data`、官网数据迁移账本和前端 `src/lib/websiteData`；区间汇总和最多 31 日逐日接口只同步可归因成功提交会话，不读取联系人明细，不与百度或 53KF 数据混用。上游不能证明全部表单记录数时，记录总数、未归因数和归因率保持不可用。
  - 验证：后端完整 994/994、营销 131/131、官网数据 28/28、咨询记录 35/35、前端单元 72/72、部署专项 26/26、Playwright 23/23，lint 与 Next.js 38 路由 production build 通过；2026-08-01 至 2026-08-04 的官网逐日合计 3 与同区间汇总 3 一致。代码随后已通过正式 Git Bundle 链路进入生产 revision，但生产凭据尚未注入，模块继续保持 `DISABLED`，不得描述为官网数据已生产接通。

## 已取消

目前没有事项。
