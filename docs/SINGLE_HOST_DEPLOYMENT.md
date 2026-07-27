# 单机原地部署

本方案面向内部使用的单台 macOS 或 Linux 服务器。部署期间允许网站暂停；构建或测试失败后，由维护者修复代码并重新执行部署。不使用双槽位、release 目录、Docker、GitHub Actions，也不提供自动回滚或进程崩溃自动恢复。

## 前提

- Git
- Node.js 20.9 或更高版本
- npm
- 干净的 `main` 工作区
- 已存在且有效的 `backend/.env`
- 使用 SQLite 时，数据库文件必须已经存在

真实 `.env`、`.env.local`、SQLite、日志和运行状态均被 Git 忽略。部署脚本不会输出 `JWT_SECRET`、`CONFIG_ENCRYPTION_KEY` 或其他秘密。

如启用 DeepSeek Web，运行主机还必须安装受支持的 Chrome，并保持当前运行用户的持久图形桌面会话可用。虚拟机不得休眠，远程桌面断开不能退出、注销或销毁该会话。无桌面 Linux、多后端实例和自动验证码处理不在第一版支持范围内。

## 首次接管

第一次使用生产命令前，先人工停止由终端、VS Code 或 Codex 启动的旧前后端，确保 3001 和 3002 端口不再被旧进程占用。部署命令只能管理由 `npm run prod:start` 启动并记录的进程，不能安全识别此前由其他会话启动的服务。

在服务器项目根目录执行：

```bash
npm run deploy:check
npm run deploy
```

`deploy:check` 只做读取和校验，不会拉取代码、停止服务、备份数据库或构建。

## 日常流程

开发电脑：

```bash
git push origin main
```

服务器：

```bash
cd /实际项目路径
npm run deploy
```

部署命令按以下顺序执行：

1. 要求当前分支为 `main`，且工作区没有未提交或未跟踪文件。
2. 执行 `git pull --ff-only origin main`，并确认 `HEAD` 与 `origin/main` 完全一致；服务器上的本地提交即使工作区干净也不会被部署。
3. 检查 `JWT_SECRET`、`CONFIG_ENCRYPTION_KEY` 和 SQLite 文件。
4. 停止由生产命令管理的前后端。
5. 使用 SQLite Online Backup API 更新唯一的最新快照，并执行 `PRAGMA quick_check`。
6. 后端执行 `npm ci` 和完整测试。
7. 前端执行 `npm ci`、lint 和生产构建。
8. 以生产模式启动后端和 Next.js。
9. 检查后端、前端页面和前端 `/api` 代理。

任何步骤失败都会返回非零退出码并写入部署日志。服务停止后的步骤失败时，网站保持停止；修复问题后重新执行 `npm run deploy`。

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

## 生产进程命令

```bash
npm run prod:start
npm run prod:stop
npm run prod:status
```

进程会脱离当前终端运行，日志位置为：

```text
logs/backend.log
logs/frontend.log
logs/deployments.log
```

PID 状态保存在 `.runtime/`。停止时会先发送 `SIGTERM`，等待超时后才强制终止，并在操作前核对 PID 对应的命令，避免误杀无关进程。

重复执行 `npm run prod:start` 会复用已核验的受管进程，不会启动第二个受管后端。PID 存活但命令不匹配时，启动、状态接管和停止都会拒绝覆盖或终止该未知进程。正式环境禁止绕过生产命令并行执行第二套 `node backend/app.js`；即使端口不同，第二个进程也会破坏全局 Web FIFO 假设，profile lock 只负责阻止它同时操作同一个 DeepSeek profile。

本阶段不配置 launchd 或 systemd，因此：

- 服务器重启后需要人工执行 `npm run prod:start`。
- 前端或后端崩溃后不会自动恢复。
- 日志不会自动轮转。

以后迁移到 Linux 时，这套手动部署命令可以直接使用。如需引入 systemd，需要替换启动和停止适配层；拉取、备份、测试和构建步骤不变。

## DeepSeek Web 虚拟机运行边界

- 后端必须从持续存在的持久图形桌面会话运行；虚拟机不得休眠，远程桌面断开不能销毁图形会话。
- SQLite/Postgres 数据、DeepSeek 专用 profile 和 Web 证据目录必须位于持久磁盘。profile 不得与日常 Chrome、SEO 渲染浏览器或其他后端实例共用。
- 所有市场部同事使用现有共享 `admin` 访问共同项目和报告。该账号保留完整管理员权限，应用无法识别真实操作人或提供人员级审计；密码分发、轮换和离职撤权由公司内部账号流程负责。
- 系统 `admin` 与 DeepSeek 服务账号是两套独立身份。DeepSeek 账号密码只由虚拟机运维负责人维护，不得进入应用配置、数据库、日志、Issue 或示例命令。
- `/api/ready` 只表示主应用、数据库、调度器和首次恢复就绪，不代表 DeepSeek Web 可用。登录后的使用者应读取 `/api/ai-platforms/deepseek-web/runtime-status`；真实运行仍会执行自己的 preflight。

首次登录、登录失效、人工验证、账号切换或选择器故障的正式恢复流程为：

```bash
npm run prod:stop
npm run web:login -- deepseek-web
npm run prod:start
```

在登录命令打开的虚拟机 Chrome 中完成操作并确认对话输入区可用后，先关闭登录浏览器，再启动生产服务。`prod:stop` 会让后端优雅关闭专用 Chrome 并释放 profile lock；重启后端会清除旧后端的登录、验证或选择器类进程内熔断。只完成网页登录但不重启后端，不视为恢复完成。

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

部署失败时先查看 `logs/deployments.log`，再查看对应的前后端日志。不要通过 `git clean -fdx` 清理项目，因为该命令会删除被 Git 忽略的真实环境文件和 SQLite 数据。
