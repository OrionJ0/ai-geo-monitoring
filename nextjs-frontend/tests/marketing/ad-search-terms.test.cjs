const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '../..');

const {
  buildAdSearchTermRows,
  buildAdSearchTermSummary,
  dashboardFilterMatchesRange,
  filterAdSearchTermRows,
  formatExactPercentChange,
  keywordEvidenceKey,
  resolveAdKeywordScope,
  sameMarketingDashboardRevision,
  searchTermEntityKey
} = require('../../src/utils/adSearchTerms.cjs');

function searchTerm(overrides = {}) {
  return {
    accountId: 'account-1',
    campaignId: 'campaign-1',
    campaignName: '计划一',
    adGroupId: 'group-1',
    adGroupName: '单元一',
    keywordName: '电子围栏厂家',
    searchTerm: '电子围栏生产厂家',
    queryStatus: 'NOT_ADDED',
    matchType: 'PHRASE',
    costAmountScaled: '12345',
    impressions: '100',
    clicks: '5',
    ...overrides
  };
}

test('advertising search-term identity never fabricates a keyword ID', () => {
  const rows = buildAdSearchTermRows([
    searchTerm(),
    searchTerm({
      adGroupId: 'group-2',
      adGroupName: '单元二'
    })
  ], 2);

  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].key, rows[1].key);
  assert.equal('keywordId' in rows[0], false);
  assert.equal(rows[0].ctrPercent, 5);
  assert.equal(rows[0].averageCpc, 24.69);
});

test('search-term identity mirrors the backend fact tuple including status and match type', () => {
  const base = searchTerm();
  assert.notEqual(
    searchTermEntityKey(base),
    searchTermEntityKey({ ...base, queryStatus: 'ADDED' })
  );
  assert.notEqual(
    searchTermEntityKey(base),
    searchTermEntityKey({ ...base, matchType: 'EXACT' })
  );
});

test('period comparison requires the same non-empty dashboard revision', () => {
  assert.equal(sameMarketingDashboardRevision('run-a', 'run-a'), true);
  assert.equal(sameMarketingDashboardRevision('run-a', 'run-b'), false);
  assert.equal(sameMarketingDashboardRevision(null, null), false);
});

test('period comparison requires the dashboard filter to match the requested range', () => {
  assert.equal(dashboardFilterMatchesRange({
    filter: { from: '2026-07-21', to: '2026-07-27' }
  }, { from: '2026-07-21', to: '2026-07-27' }), true);
  assert.equal(dashboardFilterMatchesRange({
    filter: { from: '2026-07-28', to: '2026-08-03' }
  }, { from: '2026-07-21', to: '2026-07-27' }), false);
  assert.equal(dashboardFilterMatchesRange({ filter: null }, {
    from: '2026-07-21', to: '2026-07-27'
  }), false);
});

test('search-term summary and period change keep exact integer metrics', () => {
  const rows = buildAdSearchTermRows([
    searchTerm({ costAmountScaled: '900719925474099300', impressions: '7', clicks: '3' }),
    searchTerm({ searchTerm: '电子围栏报价', costAmountScaled: '700', impressions: '5', clicks: '2' })
  ], 2);

  assert.deepEqual(buildAdSearchTermSummary(rows), {
    searchTermCount: '2',
    costAmountScaled: '900719925474100000',
    impressions: '12',
    clicks: '5'
  });
  assert.equal(formatExactPercentChange('15', '10'), '+50.0%');
  assert.equal(formatExactPercentChange('5', '10'), '-50.0%');
  assert.equal(formatExactPercentChange('0', '0'), null);
});

test('search-term filters combine keyword evidence, unit, status, match type, and query', () => {
  const first = searchTerm();
  const second = searchTerm({
    adGroupId: 'group-2',
    adGroupName: '单元二',
    keywordName: '周界报警系统',
    searchTerm: '园区周界报警方案',
    queryStatus: 'ADDED',
    matchType: 'EXACT'
  });
  const rows = buildAdSearchTermRows([first, second], 2);

  assert.deepEqual(
    filterAdSearchTermRows(rows, {
      keywordEvidence: keywordEvidenceKey(first),
      adGroupId: 'group-1',
      queryStatus: 'NOT_ADDED',
      matchType: 'PHRASE',
      query: '生产'
    }).map((row) => row.searchTerm),
    ['电子围栏生产厂家']
  );
});

test('keyword scope resolves by account and configured keyword ID before using name evidence', () => {
  const keywords = [{
    accountId: 'account-1',
    campaignId: 'campaign-1',
    campaignName: '计划一',
    adGroupId: 'group-1',
    adGroupName: '单元一',
    keywordId: 'keyword-1',
    keywordName: '电子围栏厂家'
  }, {
    accountId: 'account-2',
    campaignId: 'campaign-2',
    campaignName: '计划二',
    adGroupId: 'group-2',
    adGroupName: '单元二',
    keywordId: 'keyword-1',
    keywordName: '电子围栏厂家'
  }];

  assert.equal(
    resolveAdKeywordScope(keywords, 'account-2', 'keyword-1').adGroupId,
    'group-2'
  );
  assert.equal(resolveAdKeywordScope(keywords, 'account-3', 'keyword-1'), null);
});

test('advertising search-term page is a read-only nested dashboard consumer', () => {
  const pageSource = fs.readFileSync(
    path.join(frontendRoot, 'src/app/geo/keyword-analysis/search-terms/page.tsx'),
    'utf8'
  );
  const hookSource = fs.readFileSync(
    path.join(frontendRoot, 'src/lib/marketing/useAdSearchTerms.ts'),
    'utf8'
  );

  assert.match(pageSource, /首页/);
  assert.match(pageSource, /投放与流量/);
  assert.match(pageSource, /广告关键词/);
  assert.match(pageSource, /广告搜索词/);
  assert.match(pageSource, /查看全部广告搜索词/);
  assert.match(pageSource, /下钻范围无效/);
  assert.match(pageSource, /searchParams\.get\('view'\) === 'all'/);
  assert.match(pageSource, /!allRequested && !resolvedScope/);
  assert.match(pageSource, /命中广告关键词/);
  assert.match(pageSource, /推广单元/);
  assert.match(pageSource, /匹配方式/);
  assert.match(pageSource, /添加状态/);
  assert.match(pageSource, /广告搜索词数/);
  assert.match(pageSource, /<MarketingPageFilters/);
  assert.match(pageSource, /availableDevices=\{\['all'\]\}/);
  assert.match(hookSource, /\/dashboard/);
  assert.match(hookSource, /assertMarketingDashboardResponse/);
  assert.match(hookSource, /readMarketingDashboard/);
  assert.match(hookSource, /marketingSnapshotWarning/);
  assert.match(hookSource, /assertMarketingDashboardResponse\([^,]+, projectId\)/);
  assert.match(hookSource, /sameMarketingDashboardRevision/);
  assert.match(hookSource, /dashboardFilterMatchesRange/);
  assert.match(hookSource, /timeout: 10_000/);
  assert.ok(
    hookSource.indexOf("上一周期广告搜索词正在读取")
      < hookSource.indexOf('const previousResult = await')
  );
  assert.match(hookSource, /onDateRangeAdjusted/);
  assert.doesNotMatch(hookSource, /axios\.(?:post|put|patch|delete)\(/);
  assert.doesNotMatch(pageSource, /自然搜索词|网站流量/);
});
