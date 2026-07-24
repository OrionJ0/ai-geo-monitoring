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
2. 执行 `git pull --ff-only origin main`。
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

本阶段不配置 launchd 或 systemd，因此：

- 服务器重启后需要人工执行 `npm run prod:start`。
- 前端或后端崩溃后不会自动恢复。
- 日志不会自动轮转。

以后迁移到 Linux 时，这套手动部署命令可以直接使用。如需引入 systemd，需要替换启动和停止适配层；拉取、备份、测试和构建步骤不变。

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

部署失败时先查看 `logs/deployments.log`，再查看对应的前后端日志。不要通过 `git clean -fdx` 清理项目，因为该命令会删除被 Git 忽略的真实环境文件和 SQLite 数据。
