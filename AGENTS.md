# 项目级 AI 工作约定

## 当前生产真值

- 当前唯一支持的正式访问入口是 `https://insight.guangtuo.com`。
- `insight.gato.com.cn` 是已退役的历史域名；除非是在带日期的历史验收记录中，不得把它写成当前入口。
- `http://182.254.140.163/` 命中 Nginx 默认站点，不是本应用。不得用直接访问服务器 IP 是否出现应用页面来判断服务是否部署成功；HTTPS 直连 IP 也不是受支持入口。
- 当前实例的环境、Nginx、证书、百度 callback 和验证口径以 `docs/DEPLOYMENT.md` 的“当前正式单机实例”一节为准。回答生产状态前应重新核对运行时，不得仅凭文档日期推断实时状态。
- 2026-07-31 域名切换只修改服务器基础设施配置和前端生产构建，没有更新服务器 Git 源码；切换完成时服务器仍为 `f5138ea`。判断“服务器是否最新”必须分别比较服务器 `HEAD`、`origin/main` 和工作区状态。

## 部署与图形会话边界

- 应用代码先在本地修改、测试、提交并推送，再通过经校验的 Git Bundle 快进服务器 `main` 并执行仓库正式部署入口；`git pull --ff-only` 只保留为服务器可稳定访问 GitHub 时的兼容方式。不得直接编辑服务器项目源码。
- Ubuntu 正式前后端由 `ai-geo-backend.service` 和 `ai-geo-frontend.service` 托管。不得通过 SSH、远程桌面、`nohup`、PM2 或第二套 Node 命令并行启动后端。
- DeepSeek Web 和豆包 Web 的专用 Chrome 需要服务器上持续存在的图形桌面会话。远程桌面客户端可以断开，但不能注销、结束或销毁该桌面会话；这不表示后端要从桌面里启动。
- `DISPLAY` 指定 X 图形显示会话，`XAUTHORITY` 指定访问该会话的授权文件。SSH 终端里的临时 `export` 只影响该终端启动的子进程，不能替代正式 systemd 配置。
- 服务器 `.env`、数据库、Token、浏览器 Profile 和证据目录是持久运行数据，不得复制到 Git。百度生产 Token 必须保留在服务器数据库密文中；本地开发使用脱敏 fixture。

## 百度回调

- 服务器期望的完整 callback 是 `https://insight.guangtuo.com/api/admin/marketing/baidu/oauth/callback`。
- 百度开发者控制台也必须登记完全相同的地址。仅修改服务器环境变量不能替代控制台配置；在控制台更新得到人工确认前，不得声称新域名重新授权已经可用。
- 现有服务器 Token 不因域名切换而删除。除非撤权、过期且刷新失败或确认泄露，不得为了测试主动清除生产 Token。
