const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.resolve(
  __dirname,
  '../../src/app/geo/website-traffic/page.tsx'
);
const hookPath = path.resolve(
  __dirname,
  '../../src/lib/marketing/useWebsiteTraffic.ts'
);
const manifestPath = path.resolve(
  __dirname,
  '../../../backend/modules/marketing/contracts/baidu/baidu-marketing-pilot-2026-07-30/manifest.json'
);
const formatting = require('../../src/utils/websiteTraffic.cjs');

test('website traffic comparison formatting distinguishes percent, points, duration and pages', () => {
  assert.equal(formatting.formatPercentChange('12.3'), '+12.3%');
  assert.equal(formatting.formatPointChange('-1.8'), '-1.8 个百分点');
  assert.equal(formatting.formatDurationChange('18'), '+00:18');
  assert.equal(formatting.formatPagesChange('0.17'), '+0.17 页');
  assert.equal(formatting.formatRate('0'), '0.0%');
  assert.equal(formatting.groupDigits('0'), '0');
  assert.equal(formatting.groupDigits(null), '—');
});

test('website traffic page uses only server-side website traffic contracts', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const hook = fs.readFileSync(hookPath, 'utf8');

  assert.match(source, /useDefaultProjectContext/);
  assert.match(source, /capabilities\.trafficRead/);
  assert.match(hook, /website-traffic-overview/);
  assert.match(hook, /website-traffic-pages/);
  assert.match(hook, /assertWebsiteTrafficOverview\(response\.data, query\)/);
  assert.match(hook, /assertWebsitePageReport\(response\.data, query\)/);
  assert.doesNotMatch(source + hook, /api\.baidu\.com|accessToken|tongji_site_id/);
  assert.doesNotMatch(source + hook, /\/dashboard|\/refresh-runs/);
});

test('page keeps fixed information architecture and honest missing states', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  for (const heading of [
    '周期汇总',
    '网站访问趋势',
    '来源质量',
    '页面表现'
  ]) assert.match(source, new RegExp(heading));
  assert.match(source, /入口页面/);
  assert.match(source, /受访页面/);
  assert.match(source, /dataState === 'UNAVAILABLE'/);
  assert.match(source, /selectedMetricState === 'UNAVAILABLE'/);
  assert.match(source, /不以 0 或模拟数据代替/);
  assert.match(source, /查看每日趋势等价数据/);
  assert.match(source, /row\.title \|\| '—'/);
  assert.doesNotMatch(source, /未命名页面/);
  assert.doesNotMatch(source, /客服咨询|线索|订单|成交金额|ROAS|CPA|CPL/);
});

test('source selection has keyboard and non-color state plus explicit all-source recovery', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /aria-selected/);
  assert.match(source, /event\.key === 'Enter'/);
  assert.match(source, /已选择/);
  assert.match(source, /恢复全部来源/);
  assert.match(source, /setSource\('ALL'\)/);
  assert.match(source, /setSource\(row\.sourceKey\)/);
});

test('page views replace columns and support search, sorting and server pagination', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  for (const field of [
    'contributionPageviews',
    'averageVisitPages',
    'averageStayTime',
    'downstreamPageviews',
    'exitRate'
  ]) assert.match(source, new RegExp(field));
  assert.match(source, /onSearch/);
  assert.match(source, /sortBy/);
  assert.match(source, /total: pages\.data\.pagination\.totalItems/);
  assert.match(source, /Tooltip title=\{row\.path\} trigger=\{\['hover', 'focus'\]\}/);
  assert.match(source, /className=\{styles\.pagePath\} tabIndex=\{0\}/);
});

test('hooks isolate late requests and expose loading, error and cache fallback states', () => {
  const hook = fs.readFileSync(hookPath, 'utf8');
  const page = fs.readFileSync(pagePath, 'utf8');

  assert.equal((hook.match(/requestVersion/g) || []).length >= 8, true);
  assert.match(hook, /requestVersion\.current !== version/);
  assert.match(hook, /setLoading\(true\)/);
  assert.match(hook, /setError/);
  assert.match(page, /cache\.state === 'FALLBACK'/);
  assert.match(page, /Skeleton/);
  assert.match(page, /<Empty/);
  assert.match(page, /type="error"/);
});

test('quality and page reports are enabled only after real-account response verification', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.deepEqual(manifest.tongji.qualityMetrics.metrics, [
    'bounce_ratio',
    'avg_visit_time',
    'avg_visit_pages'
  ]);
  assert.equal(manifest.tongji.qualityMetrics.runtimeEnabled, true);
  assert.equal(manifest.tongji.qualityMetrics.responseShapeVerified, true);
  assert.equal(manifest.tongji.sourceReports.runtimeEnabled, true);
  assert.equal(manifest.tongji.sourceReports.responseShapeVerified, true);
  assert.equal(manifest.tongji.pageReports.runtimeEnabled, true);
  assert.equal(manifest.tongji.pageReports.responseShapeVerified, true);
  assert.equal(manifest.tongji.pageReports.paginationVerified, true);
  assert.equal(manifest.tongji.pageReports.landing.reportMethod, 'visit/landingpage/a');
  assert.equal(manifest.tongji.pageReports.visited.reportMethod, 'visit/toppage/a');
});
