# 市场工作台 Design QA

## 当前验收总览

本文件记录 2026-08-04 前本地页面与设计稿的浏览器验收证据，不是部署或生产真实数据证明。隔离 fixture 只用于覆盖完整视觉和交互状态；生产路径必须继续遵守各页面的数据缺失边界。

| 页面 | 本地设计实现 | 数据 / 证据边界 |
| --- | --- | --- |
| 市场总览 | 浏览器视觉、交互、响应式、axe 已通过 | 无 fixture 的本地 production build 已请求真实官网聚合 API 并显示 3 个可归因会话；百度本机无凭据，生产仍待验收 |
| 原始咨询 | 浏览器视觉、抽屉、响应式、axe 已通过 | 官网记录级 adapter 已完成真实只读与脱敏验证；53KF 仍为独立 `NOT_CONNECTED` |
| 网站流量 | 浏览器视觉、交互、响应式、axe 已通过 | 真实合同已验证，隔离响应只用于可重复视觉验收 |
| 关键词分析 | 浏览器视觉、图表、交互、axe 已通过 | 完整 302/51 数据与行动标签来自开发 fixture；生产读取 Dashboard 关键词且不补造标签 |
| 广告表现 | 浏览器视觉、层级树、交互与本地登录态入口已通过 | 完整层级 fixture 只用于设计验收；生产读取 Dashboard 严格层级 |
| 订单结果 | 页面结构、数据模型、筛选、抽屉、响应式与非生产 fixture 门已通过源码合同测试 | 尚无本文件内的正式浏览器视觉对比；生产无销售数据源，完整页面默认不展示示例数字 |

## 市场总览首页

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

## 无 fixture 的本地 production build 入口证据

- 本地 production build 通过 `/geo/market-overview` 登录进入，截图为 `output/playwright/market-overview-real-1440x1024.png`、`output/playwright/market-overview-real-390x844.png` 和 `output/playwright/market-overview-real-mobile-sidebar-390x844.png`。
- 2026-08-04 使用本地 production build、默认项目 `6` 和独立官网只读凭据复验；页面请求正式内部 `/api/website-data/projects/6/form-consultations`，所选 30 日区间展示两条官网来源行、合计 3 个可归因成功提交会话。
- 同一会话进入原始咨询页，请求 `/api/consultations/projects/6/records`；官网记录可用，53KF 明确未接入。页面没有注入 fixture，浏览器控制台无错误。
- 本机没有百度真实凭据，因此广告表现、关键词分析和网站流量只验证能力门与诚实缺失态；生产真实百度证据必须在服务器现有 Token 不出库的前提下完成。
- 控制台唯一错误是 `GET /api/geo-projects/default-context` 返回预期的 `409 Conflict`；其余是 Next.js 对预加载 CSS 的未使用警告，不是页面脚本异常。

## 最终结果

final result: passed

---

# 订单结果页面 Design QA

## 对比基线

- 视觉真值：`/Users/gato/.codex/generated_images/019fc6d4-474d-7b63-bf0c-6d956d0a621b/exec-e9889989-873a-4acd-96dd-34f47ad2d0c2.png`
- 浏览器实现：`http://127.0.0.1:3001/geo/order-results?demo=1`
- 实现截图：`output/playwright/order-results/.playwright-cli/page-2026-08-03T16-30-04-605Z.png`
- 全屏并排证据：`output/playwright/order-results/comparison-1440x1024.png`
- 表格局部证据：`output/playwright/order-results/comparison-table-region.png`
- 视口：1440 × 1024 CSS px，`deviceScaleFactor=1`。
- 状态：非生产开发示例、2026-07-05 至 2026-08-03、趋势指标“成交订单数”、全部来源、全部关联状态、无搜索词、第一页、详情抽屉关闭。

## Findings

- 无遗留 P0、P1、P2 问题。
- [P3] 趋势折线密度与视觉稿不同：视觉稿每日约 5–13 单，但同页总体只有 12 单；实现依据 12 条示例订单逐日聚合，峰值为 1 单，避免让趋势与总体互相矛盾。
- [P3] 应用外壳尺寸和右上角操作与视觉稿略有不同：实现复用现役 64px 顶栏、224px 侧栏及退出登录按钮，这是全局外壳边界。
- [P3] 历史实现截图左下角存在 Next.js 开发工具入口；它只属于开发服务器，不是页面 DOM 或生产构建。

## 必检视觉面

- 字体与排版：复用项目的中文系统字体栈和既有字号层级；标题、指标、正文、表头和状态文字没有异常换行或截断。金额与订单数保持不同展示模型。
- 间距与布局：总体指标与单圆环同处顶部，趋势和明细均为全宽；区块间距、圆角、边框、卡片留白与视觉稿一致。
- 颜色与视觉 token：可信来源使用同一蓝色系，来源未知为中性灰，待关联为浅橙；未整行着色。历史实测白底文字对比度：可信来源 7.42:1、待关联 5.02:1、中性状态 6.42:1。
- 文案与内容：订单、合同签订金额、主要归因咨询和来源关系的语义与视觉稿及数据源真值一致；默认状态明确说明销售系统尚未接入，示例状态明确标注“开发示例”。
- 响应式与无障碍：390 × 844 下无全局横向溢出；筛选器换行、表格容器滚动、抽屉全宽；筛选器有可访问名称，抽屉支持焦点进入、Esc、遮罩关闭和焦点恢复，趋势有等价数据表。

## 比较与交互证据

1. 表格总宽由 1270px 收敛为 1136px，1440 × 1024 首屏可见操作列且表格外层无需横向滚动。
2. 修复临时关联后焦点目标移除导致 Esc 不稳定的问题；成功提示和关闭后的触发按钮焦点恢复已验证。
3. 日期范围、趋势指标、来源/关联状态筛选、搜索、排序、分页、详情抽屉、临时关联和刷新重置均已验证。
4. 默认 `/geo/order-results` 只显示订单数据源未接入，不加载示例订单；本轮 production build 复验确认没有订单 API 请求并呈现诚实不可用状态。

## Open Questions

- 销售系统明确不在本轮接入范围。销售系统只读订单合同、真实来源记录 URL 和持久化关联能力尚不存在，生产继续 `UNAVAILABLE`。

final result: passed

---

# 原始咨询页 Design QA

## 验收对象

- 视觉真值：`/Users/gato/.codex/generated_images/019fc6d4-474d-7b63-bf0c-6d956d0a621b/exec-b07771f9-fc03-4e87-9c87-7ccc1b04fbb4.png`（`1487×1058`）。
- 页面入口：`/geo/consultations`。
- 实现截图：`output/playwright/consultations-fixture/consultations-drawer-1440x1024.png`（`1440×1024`）。
- 浏览器与运行态：本机 Chrome channel；Next.js production build；`1440×1024` CSS 视口；`deviceScaleFactor=1`。
- 状态：隔离 Playwright 网络 fixture 仅用于验证完整列表和抽屉状态，联系人、电话、邮箱、记录 ID 与第三方地址均为脱敏测试值；fixture 不进入生产代码，也不构成 53KF 已接入证据。
- 密度归一：视觉真值按 cover 等比缩放并居中裁切为 `1440×1024`，没有非等比拉伸；实现截图为同像素、同 CSS 视口和 1x 密度。

## 对比证据

- 归一化视觉真值：`output/playwright/consultations-fixture/consultations-reference-normalized-1440x1024.png`。
- 全页同画布并排：`output/playwright/consultations-fixture/consultations-reference-vs-implementation-1440x1024.png`（`2880×1024`）。
- 抽屉聚焦并排：`output/playwright/consultations-fixture/consultations-drawer-reference-vs-implementation.png`（设计稿抽屉原宽 350px、实现按明确要求为 440px；两者同为 960px 可视高度）。
- 浏览器用例：`nextjs-frontend/tests/marketing/browser/consultations.spec.ts`，5/5 通过，覆盖完整页面、抽屉、筛选/搜索/排序/分页/视图切换、部分覆盖、错误重试和窄屏键盘路径。

## 最终五项检查

- 字体与排版：沿用现有工作台字体栈、13–18px 标题与正文层级；趋势横轴收敛为约 8 个水平日期刻度；表格正文保持 13px 与 52px 行高。
- 间距与布局：保留现有 64px 顶栏、224px 侧栏、24px 内容边距、16px 模块间距；最近咨询在抽屉打开前后宽度与位置完全不变；抽屉固定覆盖于顶栏下方，实测 `x=1000, y=64, width=440, height=960`。
- 色彩与 Token：沿用 `#F6F8FB` 底色、白色表面、蓝色主线、浅边框和 12px 圆角；遮罩透明度为 0.1，显式关闭 Ant Design 默认背景模糊；成功、类型标签和链接均通过 axe 对比度检查。
- 图像与图标：页面不需要新增位图资产；图标来自现有 Ant Design Icons，图表来自 Ant Design Plots，没有用 CSS 图形、手写 SVG 或占位图替代设计资产。
- 文案与内容：表单咨询和在线客服有效对话始终独立，没有咨询总数；详情显示类型、时间、来源、落地页、设备、有效消息、脱敏联系方式、来源系统链接和审计提示；页面没有回复、编辑、分配、线索、订单或销售漏斗操作。

## 互动、响应式与无障碍

- 趋势与来源分布互斥切换；来源、设备、类型和来源筛选、300ms 内容搜索、三列表头排序、分页与页容量使用受控请求参数。
- Drawer 使用 Ant Design portal 覆盖主页面，支持遮罩和 ESC 关闭；打开后焦点进入关闭按钮，Tab/Shift+Tab 保持在模态内，关闭后即使表格重渲染也按记录 ID 回到原“查看”入口；桌面与 390px 窄屏浏览器实测通过。
- 抽屉内对话合同只允许 `VISITOR` / `AGENT`，测试对话含访客实际消息，不含机器人问候、窗口打开或系统发送者。
- 页面与抽屉分别运行 axe，均为 0 violations；Tabs 现在使用真实 `tabpanel`，趋势和来源图通过 `aria-describedby` 关联逐点/逐来源数据表，日期起止输入有独立名称，筛选和详情加载状态由 polite live region 播报。
- 767px 以下摘要改为单列，筛选纵向排列，表格保持自身横向滚动，抽屉宽度为 `min(440px, 100vw)`；390×844 实测抽屉为 390px 且焦点不逃逸；reduced-motion 禁用动画和过渡。

## 与设计稿的预期差异

- 顶栏、侧栏和导航分组按用户要求复用当前正式工作台，没有复制视觉稿里的历史壳层按钮和分组。
- 实现抽屉严格按明确要求使用约 440px，而视觉稿归一化后的抽屉约 350px；这是需求覆盖视觉示例的有意差异。
- 视觉稿同时绘制两条咨询趋势；当前真实运行只有官网可归因表单逐日聚合，53KF 尚未完成真实接口验证，因此正式页面只绘制有证据的表单线，并把在线客服序列明确标为未接入。视觉 fixture 可验证已接入记录与抽屉，但没有伪造一条生产 53KF 趋势。
- 视觉稿含环比和“来源已识别率”，本轮核心信息架构没有可靠对比期或全量表单分母合同；实现不展示这些示例指标，避免把聚合会话数冒充表单记录总数。

## 比较历史

### Pass 1

- [已修复 P1] 分析筛选曾通过 `tabBarExtraContent` 进入 ARIA `tablist`，导致 combobox 成为不允许的子角色；改为 Tabs 与筛选的并列视觉行。
- [已修复 P1] 初始焦点进入整块抽屉正文，产生大面积蓝色轮廓；改为聚焦真实关闭按钮，同时保留关闭后的触发点恢复。
- [已修复 P2] Ant Design Drawer 默认 4px 背景模糊使主表过度失焦；改为无模糊的 0.1 轻遮罩，保持覆盖层级但不破坏上下文辨认。
- [已修复 P2] 30 个横轴日期全部旋转显示；限制刻度数并关闭自动旋转，恢复视觉稿的水平时间节奏。
- [已修复 P2] 成功标签、客服类型标签和部分辅助文字对比度不足；加深前景色后，页面与抽屉 axe 均无违规。

### Pass 2

- 补齐在线客服详情的完整类型文案、四轮脱敏有效对话和“在 53KF 查看原记录”文案；刷新同尺寸全页与抽屉聚焦并排证据。
- 最终比较未发现仍需执行的 P0/P1/P2 差异；剩余差异均来自现有应用壳层、明确的 440px 抽屉要求或尚未验证的真实数据边界。

### Pass 3（审查修复）

- [已修复 P1] Tabs 曾只提供视觉标签、真实图表在空 `tabpanel` 之外；现将两个视图作为 Ant Tabs 的实际 children，并为图表补充视觉隐藏的数据等价表。
- [已修复 P1] 长来源状态曾被单行省略，错误与无数据共用空态；状态现可换行，来源与列表错误使用带重试的 Alert，未接入和部分覆盖使用独立诚实文案。
- [已修复 P2] 禁用“查看”的原因只能悬停获知；现改为可聚焦的 `aria-disabled` 入口并关联说明。
- [已修复 P2] 窄屏长对话下焦点可能逃出抽屉、列表重渲染后焦点恢复目标可能失效；现增加模态焦点循环与基于记录 ID 的恢复回退。
- [已修复视觉差异] 抽屉关闭按钮从默认左侧移至标题行右端，与最终视觉稿一致；刷新全页与抽屉同画布对比证据。

## 最终结果

final result: passed

---

# 网站流量页 Design QA

## 验收对象

- 视觉真值：`/Users/gato/.codex/generated_images/019fc6d4-474d-7b63-bf0c-6d956d0a621b/exec-96d10831-57d6-4712-9621-5b39de76591e.png`（`1487×1058`）。
- 真实页面入口：`/geo/website-traffic`。
- 同尺寸实现截图：`output/playwright/website-traffic/website-traffic-reference-viewport.png`（`1487×1058`）。
- 1440×1024 验收截图：`output/playwright/website-traffic/website-traffic-1440x1024.png`。
- 浏览器与运行态：Playwright 使用本机 Chrome channel；Next.js production build；`deviceScaleFactor=1`；隔离的网络 fixture 只用于验收完整已接入视觉态，不进入生产代码和真实数据链路。
- 密度归一：视觉真值和实现均为 `1487×1058` 像素、`1487×1058` CSS 视口、1x 密度，未缩放、未非等比拉伸。

## 对比证据

- 同画布并排对比：`output/playwright/website-traffic/reference-vs-implementation.png`（`2974×1058`）。
- 1280px 响应式：`output/playwright/website-traffic/website-traffic-1280.png`。
- 390px 窄屏：`output/playwright/website-traffic/website-traffic-narrow.png`。
- 400% 等效重排：`output/playwright/website-traffic/website-traffic-400-percent.png`（`320×800` CSS 视口，等效 `1280px` 浏览器在 400% 页面缩放时的可用宽度）。
- 合同能力关闭/未验证回归态：`output/playwright/website-traffic/website-traffic-honest-missing.png`。
- 全页对比已能辨认汇总、折线、来源表和页面表的字号、行高、线条与对齐；原图和实现又分别以原始尺寸打开检查，因此无需额外裁切聚焦区域。

## 最终五项检查

- 字体与排版：沿用现有应用字体栈和 Ant Design 层级；六项汇总、模块标题、辅助文字和表格数字层级清晰，长路径单行省略。
- 间距与布局：信息顺序严格为面包屑/设备/日期、周期汇总、网站趋势、来源质量、页面表现；汇总在 PV 后使用更明显分隔；密度收敛后 `1487×1058` 中可同时看到五段和页面表分页。
- 色彩与 Token：沿用 `#F6F8FB` 底色、白色浅边框容器和现有蓝色；当前周期蓝色实线、上一周期高对比灰色虚线；无第二套通用组件外观。
- 图像和图标：页面不需要新增位图资产；图标来自现有 Ant Design Icons，折线来自 Ant Design Plots，没有使用 CSS 绘制或自制 SVG 替代设计资产。
- 文案与内容：保留“首页 / 投放与流量 / 网站流量”和固定模块名称；无客服、线索、订单或广告归因文案；缺失值用 `—`，零值保留为 `0`。

## 互动、响应式与无障碍

- 来源行支持鼠标、Enter 和 Space；选中态同时含左侧标记和“已选择”文字；可恢复“全部来源”。
- 入口页面/受访页面会更换数据请求与全部列；搜索、排序、真实总数分页已验证。
- 路径 Tooltip 支持 hover 和键盘焦点；实际 Ant Design 表格滚动节点可聚焦并带区域名称；390px 和 400% 等效重排下无页面级横向滚动，宽表格仅在内部滚动。
- 折线图下方提供可展开的每日趋势等价表，包含本期日期、本期值、上期日期、上期值和变化；Tooltip 的两期日期与变化值也经过真实 hover 验证。
- axe 在启用颜色对比检查时无 serious/critical 违规；最终默认态无 `console.error` 或 page error。

## 与设计稿的预期差异

- 顶栏、侧栏及已存在的其他导航分组按用户要求原样保留，不复制设计稿中的历史应用外壳。
- 浏览器验收数字是明确隔离的视觉 fixture，且与设计稿示例数字不同；正式运行不会将 fixture 当作业务数据。
- 合同能力关闭或上游无数据时，真实页面会显示诚实缺失/未接入态；视觉稿只覆盖完整数据态，不能作为真实响应合同证据。当前来源汇总、全站质量指标和两个页面报告已有真实账号响应证据；来源行质量与来源—页面关联仍保持缺失/不联动。

## 比较历史

### Pass 1

- [已修复 P2] 初稿在 `1440×1024` 中只能看到来源表上半部，页面表现完全落在首屏之外；根因是额外的“周期汇总”可见标题、偏大的表头/行高和分离的页面 Tabs 工具栏。
- [已修复 P2] 390px 下表格最小宽度曾撑大网格项，横向滚动未被限定在表格内部。
- 修复：周期汇总保留语义标题但视觉隐藏；收紧趋势和表格密度；页面标题、Tabs、当前范围和搜索合并为一行；为模块网格与表格包装层增加 `min-width: 0` 和自身滚动约束。

### Pass 2

- 同尺寸并排证据中，五段信息结构、容器尺寸、表格密度、蓝/灰周期线、来源比例条、页面双视图和分页均已对齐。
- 没有剩余可执行的 P0/P1/P2 差异。作为 P3 的预期差异仅剩既有应用外壳和非生产 fixture 数字，两者均是用户明确约束导致。

### Pass 3：对抗式审查修复

- 修复来源缺失值聚合为零、趋势 Tooltip 前一期日期/变化错误、百分比浮点截断、错误响应缓存、跨连接同站点歧义、日期行不完整仍接受和无限陈旧回退；缓存读写收敛为同一实现，固定周期旧表与任意日期范围表保持不同迁移职责，避免改写已发布迁移。
- 为来源汇总、质量指标和页面报告保留 manifest 能力闸门与 transport 前 fail-closed 测试；当前同站点真实账号证据允许正式 manifest 开放这些报告，隔离响应仅用于可重复视觉验收。
- 补齐图表等价数据表、实际表格滚动节点焦点、Space 选择来源、Tooltip hover/keyboard、精确排序请求、滚动位移、400% 等效重排与颜色对比验收。
- 修复后：后端完整营销测试、前端单元测试/lint、production build 和独立 production Playwright 均重新通过；五位审查者确认的问题均已修复。

## 最终结果

final result: passed

---

# 关键词分析页 Design QA

## 验收对象

- 视觉真值：`/Users/gato/.codex/generated_images/019fc79d-a298-7992-a9dd-46e31845db3c/exec-0fc40496-4a4f-4c6f-b38c-c5c48b770d9c.png`（`1487×1058`）。
- 真实页面入口：`/geo/keyword-analysis`。
- 实现截图：`output/playwright/keyword-analysis/keyword-analysis.png`（`1488×1058`）。
- 浏览器与运行态：Playwright 使用本机 Chrome channel；Next.js 开发预览；`1488×1058` CSS 视口；device scale factor 1；`NEXT_PUBLIC_KEYWORD_ANALYSIS_FIXTURE=true` 的隔离开发 fixture。

## 对比证据

- 视觉稿与实现同一纵向画布：`output/playwright/keyword-analysis/design-qa-comparison.png`。
- 1280px 响应式截图：`output/playwright/keyword-analysis/keyword-analysis-1280.png`，页面宽度与视口同为 1280px，横向滚动限制在表格容器。
- Playwright 定向用例：`nextjs-frontend/tests/marketing/browser/keyword-analysis.spec.ts`，覆盖摘要、默认选中、表格联动、散点/密度切换、关键词搜索、重置、截图和 axe。
- 静态与数据契约：`nextjs-frontend/tests/marketing/keyword-analysis.test.cjs`，覆盖实体唯一性、摘要、任务筛选、行动分布、账户均值、fixture 数量和页面结构。

## 最终五项检查

- 字体与排版：沿用项目字体栈和 Ant Design 字号层级；不重复 H1，不保留解释性长文；消费、CTR、平均 CPC 使用主要视觉权重，展现和点击降一级。
- 间距与布局：结构为面包屑/日期与来源状态、转化关系摘要、任务筛选、左图右详情与行动分布、明细表；右侧详情和环图没有被新版图表替换。
- 色彩与 Token：散点按显式优化标签使用蓝、绿、红、灰；四象限同时有文字和轻背景，不只依赖颜色。风险指标、次级单元名和选中行指标已提高对比度并通过 axe。
- 图表与交互：Ant Design Plots 提供 Scatter、Heatmap 和 Pie；点大小表示点击，图表不显示额外散点图例；选中点有双环并联动详情与表格，密度视图可处理大数据量。
- 响应式与状态：表格固定“关键词”和“标签”列，完整父级路径只在 Tooltip 中读取；关键词次级信息只显示直接所属单元名，没有“推广单元”前缀。

## 与设计稿的预期差异

- 设计稿工作台外壳与当前项目壳层图标、导航分组略有差异；实现按用户要求复用当前正式顶栏、侧栏和既有信息架构，没有改造其他菜单或页面。
- 设计稿表格次级信息仍含“推广单元：”前缀；用户在实施前明确覆盖该细节，实现只显示 `record.unitName`。
- 设计稿的散点分布是视觉示意；实现使用 302 个明确开发关键词实体，其中 51 个有点击且分母有效的实体进入散点和行动分布，不补造零点击点。
- 设计稿选中点展示悬浮卡；实现保留按需 Tooltip，并以右侧完整详情作为持续可见信息，避免重复常驻说明。
- 当前应用壳层在同尺寸下占用更多垂直空间，表格通过自身滚动区读取后续行；这是复用正式壳层的 P3 差异。

## 比较历史

### Pass 1：结构恢复

- P1：设计中已确认保留的当前关键词详情、行动分布环图和原明细表曾被新版布局替换；重新组合为左侧图表、右侧完整详情与环图、下方明细表。
- P1：选中散点曾作为表格筛选条件导致只剩一行；改为选中态高亮和联动，不改变筛选后的表格集合。
- P2：删除账户、推广计划和通用“更多筛选”；任务筛选仅保留推广单元、优化建议、消费区间、CTR/CPC 异常和关键词搜索。

### Pass 2：图表与数据量

- P2：补齐四象限名称与两种业务基准，只允许当前数据中位数和账户平均值，没有人工目标线。
- P2：散点维持平方根 `3–11px` 和 56% 不透明度；新增密度视图，不增加散点图例。
- P2：fixture 的行动标签分布对齐设计稿的 `18 / 14 / 12 / 7`，但生产缺失标签时仍显示未分类，不自动生成建议。

### Pass 3：浏览器 QA

- P1：第一次真实截图中散点填充色未正确进入 Canvas；为每个点提供显式颜色后恢复 51 个可见散点。
- P1：axe 发现环图容器 ARIA 角色缺失、未获点击风险色和表格次级文字对比度不足；补充 `role="img"` 并加深相关文字。
- 修复后：定向 Playwright 完成选中联动、两种视图、搜索、重置、截图和 axe；严重/关键无障碍问题为 0。

## 数据边界

- 页面真实读取入口是 `/api/marketing/projects/:projectId/dashboard` 的 `keywords` 范围聚合；实体键使用账户、推广单元和关键词 ID 保持唯一，但页面筛选层级只暴露直接所属推广单元。
- “关键词分析”只指投放关键词；用户实际搜索词属于不同报告合同，不进入本页。
- 完整示例仅在 `NEXT_PUBLIC_KEYWORD_ANALYSIS_FIXTURE=true` 时启用，并在日期旁显示“百度推广 · 开发数据 · 更新时间”。
- 标签来自 fixture 的显式标注；adapter 将标签策略作为可替换接口，生产缺失标签时显示 `—`。
- 本轮没有新增或修改真实后端接口，没有部署，也没有完成生产 Token 的真实关键词响应核对。

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
- 历史 P1：当时暂名“搜索词分析”的未实现链接被 Next.js 自动预取并产生 404；当时先关闭预取。该临时名称和路由现已退役，正式入口为“关键词分析”。
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
