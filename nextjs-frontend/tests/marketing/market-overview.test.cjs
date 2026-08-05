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
const sharedCssPath = path.resolve(
  __dirname,
  '../../src/components/marketing/marketing-shared.module.css'
);

test('overview hook owns only the dashboard while range traffic uses the shared hook', () => {
  const source = fs.readFileSync(hookPath, 'utf8');

  assert.match(source, /assertMarketingDashboardResponse/);
  assert.match(source, /assertMarketingDashboardResponse\(value, projectId\)/);
  assert.match(source, /\/dashboard/);
  assert.match(source, /ad:\s*SourceSlot/);
  assert.doesNotMatch(source, /traffic:\s*SourceSlot/);
  assert.doesNotMatch(source, /trafficSources|paidTraffic|trafficTrend/);
  assert.doesNotMatch(source, /\/tongji-trend|\/tongji-source-trends/);
  assert.match(source, /10 \* 60 \* 1000/);
  assert.doesNotMatch(source, /setInterval/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /snapshotFreshnessState/);
  assert.match(source, /state: stale \? 'STALE'/);
  const page = fs.readFileSync(pagePath, 'utf8');
  assert.match(page, /useWebsiteTrafficOverview/);
  assert.match(page, /includeSourceComparison:\s*true/);
  assert.match(page, /websiteFallbackRange/);
  assert.match(page, /useMarketingFilters\(\)/);
  assert.match(page, /trafficRange\.data\.coverage\.from === dateRange\?\.\[0\]/);
  assert.match(page, /trafficRange\.data\.selectedSource\.sourceKey === ALL_SOURCE/);
  assert.match(page, /selectedTraffic\.data\.selectedSource\.sourceKey === trendSource/);
  assert.doesNotMatch(page, /<MarketingPageFilters[\s\S]*?disabled=/);
  assert.match(page, /最后成功广告快照/);
  assert.doesNotMatch(page, /广告来源读取失败|网站来源读取失败/);
});

test('overview implements the final three-section visual hierarchy', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, />投放效率</);
  assert.match(source, />全链路数据</);
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
  assert.match(source, /<MarketingMetricGrid/);
  assert.match(source, /<MarketingMetricCard/);
  assert.doesNotMatch(source, /9\.86|264\.69|2074\.84|5\.96/);
});

test('journey uses fixed stages and never fabricates unsupported attribution', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  for (const column of [
    '渠道',
    '广告投入',
    '展现',
    '访问',
    '官网咨询',
    '线索入池',
    '成交结果',
    '整体转换率'
  ]) {
    assert.match(source, new RegExp(column));
  }
  assert.match(source, /可信的按来源关联/);
  assert.doesNotMatch(source, /microFunnel|funnelChart|funnelRate/);
  for (const label of ['百度推广', 'BAIDU_SEARCH', 'BING_SEARCH', 'GOOGLE_SEARCH', 'OTHER_SEARCH', 'EXTERNAL_REFERRAL', '直接访问', '自然搜索']) {
    assert.match(source, new RegExp(label));
  }
  assert.doesNotMatch(source, /订单数量|成交订单数/);
});

test('journey adds Baidu Tongji source rows as visit-only evidence', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /trafficData\?\.sourceComparison/);
  assert.match(source, /source\.sourceLabel/);
  assert.match(source, /source\.summary\?\.visits/);
  assert.match(source, /TONGJI_CHANNEL_DEFINITIONS/);
  assert.match(source, /sourceKey: 'BAIDU_PAID'/);
  assert.match(source, /sourceKey: 'EXTERNAL_REFERRAL'/);
  assert.match(source, /不会因同期出现而伪造跨系统归因/);
  assert.match(source, /paidVisits/);
  assert.match(source, /不能用广告点击代替/);
  assert.match(source, /currentTotals[\s\S]*hasCompletePeriod\([\s\S]*period\.current/);
  assert.doesNotMatch(source, /所选区间的百度统计访问次数/);
  assert.doesNotMatch(source, />来自百度统计</);
  assert.match(source, /BaiduOutlined/);
  assert.match(source, /GoogleOutlined/);
  assert.match(source, /function BingBrandIcon/);
  assert.match(source, /sourceKey === 'BAIDU_SEARCH' \|\| sourceKey === PAID_SOURCE/);
  assert.match(source, /aria-label=\{`\$\{label\}渠道图标`\}/);
  assert.doesNotMatch(source, /当前范围未记录访问/);
  assert.match(source, /visibleAlignedFormKeys/);
  assert.match(source, /websiteFormBySource\.get\(PAID_SOURCE\)/);
  assert.match(source, /websiteFormBySource\.get\(source\.sourceKey\)/);
  assert.match(source, /MARKETING_SOURCE_LABELS\.UNKNOWN/);
});

test('selectable headers update only the trend metric', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /setTrendMetric\(targetMetric\)/);
  assert.match(source, /aria-pressed=\{selected\}/);
  assert.match(source, /disabled=\{!targetMetric\}/);
  assert.match(source, /metric\.key === 'visits' \? 'visits' : null/);
  assert.match(source, /trendSource/);
  assert.match(source, /selectedTrafficData\?\.trend/);
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
    'ALL',
    'DIRECT',
    'BAIDU_SEARCH',
    'BING_SEARCH',
    'GOOGLE_SEARCH',
    'OTHER_SEARCH',
    'EXTERNAL_REFERRAL'
  ]) {
    assert.match(source, new RegExp(sourceKey));
  }
  assert.match(source, /metric\.key === 'visits'/);
  assert.doesNotMatch(source, /key: 'pageviews'|key: 'visitors'/);
  assert.doesNotMatch(source, /BAIDU_TONGJI_ALL|BAIDU_TONGJI_DIRECT/);
});

test('all-channel trend has an accessible legend and table-row drill interaction', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /buildDailyChannelComparison/);
  assert.match(source, /hiddenTrendSources/);
  assert.match(source, /aria-label="渠道趋势图例"/);
  assert.match(source, /aria-pressed=\{!hidden\}/);
  assert.match(source, /trafficShare/);
  assert.match(source, /changePercent/);
  assert.match(source, /aria-selected=\{selected\}/);
  assert.match(source, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /setTrendSource\(ALL_SOURCE\)/);
  assert.doesNotMatch(source, /官网全站（百度统计）/);
});

test('overview preserves local scrolling, responsive stacking and reduced motion', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  const sharedCss = fs.readFileSync(sharedCssPath, 'utf8');
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(css, /background:\s*#f6f8fb/i);
  assert.match(css, /\.tableScroller\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(source, /animate=\{reducedMotion \? false/);
  assert.match(sharedCss, /@media \(max-width: 520px\)[\s\S]*grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /font-family/);
  assert.doesNotMatch(css, /backdrop-filter|box-shadow:\s*0\s+\d{2,}px/);
});
