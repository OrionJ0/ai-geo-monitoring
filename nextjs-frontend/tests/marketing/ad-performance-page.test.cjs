const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(
  path.join(frontendRoot, relativePath),
  'utf8'
);

const pageSource = read('src/app/geo/ad-performance/page.tsx');
const styleSource = read(
  'src/app/geo/ad-performance/ad-performance.module.css'
);
const hookSource = read('src/lib/marketing/useAdPerformance.ts');
const dashboardReaderSource = read('src/lib/marketing/readMarketingDashboard.ts');
const adapterSource = read('src/lib/marketing/adPerformanceAdapter.ts');
const fixtureSource = read('src/fixtures/adPerformance.fixture.ts');

test('advertising page uses the default project and the real read-only dashboard endpoint', () => {
  assert.match(pageSource, /useDefaultProjectContext/);
  assert.match(pageSource, /defaultContext\.project\?\.id/);
  assert.match(dashboardReaderSource, /\/dashboard/);
  assert.match(dashboardReaderSource, /axios\.get<MarketingDashboardResponse>/);
  assert.match(dashboardReaderSource, /DASHBOARD_DATE_OUT_OF_RANGE/);
  assert.match(dashboardReaderSource, /clampMarketingDateRange/);
  assert.match(hookSource, /onDateRangeAdjusted\?\.\(response\.effectiveDateRange\)/);
  assert.match(hookSource, /assertMarketingDashboardResponse\(response\.data, projectId\)/);
  assert.match(hookSource, /marketingSnapshotWarning\(response\.data\)/);
  assert.match(pageSource, /performance\.warning/);
  assert.match(adapterSource, /MARKETING_DASHBOARD_RESPONSE_INVALID/);
  assert.match(adapterSource, /value\.projectId !== expectedProjectId/);
  assert.match(adapterSource, /value\.revision !== null/);
  assert.doesNotMatch(adapterSource, /return '0';/);
  assert.doesNotMatch(hookSource + dashboardReaderSource, /axios\.(?:post|put|patch|delete)\(/);
  assert.doesNotMatch(pageSource, /立即刷新|最后成功|更新时间|前往百度/);
});

test('page follows the approved breadcrumb, date, summary, trend, and drilldown order', () => {
  const breadcrumb = pageSource.indexOf("{ title: '首页' }");
  const summary = pageSource.indexOf('周期汇总指标');
  const trend = pageSource.indexOf("selectedNode?.name || '总体'");
  const drilldown = pageSource.indexOf('<h2>结构下钻</h2>');

  assert.ok(breadcrumb >= 0 && breadcrumb < summary);
  assert.ok(summary < trend && trend < drilldown);
  assert.match(pageSource, /广告表现日期范围/);
  assert.match(pageSource, /<MarketingPageFilters/);
  assert.match(pageSource, /availableDevices=\{\['all'\]\}/);
  assert.match(pageSource, /总消费/);
  assert.match(pageSource, /总展现/);
  assert.match(pageSource, /总点击/);
  assert.doesNotMatch(pageSource, /<h1/);
  assert.doesNotMatch(pageSource, /总预算/);
});

test('trend offers exactly the five advertising metrics and one selected object', () => {
  ['消费', '展现', '点击', 'CTR', '平均 CPC'].forEach((label) => {
    assert.match(pageSource, new RegExp(`label: '${label.replace(' ', '\\s')}'`));
  });
  assert.match(pageSource, /currentPeriodLabel/);
  assert.match(pageSource, /previousPeriodLabel/);
  assert.match(pageSource, /lineDash/);
  assert.match(pageSource, /返回总体/);
  assert.match(pageSource, /current === record\.key \? null : record\.key/);
  assert.doesNotMatch(pageSource, /selectedNodeKeys|rowSelection/);
  assert.match(adapterSource, /currentTrend: normalizeTrend\(campaign\.trend\)/);
  assert.match(adapterSource, /currentTrend: normalizeTrend\(adGroup\.trend\)/);
  assert.match(adapterSource, /currentTrend: normalizeTrend\(keyword\.trend\)/);
});

test('drilldown table keeps the required columns, hierarchy filters, and parent paths', () => {
  [
    '名称', '状态', '预算', '消费', '展现', '点击', 'CTR', '平均 CPC', '详情'
  ].forEach((title) => assert.match(pageSource, new RegExp(`title: '${title}'`)));
  ['全部层级', '仅项目', '仅计划', '仅单元', '仅关键词'].forEach((label) => {
    assert.match(pageSource, new RegExp(`label: '${label}'`));
  });
  assert.match(pageSource, /filterTree/);
  assert.match(pageSource, /node\.id\.toLocaleLowerCase/);
  assert.match(pageSource, /sortTree/);
  assert.match(pageSource, /event\.stopPropagation\(\)/);
  assert.match(pageSource, /indentSize: 32/);
  assert.match(pageSource, /<Tooltip[\s\S]*title=\{name\}/);
  assert.match(styleSource, /\.nameCell[\s\S]*text-overflow: ellipsis/);
  assert.match(styleSource, /\.leafConnector::before[\s\S]*border-left/);
  assert.match(styleSource, /\.selectedRow[\s\S]*#e6f4ff/);
});

test('detail popover is viewport-aware, hover-only, and escape-closeable', () => {
  assert.match(pageSource, /<Popover/);
  assert.match(pageSource, /trigger=\{\['hover'\]\}/);
  assert.doesNotMatch(pageSource, /trigger=\{\['hover', 'focus'\]\}/);
  assert.match(pageSource, /autoAdjustOverflow/);
  assert.match(pageSource, /aria-describedby=\{descriptionId\}/);
  assert.match(pageSource, /event\.key === 'Escape'/);
  assert.match(pageSource, /mouseLeaveDelay/);
  assert.doesNotMatch(pageSource, /Drawer|Modal|进入详情页/);
});

test('real adapter builds the complete strict advertising hierarchy and fixture stays isolated', () => {
  assert.match(adapterSource, /source: 'dashboard'/);
  assert.match(adapterSource, /dashboard\.campaigns/);
  assert.match(adapterSource, /dashboard\.adGroups/);
  assert.match(adapterSource, /dashboard\.keywords/);
  assert.match(adapterSource, /level: 'scheme'/);
  assert.match(adapterSource, /level: 'unit'/);
  assert.match(adapterSource, /level: 'keyword'/);
  assert.match(adapterSource, /targetingType/);
  assert.match(adapterSource, /budgetAmountScaled: null/);
  assert.match(adapterSource, /currentTrend: \[\]/);
  assert.match(adapterSource, /\{ label: '投放设备', value: '—' \}/);
  assert.match(fixtureSource, /source: 'development-fixture'/);
  assert.match(fixtureSource, /\{ label: '下属方案数', value: '2' \}/);
  assert.doesNotMatch(fixtureSource, /scheme:perimeter-brand|周界报警品牌词/);
  assert.match(hookSource, /NEXT_PUBLIC_AD_PERFORMANCE_FIXTURE/);
  assert.match(hookSource, /process\.env\.NODE_ENV !== 'production'/);
  assert.match(hookSource, /fixtureEnabled = AD_PERFORMANCE_FIXTURE_ENABLED/);
  assert.match(pageSource, /process\.env\.NODE_ENV !== 'production'/);
  assert.match(pageSource, /get\('fixture'\)[\s\S]*=== 'ad-performance'/);
  assert.doesNotMatch(pageSource, /42752800|8566634|49648/);
});

test('ratio formatting guards zero denominators and the page excludes funnel metrics', () => {
  assert.match(pageSource, /impressions === BigInt\(0\)/);
  assert.match(pageSource, /clicks === BigInt\(0\)/);
  assert.match(pageSource, /return '—'/);
  assert.doesNotMatch(
    `${pageSource}\n${fixtureSource}`,
    /客服咨询|线索入池|订单|成交金额|转化漏斗|CPL|CPA|ROAS|TOP5|异常诊断/
  );
});
