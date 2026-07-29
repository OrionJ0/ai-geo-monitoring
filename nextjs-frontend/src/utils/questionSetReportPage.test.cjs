/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.resolve(__dirname, '../app/geo/question-set-reports/page.tsx');
const historyDrawerPath = path.resolve(__dirname, '../app/geo/question-set-reports/QuestionSetRunHistoryDrawer.tsx');
const reportCssPath = path.resolve(__dirname, '../app/geo/question-set-reports/question-set-reports.module.css');
const presentationPath = path.resolve(__dirname, 'questionSetRunPresentation.cjs');
const layoutPath = path.resolve(__dirname, '../app/geo/layout.tsx');
const promptPagePath = path.resolve(__dirname, '../app/geo/prompts/page.tsx');
const dashboardCssPath = path.resolve(__dirname, '../app/geo/project-dashboard/project-dashboard.module.css');

test('运行报告页面以运行历史和单次逐条结果为中心', () => {
  assert.equal(fs.existsSync(pagePath), true, '运行报告页面应存在');
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /运行报告/);
  assert.match(source, /运行历史/);
  assert.match(source, /逐问题结果/);
  assert.match(source, /question-set-runs/);
  assert.match(source, /summary\.total/);
  assert.match(source, /dataSource=\{report\.rows/);
});

test('问题集报告分级展示指标并给出可聚焦的口径说明', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const primaryStart = source.indexOf(`className={styles.primaryMetrics}`);
  const primaryEnd = source.indexOf(`className={styles.metricsCollapse}`, primaryStart);
  const primaryMetrics = source.slice(primaryStart, primaryEnd);
  const validIndex = primaryMetrics.indexOf(`? '分析覆盖率'`);
  const mentionIndex = primaryMetrics.indexOf('label="品牌提及率"');
  const recommendationIndex = primaryMetrics.indexOf('label="推荐率（AI 语义分析）"');

  assert.match(source, /核心指标/);
  assert.match(source, /品牌提及率/);
  assert.match(source, /推荐率/);
  assert.match(source, /平均 SOV/);
  assert.match(source, /分析覆盖率/);
  assert.ok(
    validIndex >= 0 && validIndex < mentionIndex && mentionIndex < recommendationIndex,
    '核心指标应按分析覆盖率、品牌提及率、推荐率排序'
  );
  assert.doesNotMatch(primaryMetrics, /平均排名/);
  assert.doesNotMatch(primaryMetrics, /平均 SOV/);
  assert.match(source, /summary\.sov_summary/);
  assert.match(source, /hasCompetitorBaseline/);
  assert.match(source, /更多指标/);
  assert.match(source, /QuestionCircleOutlined/);
  assert.match(source, /tabIndex=\{0\}/);
  assert.match(source, /trigger=\{\['hover', 'focus'\]\}/);
  assert.match(source, /分析模型先把目标品牌显式映射.*程序计数.*分析模型不直接返回/);
  assert.match(source, /程序根据明确推荐关系计算/);
  assert.match(source, /目标品牌实际提及次数.*AI 判定竞品.*等权平均/);
  assert.match(source, /至少包含 2 个不同实体、且回答明确给出顺序或名次/);
  assert.match(source, /短实体词.*原回答/);
  assert.match(source, /AI 结构化/);
  assert.match(source, /历史规则/);
  assert.match(source, /这份历史报告包含旧规则指标/);
  assert.match(source, /不代表当前结构化口径/);
  assert.match(source, /识别到的品牌 \/ 公司 \/ 其他组织/);
  assert.match(source, /目标品牌映射/);
  assert.match(source, /候选顺序/);
  assert.match(source, /待核验事实声明/);
  assert.match(source, /analysis_structure/);
  assert.match(source, /analysis_diagnostics/);
  assert.match(source, /错误代码/);
  assert.match(source, /输出长度/);
  assert.match(source, /官网引用率/);
  assert.match(source, /summary\.owned_citation_rate/);
  assert.match(source, /summary\.total_owned_citations/);
  assert.match(source, /source\.owned/);
  assert.match(source, /品牌官网/);
  assert.match(source, /引用源（计入核心 KPI）/);
  assert.match(source, /回答正文链接（不计入 KPI）/);
  assert.match(source, /平台检索候选（不计入 KPI）/);
  assert.match(source, /分析模型补充来源（不计入 KPI）/);
  assert.match(source, /历史混合来源.*不计入引用 KPI/);
  assert.match(source, /有效分析.*引用/);
  assert.doesNotMatch(source, /明确引用/);
});

test('v4 单回答详情展示回答内竞品提及占比及可复核语义证据', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /metric_semantics_version/);
  assert.match(source, /kind\?: 'contextual_competitor_mentions'/);
  assert.match(source, /status\?: 'calculated' \| 'not_applicable'/);
  assert.match(source, /numerator\?: number \| null/);
  assert.match(source, /denominator\?: number \| null/);
  assert.match(source, /competition_entities/);
  assert.match(source, /回答内竞品提及占比（SOV）/);
  assert.match(source, /formatAnswerSov/);
  assert.match(source, /AI 结构化 v4/);
  assert.match(source, /other_organization/);
  assert.match(source, /其他组织/);
  assert.match(source, /竞品判断/);
  assert.match(source, /entity\.relation === 'competitor'/);
  assert.match(source, /entity\.mentions/);
  assert.match(source, /entity\.reason/);
  assert.match(source, /entity\.evidence/);
  assert.match(source, /list\.evidence/);
  assert.match(source, /analysis_structure\?\.sentiment\?\.evidence/);
  assert.match(source, /情绪依据/);
});

test('新口径运行用已采集回答计算并展示分析覆盖率', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /acquired_answers/);
  assert.match(source, /analysis_coverage_rate/);
  assert.match(source, /\? '分析覆盖率'/);
  assert.match(source, /formatAnalysisCoverage/);
  assert.match(source, /成功分析数.*已采集回答数/);
  assert.doesNotMatch(source, /label="有效样本"/);
});

test('新版品牌率在没有有效分析时显示 N/A 而不是 0%', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /function formatCurrentRate/);
  assert.match(source, /value == null \|\| safeDenominator === 0/);
  assert.match(source, /formatCurrentRate\(\s*summary\.brand_mention_rate/);
  assert.match(source, /formatCurrentRate\(\s*summary\.recommendation_rate/);
});

test('正式页面只通过版本化 SOV 契约展示新旧聚合', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /sov_summary/);
  assert.match(source, /contextual_competitor_mentions/);
  assert.match(source, /回答内竞品提及占比（SOV）/);
  assert.match(source, /有效回答/);
  assert.match(source, /历史竞品配置口径/);
  assert.match(source, /brand_mentioned_answers/);
  assert.match(source, /recommended_answers/);
  assert.match(source, /ranked_answers/);
  assert.doesNotMatch(source, /summary\.avg_share_of_voice/);
  assert.match(source, /competitionEntityRow/);
  assert.match(source, /data-pdf-breakpoint="true"/);
});

test('问题集运行历史从右侧抽屉打开，主页面只保留单次报告', () => {
  assert.equal(fs.existsSync(historyDrawerPath), true, '问题集历史抽屉组件应存在');
  const page = fs.readFileSync(pagePath, 'utf8');
  const drawer = fs.readFileSync(historyDrawerPath, 'utf8');

  assert.match(page, /HistoryOutlined/);
  assert.match(page, /QuestionSetRunHistoryDrawer/);
  assert.match(page, /历史报告/);
  assert.doesNotMatch(page, /<Col(?:\s|>)/);
  assert.doesNotMatch(page, /historyPanel/);
  assert.match(drawer, /<Drawer/);
  assert.match(drawer, /placement="right"/);
});

test('历史抽屉可以搜索并按问题集筛选完整历史', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  const drawer = fs.readFileSync(historyDrawerPath, 'utf8');

  assert.match(page, /\/question-sets/);
  assert.match(page, /questionSetId: targetQuestionSetId/);
  assert.match(page, /historyQuestionSetId/);
  assert.match(drawer, /showSearch/);
  assert.match(drawer, /optionFilterProp="label"/);
  assert.match(drawer, /placeholder="全部问题集"/);
  assert.match(drawer, /onQuestionSetChange/);
});

test('历史筛选说明的布局不会把问题集下拉框拆成两行', () => {
  const css = fs.readFileSync(reportCssPath, 'utf8');

  assert.doesNotMatch(css, /\.historyFilter\s*>\s*div\s*\{/);
  assert.match(css, /\.historyFilter\s*>\s*div:first-child\s*\{/);
});

test('运行报告支持标准 CSV 导入导出并按可见性降频轮询', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const drawer = fs.readFileSync(historyDrawerPath, 'utf8');
  const pollingStart = source.indexOf('const pollInterval');
  const pollingEnd = source.indexOf('const nextState = report', pollingStart);
  const pollingEffect = source.slice(pollingStart, pollingEnd);

  assert.match(source, /question-set-runs\/\$\{report\.id\}\/export/);
  assert.match(source, /question-set-runs\/import/);
  assert.match(source, /await file\.text\(\)/);
  assert.match(source, /report\?\.status !== 'running'/);
  assert.match(pollingEffect, /report\?\.status === 'paused' \? 30_000 : 10_000/);
  assert.match(pollingEffect, /visibilitychange/);
  assert.match(pollingEffect, /document\.visibilityState !== 'visible'/);
  assert.doesNotMatch(pollingEffect, /loadHistory/);
  assert.match(source, /已开始调度的任务完成后暂停/);
  assert.match(source, /导入报告/);
  assert.match(source, /downloadQuestionSetReportPdf/);
  assert.match(source, /导出 PDF/);
  assert.match(source, /FilePdfOutlined/);
  assert.doesNotMatch(source, /window\.print\(\)|打印 \/ 导出 PDF|PrinterOutlined/);
  assert.match(fs.readFileSync(reportCssPath, 'utf8'), /\.pdfLayout\s*\{[\s\S]*width:\s*980px/);
  assert.match(source, /scroll=\{\{ x: pdfLayout \? 880 : 1080 \}\}/);
  assert.match(source, /showExpandColumn:\s*!pdfLayout/);
  assert.match(source, /expandedRowKeys:\s*pdfLayout/);
  assert.match(source, /data-pdf-breakpoint="true"/);
  assert.match(source, /styles\.pdfAnswerLine/);
  assert.match(drawer, /<Pagination/);
  assert.match(source, /pagination\?\.totalItems/);
});

test('原生问题集报告可以确认后重试失败项', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /retry-failed/);
  assert.match(source, /重试失败项/);
  assert.match(source, /Popconfirm/);
  assert.match(source, /当前设置中心的监测模型和参数/);
  assert.match(source, /import \{ createIdempotencyKey \}/);
  assert.match(source, /const idempotencyKey = createIdempotencyKey\(\)/);
  assert.doesNotMatch(source, /window\.crypto\.randomUUID\(\)/);
  assert.match(source, /idempotency_key/);
  assert.match(source, /已有完整原回答/);
  assert.match(source, /任一所选 Web 平台登录或采集能力不可用时，整次重试不会创建新任务/);
  assert.doesNotMatch(source, /不可用平台会跳过/);
  assert.match(source, /summary\.failed/);
  assert.match(source, /setRetrying/);
  assert.match(source, /report\.capabilities\?\.can_retry/);
  assert.match(source, /getWebPreflightPrompt/);
  assert.match(source, /Modal\.confirm/);
  assert.match(source, /去设置登录/);
  assert.match(source, /report\.capabilities\?\.can_pause/);
  assert.match(source, /report\.capabilities\?\.can_resume/);
  assert.match(source, /retry_disabled_reason/);
  assert.doesNotMatch(
    source,
    /report\.source === 'native'[\s\S]{0,160}report\.status !== 'running'/
  );
});

test('partial、快照和导入报告共用一致的状态说明', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const presentation = fs.readFileSync(presentationPath, 'utf8');

  assert.match(source, /execution_summary/);
  assert.match(source, /getRunStateNotice/);
  assert.match(presentation, /failure_stages/);
  assert.match(presentation, /主要失败阶段/);
  assert.match(presentation, /导入的只读报告/);
  assert.match(presentation, /历史报告仅保留快照/);
});

test('运行报告明确展示未参与运行的平台和处理入口', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /skipped_platforms/);
  assert.match(source, /formatSkippedPlatforms/);
  assert.match(source, /部分监测平台未参与本次运行/);
  assert.match(source, /当前报告计数不包含它们/);
  assert.match(source, /前往设置中心/);
});

test('运行中的报告和逐模型结果使用旋转图标提示仍在处理', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  const drawer = fs.readFileSync(historyDrawerPath, 'utf8');

  assert.match(page, /LoadingOutlined/);
  assert.match(page, /<LoadingOutlined spin \/>/);
  assert.match(page, /进行中/);
  assert.match(drawer, /<LoadingOutlined spin \/>/);
});

test('运行报告成为问题库后的主入口，旧汇总入口下沉且运行后进入独立报告', () => {
  const layout = fs.readFileSync(layoutPath, 'utf8');
  const prompts = fs.readFileSync(promptPagePath, 'utf8');
  const questionSetRunStart = prompts.indexOf('const runQuestionSet');
  const questionSetRunEnd = prompts.indexOf('const deletePrompt', questionSetRunStart);
  const questionSetRunBlock = prompts.slice(questionSetRunStart, questionSetRunEnd);
  const dashboardCss = fs.readFileSync(dashboardCssPath, 'utf8');
  const promptIndex = layout.indexOf("key: '/prompts'");
  const reportIndex = layout.indexOf("key: '/question-set-reports'");
  const projectIndex = layout.indexOf("key: '/projects'");
  const seoIndex = layout.indexOf("key: '/seo-audit'");
  const sourceIndex = layout.indexOf("key: '/sources'");
  const dashboardIndex = layout.indexOf("key: '/project-dashboard'");
  const secondaryIndex = layout.indexOf("label: '其他'");
  const alertsIndex = layout.indexOf("key: '/alerts'");
  const noticeIndex = layout.indexOf("key: '/notice'");
  const profileIndex = layout.indexOf("key: '/profile'");

  assert.ok(projectIndex >= 0, '品牌项目入口应存在');
  assert.ok(promptIndex >= 0, '问题库入口应存在');
  assert.ok(questionSetRunStart >= 0 && questionSetRunEnd > questionSetRunStart, '应找到问题集运行处理函数');
  assert.ok(seoIndex > projectIndex && promptIndex > seoIndex, 'SEO 检测应位于品牌项目和问题库之间');
  assert.ok(reportIndex > promptIndex, '运行报告应位于问题库之后');
  assert.ok(sourceIndex > reportIndex && dashboardIndex > sourceIndex, '来源分析和项目看板应按顺序位于运行报告之后');
  assert.ok(secondaryIndex > dashboardIndex, '其他分组应位于分析入口之后');
  assert.ok(alertsIndex > secondaryIndex && noticeIndex > alertsIndex && profileIndex > noticeIndex, '其他分组内顺序应正确');
  assert.doesNotMatch(layout.slice(layout.indexOf('const menuItems'), layout.indexOf('// 未登录')), /\/geo\/reports/);
  assert.match(questionSetRunBlock, /data\.report_url/);
  assert.match(prompts, /const questionSetRunIdempotencyRef = useRef\(new Map\(\)\)/);
  assert.match(questionSetRunBlock, /questionSetRunIdempotencyRef\.current\.get\(idempotencyScope\)/);
  assert.match(questionSetRunBlock, /createIdempotencyKey\(\)/);
  assert.match(questionSetRunBlock, /idempotency_key:\s*idempotencyKey/);
  assert.match(questionSetRunBlock, /'Idempotency-Key':\s*idempotencyKey/);
  assert.match(questionSetRunBlock, /data\.idempotent_replay/);
  assert.doesNotMatch(questionSetRunBlock, /project-dashboard/);
  assert.doesNotMatch(dashboardCss, /\.coreMetricCard::after/);
});
