---
title: "补齐网页版账号设置与平台默认值"
status: closed
type: AFK
blocked_by:
  - "002-managed-web-registry-and-isolated-runtime.md"
  - "003-doubao-login-preflight-and-runtime-status.md"
---

# 补齐网页版账号设置与平台默认值

## Parent

- PRD：`../prd.md`
- Tech Spec：`../TECH-SPEC.md`
- 覆盖用户故事：US-001、US-006、US-008

## What to build

修正设置页只识别 `deepseek_web`、把 `doubao_web` 误画成 API 平台的缺口。DeepSeek 网页版和豆包网页版都必须显示为受管真实网页，不展示 API 请求参数、API 编辑、密钥或连接测试操作。

管理员应能在 `/admin/settings` 查看每个网页版平台的浏览器配置、专用 Profile 初始化和本次进程登录验证状态；可以从页面打开专用 Chrome，人工登录或切换账号，并在完成后主动验证。系统不得收集账号密码、Cookie、Authorization 或账号身份信息。

平台预置默认值同步调整：千问 Responses 请求默认强制搜索，DeepSeek API 新预置默认关闭。默认值不能覆盖管理员后续明确保存的自定义配置。

## Acceptance criteria

- [x] 设置页把 `doubao_web` 和 `deepseek_web` 都显示为“真实网页 · 专用 Chrome”。
- [x] 两个网页版平台均不显示 API 请求参数、API 编辑、密钥、模型目录或 API 测试操作。
- [x] 管理员可以查看浏览器是否可用、Profile 是否已初始化、网页登录是否已验证及最近验证时间。
- [x] 管理员可以从设置页打开对应专用 Chrome，完成人工登录或切换账号后主动验证。
- [x] 登录与切换期间对应 Web 平台拒绝新采集，另一个 Web 平台不受影响。
- [x] 未登录、需要人工验证、页面结构变化和浏览器不可用在设置页显示不同状态。
- [x] 接口和页面不读取或返回账号密码、Cookie、Authorization、Profile 路径或账号身份。
- [x] 千问新预置默认包含 `search_options.forced_search = true`，正式 Responses 请求仍由请求层添加 `web_search` 工具。
- [x] DeepSeek API 新预置默认关闭；DeepSeek 网页版与 DeepSeek API 仍为独立平台。
- [x] 从设置页和正式调用入口验证豆包网页版不进入豆包 API Adapter。

## Blocked by

- `002-managed-web-registry-and-isolated-runtime.md`
- `003-doubao-login-preflight-and-runtime-status.md`
