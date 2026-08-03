const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.resolve(
  __dirname,
  '../../src/app/geo/market-overview/page.tsx'
);
const hookPath = path.resolve(
  __dirname,
  '../../src/lib/marketing/useMarketOverview.ts'
);
const cssPath = path.resolve(
  __dirname,
  '../../src/app/geo/market-overview/market-overview.module.css'
);

test('overview independently settles advertising, traffic and traffic-source reads', () => {
  const source = fs.readFileSync(hookPath, 'utf8');

  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /\/dashboard/);
  assert.match(source, /\/tongji-trend/);
  assert.match(source, /\/tongji-source-trends/);
  assert.match(source, /ad:\s*SourceSlot/);
  assert.match(source, /traffic:\s*SourceSlot/);
  assert.match(source, /trafficSources:\s*SourceSlot/);
});

test('overview implements the final three-section visual hierarchy', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, />投放效率</);
  assert.match(source, />来源全链路</);
  assert.match(source, />每日趋势</);
  assert.doesNotMatch(source, />全链路概览|>投入与流量趋势|>需要关注/);
  assert.doesNotMatch(source, /数据已更新|数据正常|最新|实时/);
});

test('efficiency keeps four standalone KPI cards and honest missing values', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  for (const metric of ['ROAS', 'CPL', 'CPA', 'CPC']) {
    assert.match(source, new RegExp(`key: '${metric}'`));
  }
  assert.match(source, /className=\{styles\.efficiencySection\}/);
  assert.match(source, /className=\{styles\.kpiGrid\}/);
  assert.match(source, /本期/);
  assert.match(source, /上期/);
  assert.match(source, /较上一周期/);
  assert.doesNotMatch(source, /9\.86|264\.69|2074\.84|5\.96/);
});

test('journey uses fixed stages and never fabricates unsupported attribution', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  for (const column of [
    '来源',
    '广告投入',
    '展现',
    '访问（点击）',
    '客服咨询',
    '线索入池',
    '成交结果',
    '全链路'
  ]) {
    assert.match(source, new RegExp(column));
  }
  assert.match(source, /可信的按来源关联/);
  assert.match(source, /className=\{styles\.microFunnel\}/);
  assert.doesNotMatch(source, /百度自然搜索|必应自然搜索/);
  assert.doesNotMatch(source, /订单数量|成交订单数/);
});

test('journey adds Baidu Tongji source rows as visit-only evidence', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /overview\.trafficSources/);
  assert.match(source, /source\.sourceLabel/);
  assert.match(source, /sourceTotals\.visits/);
  assert.match(source, /WEBSITE_TRAFFIC_SOURCE/);
  assert.match(source, /不是跨系统归因/);
  assert.doesNotMatch(source, /sourceTotals\.visits[^\n]+(?:客服咨询|线索入池|成交结果)/);
});

test('selectable headers update only the trend metric', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /setTrendMetric\(targetMetric\)/);
  assert.match(source, /aria-pressed=\{selected\}/);
  assert.match(source, /disabled=\{!targetMetric\}/);
  assert.match(source, /metric\.key === 'clicks' \? 'visits' : null/);
  assert.match(source, /trendSource/);
  assert.doesNotMatch(source, /onRow|onClick:\s*\(.*setTrendSource/s);
});

test('trend exposes two selectors, summaries, two-period semantics and equivalent data', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /aria-label="趋势来源"/);
  assert.match(source, /aria-label="趋势指标"/);
  assert.match(source, /区间总量/);
  assert.match(source, /日均/);
  assert.match(source, /较上一周期/);
  assert.match(source, /峰值/);
  assert.match(source, /当前周期/);
  assert.match(source, /上一周期/);
  assert.match(source, /每日趋势等价数据表/);
  for (const sourceKey of [
    'BAIDU_TONGJI_ALL',
    'BAIDU_TONGJI_DIRECT',
    'BAIDU_TONGJI_SEARCH',
    'BAIDU_TONGJI_EXTERNAL'
  ]) {
    assert.match(source, new RegExp(sourceKey));
  }
  for (const metric of ['pageviews', 'visits', 'visitors']) {
    assert.match(source, new RegExp(`key: '${metric}'`));
  }
});

test('overview preserves local scrolling, responsive stacking and reduced motion', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(css, /background:\s*#f6f8fb/i);
  assert.match(css, /\.tableScroller\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(source, /animate=\{reducedMotion \? false/);
  assert.match(css, /grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /font-family/);
  assert.doesNotMatch(css, /backdrop-filter|box-shadow:\s*0\s+\d{2,}px/);
});
