# Fix Bug

## 待修

### P1

- [ ] 2026-07-27：清理部署失败后 SQLite 备份临时侧文件
  - 状态：待修
  - 记录时间：2026-07-27 22:51
  - 现象：首次发布在备份完成后的测试阶段失败，`database.latest.sqlite.tmp-shm` 和 `database.latest.sqlite.tmp-wal` 留在工作区；下一次发布因工作区不干净而直接拒绝执行。
  - 影响：发布脚本宣称可以在修复后重试，但自身残留文件会阻断重试，网站继续保持停止。
  - 来源：
    - `backend/scripts/backupSqlite.js`
    - `backend/tests/BackupSqlite.test.js`
    - 目标 VM 第二次 `npm run deploy` 输出
  - 复现：对 WAL 模式的 SQLite 数据库生成最新备份，再检查备份临时路径的 `-shm` 和 `-wal` 侧文件。
  - 修复进展：备份前、成功重命名后和异常清理阶段均显式删除限定到备份临时路径的三个文件；新增侧文件回归断言，后端 786 项和部署 10 项测试通过。
  - 下一步：推送修复，删除目标 VM 上已确认的两个备份临时侧文件，重新执行完整发布并确认失败重试不再被工作区残留阻断。

- [ ] 2026-07-27：修复 Node.js 20 无法连接 Chrome 调试协议
  - 状态：待修
  - 记录时间：2026-07-27 22:45
  - 现象：目标 VM 使用 Node.js 20.20.2，运行 SEO Chrome 实机测试时返回 `unavailable`；直接诊断显示 `WebSocket is not defined`，发布流程因此停止并保持网站下线。
  - 影响：代码虽然满足文档声明的 Node.js 20.9 以上部署要求，但依赖较新 Node.js 才提供的全局 `WebSocket`，导致目标环境不能通过发布验收。
  - 来源：
    - `backend/services/CdpConnection.js`
    - `backend/tests/CdpConnection.test.js`
    - 目标 VM `npm run deploy` 输出
  - 复现：在没有全局 `WebSocket` 的 Node.js 20 环境执行 `node --test tests/SeoRenderService.test.js`。
  - 修复进展：已改为使用后端显式生产依赖 `ws`，并增加禁止读取 Node.js 全局 `WebSocket` 的回归测试；本机后端 786 项、部署 10 项测试及生产依赖审计均通过。
  - 下一步：推送修复并在目标 VM 重新执行完整发布，确认 Node.js 20 下 Chrome 实机测试和真实服务入口均通过后移入“已修”。

- [ ] 2026-07-27：完成目标 VM 的豆包 Web 正式切换
  - 状态：待修
  - 记录时间：2026-07-27 22:06
  - 现象：访问 `http://192.168.9.224:3001/admin/settings` 时，设置页只有 DeepSeek Web，没有豆包 Web，也没有登录、切换账号、验证登录和重新加载等管理入口。
  - 影响：用户无法在实际使用入口配置或确认豆包 Web；当前目标 VM 仍在运行旧前端/旧后端，源码中的新实现没有在正式流程生效。
  - 来源：
    - `output/playwright/doubao-deepseek-e2e-2026-07-27/01-settings-platform-list.png`
    - `output/playwright/doubao-deepseek-e2e-2026-07-27/audit-report.md`
    - `nextjs-frontend/src/app/admin/settings/page.tsx`
  - 复现：打开目标 VM 设置页，检查 Web 平台列表和账号操作区。
  - 修复进展：当前源码、完整测试和生产构建均已包含豆包 Web 与账号管理入口；目标 VM 已拉取新提交，但首次发布被 Node.js 20 的 Chrome 调试连接兼容问题安全拦截。
  - 下一步：先发布 Node.js 20 兼容修复，再确认正式配置包含 `doubao-web`，并从目标 VM 完成登录、验证登录、运行问题和历史回查。

- [ ] 2026-07-27：修复局域网 HTTP 页面点击运行无响应
  - 状态：待修
  - 记录时间：2026-07-27 22:06
  - 现象：在 `http://192.168.9.224:3001/geo/prompts` 点击单题“运行”后，页面没有加载态、成功或失败提示，也没有发出运行请求；浏览器报错 `TypeError: window.crypto.randomUUID is not a function`。
  - 影响：通过局域网 HTTP 访问的用户无法执行单题监测，且界面把客户端崩溃表现成“按钮没反应”。
  - 来源：
    - `output/playwright/doubao-deepseek-e2e-2026-07-27/04-run-click-no-visible-feedback.png`
    - `output/playwright/doubao-deepseek-e2e-2026-07-27/audit-report.md`
    - `nextjs-frontend/src/utils/idempotencyKey.cjs`
  - 复现：通过非安全上下文的局域网 HTTP 地址打开问题库，点击任一问题的“运行”，观察控制台和网络请求。
  - 修复进展：当前源码已改用兼容安全上下文和局域网 HTTP 的幂等键生成器，前端定向测试和完整 230 项测试通过；目标 VM 仍未部署该构建。
  - 下一步：将已使用兼容降级算法的当前前端部署到目标 VM，并在局域网 HTTP 真实入口证明请求已发出、页面有运行反馈、历史记录已生成。

### P2

- [ ] 2026-07-27：只显示当前项目或运行实际使用的 Web 通道状态
  - 状态：待修
  - 记录时间：2026-07-27 23:06
  - 现象：目标 VM 的“广拓”项目只配置豆包 API，问题库仍固定显示“DeepSeek Web 登录已失效”，让用户误以为当前项目被无关平台阻塞。
  - 影响：全局启用但未被当前项目使用的 Web 平台会在问题库和运行报告制造错误告警，用户无法判断哪个登录状态真正影响当前任务。
  - 来源：
    - `nextjs-frontend/src/components/WebPlatformRuntimeStatus.tsx`
    - `nextjs-frontend/src/app/geo/prompts/page.tsx`
    - `nextjs-frontend/src/app/geo/question-set-reports/page.tsx`
    - 目标 VM `http://192.168.9.224:3001/geo/prompts`
  - 复现：启用 `deepseek-web`，令当前项目只选择 `doubao`，打开问题库。
  - 修复进展：组件已改为接收当前项目或当前运行的平台代码，只轮询和展示其中的受管 Web 平台；定向 5 项回归测试通过。
  - 下一步：完成前端全量测试和生产构建，推送后由目标 VM 拉取部署，再确认豆包 API 项目不显示 DeepSeek Web 告警。

- [ ] 2026-07-27：修复未运行问题显示 1970 年时间
  - 状态：待修
  - 记录时间：2026-07-27 22:06
  - 现象：新建且从未运行的问题在“最近运行”列显示 `1970-01-01 08:00`，而不是未运行状态。
  - 影响：用户会误以为问题曾在异常时间运行，无法准确判断是否完成过采集。
  - 来源：
    - `output/playwright/doubao-deepseek-e2e-2026-07-27/04-run-click-no-visible-feedback.png`
    - `nextjs-frontend/src/app/geo/prompts/page.tsx`
  - 复现：创建一个未运行的问题，查看问题库的“最近运行”列。
  - 修复进展：已增加空值、空白字符串、无效时间和有效时间测试，页面已统一使用可选时间格式化器；完整前端测试与生产构建通过。
  - 下一步：部署到目标 VM 后，从问题库确认未运行问题显示 `-`。

- [ ] 2026-07-27：补全失败历史的错误原因和失败阶段
  - 状态：待修
  - 记录时间：2026-07-27 22:06
  - 现象：管理端历史记录标记为“失败”，展开后却只显示完整的 AI 原始回答，没有显示 `error_message`、失败阶段或错误码。
  - 影响：用户无法区分“回答采集失败”和“回答已采集但后续分析/指标保存失败”，也无法据此排障。
  - 来源：
    - `output/playwright/doubao-deepseek-e2e-2026-07-27/06-admin-history-failed-with-answer.png`
    - `nextjs-frontend/src/app/admin/history/page.tsx`
    - `backend/services/ProjectRunService.js`
  - 复现：打开管理端运行历史，展开一条状态为“失败”但包含回答内容的记录。
  - 修复进展：已区分“回答采集失败”和“回答已采集，后续处理失败”，并展示安全化原因、中文阶段、阶段代码和错误码；行为与页面接入测试通过。
  - 下一步：部署到目标 VM 后，展开原失败记录核对真实数据展示。

- [ ] 2026-07-27：迁移目标 VM 的内置平台默认配置
  - 状态：待修
  - 记录时间：2026-07-27 22:06
  - 现象：目标 VM 的千问请求参数仍为空对象，DeepSeek API 仍默认启用且未配置，与当前产品要求的“千问默认强制联网、DeepSeek API 默认不启用”不一致。
  - 影响：旧环境升级后不会获得新的安全默认值，可能发出未启用联网搜索的千问请求，或把未配置的 DeepSeek API 暴露为可选平台。
  - 来源：
    - `output/playwright/doubao-deepseek-e2e-2026-07-27/01-settings-platform-list.png`
    - `backend/services/AIPlatformConfigService.js`
  - 复现：在目标 VM 设置页查看千问请求参数和 DeepSeek API 启用状态。
  - 修复进展：已增加幂等迁移：只升级完整匹配旧预置身份的 Qwen 空参数，只关闭完整匹配旧预置且没有密钥的 DeepSeek API；管理员自定义连接和已配置启用状态保持不变。本机生产后端重启后已验证迁移生效。
  - 下一步：部署到目标 VM 并重启后端后，在设置页验证 Qwen 为 `{"search_options":{"forced_search":true}}`、未配置的 DeepSeek API 为停用。

### P3

- [ ] 2026-07-27：修复问题库首屏短暂显示空数据
  - 状态：待修
  - 记录时间：2026-07-27 22:06
  - 现象：进入问题库时先短暂显示 `0` 条和空状态，约 800ms 后才出现真实数据。
  - 影响：用户会误以为问题被清空，弱网环境下更明显。
  - 来源：
    - `output/playwright/doubao-deepseek-e2e-2026-07-27/audit-report.md`
    - `nextjs-frontend/src/app/geo/prompts/page.tsx`
  - 复现：冷启动后首次进入问题库，观察统计卡片和表格的数据加载过程。
  - 修复进展：问题请求期间的数量区域已显示“正在加载问题…”，表格继续使用加载态；相关页面测试和生产构建通过。
  - 下一步：部署到目标 VM 后节流网络复查首屏。

- [ ] 2026-07-27：改善管理历史的回答排版
  - 状态：待修
  - 记录时间：2026-07-27 22:06
  - 现象：管理端历史展开区把 Markdown 标记 `###`、`**` 等作为普通文本直接显示。
  - 影响：长回答难以阅读，标题、列表和强调信息的层次丢失。
  - 来源：
    - `output/playwright/doubao-deepseek-e2e-2026-07-27/06-admin-history-failed-with-answer.png`
    - `nextjs-frontend/src/app/admin/history/page.tsx`
  - 复现：展开一条包含 Markdown 的 AI 回答历史。
  - 修复进展：已复用项目现有 React Markdown 与 GFM 展示能力，未启用原始 HTML 或 `dangerouslySetInnerHTML`；安全约束测试和生产构建通过。
  - 下一步：部署到目标 VM 后展开包含标题、强调和列表的回答做视觉复查。

- [ ] 2026-07-27：补全管理历史筛选控件的可访问名称
  - 状态：待修
  - 记录时间：2026-07-27 22:06
  - 现象：平台和状态筛选下拉框缺少可访问名称，部分中文按钮的可访问名称被拆成带空格的字符。
  - 影响：屏幕阅读器用户难以理解筛选控件用途，自动化与语音控制也不稳定。
  - 来源：
    - `output/playwright/doubao-deepseek-e2e-2026-07-27/audit-report.md`
    - `nextjs-frontend/src/app/admin/history/page.tsx`
  - 复现：查看管理历史页面的 accessibility tree，检查两个筛选下拉框和操作按钮名称。
  - 修复进展：已为平台筛选、状态筛选、搜索和重置补充稳定 `aria-label`，页面测试和生产构建通过。
  - 下一步：部署到目标 VM 后复查 accessibility tree。

- [ ] 2026-07-27：跟进前端 ESLint 工具链的间接依赖漏洞
  - 状态：待修
  - 记录时间：2026-07-27 13:37
  - 现象：不排除开发依赖执行 `npm audit` 时，`eslint-config-next` 下的旧版 Minimatch/Brace Expansion 仍报告高危拒绝服务漏洞；生产依赖审计为 0。
  - 影响：仅影响在受攻击者控制的 glob 输入下运行本地 Lint 的开发流程，不进入前端生产包。
  - 来源：
    - `nextjs-frontend/package-lock.json`
  - 复现：在 `nextjs-frontend` 执行 `npm audit`。
  - 下一步：待 `eslint-config-next` 及其插件支持安全版 Minimatch/Brace Expansion 后升级；不可直接覆盖 Brace Expansion 5，已验证会导致 Lint 报 `expand is not a function`。

## 已修

- [x] 2026-07-27：修复 Next.js 生产进程误判
  - 状态：已修
  - 记录时间：2026-07-27 13:23
  - 修复时间：2026-07-27 13:37
  - 原始问题：Next.js 启动后把进程标题替换为 `next-server`，仅按初始命令标记校验会误报未运行；仅放宽命令匹配又会产生 PID 复用风险。
  - 修复内容：记录并校验操作系统进程启动时间，允许 Next.js 的稳定运行时标题作为辅助标记；停止前后端时改为独立收敛，单个身份异常不再跳过另一个服务。
  - 验证结果：根目录进程管理测试 9/9 通过；真实重启后前后端 `commandMatched` 与 `identityMatched` 均为 `true`，前端识别为 Next.js 16.2.12。

- [x] 2026-07-27：修复证据删除崩溃窗口
  - 状态：已修
  - 记录时间：2026-07-27 13:23
  - 修复时间：2026-07-27 13:37
  - 原始问题：启动恢复会无条件删除 `.trash`，无法区分数据库事务已提交还是已回滚，可能删除仍被记录引用的截图。
  - 修复内容：启动时先查询每个隔离证据对应的数据库记录；记录仍存在则原子恢复，不存在才删除；数据库读取失败时保留隔离目录并中止恢复。
  - 验证结果：删除与恢复相关测试 17/17 通过，覆盖记录存活恢复、记录删除清理及数据库不可用时保留证据。

- [x] 2026-07-27：修复关闭服务未等待后台任务
  - 状态：已修
  - 记录时间：2026-07-27 13:23
  - 修复时间：2026-07-27 13:37
  - 原始问题：调度 tick 与 `setImmediate` 启动的项目运行未纳入停机等待，数据库可能先于后台写入任务关闭。
  - 修复内容：项目运行服务跟踪所有后台 Promise，停机后拒绝新任务并提供 `drain()`；调度器等待当前 tick；HTTP 停止接收请求后并行排空调度、项目任务和 Web 会话，最后关闭数据库。
  - 验证结果：新增停机顺序、调度等待及项目任务拒绝/排空测试；后端全量测试 753/753 通过。

- [x] 2026-07-27：升级存在已知高危漏洞的生产依赖
  - 状态：已修
  - 记录时间：2026-07-27 13:23
  - 修复时间：2026-07-27 13:37
  - 原始问题：前后端直接及传递生产依赖包含严重和高危安全公告，Next.js 16.1.1 也位于受影响范围。
  - 修复内容：升级 Next.js、Axios、Express Rate Limit、Sequelize、SQLite3 等依赖；对 Next.js 尚未更新约束的 PostCSS/Sharp 和 Sequelize 的 UUID 使用已验证安全版本覆盖；修复升级后暴露的 React render 纯度错误。
  - 验证结果：后端完整 `npm audit` 为 0，前端 `npm audit --omit=dev` 为 0；前端 Lint 无错误/警告，生产构建成功，真实首页与健康接口返回 200。

- [x] 2026-07-27：修复合法标题层级被误判
  - 状态：已修
  - 记录时间：2026-07-27 13:23
  - 修复时间：2026-07-27 13:37
  - 原始问题：标题级别数值下降被当作“顺序错误”，导致从 H3 返回同级章节 H2 的正常文档结构被扣分。
  - 修复内容：只把向更深层级跨越一级以上视为跳级，允许子章节结束后回到上级或同级章节。
  - 验证结果：新增 `H1 → H2 → H3 → H2` 回归测试；SEO 相关测试 64/64 通过。

- [x] 2026-07-27：避免掩盖公共站点的 localhost Sitemap
  - 状态：已修
  - 记录时间：2026-07-27 13:23
  - 修复时间：2026-07-27 13:37
  - 原始问题：localhost Sitemap 的来源改写没有区分公网与私网审计，导致公网错误配置被静默修正。
  - 修复内容：只有本次审计目标已被判定为私网时才允许 localhost 改写；公网目标保持来源不一致结果。
  - 验证结果：新增公网不改写和私网改写双向测试；SEO 相关测试 64/64 通过。
