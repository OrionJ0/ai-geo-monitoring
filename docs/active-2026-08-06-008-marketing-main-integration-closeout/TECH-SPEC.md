# 营销主分支集成与治理收尾 Tech Spec

## 1. Git 集成

集成分支固定为 `integration/marketing-main-sync`，worktree 固定为
`/private/tmp/ai-geo-marketing-main-sync`。以创建时本地 `main`
`f2aa0785ff2fdb566f331873f3e3cd3ddd76292d` 为父提交，逐个重放营销主父链。

旧 merge `e8de9d56619a69b5de98f8bee5e9bc5d42d69e41` 包含对当时 Flash
工作的大量删除，因此不重放该 merge；其 A1 营销功能已由同等的主父链提交交付。
`58469e29214ccc28e989f07d54af873d9c0ba801` 夹带其他工作线文档，仅重放 A2
运行代码、测试和设置页。共享 Dashboard 刷新服务手工合并为：

- 默认窗口已有旧 revision 时继续后台刷新并立即返回旧快照；
- 首载或日期筛选继续同步刷新，以保证筛选与 revision 一致；
- 失败冷却内不重复刷新，筛选错误保持原错误语义。

## 2. OpenAPI 实际响应校验

继续使用
`backend/modules/marketing/contracts/goodieai-marketing-ad-read.openapi.json`
作为唯一机器合同。测试从实际 Express 路由取得四个成功响应及代表性
`401/409/422/503` 错误响应，解析对应 operation 的 response schema，并执行
OpenAPI 3.1/JSON Schema 2020-12 校验。优先复用现有依赖；如现有栈不能正确校验
2020-12，再引入最小后端开发依赖并锁定版本。

校验必须覆盖 required、类型、enum、nullable、数组 item、嵌套对象和
`additionalProperties`，不能退化为手写字段存在性断言。

## 3. 关键词上期汇总缓存

上期汇总的身份由项目、Dashboard revision、上期日期范围和业务筛选组成，不包含
`page/pageSize` 和排序。hook 在身份未变化时复用进行中或已完成请求；项目、revision、
日期或业务筛选变化时失效。失败结果只保留到同一身份的显式刷新，显式刷新会强制
重试；请求 generation 仍是唯一页面状态写入门禁，迟到响应不得覆盖新状态。
进行中的上期请求只保留 `previousKey` 与 `AbortController`，不存在第二套 scope 真值；
已有 Dashboard coverage 只用于提前计算同一个 `previousKey`，最终响应仍负责权威校验。

## 4. 公开错误与 SQLite 精确排序边界

四个读取入口和刷新入口只允许公开版本化错误合同中的状态码、固定文案和必要的
`Retry-After`；未知 SQL、驱动或上游错误统一脱敏。OpenAPI 的成功与典型错误示例
必须来自同一公开错误合同。

SQLite 的 CTR/CPC 精确排序固定为最多 2,000 个事实身份、5,000 行日事实，超出返回
`MARKETING_AD_RESOURCE_SORT_SCOPE_TOO_LARGE`。有界路径只查询 identity、展示字段和三个
精确指标字段，在一次 Node `Map`/`BigInt` 遍历中同时生成排序项与完整筛选范围 summary。
边界性能测试排除造数，预热后分别采样三次并以 750ms P95 阻止秒级回归。

## 5. 百度报告端点唯一真值

`backend/modules/marketing/contracts/baidu/` manifest 继续声明允许的报告端点。
`BaiduSearchAdsClient` 只引用 manifest/安全内核暴露的端点标识，不再写第二个 URL
字面量。共享 HTTP 内核仍负责最终 allowlist 校验，客户端不得获得放宽安全策略的入口。

## 6. 发布与 main 对齐

发布前重新获取并比较本地 `main`、`origin/main`、服务器 `HEAD`、公开 revision
和 0805-002 状态。若 `main` 前进，先把候选重放到新 `main` 并重跑受影响验证。
正式发布使用 Git Bundle、systemd 和项目部署入口。生产通过后将本地 `main` 与
`origin/main` 快进到同一已发布提交；禁止强推、非快进回退和服务器源码直改。

`competitor_snapshot` 的 Stage1 数据库前置迁移已经独立发布并通过 audit、SQLite
`quick_check`、旧 v4 应用和 `/api/ready` 验证。Stage2 统一候选在正式 Git Bundle 前仍须
重新核对生产锁、服务器/远端/公开 revision 和全部 migration audit，并在最终发布 SHA
上完成测试、构建和真实 Chrome。停服后的正式流程负责安全迁移 builtin DeepSeek
Pro→Flash 并执行四入口 v5 acceptance；自定义或未知 DeepSeek 身份必须 fail-closed。
