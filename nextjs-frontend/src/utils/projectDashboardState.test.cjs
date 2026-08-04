/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/geo/project-dashboard/page.tsx'), 'utf8');

test('AI search performance ignores stale async responses after period or platform changes', () => {
  assert.match(source, /useRef/);
  assert.match(source, /const dashboardRequestRef = useRef\(0\)/);
  assert.match(source, /const invalidateDashboardRequest = \(\) =>/);
  assert.match(source, /dashboardRequestRef\.current \+= 1/);
  assert.match(source, /const handleDaysChange = \(value\) =>/);
  assert.match(source, /const \[platform, setPlatform\] = useState\('all'\)/);
  assert.match(source, /const handlePlatformChange = \(value\) =>/);
  assert.match(source, /onChange=\{handleDaysChange\}/);
  assert.match(source, /onChange=\{handlePlatformChange\}/);
  assert.match(source, /const requestId = dashboardRequestRef\.current \+ 1/);
  assert.match(source, /dashboardRequestRef\.current = requestId/);
  assert.match(source, /if \(!id\) \{[\s\S]*setDashboard\(null\);[\s\S]*setDashboardLoading\(false\);[\s\S]*return;/);
  const daysHandler = source.slice(
    source.indexOf('const handleDaysChange'),
    source.indexOf('const handlePlatformChange')
  );
  const platformHandler = source.slice(
    source.indexOf('const handlePlatformChange'),
    source.indexOf('const fetchDashboard')
  );
  assert.doesNotMatch(daysHandler, /setDashboard\(null\)/);
  assert.doesNotMatch(platformHandler, /setDashboard\(null\)/);
  assert.match(daysHandler, /setDashboardLoading\(true\)/);
  assert.match(platformHandler, /setDashboardLoading\(true\)/);
  assert.match(source, /params:\s*\{\s*days:\s*targetDays,\s*platform:\s*targetPlatform\s*\}/);
  assert.match(source, /if \(dashboardRequestRef\.current === requestId\) setDashboard\(res\?\.data\?\.data \|\| null\)/);
  assert.match(source, /if \(dashboardRequestRef\.current === requestId\) setDashboardLoading\(false\)/);
});

test('project dashboard defaults to merged platforms and renders versioned answer-level SOV without pseudo zero', () => {
  assert.match(source, /available_platforms/);
  assert.match(source, /selected_platform/);
  assert.match(source, /全部平台（合并）/);
  assert.match(source, /回答内竞品提及占比（SOV）/);
  assert.match(source, /sov_summary/);
  assert.match(source, /analysis_coverage_rate/);
  assert.match(source, /有效回答/);
  assert.match(source, /—（有效回答/);
  assert.doesNotMatch(source, /N\/A/);
  assert.doesNotMatch(source, /summary\.avg_share_of_voice/);
  assert.doesNotMatch(source, /dataIndex:\s*'share_of_voice'/);
});

test('AI search performance uses only the explicit default project context', () => {
  assert.match(source, /useDefaultProjectContext/);
  assert.match(source, /defaultContext\.project\?\.id/);
  assert.match(source, /defaultContext\.errorMessage/);
  assert.doesNotMatch(source, /getSelectableProjects/);
  assert.doesNotMatch(source, /resolveSelectedProjectId/);
  assert.doesNotMatch(source, /axios\.get\(['"]\/api\/geo-projects['"]\)/);
  assert.doesNotMatch(source, /project_id/);
  assert.doesNotMatch(source, /placeholder="选择品牌项目"/);
  assert.match(source, /获取总体表现失败/);
});

test('project dashboard recent metrics expose prompt question context', () => {
  assert.match(source, /title:\s*'问题'/);
  assert.match(source, /row\?\.prompt\?\.question\s*\|\|\s*row\?\.questionRecord\?\.question/);
});

test('project dashboard competitor table shows contextual mention evidence', () => {
  assert.match(source, /title:\s*'提及次数'/);
  assert.match(source, /title:\s*'出现回答数'/);
  assert.match(source, /dataIndex:\s*'appeared_answers'/);
  assert.doesNotMatch(source, /dataIndex:\s*'visibility_score'/);
});

test('project dashboard presents existing metrics in a clear decision hierarchy', () => {
  const coreIndex = source.indexOf('核心表现');
  const trendIndex = source.indexOf('表现趋势');
  const runIndex = source.indexOf('运行质量');
  const sourceIndex = source.indexOf('来源表现');
  const sourceStructureIndex = source.indexOf('来源结构');
  const diagnosisIndex = source.indexOf('变化与诊断');
  const actionIndex = source.indexOf('行动建议');

  assert.ok(coreIndex >= 0, '核心表现分区应存在');
  assert.ok(coreIndex < trendIndex, '核心表现应先于表现趋势');
  assert.ok(trendIndex < runIndex, '表现趋势应先于运行质量');
  assert.ok(runIndex < sourceIndex, '运行质量应先于来源表现');
  assert.ok(sourceIndex < sourceStructureIndex, '来源表现应先于来源结构');
  assert.ok(sourceStructureIndex < diagnosisIndex, '来源结构应先于变化与诊断');
  assert.ok(diagnosisIndex < actionIndex, '变化与诊断应先于行动建议');

  const coreSection = source.slice(coreIndex, runIndex);
  assert.match(coreSection, /品牌提及率/);
  assert.match(coreSection, /回答内竞品提及占比（SOV）/);
  assert.match(coreSection, /推荐率/);
  assert.doesNotMatch(coreSection, /平均排名/);
  assert.doesNotMatch(coreSection, /title="(?:总运行数|有效分析数|失败数|新增引用域名)"/);
});

test('project dashboard explains how each core metric is currently calculated', () => {
  assert.match(source, /提及目标品牌的有效回答数 ÷ 有效回答数/);
  assert.match(source, /目标品牌提及数 ÷ 品牌与竞品提及总数/);
  assert.match(source, /再按回答取平均/);
  assert.match(source, /明确推荐目标品牌的有效回答数 ÷ 有效回答数/);
  assert.match(source, /明确给出顺序或名次的多品牌榜单/);
});

test('project dashboard keeps diagnostic indicators before the final action section', () => {
  const diagnosisIndex = source.indexOf('变化与诊断');
  const actionIndex = source.indexOf('行动建议');
  const recentMetricsIndex = source.indexOf('title="最近指标"');
  const diagnosisSection = source.slice(diagnosisIndex, actionIndex);

  assert.match(diagnosisSection, /title="竞品提及次数"/);
  assert.match(diagnosisSection, /明确有序榜单平均排名/);
  assert.ok(recentMetricsIndex >= 0, '最近指标明细应保留');
  assert.ok(recentMetricsIndex < actionIndex, '行动建议应位于诊断明细之后');
  assert.match(source.slice(actionIndex), /dataSource=\{opportunities\}/);
  assert.match(diagnosisSection, /href="\/geo\/sources"/);
  assert.doesNotMatch(diagnosisSection, /scroll=\{\{ x: 930 \}\}/);
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
  assert.match(css, /\.diagnosticRows > :global\(\.ant-col\)\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.diagnosticRows > :global\(\.ant-col\) > :global\(\.ant-card\)\s*\{[^}]*height:\s*100%/);
  assert.match(css, /@media \(max-width: 640px\)/);
});

test('project dashboard sections avoid decorative pseudo-element rails', () => {
  const styles = fs.readFileSync(
    path.resolve(__dirname, '../app/geo/project-dashboard/project-dashboard.module.css'),
    'utf8',
  );

  assert.doesNotMatch(styles, /\.metricSection::before/);
  assert.doesNotMatch(styles, /\.coreSection::before/);
  assert.doesNotMatch(styles, /\.actionSection::before/);
});
