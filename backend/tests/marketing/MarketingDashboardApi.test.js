const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MarketingDashboardService
} = require('../../modules/marketing/services/MarketingDashboardService');
const {
  MarketingRefreshService
} = require('../../modules/marketing/services/MarketingRefreshService');
const {
  campaignOnlyReports,
  createMarketingTestDatabase,
  seedConnectionAndBinding
} = require('./helpers/createMarketingTestDatabase');
const openApi = require(
  '../../modules/marketing/contracts/goodieai-marketing-ad-read.openapi.json'
);
const {
  assertMarketingOpenApiResponse
} = require('./helpers/assertMarketingOpenApiResponse');

test('dashboard returns one revision and exact aggregates without provider calls', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  let providerCalls = 0;
  const refresh = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports({ binding }) {
        providerCalls += 1;
        return campaignOnlyReports([
          {
            accountId: binding.accountId,
            campaignId: 'campaign-0009007199254740993123',
            campaignName: '计划甲',
            metricDate: '2026-07-28',
            impressions: '900719925474099312345',
            clicks: '3',
            costAmountScaled: '1000001'
          },
          {
            accountId: binding.accountId,
            campaignId: 'campaign-0009007199254740993123',
            campaignName: '计划甲',
            metricDate: '2026-07-29',
            impressions: '7',
            clicks: '4',
            costAmountScaled: '2000002'
          }
        ]);
      }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 6,
    clock: () => Date.parse('2026-07-30T04:00:00.000Z')
  });
  const run = await refresh.createRun({
    projectId: 11,
    triggerType: 'MANUAL',
    userId: 2
  });
  await refresh.executeRun(run.runId);
  assert.equal(providerCalls, 1);

  const dashboardService = new MarketingDashboardService({
    sequelize: database.sequelize,
    clock: () => Date.parse('2026-07-30T04:05:00.000Z')
  });
  const dashboardQueries = [];
  const originalQuery = database.sequelize.query.bind(database.sequelize);
  database.sequelize.query = (sql, options) => {
    dashboardQueries.push(String(sql));
    return originalQuery(sql, options);
  };
  const dashboard = await dashboardService.read({
    projectId: 11,
    from: '2026-07-28',
    to: '2026-07-29'
  });
  assertMarketingOpenApiResponse({
    path: '/api/marketing/projects/{projectId}/dashboard',
    status: 200,
    payload: dashboard
  });
  assert.equal(providerCalls, 1, 'dashboard GET must not call the provider');
  assert.equal(dashboard.schemaVersion, 'marketing_dashboard_v2');
  assert.equal(dashboard.revision, run.runId);
  assert.equal(dashboard.states.snapshotContentState, 'DATA');
  assert.equal(dashboard.states.snapshotFreshnessState, 'FRESH');
  assert.deepEqual(dashboard.summary, {
    impressions: '900719925474099312352',
    clicks: '7',
    costAmountScaled: '3000003'
  });
  assert.equal(dashboard.trend.length, 2);
  assert.deepEqual(dashboard.hierarchyCounts, {
    campaigns: 1,
    adGroups: 0,
    keywords: 0,
    searchTerms: 0
  });
  for (const field of ['campaigns', 'adGroups', 'keywords', 'searchTerms']) {
    assert.equal(field in dashboard, false, `dashboard must omit ${field}`);
  }
  assert.deepEqual(
    Object.keys(dashboard).sort(),
    [...openApi.components.schemas.MarketingDashboardResponse.required].sort(),
    '实际 Dashboard 顶层字段必须与 OpenAPI 3.1 合同一致'
  );
  for (const table of [
    'baidu_ad_group_daily_metrics',
    'baidu_keyword_daily_metrics',
    'baidu_search_term_daily_metrics'
  ]) {
    const reads = dashboardQueries.filter((sql) => sql.includes(table));
    assert.equal(reads.length, 1, `${table} should only be counted once`);
    assert.match(reads[0], /SELECT COUNT\(\*\) AS total/u);
    assert.match(reads[0], /GROUP BY/u);
    assert.doesNotMatch(reads[0], /SELECT \*/u);
  }
  await dashboardService.read({
    projectId: 11,
    from: '2026-07-28',
    to: '2026-07-29'
  });
  for (const table of [
    'baidu_ad_group_daily_metrics',
    'baidu_keyword_daily_metrics',
    'baidu_search_term_daily_metrics'
  ]) {
    assert.equal(
      dashboardQueries.filter((sql) => sql.includes(table)).length,
      1,
      `${table} immutable hierarchy count should be reused for the same revision and range`
    );
  }

  const concurrentService = new MarketingDashboardService({
    sequelize: database.sequelize,
    clock: () => Date.parse('2026-07-30T04:05:00.000Z')
  });
  dashboardQueries.length = 0;
  await Promise.all(Array.from({ length: 5 }, () => concurrentService.read({
    projectId: 11,
    from: '2026-07-28',
    to: '2026-07-29'
  })));
  for (const table of [
    'baidu_campaign_daily_metrics',
    'baidu_ad_group_daily_metrics',
    'baidu_keyword_daily_metrics',
    'baidu_search_term_daily_metrics'
  ]) {
    assert.equal(
      dashboardQueries.filter((sql) => (
        sql.includes(table) && /SELECT COUNT\(\*\) AS total/u.test(sql)
      )).length,
      1,
      `${table} concurrent cold reads should share one hierarchy count query`
    );
  }
});

test('dashboard rejects filters outside the saved coverage', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  const refresh = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports() { return campaignOnlyReports(); }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 6,
    clock: () => Date.parse('2026-07-30T04:00:00.000Z')
  });
  const run = await refresh.createRun({
    projectId: 11,
    triggerType: 'MANUAL',
    userId: 2
  });
  await refresh.executeRun(run.runId);
  const dashboard = new MarketingDashboardService({
    sequelize: database.sequelize
  });
  await assert.rejects(
    dashboard.read({
      projectId: 11,
      from: '2026-01-01',
      to: '2026-07-29'
    }),
    { code: 'DASHBOARD_DATE_OUT_OF_RANGE', status: 422 }
  );
});

test('dashboard rejects a date filter when no snapshot exists', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  const dashboard = new MarketingDashboardService({
    sequelize: database.sequelize
  });
  await assert.rejects(
    dashboard.read({
      projectId: 11,
      from: '2026-07-01'
    }),
    { code: 'DASHBOARD_FILTER_WITHOUT_SNAPSHOT', status: 422 }
  );
});

test('restoring an old binding fingerprint does not revive deleted facts', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  const refresh = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports({ binding }) {
        return campaignOnlyReports([{
          accountId: binding.accountId,
          campaignId: `campaign-${binding.id}`,
          campaignName: '口径测试',
          metricDate: '2026-07-29',
          impressions: '9',
          clicks: '1',
          costAmountScaled: '2'
        }]);
      }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 6,
    clock: () => Date.parse('2026-07-30T04:00:00.000Z')
  });
  const first = await refresh.createRun({
    projectId: 11,
    triggerType: 'MANUAL'
  });
  await refresh.executeRun(first.runId);
  await database.sequelize.query(
    `UPDATE baidu_project_bindings
     SET binding_version = 1
     WHERE id = 'binding-1'`
  );
  const second = await refresh.createRun({
    projectId: 11,
    triggerType: 'MANUAL'
  });
  await refresh.executeRun(second.runId);
  await database.sequelize.query(
    `UPDATE baidu_project_bindings
     SET binding_version = 0
     WHERE id = 'binding-1'`
  );

  const dashboard = await new MarketingDashboardService({
    sequelize: database.sequelize
  }).read({ projectId: 11 });

  assert.equal(dashboard.revision, null);
  assert.equal(dashboard.states.snapshotContentState, 'NONE');
  assert.deepEqual(dashboard.summary, {
    impressions: '0',
    clicks: '0',
    costAmountScaled: '0'
  });
});
