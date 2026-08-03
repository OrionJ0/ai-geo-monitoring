# 市场总览首页 Design QA

## 验收对象

- 视觉真值：`docs/active-2026-07-31-001-market-monitoring-frontend-ia/assets/market-overview-home-final-2026-08-03.png`
- 正式页面入口：`/geo/market-overview`
- 实现截图：`output/playwright/market-overview-fixture/market-overview-desktop-1440x1024.png`
- 浏览器与运行态：Chrome channel；Next.js production build；`1440×1024` CSS 视口；device scale factor 1。
- 设计稿原始像素：`1486×1059`；按 cover 等比缩放并做不足 2px 的居中裁切，得到 `1440×1024` 对比副本；没有非等比拉伸。
- 实现截图像素：`1440×1024`。
- 状态：隔离 Playwright fixture 只用于验证完整 UI 结构和交互；生产路径不包含示例数字。本报告不把 fixture 当成真实业务数据。

## 对比证据

- 归一化设计稿：`output/playwright/market-overview-reference-normalized-1440x1024.png`
- 全页并排：`output/playwright/market-overview-side-by-side-2026-08-03.png`
- 顶栏、侧栏、面包屑和 KPI 聚焦：`output/playwright/market-overview-side-by-side-top-2026-08-03.png`
- 全链路和趋势聚焦：`output/playwright/market-overview-side-by-side-content-2026-08-03.png`
- 窄屏纵向态：`output/playwright/market-overview-fixture/market-overview-mobile-390x844.png`
- 窄屏侧栏覆盖态：`output/playwright/market-overview-fixture/market-overview-mobile-sidebar-390x844.png`
- 窄屏表格局部滚动态：`output/playwright/market-overview-fixture/market-overview-mobile-table-scroll-390x844.png`

## 最终检查

- 字体与排版：沿用项目现有字体栈；模块标题、卡片标题、辅助文字和表格数字的层级与规范一致；侧栏图标约 16px，图标列与文字列保持标准左对齐。
- 间距与布局：顶部栏 64px、桌面侧栏 224px、内容边距 24px、模块间距 16px；投放效率没有外层白色底板；全链路和趋势各有完整白色容器；未发现页面级横向滚动。
- 色彩与 Token：页面底色 `#F6F8FB`，白色表面使用浅边框和 10–12px 圆角，无常驻强阴影；当前周期蓝色实线、上一周期灰蓝虚线。
- 图像与图标：没有需要新增的位图资产；使用现有 Ant Design Icons 和 Ant Design Plots。每行漏斗由图表库渲染为固定 5 阶、左侧共线、底部细尾，不使用 CSS 伪图形。
- 文案与内容：保留“首页 / 市场总览”、固定四个效率指标、固定全链路列和两个趋势下拉。设计稿示例数字没有进入生产路径；缺失咨询、线索、订单和跨系统归因时显示 `—`。
- 响应式：`390×844` 页面无整体横向滚动；全链路表格仅在自身区域滚动；侧栏以 260px 覆盖层出现，关闭后焦点返回触发按钮。
- 无障碍：键盘可操作表头、下拉和 info Tooltip；焦点可见；axe 无违规；图表提供等价数据表；reduced-motion 下没有仍在运行的动画。

## 与设计稿的预期差异

- 顶部栏按用户最终要求保留现有正式工作台操作，因此没有复制设计稿中的“返回首页”按钮。
- 侧栏保留当前正式导航结构，因而比设计稿多“网站诊断”“监测任务”等现有分组；这不是旧首页残留。
- fixture 展示广告、直接访问、搜索引擎、外部链接四条诚实来源证据，设计稿示意为三条品牌来源。当前没有可信跨系统来源关联，不能把流量来源伪装成已验证的百度/必应自然转化链路。
- 四条来源使页面需要纵向滚动才能看到完整图例；未为“一屏看全”压缩到低于规范行高，也未拉伸图表。核心结构和图表比例保持不变。

## 比较历史

### Pass 1

- P1：表头联动后的截图停留在“广告投入”，与默认“访问（点击）”不一致；修复为联动验证后恢复默认指标。
- P1：上一周期折线误为实线；修复 series datum 读取后改为灰蓝虚线。
- P2：全链路行高曾为 84px；收敛到规范允许范围。
- P1：移动侧栏结束态、reduced-motion、主地标和隐藏 H1 存在验收问题；已分别修复并通过 axe。
- P1：权限阻断仍显示业务模块；已改为只显示阻断状态。

### Pass 2–5

- P2：趋势横轴标签过密；约束为 7 个时间刻度。
- P2：侧栏按用户澄清改为标准两列左对齐；分组标题使用更小、更灰的辅助层级。
- P1：图表误用旧动画参数，可能截到渐显中间帧；改用当前图表库 `animate` 参数并验证 reduced-motion。

### Pass 6

- P1：Playwright 最终截图复用了 3001 端口的 Next.js 开发服务器，左下出现调试浮标；改为独立 3011 端口运行 production build。
- P1：完整交互验收后截图停留在“搜索引擎”来源，缺少默认态上一周期虚线；测试现已恢复“百度推广 / 访问（点击）”后再截图。
- 修复后：Chrome production build 下 9/9 Playwright/axe 用例通过，新的全页与聚焦并排证据中未发现可执行的 P0/P1/P2 差异。

## 浏览器验证

- 主交互：趋势指标表头联动、趋势来源切换后保持独立、info Tooltip 键盘触发与 Escape 关闭、移动侧栏打开/关闭与焦点返回、表格自身横向滚动。
- 状态：加载、无数据、部分来源错误、陈旧、权限阻断、reduced-motion。
- 控制台：正常桌面和窄屏验收中无 `console.error` 或 page error。
- axe：桌面和窄屏正常态均为 0 violations。

## 无 fixture 的正式入口证据

- 本地 production build 通过 `/geo/market-overview` 登录进入，截图为 `output/playwright/market-overview-real-1440x1024.png`、`output/playwright/market-overview-real-390x844.png` 和 `output/playwright/market-overview-real-mobile-sidebar-390x844.png`。
- 该运行态没有注入测试数据。由于本地环境尚未配置默认监控项目，页面诚实显示“默认项目不可用”，没有把隔离 fixture 数字渲染为业务数据。
- 控制台唯一错误是 `GET /api/geo-projects/default-context` 返回预期的 `409 Conflict`；其余是 Next.js 对预加载 CSS 的未使用警告，不是页面脚本异常。

## 最终结果

final result: passed

---

# 广告表现页 Design QA

## 验收对象

- 视觉真值：`output/playwright/ad-performance/ad-performance-reference.png`（从本轮用户附件原样提取，`1760×1429`）。
- 真实页面入口：`/geo/ad-performance`。
- 默认态实现截图：`output/playwright/ad-performance/ad-performance-1440x1024-final.png`。
- 同状态实现截图：`output/playwright/ad-performance/ad-performance-1440x1024-popover.png`。
- 浏览器与运行态：Playwright Chromium；Next.js production build；`1440×1024` CSS 视口；`NEXT_PUBLIC_AD_PERFORMANCE_FIXTURE=true` 的隔离开发 fixture。
- 设计稿没有应用侧边栏，只包含内容区和顶部蓝色边线；按用户明确要求，实现保留当前 64px 蓝色顶栏和 224px 展开侧栏。并排比较因此统一使用 `1216×960` 内容区裁切，完整工作台外壳另由默认态实现截图验证。

## 对比证据

- 内容区并排同状态比较：`output/playwright/ad-performance/ad-performance-side-by-side-final.png`。
- 1440×1024 默认态：`output/playwright/ad-performance/ad-performance-1440x1024-final.png`。
- 1440×1024 方案 Popover：`output/playwright/ad-performance/ad-performance-1440x1024-popover.png`。
- 1280×1024 响应式：`output/playwright/ad-performance/ad-performance-1280x1024-final.png`。
- 比较画布源文件：`output/playwright/ad-performance/visual-compare.html`。

## 最终检查

- 字体与排版：沿用项目现有字体和 Ant Design 默认排版；面包屑、模块标题、KPI、辅助文字、表头和表格数字层级清晰，数字使用等宽数字特性。
- 间距与布局：内容区顺序严格为面包屑/日期、横向三指标、总体趋势、结构下钻；白色容器使用轻边框、10–12px 圆角和 16px 模块间距；普通卡片无常驻阴影。
- 色彩与 Token：沿用项目蓝色顶栏、`#F6F8FB` 页面底色、蓝色当前周期和灰蓝上一周期；未引入第二套主题、字体、颜色系统或组件库。
- 图表：当前周期为蓝色实线、上一周期为浅灰虚线；纵轴从 0 开始，图例居中；消费、展现、点击、CTR、平均 CPC 会同步改变纵轴、Tooltip 和格式。
- 表格：项目 → 方案 → 单元保持同级排序和树路径；名称、详情按 Ant Design Table 能力处理；单元预算为 `—`；当前选中行为克制浅蓝；1280px 页面本身无横向溢出，表格内容在自身容器内滚动（991px 可视宽度、1036px 内容宽度）。
- 详情浮层：方案字段、层级差异、hover 保持、Tab 聚焦、Escape 关闭和 `aria-describedby` 已验证；1440×1024 实测浮层边界 `left=989, right=1313, top=710, bottom=973`，全部在视口内。
- 状态与交互：日期快捷范围、三模块联动、五项趋势指标、项目/方案/单元行联动、重复点击恢复总体、返回总体、展开收起、全部/项目/方案/单元层级、名称/ID 搜索父路径、loading/empty/error 均通过 Playwright 验证。
- 控制台：最终页面为 0 errors；6 条 warning 均为 Next.js production build 的预加载 CSS 未在数秒内使用提示，没有页面脚本错误或新增 404。

## 与设计稿的预期差异

- 面包屑末级按用户最终业务要求为“广告表现”，不是设计图中的历史文字“投放结构”。
- 设计图示意的 30 天消费曲线约为每日 ¥2,000–¥5,600，但同时展示总消费 ¥427,528，两者无法同时满足求和口径；fixture 优先遵守用户明确的数据真值约束，使 30 个逐日值精确汇总为 ¥427,528，因此消费纵轴范围高于设计示意。没有为了视觉相似伪造不守恒数据。
- 设计图不含正式工作台外壳；实现按用户要求保留当前顶栏、完整侧栏及其他既有分组。内容区容器、密度、对齐、边框、圆角、图表与表格层级仍按设计目标实现。
- 表头排序指示符来自现有 Ant Design Table，用于满足同级排序要求；设计图中该状态较弱或不可见。

## 比较历史

### Pass 1

- P1：趋势图使用日期样式字符串作为横轴时，折线未覆盖完整 30 天；改为按周期序号对齐并用真实日期格式化刻度。
- P2：趋势纵轴自动从中间值开始、图例左对齐；修复为 0 基线和底部居中图例。
- P1：未实现的“搜索词分析”链接被 Next.js 自动预取并产生 404；关闭该未实现路由的预取，没有新增页面。
- P1：fixture 状态切换存在旧请求覆盖 loading/error 的竞态；增加请求序列保护，状态不再闪回旧数据。

### Pass 2

- P1：1280px 下树表的最小内容宽度撑大整个内容栈，趋势指标选择器被挤出视口；为页面、模块栈和卡片补充 `min-width: 0`，页面级横向溢出归零，仅表格内部滚动。
- P2：CTR 表格格式曾显示 4 位小数；收敛为设计目标的 2 位小数，同时保持 BigInt 精确计算和零分母保护。
- 修复后：同状态并排比较未发现仍需执行的 P0/P1/P2 视觉或交互问题。

## 数据边界

- 无 fixture 时只读真实接口为 `GET /api/marketing/projects/:projectId/dashboard?from&to`；真实 summary、总体 daily trend、campaign 汇总、币种与 cost scale 进入 typed adapter。
- 真实接口暂缺上一周期、项目/方案预算与详情、单元层、方案/单元逐日趋势；这些字段保持 `—` 或空态，不伪造真实数据。
- 完整三层结构、预算、详情、上一周期与逐日示例只存在 `src/fixtures/adPerformance.fixture.ts`，且仅在 `NEXT_PUBLIC_AD_PERFORMANCE_FIXTURE=true` 时启用。Playwright 网络记录没有请求真实广告 dashboard。

## 最终结果

final result: passed

---

# 广告表现页树形结构修正 Design QA

## 验收对象与证据

- 本轮视觉真值：`output/playwright/ad-performance/ad-performance-tree-reference.png`（用户附件原样提取，`656×734`）。
- 最终整页截图：`output/playwright/ad-performance/ad-performance-1440x1024-tree-final.png`；Playwright Chromium，`1440×1024` CSS 视口，`deviceScaleFactor=1`，隔离开发 fixture。
- 最终表格截图：`output/playwright/ad-performance/ad-performance-tree-table-final.png`（`1036×411`）。
- 最终名称列聚焦裁切：`output/playwright/ad-performance/ad-performance-tree-name-final.png`（`289×367`）。
- 同屏比较：`output/playwright/ad-performance/ad-performance-tree-side-by-side-final.png`；将实现裁切等比归一到 `578×734`，与 `656×734` 视觉真值同高并排检查。

## 本轮发现与修复

- [已修复 P1] 名称容器原为块级元素，Ant Design Table 的缩进和展开按钮被挤到名称上一行，导致各层级名称从同一横坐标开始。改为单行内联省略布局，最终实测三层名称起点分别为 `281 / 313 / 345px`，每层递进 `32px`，行高统一为 `52px`。
- [已修复 P1] fixture 在周界报警项目下多展示一条设计图不存在的“周界报警品牌词”方案。删除该重复示例分支，并把项目详情的下属方案数改为 2；默认可见顺序现在与视觉真值一致。
- [已修复 P2] 单元层级缺少清晰连接关系。补充极浅灰竖线与横向分支线，最后一个子节点的竖线在行中点收束。
- [已修复 P2] 超长名称缺少明确的完整文本反馈。名称现在使用 `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`，并用现有 Ant Design Tooltip 在鼠标悬浮时显示完整名称。临时超长文本实测 `clientWidth=217`、`scrollWidth=380`；最终 Tooltip 文本验证为“PC-周界报警-振动光纤-多地域”。

## 最终五项检查

- 字体与排版：继续使用项目字体、13px 表格文字和 500 字重；名称、箭头和状态保持单行垂直居中。
- 间距与布局：项目、方案、单元每级 32px 缩进；52px BI 行高；长文本不会撑宽或增加行高。
- 色彩与 Token：连接线使用现有极浅边框色 `#eef2f7`，没有新增层级底色；选中态仍沿用既有浅蓝。
- 图像与图标：没有新增位图资产；展开箭头继续使用项目现有 Ant Design Icons。
- 文案与结构：默认路径依次为周界报警 → PC 多地域 → 两个振动光纤单元，随后是 PC 电子围栏、品牌词和室内报警，与本轮视觉真值一致。

## 浏览器验证

- 展开/收起仍只控制当前树分支，不触发行选择。
- 名称悬浮 Tooltip 已打开并返回完整名称；移开鼠标后关闭。
- 最终控制台为 0 errors；6 条 warnings 均为既有 Next.js 生产 CSS preload 提示。
- 聚焦同屏比较未发现剩余可执行 P0/P1/P2 差异；设计图里的方案浅蓝底代表行选中态，页面按原验收要求仍保持默认不选中。

final result: passed

---

# 广告表现页本地交接入口修正

- 原交接地址 `127.0.0.1:3012` 的页面进程正常、直连返回 200，但桌面浏览器链接代理拦截了该本地地址。
- 增加仅 `NODE_ENV !== 'production'` 时识别的 `?fixture=ad-performance` 查询参数；不新增路由、不修改鉴权、不写 Token 或浏览器 Profile，生产构建不会由该参数启用 fixture。
- 最终可访问入口：`http://localhost:3001/geo/ad-performance?fixture=ad-performance`。
- 在用户现有 Chrome 登录态中重新打开并验证：总消费、总体趋势、结构下钻及三级树表均完成渲染；构建后 reload 仍通过，控制台 0 errors。
- `allowEmpty={[true, true]}` 只修正无默认项目时禁用空日期控件的 Ant Design 开发警告，不改变正常日期范围交互和视觉布局。
- `npm test` 为 40/40 通过，正常 `npm run build` 通过。

final result: passed
