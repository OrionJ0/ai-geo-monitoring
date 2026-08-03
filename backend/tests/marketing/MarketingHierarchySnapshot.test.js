const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MarketingDashboardService
} = require('../../modules/marketing/services/MarketingDashboardService');
const {
  MarketingRefreshService
} = require('../../modules/marketing/services/MarketingRefreshService');
const {
  createMarketingTestDatabase,
  seedConnectionAndBinding
} = require('./helpers/createMarketingTestDatabase');

test('one refresh commits campaign, ad group, keyword and search-term facts atomically', async (t) => {
  const database = await createMarketingTestDatabase('marketing-hierarchy-refresh-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, {
    accountId: '1234'
  });
  const service = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports({ binding }) {
        const common = {
          accountId: binding.accountId,
          campaignId: '101',
          campaignName: '计划甲',
          metricDate: '2026-07-29',
          impressions: '10',
          clicks: '2',
          costAmountScaled: '350'
        };
        const adGroup = {
          ...common,
          adGroupId: '201',
          adGroupName: '单元甲'
        };
        return {
          campaigns: [common],
          adGroups: [adGroup],
          keywords: [{
            ...adGroup,
            keywordId: '301',
            keywordName: '周界报警系统',
            targetingType: 'KEYWORD'
          }],
          searchTerms: [{
            ...adGroup,
            keywordName: '周界报警系统',
            searchTerm: '周界报警系统厂家',
            queryStatus: 'NOT_ADDED',
            matchType: 'PHRASE'
          }]
        };
      }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 2,
    clock: () => Date.parse('2026-07-29T04:00:00.000Z')
  });

  const run = await service.createRun({
    projectId: 11,
    triggerType: 'MANUAL',
    userId: 2
  });
  const completed = await service.executeRun(run.runId);

  assert.equal(completed.status, 'SUCCEEDED');
  for (const table of [
    'baidu_campaign_daily_metrics',
    'baidu_ad_group_daily_metrics',
    'baidu_keyword_daily_metrics',
    'baidu_search_term_daily_metrics'
  ]) {
    const [rows] = await database.sequelize.query(
      `SELECT * FROM ${table}`
    );
    assert.equal(rows.length, 1, table);
    assert.equal(rows[0].refresh_run_id, run.runId, table);
  }
  const [terms] = await database.sequelize.query(
    `SELECT search_term, search_term_key
     FROM baidu_search_term_daily_metrics`
  );
  assert.equal(terms[0].search_term, '周界报警系统厂家');
  assert.match(terms[0].search_term_key, /^[0-9a-f]{64}$/u);

  const dashboard = await new MarketingDashboardService({
    sequelize: database.sequelize,
    clock: () => Date.parse('2026-07-29T04:01:00.000Z')
  }).read({ projectId: 11 });
  assert.deepEqual(dashboard.hierarchyCounts, {
    campaigns: 1,
    adGroups: 1,
    keywords: 1,
    searchTerms: 1
  });
  assert.deepEqual(dashboard.adGroups, [{
    accountId: '1234',
    campaignId: '101',
    campaignName: '计划甲',
    adGroupId: '201',
    adGroupName: '单元甲',
    impressions: '10',
    clicks: '2',
    costAmountScaled: '350',
    trend: [{
      date: '2026-07-29',
      impressions: '10',
      clicks: '2',
      costAmountScaled: '350'
    }]
  }]);
  assert.deepEqual(dashboard.keywords, [{
    accountId: '1234',
    campaignId: '101',
    campaignName: '计划甲',
    adGroupId: '201',
    adGroupName: '单元甲',
    keywordId: '301',
    keywordName: '周界报警系统',
    targetingType: 'KEYWORD',
    impressions: '10',
    clicks: '2',
    costAmountScaled: '350',
    trend: [{
      date: '2026-07-29',
      impressions: '10',
      clicks: '2',
      costAmountScaled: '350'
    }]
  }]);
  assert.deepEqual(dashboard.searchTerms, [{
    accountId: '1234',
    campaignId: '101',
    campaignName: '计划甲',
    adGroupId: '201',
    adGroupName: '单元甲',
    keywordName: '周界报警系统',
    searchTerm: '周界报警系统厂家',
    queryStatus: 'NOT_ADDED',
    matchType: 'PHRASE',
    impressions: '10',
    clicks: '2',
    costAmountScaled: '350',
    trend: [{
      date: '2026-07-29',
      impressions: '10',
      clicks: '2',
      costAmountScaled: '350'
    }]
  }]);
  assert.deepEqual(dashboard.campaigns[0].trend, [{
    date: '2026-07-29',
    impressions: '10',
    clicks: '2',
    costAmountScaled: '350'
  }]);
  assert.equal('keywordId' in dashboard.searchTerms[0], false);
});

test('refresh rejects orphan hierarchy rows instead of hiding them in the UI', async (t) => {
  const database = await createMarketingTestDatabase('marketing-hierarchy-orphan-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, { accountId: '1234' });
  const common = {
    accountId: '1234',
    campaignId: '101',
    campaignName: '计划甲',
    metricDate: '2026-07-29',
    impressions: '10',
    clicks: '2',
    costAmountScaled: '350'
  };
  const service = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports() {
        return {
          campaigns: [common],
          adGroups: [],
          keywords: [{
            ...common,
            adGroupId: 'missing-ad-group',
            adGroupName: '不存在的单元',
            keywordId: '301',
            keywordName: '周界报警系统',
            targetingType: 'KEYWORD'
          }],
          searchTerms: []
        };
      }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 2,
    clock: () => Date.parse('2026-07-29T04:00:00.000Z')
  });
  const run = await service.createRun({
    projectId: 11,
    triggerType: 'MANUAL',
    userId: 2
  });

  await assert.rejects(
    service.executeRun(run.runId),
    { code: 'REPORT_HIERARCHY_INVALID' }
  );
  const [facts] = await database.sequelize.query(
    'SELECT id FROM baidu_keyword_daily_metrics'
  );
  assert.equal(facts.length, 0);
});
