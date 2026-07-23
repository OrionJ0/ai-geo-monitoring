# 接口文档

> 统一前缀：`/api`
> **重要**：除了健康检查、验证码、公共 SEO 设置和公共通知接口外，其他业务接口都需要身份验证。

## 认证说明

> ⚠️ **除明确标注为公开的接口外，所有接口都需要在请求头中携带有效的 JWT Token**

### 请求头格式
```
Authorization: Bearer <token>
```

### 认证相关响应
- `401 Unauthorized` - 未提供 token 或 token 无效
- `403 Forbidden` - 无权限访问该资源（如访问他人数据）
- `429 Too Many Requests` - 超过速率限制

### 速率限制
- **通用 API**：500 次/15 分钟
- **定时任务 API**：1000 次/15 分钟
- **登录接口**：5 次/15 分钟

## 健康检查
- `GET /api/health`

## 验证码（公开接口，无需认证）
- `GET /api/captcha/new` 获取文本验证码（题目与有效期）
- `GET /api/captcha/image` 获取图形验证码（SVG 与有效期）

## 用户
- `POST /api/users/register` 注册（公开）
  - 参数：`username`、`email`、`password`、`captcha_id`、`captcha_answer`
- `POST /api/users/login` 登录（公开，有速率限制）
  - 返回：`token` 与用户信息
- `GET /api/users/profile/:userId` 获取用户信息（需登录）
  - **权限验证**：只能查看自己的信息，管理员可查看所有
- `PUT /api/users/profile/:userId` 更新用户邮箱（需登录）
  - **权限验证**：只能修改自己的信息，管理员可修改所有
- `GET /api/users/quota/:userId` 获取会员等级与配额摘要（需登录）
  - **权限验证**：只能查看自己的配额
- 管理员接口（需管理员权限）：
  - `GET /api/users` 用户列表（分页与搜索）
  - `POST /api/users` 创建用户
  - `PUT /api/users/:id` 更新用户状态/角色/会员
  - `DELETE /api/users/:id` 删除用户
  - `PUT /api/users/:id/password` 重置用户密码

## AI 检测（需认证）
- `GET /api/detection/brands` 获取品牌列表
- `POST /api/detection/create` 创建检测任务
  - 参数：`question` 必填；`platforms`、`brand`、`brand_keywords`/`highlightKeywords` 可选
- `GET /api/detection/status/:recordId` 获取任务状态与结果摘要
- `GET /api/detection/stream` 流式获取AI结果（SSE）
  - 参数：`platform`、`question`、`brand`、`brand_keywords`
  - SSE 可通过查询参数 `token` 传递 JWT
- `GET /api/detection/history` 获取所有用户检测历史（管理员）
  - 参数：`page`、`limit`、`user_id`、`platform`、`status`、`q`、`brand`
- `GET /api/detection/history/:userId` 获取检测历史
  - 参数：`page`、`limit`、`platform`、`status`、`q`、`brand`
  - **权限验证**：只能查看自己的历史，管理员可查看所有
- `DELETE /api/detection/record/:id` 删除单条历史记录
  - **权限验证**：只能删除自己的记录，管理员可删除所有
- `DELETE /api/detection/history/:userId` 批量删除历史记录
  - **权限验证**：只能删除自己的记录，管理员可删除所有

## 问题库与问题集（需认证）

- `GET /api/geo-projects/:projectId/prompts` 查询项目问题列表及近期表现
- `POST /api/geo-projects/:projectId/prompts` 新建单问题
  - 请求体：`question` 必填；`question_set_id`、`tags`、`platforms`、`enabled` 可选
- `PUT /api/geo-projects/:projectId/prompts/:promptId` 编辑单问题
- `DELETE /api/geo-projects/:projectId/prompts/:promptId` 删除单问题
- `POST /api/geo-projects/:projectId/prompts/:promptId/run` 独立运行一个启用问题
- `GET /api/geo-projects/:projectId/question-sets` 查询问题集及成员问题
- `POST /api/geo-projects/:projectId/question-sets` 新建问题集
  - 请求体：`name` 必填；`description`、`question_ids` 可选
- `PATCH /api/geo-projects/:projectId/question-sets/:questionSetId` 编辑问题集名称、说明或成员
- `DELETE /api/geo-projects/:projectId/question-sets/:questionSetId` 删除问题集；成员问题仅解除归属，不会被删除
- `POST /api/geo-projects/:projectId/question-sets/:questionSetId/run` 将问题集内所有启用问题按可用监测平台加入并发队列
  - 返回 `202 Accepted` 与队列记录；每个成员问题仍可通过单问题接口独立运行

## SEO 检测（需认证）

- `POST /api/seo-audits` 检测一个公开 HTML 页面
  - 请求体：`url` 必填，可省略 `http://` 或 `https://`
  - 返回：新保存的 `auditId`、最终 URL、状态码、响应时间、0–100 基础分、问题统计、优先修复项、六类检查结果与搜索/分享预览
  - 检查项：每项包含 `title`（检查对象）、`finding`（具体发现）、`status`、`severity`、`value`（检测事实）、`description`（影响）和 `recommendation`（建议）
  - 内容有效性：`robots.txt` 和 Sitemap 必须含有效内容；Title、Meta Description、Canonical、H1、JSON-LD、Open Graph 与图片 Alt 不会因空标签而通过；`robots.txt` 中声明的自定义 Sitemap 会被实际抓取并校验
  - 爬虫权限：响应的 `crawlerAccess` 按当前页面路径分别展示 Google、Bing、百度和重要 AI 爬虫在 `robots.txt` 中的允许、禁止或无法判断状态；搜索与 AI 搜索爬虫纳入评分，用户触发访问及 AI 训练/数据使用策略不计分
  - 判定边界：`robots.txt` 返回普通 4xx 或内容为空表示“未声明抓取限制”，但独立的 `robots-txt` 有效性检查仍会报缺失/空内容；429、5xx、网络失败或非空但无法解析的文件返回“无法判断”。允许状态不能证明真实 UA 已成功访问、收录或引用
  - 搜索平台标签：固定从站点首页分别检查 Google、Bing、百度 HTML 验证 Meta 标签，但不能据此断言平台后台当前已验证，也不识别 DNS 或验证文件方式
  - 评分配置：响应包含 `scoreVersion` 和 `summary.totalWeight`；规则权重、严重程度、主要阈值和 `crawlerProfiles` 集中在 `backend/config/seoAuditRules.js`，Keywords 默认权重为 1，爬虫权限默认权重为 7
  - 保存规则：检测成功后完整报告写入当前用户的 SQLite 历史记录；保存失败时本次请求不返回成功
  - 安全边界：拒绝带用户名/密码的网址、本机和私网 IP、解析到私网的域名，以及重定向到私网的目标；最多跟随 5 次重定向，超时 10 秒，页面响应体上限 2 MB
- `POST /api/seo-audits/site` 创建全站异步检测任务
  - 请求体：`url` 必填；以该 URL 为入口，只发现同源 HTTP/HTTPS 页面
  - 返回：`202 Accepted`，`data.id` 为任务编号，初始 `status` 为 `queued`，`progress.phase` 为 `queued`
  - 发现来源：提交 URL、页面内链、根目录 `/sitemap.xml`、robots 声明的 Sitemap；支持 Sitemap index、URL 去重和片段移除
  - 抓取限制：默认上限 200 页、并发 3、最多读取 20 个 Sitemap、递归深度 3；达到上限时任务仍完成，但报告 `site.truncated` 为 `true`
  - 容错：单页失败写入逐页账本并继续；所有入口均失败时任务标记 `failed`，且不写入伪成功历史
- `GET /api/seo-audits/jobs/:jobId` 查询当前用户的全站任务
  - 运行中返回 `status` 与 `progress`（发现、检测和失败页数）
  - 完成后返回 `auditId` 与完整 `report`；失败时返回安全的 `error.code`、`error.message`
  - 权限验证：只能读取当前用户自己的任务；任务不存在或不属于当前用户时统一返回 404
- `GET /api/seo-audits` 分页获取当前用户的检测历史摘要
  - Query 参数：`page` 默认 1；`pageSize` 默认 10，最大 50
  - 返回：`items` 与 `pagination`；`summary.mode` 区分 `site` / `page`，`summary.pages` 为检测页数，摘要不包含完整报告正文
- `GET /api/seo-audits/:id` 获取一条完整历史报告
  - 权限验证：只能读取当前用户自己的记录；记录不存在或不属于当前用户时统一返回 404

请求示例：

```json
{
  "url": "https://example.com/"
}
```

成功响应摘要：

```json
{
  "success": true,
  "data": {
    "auditId": 42,
    "finalUrl": "https://example.com/",
    "statusCode": 200,
    "score": 82,
    "summary": {
      "total": 21,
      "passed": 17,
      "issues": 4,
      "critical": 0,
      "high": 1,
      "medium": 2,
      "low": 1
    },
    "priorities": [],
    "categories": []
  }
}
```

历史列表响应摘要：

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 42,
        "finalUrl": "https://example.com/",
        "score": 82,
        "grade": "good",
        "summary": { "issues": 4 },
        "checkedAt": "2026-07-23T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 10,
      "totalItems": 1,
      "totalPages": 1
    }
  }
}
```

常见业务错误码：

- `INVALID_URL`：网址格式不正确
- `UNSUPPORTED_PROTOCOL`：不是 HTTP/HTTPS 地址
- `URL_CREDENTIALS_NOT_ALLOWED`：网址包含用户名或密码
- `PRIVATE_NETWORK_URL`：目标或重定向地址属于本机/私网
- `DNS_LOOKUP_FAILED`：域名无法解析
- `UPSTREAM_TIMEOUT`：目标网站响应超时
- `UPSTREAM_UNAVAILABLE`：无法连接目标网站
- `PAGE_TOO_LARGE`：页面内容超过限制
- `UNSUPPORTED_CONTENT_TYPE`：目标不是 HTML 页面

## 定时任务（需认证）
- `POST /api/schedules` 创建每日定时任务
  - 参数：`question`、`platforms`、`daily_time`、`timezone`、`brand`、`brand_keywords`
- `GET /api/schedules` 列出当前用户定时任务
- `PUT /api/schedules/:id` 更新定时任务
  - **权限验证**：只能操作自己的任务
- `DELETE /api/schedules/:id` 删除定时任务
  - **权限验证**：只能删除自己的任务
- `POST /api/schedules/:id/run` 立即执行一次
  - **权限验证**：只能执行自己的任务

## 平台自检（需认证）
- `GET /api/platforms/ping` 检查各平台 API Key 配置状态

## 会员方案（需管理员权限）
- `GET /api/membership/plans` 获取全部会员方案
- `PUT /api/membership/plans/:level` 更新指定会员方案
- `POST /api/membership/plans/resetAll` 批量重置为默认值
- `POST /api/membership/plans/:level/reset` 重置指定等级为默认值

## 设置
- 管理员接口（需管理员权限）：
  - `GET /api/settings` 获取允许的系统设置项
  - `PUT /api/settings` 更新设置
- 公开接口（无需认证）：
  - `GET /api/settings/seo` 获取公共 SEO 设置
  - `GET /api/settings/notice` 获取系统通知

## 统计（需认证）
- 管理员接口（需管理员权限）：
  - `GET /api/statistics/overview` 管理员概览统计
- 用户接口（需认证）：
  - `GET /api/statistics/user/:userId` 用户维度统计
    - **权限验证**：只能查看自己的统计
  - `GET /api/statistics/keywords/:userId` 品牌关键词统计
    - **权限验证**：只能查看自己的统计
  - `GET /api/statistics/platform-comparison/:userId` 平台对比统计
    - **权限验证**：只能查看自己的统计
  - `GET /api/statistics/trends/:userId` 趋势分析
    - 参数：`days` 可选，默认 30
    - **权限验证**：只能查看自己的统计

## 响应状态码
- `200 OK` - 请求成功
- `400 Bad Request` - 请求参数错误
- `401 Unauthorized` - 未认证或 token 无效
- `403 Forbidden` - 无权限访问该资源
- `404 Not Found` - 资源不存在
- `429 Too Many Requests` - 超过速率限制
- `500 Internal Server Error` - 服务器内部错误

## 响应格式
成功响应：
```json
{
  "success": true,
  "data": { ... },
  "message": "操作成功"
}
```

错误响应：
```json
{
  "success": false,
  "message": "错误描述"
}
```
