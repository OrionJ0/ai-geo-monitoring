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
