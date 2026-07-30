# AI-GEO 生产进程与受信代理部署报告

## 结论

2026-07-30 15:52—16:33 CST，AI-GEO 已完成两项正式生产变更：

- 前后端正式入口已从项目内 PID 管理器硬切到 Ubuntu systemd，两个服务均以 `ubuntu` 普通用户运行、开机启用、异常退出自动恢复，并只监听 `127.0.0.1:3001/3002`。
- Express 已启用仅信任回环地址的代理策略。公网伪造 `X-Forwarded-For` 前缀不能切换限流桶，本次启动后未再出现 `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`。

这两项可以交付并继续用于生产。DeepSeek/豆包 Web 只完成了图形环境、Chrome 和隔离目录前置检查，真实登录与采集尚未验收；百度营销仍缺真实权限和账户，不能认定生产验收完成，需求目录继续保持 `blocked-*`。

质量分级：`good`（systemd 与受信代理）；`partial`（DeepSeek/豆包真实采集）；`blocked`（百度生产验收）。

## 范围与版本

- 生产目录：`/opt/ai-geo-monitoring`
- 生产域名：`https://insight.gato.com.cn`
- 基线提交：`dca4cae8aac0f4fb5561d06965cf0b33ede99d9c`
- systemd 提交：`93229d9bda28f23822adeb7337413a1f9f5c0318`
- 受信代理提交：`e29166e0b0ce2a6420aeda177972d31f718ced0d`
- 明确排除：广拓官网、`gato-test-*` 容器及其配置；本次未检查、修改或重启。

## 服务器修改台账

| 修改对象 | 影响服务 | 修改与结果 | 验证 | 回滚方法 |
| --- | --- | --- | --- | --- |
| `/opt/ai-geo-monitoring/backend/.env` 中的 `AI_GEO_PROCESS_MANAGER` 单一非秘密配置键 | AI-GEO 部署脚本和进程管理入口 | 初次部署前临时设为 `manual`，systemd 单元安装后改为 `systemd`；未读取或输出其他配置值 | `npm run prod:status -- --json` 返回两个 systemd 单元均为 `loaded/active/running` 且用户为 `ubuntu` | 先用当前入口执行 `npm run prod:stop`，仅把该键改回 `manual`，再执行 `npm run prod:start`；原始状态为未配置该键 |
| `/etc/systemd/system/ai-geo-backend.service` | AI-GEO 后端 | 安装为 root:root、0644；以 `ubuntu` 运行，失败 3 秒后自动恢复 | `systemd-analyze verify` 通过；`systemctl is-enabled` 为 `enabled`；定向 `SIGKILL` 后 PID 变化且 `NRestarts=1` | 停止当前服务、把进程管理键改为 `manual`，执行 `sudo systemctl disable ai-geo-backend.service`，再用 `npm run prod:start` 启动旧管理器 |
| `/etc/systemd/system/ai-geo-frontend.service` | AI-GEO 前端 | 安装为 root:root、0644；以 `ubuntu` 运行，固定 `127.0.0.1:3001`，失败 3 秒后自动恢复 | `systemd-analyze verify` 通过；`systemctl is-enabled` 为 `enabled`；定向 `SIGKILL` 后 PID 变化且 `NRestarts=1` | 与后端一并切回 `manual`，执行 `sudo systemctl disable ai-geo-frontend.service`，再启动旧管理器 |
| `/etc/systemd/system/multi-user.target.wants/ai-geo-*.service` | AI-GEO 开机启动 | `systemctl enable` 创建两个启用链接 | 两个单元 `is-enabled=enabled` | 只对这两个 AI-GEO 单元执行 `systemctl disable`；不得操作 Nginx |
| `/opt/ai-geo-monitoring` Git 工作树与依赖/构建产物 | AI-GEO 全栈 | 两次快进部署到 `93229d9`、`e29166e`；最终生产服务器与 `origin/main` 一致且工作树干净 | 标准 `npm run deploy` 两次完成 10/10 阶段；最终 `git rev-parse HEAD` 为 `e29166e…` | 对目标提交执行 `git revert` 并重新运行标准部署；不得使用 `git reset --hard` |
| `/opt/ai-geo-monitoring/backend/database.latest.sqlite` | SQLite 最新备份 | 每次标准部署前更新唯一最新快照；生产数据库未删除 | 两次迁移前后审计均为 `quick_check=ok`，无缺列、无待迁移 GEO 语义记录 | 该文件是滚动“最新备份”，不单独回退；如业务数据库异常，停止服务后按 SQLite 恢复流程使用此快照 |
| Git `origin` 与 `/tmp/ai-geo-systemd-93229d9.bundle` | 仅首次代码拉取 | GitHub TLS 首次超时后，临时把 `origin` 指向校验过的增量 bundle 完成同一标准部署；随即恢复正式 GitHub 地址，临时 bundle 已从本机和服务器删除 | bundle 两端 SHA-256 一致；最终 `git remote get-url origin` 为正式 GitHub 地址 | 无需回滚；bundle 只含 Git 代码，可从相同提交重新生成 |

本次没有修改 Nginx 配置，没有 reload/stop Nginx，没有重启整台服务器，没有操作 Docker，也没有修改或重启官网项目。

## 测试与生产验收

### systemd

- 本地部署专项测试：17/17 通过。
- Ubuntu `systemd-analyze verify`：新增单元通过。输出中仅有既存腾讯云代理单元的 `/var/run` 兼容警告，与 AI-GEO 无关。
- systemd 状态：后端、前端均为 `loaded/active/running`，运行用户为 `ubuntu`。
- 端口：Next.js 只监听 `127.0.0.1:3001`，Express 只监听 `127.0.0.1:3002`。
- 自动恢复：后端 PID `427909 → 429242`，前端 PID `427929 → 429629`；两者 `NRestarts=1`，journald 记录信号退出和 3 秒后重启。
- 日志：`journalctl -u ai-geo-backend.service` 与 `journalctl -u ai-geo-frontend.service` 均可读取启动、退出和恢复记录。
- 公网：异常恢复后及最终部署后，`/` 与 `/api/ready` 均为 HTTP 200。
- 未执行整机重启；开机恢复依据为两个单元已 `enabled`，不是实际重启验收。

### 受信代理与限流

- TDD 红灯：新增测试首先因代理策略模块不存在而失败。
- 绿灯：真实 HTTP 测试覆盖回环 IPv4/IPv6、Nginx/Next.js 转发链、伪造前缀和限流桶，共 3/3 通过。
- 本地后端完整回归：883/883 通过。
- 生产部署回归：后端 883/883、营销专项 78/78、前端 10/10、Playwright 2/2、lint 与 Next.js 生产构建全部通过。
- 公网入口验证：三个不同伪造前缀请求的 `x-ratelimit-remaining` 连续为 `499 → 498 → 497`，未切换限流桶。
- Nginx 访问日志：三条探测请求对应一个真实远端地址；报告不记录该地址值。
- journald：本次后端启动后 `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` 计数为 0。
- SQLite：`quick_check=ok`；营销模块状态仍为 `DISABLED`。

### DeepSeek 与豆包 Web

已验证的 OS 前置条件：

- systemd 运行用户可访问图形显示和 Xauthority。
- 用户会话总线可用。
- DeepSeek、豆包各自的 Chrome 可执行文件存在且可执行。
- 两个平台的 profile 与 evidence 目录均存在、可读写且彼此隔离。

未验证：

- 两个平台当前是否保持真实登录。
- 人机验证是否已通过。
- 从正式管理员入口发起问题后，是否能取得真实回答、引用和证据截图。

因此不能仅凭 `/api/ready` 或上述前置检查宣称 Web 采集可用。

## 风险与后续

1. `P1`：DeepSeek/豆包真实登录和采集未验收。需要在持久图形桌面中分别完成管理员登录验证，再从正式项目入口各执行至少一条真实问题。
2. `P1`：百度营销缺真实 App 权限、账户和生产数据。继续按 issue 009/010 验收，全部通过前不得把需求目录改为 `closed-*`。
3. `P2`：前端依赖安装报告 9 个 high 风险，GitHub 默认分支同时提示 1 critical、1 high。二者可能不是同一集合，需另建依赖审计任务逐项确认；本次未执行 `npm audit fix --force`。
4. `P2`：服务器到 GitHub 曾出现一次 GnuTLS 超时，后续部署已恢复正常。若复发，应先检查网络，再使用经过哈希校验的增量 bundle；不得跳过标准测试和构建阶段。

## 最终决策

- systemd 与受信代理：**可以交付/进入后续流程**。
- AI-GEO 整体：**可以有限使用**。API、前端、数据库和常规调度健康；DeepSeek/豆包 Web 真实采集及百度营销生产链路仍须单独验收。

## 证据路径

- [systemd 后端单元](../../deploy/systemd/ai-geo-backend.service) — `deploy/systemd/ai-geo-backend.service`
- [systemd 前端单元](../../deploy/systemd/ai-geo-frontend.service) — `deploy/systemd/ai-geo-frontend.service`
- [systemd 进程管理实现](../../scripts/systemdProcessManager.mjs) — `scripts/systemdProcessManager.mjs`
- [生产进程入口](../../scripts/production.mjs) — `scripts/production.mjs`
- [systemd 行为测试](../../tests/systemdProcessManager.test.mjs) — `tests/systemdProcessManager.test.mjs`
- [systemd 单元契约测试](../../tests/systemdUnits.test.mjs) — `tests/systemdUnits.test.mjs`
- [受信代理策略](../../backend/config/trustedProxyPolicy.js) — `backend/config/trustedProxyPolicy.js`
- [受信代理与限流测试](../../backend/tests/TrustedProxyPolicy.test.js) — `backend/tests/TrustedProxyPolicy.test.js`
- [单机部署与回滚说明](../SINGLE_HOST_DEPLOYMENT.md) — `docs/SINGLE_HOST_DEPLOYMENT.md`

服务器 journald、Nginx access log 和现场命令输出属于生产实时证据，本报告仅记录汇总结论，不复制可能包含用户活动信息的原始日志。
