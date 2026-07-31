# 单机原地部署

本方案面向内部使用的单台 macOS 或 Ubuntu 服务器。部署期间允许网站暂停；构建或测试失败后，由维护者修复代码并重新执行部署。不使用双槽位、release 目录或 Docker。Ubuntu 正式环境使用 systemd 自动恢复前后端进程；部署失败仍保持停止，不做应用版本自动回滚。

正式发布由维护者在 `main` 更新后手动触发 GitHub Actions。工作流生成 Git Bundle，通过 SSH 上传到服务器；服务器校验完整 commit、Bundle SHA-256、`main` 引用、干净工作区和快进关系后，复用仓库部署脚本完成备份、测试、构建、迁移与 systemd 重启。服务器不需要访问 GitHub，也不在这条正式链路中执行 `git pull`。

## 前提

- Git
- Node.js 20.9 或更高版本
- npm
- 干净的 `main` 工作区
- 已存在且有效的 `backend/.env`
- 使用 SQLite 时，数据库文件必须已经存在
- Ubuntu 正式环境已安装仓库 `deploy/systemd/` 中的两个 unit，并明确配置 `AI_GEO_PROCESS_MANAGER=systemd`

真实 `.env`、`.env.local`、SQLite、日志和运行状态均被 Git 忽略。部署脚本不会输出 `JWT_SECRET`、`CONFIG_ENCRYPTION_KEY` 或其他秘密。

如启用 DeepSeek Web 或豆包 Web，运行主机还必须安装受支持的 Chrome，并保持当前运行用户的持久图形桌面会话可用。正式后端仍由 systemd 启动，不需要在远程桌面中手工启动；图形会话只供后端管理的专用 Chrome 使用。远程桌面断开后，客户端不需要保持连接，但虚拟机不得休眠，也不能退出、注销或销毁该桌面会话。无桌面 Linux、多后端实例和自动验证码处理不在第一版支持范围内。

当前正式域名、直接 IP 的 Nginx 默认站点行为、服务器环境变量、百度 callback
和带日期的运行时验证结果统一记录在[部署与运维](DEPLOYMENT.md#当前正式单机实例)。

## 首次接管

Ubuntu 首次安装 systemd：

```bash
cd /opt/ai-geo-monitoring
sudo install -o root -g root -m 0644 \
  deploy/systemd/ai-geo-backend.service \
  deploy/systemd/ai-geo-frontend.service \
  /etc/systemd/system/
sudo systemd-analyze verify \
  /etc/systemd/system/ai-geo-backend.service \
  /etc/systemd/system/ai-geo-frontend.service
sudo systemctl daemon-reload
sudo systemctl enable ai-geo-backend.service ai-geo-frontend.service
```

从旧 PID 管理器首次切换时，先保持 `AI_GEO_PROCESS_MANAGER=manual`，执行 `npm run prod:stop` 并确认 3001/3002 已释放；再把配置明确改为 `systemd`，最后执行 `npm run prod:start`。不得并行保留两套管理器。

首次启用 Bundle 发布前，先人工把包含 `scripts/deploy-from-bundle.mjs` 的版本以同样的已校验 Bundle 方式引导到服务器。完成安装后，可在服务器项目根目录执行只读检查：

```bash
npm run deploy:check
```

`deploy:check` 只做读取和校验，不会拉取代码、停止服务、备份数据库或构建。

## 日常流程

正式日常流程：

```bash
git push origin main
# 然后在 GitHub Actions 中手动运行“部署生产环境”
```

手动触发 `.github/workflows/deploy-production.yml` 后会依次：

1. 检出完整 `main`，生成并本地验证 Git Bundle。
2. 计算 Bundle SHA-256。
3. 使用 production 环境的 SSH secrets 上传到服务器临时目录。
4. 由 `scripts/deploy-from-bundle.mjs` 校验并快进服务器 `main`。
5. 以 `--prepared-revision=<完整 commit>` 调用 `scripts/deploy.mjs`，完成原有正式部署。

GitHub production 环境必须配置：

- Repository/Environment variable `AI_GEO_DEPLOY_ENABLED=true`
- `AI_GEO_DEPLOY_HOST`
- `AI_GEO_DEPLOY_USER`
- `AI_GEO_DEPLOY_SSH_KEY`
- `AI_GEO_DEPLOY_KNOWN_HOSTS`

主机密钥必须来自运维侧预先核验，不得在 workflow 中临时执行无校验的 `ssh-keyscan`。SSH 私钥应使用只允许该服务器、该部署用户的专用密钥。
服务器把仓库 `deploy/ai-geo-deploy-gate.sh` 安装到
`/home/ubuntu/.local/bin/ai-geo-deploy-gate`，并在该公钥的
`authorized_keys` 条目中配置
`command="/home/ubuntu/.local/bin/ai-geo-deploy-gate",restrict`。这把密钥只允许
以旧式 SCP 协议上传命名规范的临时 Bundle，以及执行参数经过严格校验的正式部署命令；
不能获得通用交互式 Shell、端口转发或图形会话。

在专用公钥安装、主机指纹核验和四个 secrets 全部完成前，不得设置
`AI_GEO_DEPLOY_ENABLED=true`。变量缺失或不是 `true` 时，手动运行只会跳过生产部署
job，不会用空凭据尝试连接服务器。

部署命令按以下顺序执行：

1. 要求当前分支为 `main`，且工作区没有未提交或未跟踪文件。
2. 校验 Bundle SHA-256、`refs/heads/main` 与预期完整 commit，拒绝非快进版本；快进后再次核对 `HEAD`。
3. 检查 `JWT_SECRET`、`CONFIG_ENCRYPTION_KEY` 和数据库配置。
4. 通过 systemd 停止前端和后端。
5. SQLite 使用 Online Backup API 更新唯一最新快照并执行 `PRAGMA quick_check`；Postgres 要求 `AI_GEO_DATABASE_BACKUP_REFERENCE` 已声明外部备份引用。
6. 后端执行 `npm ci` 和完整测试。
7. 前端执行 `npm ci`、lint 和生产构建。
8. 使用第 5 步的备份引用执行 GEO 指标语义迁移，再运行一次只读迁移审计；任一步失败都不启动服务。
9. 通过 systemd 依次启动后端和 Next.js，并检查后端 ready、前端页面和前端 `/api` 代理。

任何步骤失败都会返回非零退出码并写入部署日志。服务停止后的步骤失败时，网站保持停止；修复问题后重新运行对应 workflow。`npm run deploy` 保留为服务器能够稳定访问 GitHub 时的人工兼容入口，不是当前正式 Bundle 发布路径。

## SQLite 最新备份

默认备份位置：

```text
backend/database.latest.sqlite
```

备份脚本先写入临时文件，通过完整性检查后再替换 latest，因此失败的新快照不会覆盖上一次成功快照。只保留这一份，不保留历史版本。

可以在部署命令外指定其他路径：

```bash
AI_GEO_SQLITE_BACKUP_PATH=/实际备份路径/database.latest.sqlite npm run deploy
```

这份文件是部署前快照，不是异机灾备。服务器磁盘损坏、项目目录被整个删除或当前数据库在备份前已经逻辑损坏时，单份本地快照可能无法恢复。

Postgres 的备份由外部数据库设施负责，部署命令不会创建数据库快照。执行部署前必须提供可追溯的备份引用：

```bash
AI_GEO_DATABASE_BACKUP_REFERENCE=<备份任务或快照标识> npm run deploy
```

## 生产进程命令

```bash
npm run prod:start
npm run prod:stop
npm run prod:status
```

Ubuntu 正式环境中，这三个命令是 systemd 的项目级入口。它们不会读取旧 `.runtime/*.json` 作为生产真值，也不会生成第二套脱离终端的 Node 进程。

```bash
systemctl status ai-geo-backend.service ai-geo-frontend.service
journalctl -u ai-geo-backend.service -u ai-geo-frontend.service
```

部署结果摘要继续写入 `logs/deployments.log`；前后端标准输出和错误统一进入 journald。两个 unit 直接运行项目 Node/Next.js 入口，以 `ubuntu` 用户启动，使用 `Restart=always` 自动恢复，并通过 `SIGTERM` 和 60 秒停止窗口执行应用优雅关闭。

前端正式 unit 只绑定 `127.0.0.1:3001`，后端继续绑定 `127.0.0.1:3002`。正式环境禁止绕过 systemd 并行执行第二套 `node backend/app.js`；即使端口不同，第二个进程也会破坏全局 Web FIFO 假设。

旧 PID 管理器只为 macOS 兼容环境保留；Linux 默认要求 systemd，且服务器 `.env` 应明确配置 `AI_GEO_PROCESS_MANAGER=systemd`。unit 缺失时直接失败，不静默回退。

## 受管 Web 虚拟机运行边界

- 后端由 systemd 正式入口运行；它管理的 headed Chrome 必须能够连接到持续存在的持久图形桌面会话。远程桌面客户端不需要一直打开，但虚拟机不得休眠，断开时不能选择注销或销毁图形会话。
- `DISPLAY` 是 X 图形显示会话地址，`XAUTHORITY` 是访问该会话的授权文件。SSH 终端中执行 `export DISPLAY=...` 和 `export XAUTHORITY=...` 只影响该终端随后启动的子进程；systemd 不会自动继承该临时 shell 环境，正式配置必须由服务运行环境提供并在服务重启后重新验证。
- SQLite/Postgres 数据、DeepSeek 与豆包各自的专用 profile 和 Web 证据目录必须位于持久磁盘。两个 profile 彼此隔离，也不得与日常 Chrome、SEO 渲染浏览器或其他后端实例共用。
- 所有市场部同事使用现有共享 `admin` 访问共同项目和报告。该账号保留完整管理员权限，应用无法识别真实操作人或提供人员级审计；密码分发、轮换和离职撤权由公司内部账号流程负责。
- 系统 `admin` 与 DeepSeek 服务账号是两套独立身份，与豆包服务账号也彼此独立。网页账号密码只由虚拟机运维负责人维护，不得进入应用配置、数据库、日志、Issue 或示例命令。
- `/api/ready` 只表示主应用、数据库、调度器和首次恢复就绪，不代表 DeepSeek Web 或豆包 Web 可用。登录后的使用者应按平台读取 `/api/ai-platforms/:platformCode/runtime-status`；真实运行仍会执行自己的 preflight。

首次登录、登录失效、人工验证或账号切换的首选恢复流程为：

1. 管理员进入 `/admin/settings` 的“AI 平台”页签。
2. 查看目标平台的浏览器、Profile 和登录验证状态。
3. 点击“登录 / 打开 Chrome”或“切换账号”。
4. 在虚拟机持久桌面中新打开的专用 Chrome 中人工完成操作。
5. 回到设置页点击“验证登录”，确认状态为“网页登录已验证”。

打开登录窗口后，对应平台以 `web_login_required` 阻断新页面采集，验证成功后恢复；DeepSeek Web 与豆包 Web 的登录操作、浏览器和熔断互相隔离。设置页只显示浏览器配置、Profile 初始化和验证结果，不读取账号身份、密码、Cookie、Authorization 或绝对路径。

重启后端会清除两个平台各自的进程内熔断，但不会证明网页登录仍然有效；重启后仍应在设置页验证目标平台，真实任务也会再次执行 preflight。

如果后端不可用、设置页无法进入或需要离线修复 Profile，使用 CLI 兜底：

```bash
npm run prod:stop
npm run web:login -- deepseek-web
# 或：npm run web:login -- doubao-web
npm run prod:start
```

`prod:stop` 会让后端优雅关闭全部注册 Chrome 并释放各自的 Profile lock。豆包 Web 必须在真实单问题、问题集重试、自动监测、双浏览器资源和回收验收全部通过后才由管理员启用。

## 验证与排错

运行部署专项测试：

```bash
npm run test:deployment
```

检查进程：

```bash
npm run prod:status
```

检查服务：

```bash
curl -f http://127.0.0.1:3002/api/health
curl -f http://127.0.0.1:3001/
curl -f http://127.0.0.1:3001/api/health
```

使用有效 JWT 检查 DeepSeek Web 公共状态；不要把 Token 写入共享脚本、日志或工单。`idle` 仅表示没有待处理工作和已知阻塞，不代替正式运行前的真实 preflight。

部署失败时先查看 `logs/deployments.log`，再用 `journalctl` 查看对应 unit。不要通过 `git clean -fdx` 清理项目，因为该命令会删除被 Git 忽略的真实环境文件和 SQLite 数据。
