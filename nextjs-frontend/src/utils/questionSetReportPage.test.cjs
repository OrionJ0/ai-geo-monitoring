/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.resolve(__dirname, '../app/geo/question-set-reports/page.tsx');
const historyDrawerPath = path.resolve(__dirname, '../app/geo/question-set-reports/QuestionSetRunHistoryDrawer.tsx');
const reportCssPath = path.resolve(__dirname, '../app/geo/question-set-reports/question-set-reports.module.css');
const layoutPath = path.resolve(__dirname, '../app/geo/layout.tsx');
const promptPagePath = path.resolve(__dirname, '../app/geo/prompts/page.tsx');
const dashboardCssPath = path.resolve(__dirname, '../app/geo/project-dashboard/project-dashboard.module.css');

test('问题集报告页面以运行历史和单次逐条结果为中心', () => {
  assert.equal(fs.existsSync(pagePath), true, '问题集报告页面应存在');
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /问题集报告/);
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
  const validIndex = primaryMetrics.indexOf('label="有效样本"');
  const mentionIndex = primaryMetrics.indexOf('label="品牌提及率"');
  const recommendationIndex = primaryMetrics.indexOf('label="推荐率"');
  const rankIndex = primaryMetrics.indexOf('label="平均品牌排名"');

  assert.match(source, /核心指标/);
  assert.match(source, /品牌提及率/);
  assert.match(source, /推荐率/);
  assert.match(source, /平均 SOV/);
  assert.match(source, /有效样本/);
  assert.ok(
    validIndex >= 0 && validIndex < mentionIndex && mentionIndex < recommendationIndex && recommendationIndex < rankIndex,
    '核心指标应按有效样本、品牌提及率、推荐率、平均品牌排名排序'
  );
  assert.doesNotMatch(primaryMetrics, /平均 SOV/);
  assert.match(source, /summary\.competitor_baseline_count/);
  assert.match(source, /hasCompetitorBaseline/);
  assert.match(source, /更多指标/);
  assert.match(source, /QuestionCircleOutlined/);
  assert.match(source, /tabIndex=\{0\}/);
  assert.match(source, /trigger=\{\['hover', 'focus'\]\}/);
  assert.match(source, /提及品牌的有效分析数.*有效分析数/);
  assert.match(source, /明确推荐.*有效分析数/);
  assert.match(source, /配置竞品.*相对声量/);
  assert.match(source, /实际列表项位置/);
  assert.match(source, /官网引用率/);
  assert.match(source, /summary\.owned_citation_rate/);
  assert.match(source, /summary\.total_owned_citations/);
  assert.match(source, /source\.owned/);
  assert.match(source, /品牌官网/);
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

test('问题集报告支持标准 CSV 导入导出并轮询运行中的报告', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const drawer = fs.readFileSync(historyDrawerPath, 'utf8');

  assert.match(source, /question-set-runs\/\$\{report\.id\}\/export/);
  assert.match(source, /question-set-runs\/import/);
  assert.match(source, /await file\.text\(\)/);
  assert.match(source, /report\?\.status !== 'running'/);
  assert.match(source, /setInterval[\s\S]*4000/);
  assert.match(source, /导入报告/);
  assert.match(source, /window\.print\(\)/);
  assert.match(source, /打印 \/ 导出 PDF/);
  assert.match(drawer, /<Pagination/);
  assert.match(source, /pagination\?\.totalItems/);
});

test('运行中的报告和逐模型结果使用旋转图标提示仍在处理', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  const drawer = fs.readFileSync(historyDrawerPath, 'utf8');

  assert.match(page, /LoadingOutlined/);
  assert.match(page, /<LoadingOutlined spin \/>/);
  assert.match(page, /进行中/);
  assert.match(drawer, /<LoadingOutlined spin \/>/);
});

test('问题集报告成为问题库后的主入口，旧汇总入口下沉且运行后进入独立报告', () => {
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
  assert.ok(reportIndex > promptIndex, '问题集报告应位于问题库之后');
  assert.ok(sourceIndex > reportIndex && dashboardIndex > sourceIndex, '来源分析和项目看板应按顺序位于问题集报告之后');
  assert.ok(secondaryIndex > dashboardIndex, '其他分组应位于分析入口之后');
  assert.ok(alertsIndex > secondaryIndex && noticeIndex > alertsIndex && profileIndex > noticeIndex, '其他分组内顺序应正确');
  assert.doesNotMatch(layout.slice(layout.indexOf('const menuItems'), layout.indexOf('// 未登录')), /\/geo\/reports/);
  assert.match(questionSetRunBlock, /data\.report_url/);
  assert.doesNotMatch(questionSetRunBlock, /project-dashboard/);
  assert.doesNotMatch(dashboardCss, /\.coreMetricCard::after/);
});
