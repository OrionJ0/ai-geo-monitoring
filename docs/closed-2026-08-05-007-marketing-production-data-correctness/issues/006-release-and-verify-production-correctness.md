---
title: "发布并验收营销生产数据正确性"
status: closed
type: HITL
blocked_by:
  - "002-deliver-ad-performance-period-comparison.md"
  - "003-deliver-keyword-period-comparison.md"
  - "004-deliver-tongji-source-partition.md"
  - "005-disambiguate-tongji-page-path-collisions.md"
---

# 发布并验收营销生产数据正确性

## Parent

- [PRD](../prd.md)
- [Tech Spec](../TECH-SPEC.md)

## User stories covered

- US-1：广告和关键词真实双周期在生产可用。
- US-2：来源覆盖状态在生产诚实可见。
- US-3：同路径入口页记录在生产可区分。
- US-4：本地回归证据与生产响应形状一致。
- US-5：正式入口逐页验收后才关闭需求并解除 005 门禁。

## What to build

完成 007 的发布、生产观察和关闭证据。先运行聚焦合同、前端、浏览器和敏感信息回归，再通过正式 Git Bundle 工作流发布；从唯一支持域名使用真实 Chrome 逐页检查市场总览、广告表现、关键词、搜索词、网站流量和入口页，并把页面显示与 Network 响应逐项对账。

验收同时确认官网、53KF、销售线索、成交订单和营销 AI 的真实模块状态没有被补零或误报接入。只有目标 revision、双周期、来源分区、同路径消歧、隐私扫描和遗留 P0/P1 全部通过后，才能关闭 007 并解除 005 Issue 001 的门禁。

## Acceptance criteria

- [x] Issue 002–005 全部通过各自自动化验收，聚焦与相关全量回归无阻断失败。
- [x] fixture、代码、日志和 Git diff 的秘密及个人信息扫描为零，人工复核确认没有生产 Token、原始报文或真实敏感业务明细。
- [x] 正式 backend/frontend revision 与目标 Git Bundle 一致，公开健康与 `/api/ready` 通过，部署未启动第二套服务。
- [x] 广告表现和关键词页面的 Network 均存在 current/previous 请求，两个周期日期等长相邻并使用同一 revision、currency 和 cost scale。
- [x] 可用上期显示真实比较；上期不可用显示不可用；精确零、null 和错误没有互相冒充。
- [x] 网站流量页面显示生产来源分区状态，总访问、已分类访问和 residual 与接口精确一致，residual 未变成业务来源。
- [x] 入口页相同规范化路径记录具有稳定消歧标签，刷新、排序、分页和响应式场景不产生身份漂移或指标合并。
- [x] 市场总览十进制字符串修复和搜索词现役周期比较继续通过真实浏览器回归。
- [x] 官网、53KF、销售线索、成交订单和营销 AI 按真实连接状态展示，未接入数据不补零、不计算 CPA/成交率、不宣称已接入。
- [x] 生产观察期内本需求 P0/P1 为零；若出现阻断回归，只使用后代 revert revision 经正式流程恢复，不重新启用旧 Dashboard 或隐藏 fallback。
- [x] 验收证据记录目标 revision、请求路径、filter、状态码、关键对账值和页面结果；fixture 或本地测试没有被当成生产证据。
- [x] 007 目录关闭后，005 Issue 001 才可开始，并以 007 修正后的行为冻结 Provider 等价合同。

## Blocked by

- [Issue 002：交付广告表现真实双周期比较](002-deliver-ad-performance-period-comparison.md)。
- [Issue 003：交付关键词真实双周期比较](003-deliver-keyword-period-comparison.md)。
- [Issue 004：交付百度统计来源分区完整性](004-deliver-tongji-source-partition.md)。
- [Issue 005：交付百度统计同路径页面消歧](005-disambiguate-tongji-page-path-collisions.md)。

## 发布前证据（2026-08-06）

- 后端：营销测试 `231/231`，全后端测试 `994/994`。
- 前端：单元/合同测试 `123/123`，ESLint、TypeScript 和 40 路由生产构建通过。
- 真实 Chrome：营销全套 `56/56`；覆盖广告/关键词双周期、对象级上期身份缺失、来源 `COMPLETE/PARTIAL/INVALID`、全站逐日访问缺失、同路径消歧、响应式和键盘/无障碍树。
- 对抗式复审：代码、现实证据、最小变更、API 和无障碍专项均为 P0/P1 零；保留一个不阻断发布的 P2——关键词翻页会重复读取不变的上期汇总，未在正确性需求中扩大修改范围。
- 隐私：最终 diff 未包含生产 Token、Cookie、`.env`、数据库、原始百度响应或个人信息；命中的 `access-token-fixture` 是既有测试使用的显式合成占位值。
- 发布前生产 revision 为 `d9b0688e28ba9b3a33fcfb061fe7d7235388ec22`；以下发布后证据取代该历史基线。

## 正式发布与运行证据（2026-08-06）

- 正式 Git Bundle 将服务器 `main` 从 `d9b0688e28ba9b3a33fcfb061fe7d7235388ec22` 快进到 `17214184f9c0ec2c9508080cb571f6b8b45923c4`，Bundle SHA-256 为 `37ccf67d5aff553c9030dc23a2e72d26ea1a6c2e2c436b0209eb5c6b37366ef7`；远端 `refs/heads/feature/marketing-003-006-007-005` 精确指向该 revision，正式源码没有只留在服务器。部署树不含并行 0805-002 工作。部署器创建 `database.pre-17214184f9c0ec2c9508080cb571f6b8b45923c4.sqlite`，完成验证后删除上传 Bundle。
- 部署入口通过后端 `994/994`、营销 `231/231`、官网 `31/31`、咨询 `35/35`、前端 `123/123`、ESLint、TypeScript、40 路由生产构建和单 worker Chrome `56/56`。营销迁移 `001`–`016` 已应用且 `pending=[]`。
- 服务器 `HEAD` 为目标 revision、分支为 `main`、工作区干净；公开 `/api/health` 和 `/api/frontend-health` 都返回完整目标 revision，`/api/ready` 为 `ready`。前后端仅由两个正式 systemd 单元各一个 MainPID 运行，发布后 warning 日志为空。

## 正式入口与 Network 对账（2026-08-06）

- `/usr/bin/google-chrome` 从 `https://insight.guangtuo.com` 打开市场总览、广告表现、关键词、全量搜索词、网站流量和营销 AI 状态页，六个正式页面均命中目标路由并显示现役页面合同。浏览器使用只存在于服务器进程和浏览器内存的 15 分钟应用会话；JWT 未输出、未落盘、未复制到本地，也未读取或复制 Cookie。用户提供的 SSH 密码不适用于应用 `admin`，一次正常密码登录失败后未重试、未重置账号；因此本证据验证的是已认证营销入口，不把密码登录流程描述为已验收。
- 广告层级、关键词和搜索词均各有两次真实 200 响应：本期 `2026-07-30` 至 `2026-08-05`，上期 `2026-07-23` 至 `2026-07-29`。三组周期都等长相邻，并分别使用同一快照 revision、`CNY` 和 `costScale=2`；本期/上期 summary 来自对应资源，不是当前页累加或补零。
- 网站流量当前范围返回 `PARTIAL / SOURCE_TOTAL_UNAVAILABLE`，全站访问和 residual 都为 `null`、已分类访问为精确字符串；页面明确提示总量暂不可用且差额不代表业务来源。生产当次没有可靠分母，因而没有为了复现历史 `83/82` 强行拼出 `1`；`83/82 → PARTIAL` 由脱敏合同和真实 Chrome 回归覆盖。
- 入口页默认响应为 `10/44` 行；首屏可见同一 24 行碰撞组的 `7/24`、`16/24`。正式 Chrome 刷新后 ordinal 不变；切换“贡献浏览量”升序取得 200 资源响应并显示同组其他稳定 ordinal；分页到第 2 页显示 `1/24` 至 `11/24` 中对应事实；切到 `390×844` 后入口页滚动区仍可见且首屏标签仍为 `7/24`、`16/24`。本地 `56/56` 回归另覆盖 400% 缩放与完整排序组合，生产操作没有发现身份漂移或指标合并。
- 浏览器观测到的营销响应共 13 个，均成功。唯一 503 来自既有 `DISABLED` 的官网区间与逐日接口；咨询页明确显示官网模块不可用、53KF 尚未完成，订单页明确显示销售系统未接入，市场总览的线索和成交依赖指标保持 `—`。营销 AI 正式页明确“尚未在生产环境启用”且不会读取来源数据，没有误报完整漏斗或真实 AI 报告。

## 正式路径与退役边界

- 当前正式默认仍是 006 R2 的轻量 Dashboard + revision 钉扎的 `ad-hierarchy`、`keywords`、`search-terms`，007 在这些资源上读取真实双周期；网站流量继续使用 `website-traffic-overview` 与 `website-traffic-pages`，新增分区和消歧元数据已是默认响应。
- 旧 Dashboard 四数组、旧 adapter、兼容查询和 fallback 已在 006 R2 删除，本次未恢复；007 没有增加第二套 API、feature flag 或旧正确性路径。005 现在可以把本需求修正后的行为冻结为等价基线。
