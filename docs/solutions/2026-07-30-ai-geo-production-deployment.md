# AI-GEO 生产进程与受信代理部署报告

## 结论

2026-07-30 15:52—18:30 CST，AI-GEO 已完成三项正式生产变更：

- 前后端正式入口已从项目内 PID 管理器硬切到 Ubuntu systemd，两个服务均以 `ubuntu` 普通用户运行、开机启用、异常退出自动恢复，并只监听 `127.0.0.1:3001/3002`。
- Express 已启用仅信任回环地址的代理策略。公网伪造 `X-Forwarded-For` 前缀不能切换限流桶，本次启动后未再出现 `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`。
- AI 平台已采用安全默认值：新增预置和自定义平台默认停用，固定展示顺序为豆包 Web、DeepSeek Web、豆包 API、DeepSeek API、千问 API、混元 API；已有生产启停状态保持不变。DeepSeek 结构化分析默认关闭思考模式，分析附加参数可由管理员编辑，但修改必须二次确认。

代码、部署和 DeepSeek API 结构化测试可以交付。正式问题集已从公网入口运行
5 个问题 × 2 个 Web 平台，共 10 条任务：DeepSeek Web 完成 4 条并形成
47 条引用，1 条因分析结果校验失败；豆包 Web 的登录检查通过，但正式提问
触发人机验证，5 条均失败。因此 Web 全链路仍只能有限使用，不能宣称两套
Web 采集全部可用。百度营销仍缺真实权限和账户，不能认定生产验收完成。

质量分级：`good`（systemd、受信代理、安全默认值、DeepSeek 结构化 API）；
`acceptable`（DeepSeek Web，5 条中 4 条完成）；`partial`（豆包 Web、问题集
整体）；`blocked`（豆包人机验证、百度生产验收）。

## 范围与版本

- 生产目录：`/opt/ai-geo-monitoring`
- 验收时生产域名：`https://insight.gato.com.cn`（历史记录；已于
  2026-07-31 退役，当前入口见本文末“生产域名切换”）
- 基线提交：`dca4cae8aac0f4fb5561d06965cf0b33ede99d9c`
- systemd 提交：`93229d9bda28f23822adeb7337413a1f9f5c0318`
- 受信代理提交：`e29166e0b0ce2a6420aeda177972d31f718ced0d`
- 平台安全默认值与分析参数提交：`4aa58122dcb286073f19d9b907db5c3abc2c3b3b`
- 真实 Web 回答结构化测试样例提交：`85bb9b7c0663e479329938094d64c9559187f262`
- 明确排除：广拓官网、`gato-test-*` 容器及其配置；本次未检查、修改或重启。

## 服务器修改台账

| 修改对象 | 影响服务 | 修改与结果 | 验证 | 回滚方法 |
| --- | --- | --- | --- | --- |
| `/opt/ai-geo-monitoring/backend/.env` 中的 `AI_GEO_PROCESS_MANAGER` 单一非秘密配置键 | AI-GEO 部署脚本和进程管理入口 | 初次部署前临时设为 `manual`，systemd 单元安装后改为 `systemd`；未读取或输出其他配置值 | `npm run prod:status -- --json` 返回两个 systemd 单元均为 `loaded/active/running` 且用户为 `ubuntu` | 先用当前入口执行 `npm run prod:stop`，仅把该键改回 `manual`，再执行 `npm run prod:start`；原始状态为未配置该键 |
| `/etc/systemd/system/ai-geo-backend.service` | AI-GEO 后端 | 安装为 root:root、0644；以 `ubuntu` 运行，失败 3 秒后自动恢复 | `systemd-analyze verify` 通过；`systemctl is-enabled` 为 `enabled`；定向 `SIGKILL` 后 PID 变化且 `NRestarts=1` | 停止当前服务、把进程管理键改为 `manual`，执行 `sudo systemctl disable ai-geo-backend.service`，再用 `npm run prod:start` 启动旧管理器 |
| `/etc/systemd/system/ai-geo-frontend.service` | AI-GEO 前端 | 安装为 root:root、0644；以 `ubuntu` 运行，固定 `127.0.0.1:3001`，失败 3 秒后自动恢复 | `systemd-analyze verify` 通过；`systemctl is-enabled` 为 `enabled`；定向 `SIGKILL` 后 PID 变化且 `NRestarts=1` | 与后端一并切回 `manual`，执行 `sudo systemctl disable ai-geo-frontend.service`，再启动旧管理器 |
| `/etc/systemd/system/multi-user.target.wants/ai-geo-*.service` | AI-GEO 开机启动 | `systemctl enable` 创建两个启用链接 | 两个单元 `is-enabled=enabled` | 只对这两个 AI-GEO 单元执行 `systemctl disable`；不得操作 Nginx |
| `/opt/ai-geo-monitoring` Git 工作树与依赖/构建产物 | AI-GEO 全栈 | 先后快进部署到 `93229d9`、`e29166e`，完成 systemd 与受信代理切换 | 标准 `npm run deploy` 两次完成 10/10 阶段；对应阶段 `git rev-parse HEAD` 为 `e29166e…` | 对目标提交执行 `git revert` 并重新运行标准部署；不得使用 `git reset --hard` |
| `/opt/ai-geo-monitoring` 平台默认值、分析参数和前端产物 | AI-GEO 全栈 | 标准部署到 `4aa5812`；新增平台默认停用、固定平台顺序、DeepSeek 思考模式默认关闭、分析附加参数及二次确认；保留生产数据库中已有启停状态 | 生产部署后后端 906/906、营销后端 91/91、前端营销 11/11、Playwright 2/2，lint 和 Next.js 生产构建通过；公网 UI 和真实结构化请求通过 | 对 `4aa5812` 执行 `git revert`，推送后重新运行标准 `npm run deploy`；不得使用 `git reset --hard` |
| `/opt/ai-geo-monitoring` 真实 Web 回答测试样例与前端产物 | AI-GEO 前端及分析测试入口 | 标准部署到 `85bb9b7`；把原三行候选列表替换为生产问题集中成功采集的 1227 字 DeepSeek Web 回答，保留多厂商对比、选型建议和页面引用标记 | 部署后后端 910/910、营销后端 91/91、前端营销 11/11、Playwright 2/2，lint 和 Next.js 构建通过；公网默认样例和结构化测试成功 | 对 `85bb9b7` 执行 `git revert`，推送后重新运行标准 `npm run deploy`；SQLite 无需数据回滚 |
| `/opt/ai-geo-monitoring/backend/database.latest.sqlite` | SQLite 最新备份 | 每次标准部署前更新唯一最新快照；生产数据库未删除 | 各次迁移前后审计均为 `quick_check=ok`，无缺列、无待迁移 GEO 语义记录 | 该文件是滚动“最新备份”，不单独回退；如业务数据库异常，停止服务后按 SQLite 恢复流程使用此快照 |
| Git `origin` 与 `/tmp/ai-geo-systemd-93229d9.bundle` | 仅首次代码拉取 | GitHub TLS 首次超时后，临时把 `origin` 指向校验过的增量 bundle 完成同一标准部署；随即恢复正式 GitHub 地址，临时 bundle 已从本机和服务器删除 | bundle 两端 SHA-256 一致；最终 `git remote get-url origin` 为正式 GitHub 地址 | 无需回滚；bundle 只含 Git 代码，可从相同提交重新生成 |
| 后端受管 DeepSeek/豆包 Chrome 运行态 | AI-GEO 后端 Web 会话 | 通过正式管理员入口执行两次“验证登录”，分别启动并保留专用会话；未修改服务器配置文件、数据库或服务单元 | 两个平台均显示“网页登录已验证”；资源、ready、systemd 和 OOM 结果见下文 | 受管会话会随 `ai-geo-backend.service` 停止而关闭；当前不需要回滚，未为释放内存擅自重启服务 |

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

### AI 平台默认值与分析参数

- 本地 TDD 和完整回归：后端 906/906、目标专项 58/58、部署专项 17/17、
  前端设置页静态测试 8/8、前端营销测试 11/11，lint 与生产构建通过。
- 生产配置确认 `ai_run_concurrency=2`。这是所有平台共享的上层 worker
  并发；两个 Web 平台各自还有最大并发为 1 的 FIFO。API 不进入 Web FIFO，
  但仍占用共享 worker 配额，所以 API/Web 是部分隔离，不是两套完全独立池。
- 生产问题集启动时，页面同时显示 DeepSeek Web 和豆包 Web 各运行 1 条、
  各等待 4 条，验证了两个 Web 队列可以彼此同时运行，但单个平台内部串行。
- 生产平台顺序为 `doubao-web → deepseek-web → doubao → deepseek → qwen
  → hunyuan`。新平台默认停用；已有生产状态按数据库保存值保留，当前启用
  `doubao-web`、`deepseek-web` 和已配置的 `deepseek`。
- 分析请求预览包含 `thinking.type=disabled`，不再包含
  `reasoning_effort=high`。管理员把附加参数从 `{}` 临时改为
  `{"temperature":0}` 后点击保存，页面正确显示“确认修改分析请求参数？”
  和风险说明；取消后恢复 `{}`，没有写入生产配置。
- 浏览器前端只请求 AI-GEO 后端，不接触供应商密钥。后端根据管理员选中的
  分析平台解密连接配置并请求供应商；当前选中 DeepSeek，因此实际由后端
  直接调用 DeepSeek API。
- 正式“测试结构化”在约 10 秒内成功，使用
  `deepseek/deepseek-v4-pro`，`analysis_attempts=1`，返回实体、竞品关系、
  候选顺序、事实声明和情绪的有效结构。
- 2026-07-30 20:59 CST 再次从公网正式入口验收：临时结构化测试默认加载
  生产问题集成功记录中的真实 DeepSeek Web 回答，共 1227 字；页面明确标注
  事实声明仍需核验。该回答包含表格式多厂商对比、复杂选型说明和被页面采集
  拆分的引用标记，不再是三行人工示例。
- 新真实样例约 28 秒后结构化成功，识别 9 个实体、目标品牌 2 次提及、
  8 个竞品关系、两个无序候选集合和正向情绪；思考模式仍为关闭。本次
  `analysis_attempts=2`，说明第一次模型输出仍未通过严格校验，重试后才成功。
- 部署与测试结束后，前后端均为 `active/enabled`、运行用户为 `ubuntu`、
  `NRestarts=0`；公网 `/api/ready` 为 HTTP 200，约 59 ms。后端和前端
  当前内存分别约 63 MiB、52 MiB；本次部署重启关闭了此前常驻的 Web Chrome。

### DeepSeek 与豆包 Web

2026-07-30 18:25—18:30 CST，从当时的用户真实访问入口（现已退役）
`https://insight.gato.com.cn` 执行问题集生产验收。服务器图形桌面仍只承载
DeepSeek/豆包专用 Chrome 的账户登录、验证和维护，不是 AI-GEO 用户入口。

已验证：

- 正式管理员入口重新执行“验证登录”，豆包 Web 于 18:25:38、DeepSeek
  Web 于 18:25:53 显示“网页登录已验证”。
- 正式问题集“广拓周界安防采购问题集”包含 5 个启用问题，覆盖两个 Web
  平台，共创建 10 条任务，约 100 秒后结束为“部分完成”。
- DeepSeek Web：4/5 完成，完成项均有真实回答、页面采集证据、结构化指标
  和引用，共 47 条引用；4 条有效分析中 3 条提及目标品牌、1 条明确推荐。
- DeepSeek Web 唯一失败项已经生成真实回答和 10 条引用，但结构化分析模型
  连续两次返回不符合约束的数据，校验错误为
  `mentions[4].surface_forms` 为空，记录为
  `invalid_analysis_output / parse_or_validate`，未错误计入品牌指标。
- 豆包 Web：5/5 失败。首条正式提问触发
  `web_verification_required`，后续队列在 preflight/request 阶段被拦截；
  登录页状态检查通过不等于真实提问可用。
- 刷新报告后 DeepSeek Web 队列恢复空闲；豆包状态明确提示需要人工验证。
- 本次测试窗口内核 OOM、oom-killer 和 killed process 记录计数为 0。
- 运行后后端、前端均保持 `active/enabled`，运行用户为 `ubuntu`，
  `NRestarts=0`；公网 `/api/ready` 为 HTTP 200，约 67 ms。
- journald 同时记录了 6 次非致命的 `record_lease_claim_rejected`。最终 10
  条记录均进入终态且队列归零，但这表明并行调度存在重复领取竞争，应另行
  检查，不能把它当作无风险日志噪声。

结论：DeepSeek Web 的“域名发起问题 → 单通道排队 → 真实回答与引用 →
DeepSeek API 结构化分析 → 独立运行报告”链路已由 4 个样本验证；豆包 Web
仍被平台人机验证阻断，整个双平台问题集只达到 `partial`。

### Web 浏览器资源采样

采样口径：

- 每 2 秒读取整机 `MemAvailable`、Swap、load average，以及
  `ai-geo-backend.service` 的 `MemoryCurrent`、`MemoryPeak`、
  `TasksCurrent`。
- 后端 cgroup 数值覆盖后端及其启动的专用 Chrome 子进程，是判断 Web
  采集运行开销的主口径。
- 同时记录 `ubuntu` 用户全部 Chrome RSS 和进程数作为辅助口径。由于图形
  桌面已有一组普通 Chrome，且 RSS 会重复计算共享内存，这组数据不能直接
  当作物理内存消耗。

| 阶段 | 后端 cgroup 内存 | 后端任务数 | 整机可用内存 | 全部 Chrome RSS / 进程 |
| --- | ---: | ---: | ---: | ---: |
| 本轮浏览器启动前 | 63.4 MiB | 11 | 2.69 GiB | 290.7 MiB / 12 |
| 问题集开始 | 699.9 MiB | 158 | 1.90 GiB | 2.77 GiB / 37 |
| 问题集运行峰值 | 806.2 MiB（`MemoryPeak` 838.0 MiB） | 176 | 最低 1.70 GiB | 最高 3.09 GiB / 38 |
| 运行结束稳态 | 737.1 MiB | 172 | 1.84 GiB | 3.01 GiB / 38 |

补充结果：

- 18:25:26—18:29:02 每 2 秒采样，共 107 个样本。问题集阶段 64 个样本。
- 两个受管浏览器启动与保持会话是主要开销：后端 cgroup 从 63.4 MiB 上升
  到峰值 806.2 MiB；问题集开始后再增加约 106.3 MiB。
- 问题集期间一分钟 load 峰值 1.09；前端内存峰值 60.4 MiB，基本稳定。
- 整机可用内存最低 1.70 GiB，结束时 1.84 GiB；没有 OOM。Swap free 从
  749.9 MiB 上升而非下降，没有观察到本轮新增换页压力。
- `ps` 汇总的 Chrome RSS 会跨进程重复计算共享页，因此 3.09 GiB 只作辅助
  指标；后端 cgroup 和整机 `MemAvailable` 更接近实际资源压力。
- 受管浏览器会话由后端保持常驻以供后续采集复用；本次没有为回收内存而
  重启服务，因为用户未授权维护窗口，且当前剩余内存和健康检查均正常。

## 风险与后续

1. `P1`：豆包 Web 登录状态检查通过，但正式发问仍触发平台人机验证。需要
   在服务器图形桌面的专用豆包 Chrome 完成验证，再只重试失败项；重试后仍
   应检查 5 条回答、引用和结构化分析，不能只重新点“验证登录”。
2. `P1`：DeepSeek 分析输出 1/5 因空 `surface_forms` 被正确拒绝；新增的
   真实长回答健康测试也需要第二次尝试才通过，证明结构化输出稳定性仍有问题。
   应先增加失败样本回归测试，再决定是提示词强化还是对可安全修复的空数组做
   受控规范化；不得直接放宽全部结构校验。
3. `P1`：百度营销缺真实 App 权限、账户和生产数据。继续按 issue 009/010
   验收，全部通过前不得把需求目录改为 `closed-*`。
4. `P2`：后端浏览器双会话常驻约占 0.72 GiB，峰值约 0.79 GiB，当前 3.57
   GiB 物理内存仍有约 1.84 GiB 可用，但余量不适合无上限增加 Web 平台。
5. `P2`：正式运行出现 6 次 `record_lease_claim_rejected`。虽然记录均收敛
   到终态，应检查问题集启动和项目队列分析是否重复调度同一记录。
6. `P2`：前端依赖安装报告 9 个 high 风险，GitHub 默认分支同时提示
   1 critical、1 high。二者可能不是同一集合，需另建依赖审计任务逐项确认；
   本次未执行 `npm audit fix --force`。
7. `P2`：前端全量静态测试 250 条中有 2 条既存失败，均来自百度营销页面
   继续使用 Ant Design 已弃用的 `Space direction` 和 `Alert message`；
   本次目标测试、lint 和生产构建通过，未把无关营销重构混入当前提交。
8. `P2`：服务器登录提示存在 3 个可更新软件包且需要系统重启。未取得维护
   窗口授权，因此没有升级或重启；应单独安排补丁窗口和回滚/健康检查方案。

## 最终决策

- systemd 与受信代理：**可以交付/进入后续流程**。
- AI 平台安全默认值、分析参数和 DeepSeek API：**可以交付/进入后续流程**。
- DeepSeek Web：**可以有限使用**。本轮 4/5 完成，失败记录已安全排除，
  但必须修复并回归结构化校验失败样本。
- 豆包 Web：**暂不建议用于正式批量运行**。真实提问触发人机验证，完成
  验证并重试 5 条失败项前，不得宣称可用。
- AI-GEO 整体：**可以有限使用**。API、前端、数据库、systemd 和常规调度
  健康；双 Web 问题集与百度生产链路仍未完全验收。

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

## 2026-07-31 稳定性修复部署补充

### 修复与正式切换

- 正式入口已切换到 `f5138ea17a42`，包含三个连续提交：
  `f1c2790`（空 `surface_forms` 的受控规范化）、`debbb71`
  （同一问题集运行修订的进程内重复调度保护）和 `f5138ea`
  （移除百度营销页面 Ant Design 弃用属性）。
- `surface_forms` 只有在字段为数组、数组为空、且实体名称逐字出现在原始回答中
  时，才回填精确实体名称；非数组或回答中没有该实体名称仍然拒绝，不放宽证据
  约束。
- 问题集调度以 `run_id:revision` 为进程内活动键，覆盖从立即派发到整个批次结束
  的生命周期。数据库记录 lease 继续作为跨进程最终防线，没有被删除或替代。
- 原因复盘确认：此前只有一个后端进程且 `NRestarts=0`。问题集创建后立即派发
  整批记录，但 30 秒轮询器会把同一运行中尚未轮到的 Web 记录再次视为待派发；
  `activeRecordIds` 只能保护已经开始执行的记录，不能保护同批次后续排队记录，
  因而产生 6 次 `record_lease_claim_rejected`。这不是多实例造成。

### 服务器修改台账

| 修改对象 | 影响服务 | 修改与结果 | 验证 | 回滚方法 |
| --- | --- | --- | --- | --- |
| `/opt/ai-geo-monitoring` Git 工作树 | AI-GEO 全栈 | 服务器访问 GitHub 超时后，使用两端 SHA-256 一致且 `git bundle verify` 通过的离线 bundle 快进到 `f5138ea`；部署时临时使用同一提交的本机 bare origin，退出 trap 已恢复正式 origin。没有修改官网、Nginx 或 Docker | `git rev-parse --short HEAD=f5138ea`；工作树 `main...origin/main` 且干净；正式 origin 长度与部署前一致 | 在本地对三个提交按逆序执行 `git revert`，推送后重新运行标准部署；不得在服务器使用 `git reset --hard` |
| `/opt/ai-geo-monitoring/backend/node_modules` | AI-GEO 后端 | 标准部署重新执行 `npm ci` | 后端完整测试 914/914；营销专项 91/91；依赖审计 0 个漏洞 | 回退代码提交后重新执行标准部署，由 lockfile 重建依赖 |
| `/opt/ai-geo-monitoring/nextjs-frontend/node_modules` 与 `.next` | AI-GEO 前端 | 标准部署重新安装依赖并生成 30 个路由的生产产物 | 前端静态测试 11/11、Playwright 2/2、ESLint 和标准 Next.js Turbopack 生产构建通过 | 回退代码提交后重新执行标准部署，由 lockfile 和源码重建 |
| `/opt/ai-geo-monitoring/backend/database.latest.sqlite` | SQLite 最新备份 | 标准部署停服务后更新滚动备份；业务库没有删除或重建 | GEO 迁移前后 `quick_check=ok`、无缺列和待迁移语义；营销 4 个版本全部已应用且审计通过 | 如业务库异常，停止 AI-GEO 服务后按 SQLite 恢复流程使用该快照；正常代码回滚不需要数据回滚 |
| `ai-geo-backend.service`、`ai-geo-frontend.service` | AI-GEO 正式入口 | 标准部署仅停止并重新启动这两个单元；未重启服务器 | 两项均 `active/enabled`、`NRestarts=0`，分别监听 `127.0.0.1:3002/3001`；公网 `/api/ready=200`，约 58 ms | 先回退代码，再由标准部署重启这两个单元；不得操作无关服务 |
| 后端专用 DeepSeek/豆包 Profile | AI-GEO Web 采集 | 部署后分别通过项目正式登录校验命令启动专用 Chrome，检查真实页面输入区后正常关闭，Profile 保留；没有读取账号密码或浏览器会话数据 | DeepSeek Web 和豆包 Web 均返回登录状态已确认；校验结束无受管 Chrome 残留，后端约 61 MiB、整机可用内存约 2.4 GiB | 无持久配置变更；如需失效会话，只能通过正式管理员入口切换账号，不能删除 Profile |

标准部署于 2026-07-31 11:16—11:18 CST 完成。部署后 journald 未出现
`record_lease_claim_rejected`、`ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` 或未处理
异常。部署窗口内未修改或 reload Nginx，未操作 Docker/官网，未重启整台服务器。

### 依赖与系统补丁审计

- 前端全量 `npm audit` 为 9 个 high、0 critical，全部位于 ESLint 开发工具链；
  生产依赖 `npm audit --omit=dev` 为 0 个漏洞。审计建议涉及 ESLint 主版本变更
  或不合理降级，未执行 `npm audit fix --force`。
- GitHub push 仍提示默认分支有 1 critical、1 high 的 Dependabot 告警；本机
  GitHub CLI 凭据失效，当前无法读取告警明细，因此不能把这两个远端告警标为
  已解决。
- Ubuntu 当前有 3 个普通更新：`distro-info-data`、`tzdata-legacy` 和
  `tzdata`；没有标准仓库安全更新。Ubuntu Pro 未连接，另显示 6 个 ESM Apps
  更新。`/var/run/reboot-required.pkgs` 仍记录
  `evolution-data-server`，需要维护窗口才能升级并重启验收；本次未升级、未重启。

### 尚待正式入口验收

- 两个 Web Profile 的登录校验通过不等于正式发问通过。仍需从公网管理员/用户
  入口重试问题集 #1 的 6 个失败项，确认原 DeepSeek 真实回答可在空
  `surface_forms` 场景成功结构化、豆包真实提问不再触发验证，并确认本轮没有
  新增 `record_lease_claim_rejected`。
- 本机 Chrome 的 AI-GEO 登录会话当前失效，已打开登录页等待用户重新登录；
  在完成正式入口重试前，整体结论仍保持 `partial`，不能宣称豆包 Web 可用。

## 2026-07-31 生产域名切换

### 当前结论

- 唯一支持的正式入口已切换为 `https://insight.guangtuo.com`。
- `insight.gato.com.cn` 已退役；本文前面的旧域名只用于还原
  2026-07-30 当时的验收事实，不再是运行说明。
- `http://182.254.140.163/` 命中 Nginx 默认站点，不是 AI-GEO；HTTPS 直连
  IP 也不是支持入口。以后不得用直接 IP 是否出现应用页面判断部署状态。
- 切换完成后公网首页为 HTTP 200，`/api/ready` 返回 `ready`，TLS 验证通过，
  HTTP 域名访问重定向到 HTTPS，两个 systemd 服务保持运行。
- 域名切换只调整 Nginx、证书、前后端环境与前端生产构建。服务器 Git 工作树
  保持干净且仍为 `f5138ea`，没有在服务器直接修改项目源码，也没有把域名切换
  误报成代码已经更新到最新 `main`。

### 修改台账

| 修改对象 | 修改与结果 | 验证 | 回滚 |
| --- | --- | --- | --- |
| `/etc/nginx/sites-available/insight` | 80/443 的 `server_name` 切到 `insight.guangtuo.com`；80 重定向 HTTPS，443 继续反代 `127.0.0.1:3001` | `nginx -t` 通过；新域名首页与 `/api/ready` 通过 | 恢复切换前备份并重新执行 `nginx -t`；只有旧域名 DNS 和证书重新有效时才可 reload |
| `/etc/letsencrypt/live/insight.guangtuo.com/` | 签发并启用新域名 Let's Encrypt 证书 | 公网 TLS 校验通过；指定证书续期 dry-run 成功 | Nginx 恢复旧证书路径前必须先确认旧域名仍可解析且证书有效 |
| `nextjs-frontend/.env.production` | `NEXT_PUBLIC_SITE_URL` 改为 `https://insight.guangtuo.com`，服务端代理继续为 `http://127.0.0.1:3002` | 前端生产构建通过，重启后正式域名可访问 | 恢复旧值后重新构建并重启前端 |
| `backend/.env` | `BAIDU_MARKETING_REDIRECT_URI` 改为新域名完整 callback；`HOST=127.0.0.1`，同源代理下 `ALLOWED_ORIGINS` 保持空值 | 后端重启后 `/api/ready=ready`，既有百度连接和服务器密文 Token 保留 | 恢复旧 callback 仅适用于旧域名重新启用且百度控制台同步回退的情况 |

百度开发者控制台还必须人工登记
`https://insight.guangtuo.com/api/admin/marketing/baidu/oauth/callback`。服务器配置
已完成不等于控制台已经同步；在人工确认前，既有 Token 继续保留，但未来重新
授权仍视为未验收。当前操作真值以后统一以
[部署与运维](../DEPLOYMENT.md#当前正式单机实例)为准。
