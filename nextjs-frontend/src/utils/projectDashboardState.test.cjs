/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/geo/project-dashboard/page.tsx'), 'utf8');

test('project dashboard ignores stale async dashboard responses after project or period changes', () => {
  assert.match(source, /useRef/);
  assert.match(source, /const dashboardRequestRef = useRef\(0\)/);
  assert.match(source, /const invalidateDashboardRequest = \(\) =>/);
  assert.match(source, /dashboardRequestRef\.current \+= 1/);
  assert.match(source, /const handleProjectChange = \(value\) =>/);
  assert.match(source, /const handleDaysChange = \(value\) =>/);
  assert.match(source, /onChange=\{handleProjectChange\}/);
  assert.match(source, /onChange=\{handleDaysChange\}/);
  assert.match(source, /const requestId = dashboardRequestRef\.current \+ 1/);
  assert.match(source, /dashboardRequestRef\.current = requestId/);
  assert.match(source, /if \(!id\) \{[\s\S]*setDashboard\(null\);[\s\S]*setDashboardLoading\(false\);[\s\S]*return;/);
  assert.match(source, /setDashboard\(null\)[\s\S]*setDashboardLoading\(true\)/);
  assert.match(source, /if \(dashboardRequestRef\.current === requestId\) setDashboard\(res\?\.data\?\.data \|\| null\)/);
  assert.match(source, /if \(dashboardRequestRef\.current === requestId\) setDashboardLoading\(false\)/);
});

test('project dashboard uses shared active-project selection rules', () => {
  assert.match(source, /getSelectableProjects/);
  assert.match(source, /resolveSelectedProjectId/);
  assert.doesNotMatch(source, /filter\(\(item\) => item\?\.status !== 'archived'\)/);
});

test('project dashboard recent metrics expose prompt question context', () => {
  assert.match(source, /title:\s*'问题'/);
  assert.match(source, /row\?\.prompt\?\.question\s*\|\|\s*row\?\.questionRecord\?\.question/);
});

test('project dashboard competitor table shows visibility score context', () => {
  assert.match(source, /title:\s*'可见度得分'/);
  assert.match(source, /dataIndex:\s*'visibility_score'/);
});

test('project dashboard presents existing metrics in a clear decision hierarchy', () => {
  const coreIndex = source.indexOf('核心表现');
  const runIndex = source.indexOf('运行质量');
  const sourceIndex = source.indexOf('来源表现');
  const diagnosisIndex = source.indexOf('变化与诊断');
  const actionIndex = source.indexOf('行动建议');

  assert.ok(coreIndex >= 0, '核心表现分区应存在');
  assert.ok(coreIndex < runIndex, '核心表现应先于运行质量');
  assert.ok(runIndex < sourceIndex, '运行质量应先于来源表现');
  assert.ok(sourceIndex < diagnosisIndex, '来源表现应先于变化与诊断');
  assert.ok(diagnosisIndex < actionIndex, '变化与诊断应先于行动建议');

  const coreSection = source.slice(coreIndex, runIndex);
  assert.match(coreSection, /品牌提及率/);
  assert.match(coreSection, /平均声量占比（SOV）/);
  assert.match(coreSection, /推荐率/);
  assert.match(coreSection, /平均品牌排名/);
  assert.doesNotMatch(coreSection, /title="(?:总运行数|有效分析数|失败数|新增引用域名)"/);
});

test('project dashboard explains how each core metric is currently calculated', () => {
  assert.match(source, /提及品牌的有效回答数 ÷ 有效分析数/);
  assert.match(source, /提及次数、首次出现位置和明确推荐表达共同计算/);
  assert.match(source, /品牌名称附近命中“推荐、首选、优先选择”等明确表达/);
  assert.match(source, /相对已配置竞品的首次出现位置平均值/);
});

test('project dashboard keeps diagnostic indicators before the final action section', () => {
  const diagnosisIndex = source.indexOf('变化与诊断');
  const actionIndex = source.indexOf('行动建议');
  const recentMetricsIndex = source.indexOf('title="最近指标"');
  const diagnosisSection = source.slice(diagnosisIndex, actionIndex);

  assert.match(diagnosisSection, /title="竞品提及次数"/);
  assert.ok(recentMetricsIndex >= 0, '最近指标明细应保留');
  assert.ok(recentMetricsIndex < actionIndex, '行动建议应位于诊断明细之后');
  assert.match(source.slice(actionIndex), /dataSource=\{opportunities\}/);
});

test('project dashboard gives each metric level a distinct responsive visual treatment', () => {
  const cssPath = path.resolve(__dirname, '../app/geo/project-dashboard/project-dashboard.module.css');
  assert.equal(fs.existsSync(cssPath), true, '指标层级样式文件应存在');
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.match(source, /styles\.coreMetricCard/);
  assert.match(source, /styles\.supportMetricCard/);
  assert.match(source, /styles\.diagnosticMetricCard/);
  assert.match(css, /\.coreMetricCard/);
  assert.match(css, /\.supportMetricCard/);
  assert.match(css, /\.diagnosticMetricCard/);
  assert.match(css, /@media \(max-width: 640px\)/);
});
