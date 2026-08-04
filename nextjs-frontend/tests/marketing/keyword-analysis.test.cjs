const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '../..');

const {
  aggregateKeywordFacts,
  buildKeywordActionDistribution,
  buildKeywordAverageBenchmark,
  buildKeywordCoverage,
  buildKeywordScatter,
  filterKeywordRows,
  keywordEntityKey
} = require('../../src/utils/keywordAnalysis.cjs');
const {
  KEYWORD_FIXTURE_RANGE,
  buildKeywordFixture
} = require('../../src/fixtures/keywordAnalysis.fixture.cjs');

function fact(overrides = {}) {
  return {
    date: '2026-07-05',
    accountId: 'account-1',
    accountName: '百度搜索账户',
    projectId: 'project-1',
    projectName: '周界报警',
    schemeId: 'scheme-1',
    schemeName: 'PC-周界报警',
    unitId: 'unit-1',
    unitName: '电子围栏',
    keywordId: 'keyword-1',
    keyword: '电子围栏厂家',
    tag: null,
    costAmountScaled: '1000',
    impressions: '100',
    clicks: '5',
    ...overrides
  };
}

test('keyword identity prefers account, unit, and keyword IDs over visible text', () => {
  const first = fact();
  const sameEntityNextDay = fact({
    date: '2026-07-06',
    impressions: '80',
    clicks: '4',
    costAmountScaled: '800'
  });
  const sameTextDifferentUnit = fact({
    unitId: 'unit-2',
    keywordId: 'keyword-2'
  });

  assert.notEqual(
    keywordEntityKey(first),
    keywordEntityKey(sameTextDifferentUnit)
  );
  const rows = aggregateKeywordFacts(
    [first, sameEntityNextDay, sameTextDifferentUnit],
    { from: '2026-07-05', to: '2026-07-06', costScale: 2 }
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.keyword),
    ['电子围栏厂家', '电子围栏厂家']
  );
  assert.equal(rows[0].impressions, '180');
  assert.equal(rows[0].clicks, '9');
  assert.equal(rows[0].costAmountScaled, '1800');
});

test('coverage counts unique entities and keeps a missing denominator honest', () => {
  const coverage = buildKeywordCoverage([
    { impressions: '100', clicks: '5' },
    { impressions: '80', clicks: '0' },
    { impressions: '0', clicks: '0' }
  ]);
  assert.deepEqual(coverage, {
    impressionKeywordCount: 2,
    clickedKeywordCount: 1,
    clickCoverageRate: 0.5,
    unclickedKeywordCount: 1
  });
  assert.equal(buildKeywordCoverage([]).clickCoverageRate, null);
});

test('scatter excludes zero-click and invalid CTR rows without emitting NaN or Infinity', () => {
  const rows = aggregateKeywordFacts([
    fact({ keywordId: 'a', keyword: 'A', clicks: '2', impressions: '100', costAmountScaled: '2400' }),
    fact({ keywordId: 'b', keyword: 'B', clicks: '4', impressions: '100', costAmountScaled: '1600' }),
    fact({ keywordId: 'c', keyword: 'C', clicks: '0', impressions: '100', costAmountScaled: '0' }),
    fact({ keywordId: 'd', keyword: 'D', clicks: '3', impressions: '0', costAmountScaled: '1200' })
  ], { from: '2026-07-05', to: '2026-07-05', costScale: 2 });
  const scatter = buildKeywordScatter(rows, 2);

  assert.equal(scatter.points.length, 2);
  assert.equal(scatter.medianCtrPercent, 3);
  assert.equal(scatter.medianAverageCpc, 8);
  assert.ok(scatter.points.every((point) => (
    Number.isFinite(point.ctrPercent)
    && Number.isFinite(point.averageCpc)
    && Number.isFinite(point.clicks)
  )));
});

test('filtering combines summary stages, search, explicit labels, and factual more filters', () => {
  const rows = aggregateKeywordFacts([
    fact({ keywordId: 'a', keyword: '电子围栏厂家', tag: '优先加投' }),
    fact({ keywordId: 'b', keyword: '周界报警系统', tag: '稳健保持', clicks: '0', costAmountScaled: '0' }),
    fact({ keywordId: 'c', keyword: '室内报警器', tag: null, impressions: '0', clicks: '0', costAmountScaled: '0' })
  ], { from: '2026-07-05', to: '2026-07-05', costScale: 2 });

  assert.equal(filterKeywordRows(rows, { stage: 'clicked' }).length, 1);
  assert.equal(filterKeywordRows(rows, { stage: 'unclicked' }).length, 1);
  assert.equal(filterKeywordRows(rows, { search: '周界' }).length, 1);
  assert.equal(filterKeywordRows(rows, { tag: '优先加投' }).length, 1);
  assert.equal(filterKeywordRows(rows, { more: 'with-cost' }).length, 1);
  assert.equal(filterKeywordRows(rows, { more: 'plottable' }).length, 1);
  assert.equal(rows[2].tag, null);
});

test('task filtering narrows keywords by their direct promotion unit only', () => {
  const rows = aggregateKeywordFacts([
    fact({ keywordId: 'a', keyword: '电子围栏厂家', unitId: 'unit-a', unitName: '电子围栏 / 厂家词' }),
    fact({ keywordId: 'b', keyword: '周界报警系统', unitId: 'unit-b', unitName: '周界系统 / 通用词' })
  ], { from: '2026-07-05', to: '2026-07-05', costScale: 2 });

  const filtered = filterKeywordRows(rows, { unitId: 'unit-b' });

  assert.deepEqual(filtered.map((row) => row.keyword), ['周界报警系统']);
});

test('action distribution counts visible clicked labels without inventing missing labels', () => {
  const rows = aggregateKeywordFacts([
    fact({ keywordId: 'a', tag: '优先加投', clicks: '5' }),
    fact({ keywordId: 'b', tag: '优先加投', clicks: '3' }),
    fact({ keywordId: 'c', tag: '控制浪费', clicks: '2' }),
    fact({ keywordId: 'd', tag: null, clicks: '1' }),
    fact({ keywordId: 'e', tag: '稳健保持', clicks: '0' })
  ], { from: '2026-07-05', to: '2026-07-05', costScale: 2 });

  assert.deepEqual(buildKeywordActionDistribution(rows), {
    items: [
      { tag: '优先加投', count: 2 },
      { tag: '稳健保持', count: 0 },
      { tag: '控制浪费', count: 1 },
      { tag: '样本不足', count: 0 }
    ],
    taggedTotal: 3,
    unclassifiedCount: 1,
    total: 4
  });
});

test('account average benchmark uses weighted impressions, clicks, and spend', () => {
  const rows = aggregateKeywordFacts([
    fact({ keywordId: 'a', impressions: '100', clicks: '10', costAmountScaled: '20000' }),
    fact({ keywordId: 'b', impressions: '300', clicks: '10', costAmountScaled: '40000' })
  ], { from: '2026-07-05', to: '2026-07-05', costScale: 2 });

  assert.deepEqual(buildKeywordAverageBenchmark(rows, 2), {
    ctrPercent: 5,
    averageCpc: 30
  });
});

test('task filtering applies spend bands and CTR/CPC quadrants against a factual benchmark', () => {
  const rows = aggregateKeywordFacts([
    fact({ keywordId: 'a', impressions: '100', clicks: '80', costAmountScaled: '2400000' }),
    fact({ keywordId: 'b', impressions: '100', clicks: '2', costAmountScaled: '1200000' }),
    fact({ keywordId: 'c', impressions: '100', clicks: '6', costAmountScaled: '6000000' })
  ], { from: '2026-07-05', to: '2026-07-05', costScale: 2 });

  const filtered = filterKeywordRows(rows, {
    costRange: '10000-50000',
    costScale: 2,
    anomaly: 'high-ctr-low-cpc',
    benchmarkCtrPercent: 5,
    benchmarkAverageCpc: 500
  });

  assert.deepEqual(filtered.map((row) => row.keywordId), ['a']);
});

test('development fixture produces the approved 302 to 51 coverage without pretending to be production', () => {
  const fixture = buildKeywordFixture();
  const rows = aggregateKeywordFacts(fixture.facts, {
    from: KEYWORD_FIXTURE_RANGE.from,
    to: KEYWORD_FIXTURE_RANGE.to,
    costScale: fixture.costScale
  });
  const coverage = buildKeywordCoverage(rows);
  const scatter = buildKeywordScatter(rows, fixture.costScale);
  const distribution = buildKeywordActionDistribution(rows);

  assert.equal(fixture.source, 'development-fixture');
  assert.equal(fixture.updatedAt, '2026-08-03T09:30:00+08:00');
  assert.equal(rows.length, 302);
  assert.equal(coverage.impressionKeywordCount, 302);
  assert.equal(coverage.clickedKeywordCount, 51);
  assert.equal(coverage.unclickedKeywordCount, 251);
  assert.equal(Number((coverage.clickCoverageRate * 100).toFixed(2)), 16.89);
  assert.equal(scatter.points.length, 51);
  assert.equal(Number(scatter.medianCtrPercent.toFixed(1)), 3.1);
  assert.equal(Number(scatter.medianAverageCpc.toFixed(0)), 48);
  assert.deepEqual(distribution.items.map((item) => item.count), [18, 14, 12, 7]);
});

test('keyword analysis page implements the confirmed task-focused visual and interaction contract', () => {
  const pageSource = fs.readFileSync(
    path.join(frontendRoot, 'src/app/geo/keyword-analysis/page.tsx'),
    'utf8'
  );
  const hookSource = fs.readFileSync(
    path.join(frontendRoot, 'src/lib/marketing/useKeywordAnalysis.ts'),
    'utf8'
  );
  const dashboardReaderSource = fs.readFileSync(
    path.join(frontendRoot, 'src/lib/marketing/readMarketingDashboard.ts'),
    'utf8'
  );
  assert.match(hookSource, /assertMarketingDashboardResponse\(response\.data, projectId\)/);
  assert.match(hookSource, /marketingSnapshotWarning\(response\.data\)/);
  assert.match(pageSource, /analysis\.warning/);
  assert.match(pageSource, /!pageError && analysis\.warning/);
  assert.match(pageSource, /shellLoading \|\| analysis\.loading \|\| !model/);

  assert.match(hookSource, /NEXT_PUBLIC_KEYWORD_ANALYSIS_FIXTURE/);
  assert.match(hookSource, /process\.env\.NODE_ENV !== 'production'/);
  assert.match(dashboardReaderSource, /axios\.get<MarketingDashboardResponse>/);
  assert.match(dashboardReaderSource, /\/dashboard/);
  assert.match(dashboardReaderSource, /DASHBOARD_DATE_OUT_OF_RANGE/);
  assert.match(hookSource, /onDateRangeAdjusted\?\.\(response\.effectiveDateRange\)/);
  assert.match(hookSource, /adaptMarketingDashboardKeywords/);
  assert.doesNotMatch(hookSource + dashboardReaderSource, /axios\.(?:post|put|patch|delete)\(/);
  assert.match(pageSource, /useDefaultProjectContext/);
  assert.match(pageSource, /useMarketingCapabilities/);
  assert.match(pageSource, /首页/);
  assert.match(pageSource, /投放与流量/);
  assert.match(pageSource, /关键词分析/);
  assert.doesNotMatch(pageSource, /搜索词分析|SearchTermAnalysis|searchTermAnalysis/);
  assert.doesNotMatch(pageSource, /当前真实百度数据只到推广计划|关键词数据尚未接入/);
  assert.match(pageSource, /有展现关键词/);
  assert.match(pageSource, /有点击关键词/);
  assert.match(pageSource, /点击覆盖率/);
  assert.match(pageSource, /未获点击/);
  assert.match(pageSource, /推广单元/);
  assert.match(pageSource, /优化建议/);
  assert.match(pageSource, /消费区间/);
  assert.match(pageSource, /CTR\/CPC 异常/);
  assert.match(pageSource, /搜索投放关键词/);
  assert.match(pageSource, /关键词效率分布/);
  assert.match(pageSource, /当前数据中位数/);
  assert.match(pageSource, /账户平均值/);
  assert.match(pageSource, /散点/);
  assert.match(pageSource, /密度/);
  assert.match(pageSource, /当前选中关键词/);
  assert.match(pageSource, /行动建议分布/);
  assert.match(pageSource, /全部关键词明细/);
  assert.match(pageSource, /record\.unitName/);
  assert.match(pageSource, /rowClassName/);
  assert.match(pageSource, /\bPie\b/);
  assert.match(pageSource, /\bHeatmap\b/);
  assert.match(pageSource, /type:\s*'sqrt'/);
  assert.match(pageSource, /range:\s*\[3,\s*11\]/);
  assert.match(pageSource, /fillOpacity:\s*0\.56/);
  assert.match(pageSource, /<MarketingPageFilters/);
  assert.match(pageSource, /availableDevices=\{\['all'\]\}/);
  assert.doesNotMatch(pageSource, /MORE_FILTER_OPTIONS|更多筛选/);
  assert.doesNotMatch(pageSource, /title:\s*'投放路径'/);
  assert.doesNotMatch(pageSource, /推广单元：\{record\.unitName\}/);
  assert.doesNotMatch(pageSource, /key:\s*selectedKeywordKey/);
  assert.doesNotMatch(pageSource, /人工目标线/);
  assert.doesNotMatch(pageSource, /<h1/);
  assert.doesNotMatch(
    pageSource,
    /Top\s?20|消费最高|点击贡献|客服咨询|线索入池|成交订单|成交金额|ROAS|CPA|CPL|全链路漏斗/u
  );
});
