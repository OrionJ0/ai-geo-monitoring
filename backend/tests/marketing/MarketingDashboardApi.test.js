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
    clock: () => Date.parse('2026-07-29T04:00:00.000Z')
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
    clock: () => Date.parse('2026-07-29T04:05:00.000Z')
  });
  const dashboard = await dashboardService.read({
    projectId: 11,
    from: '2026-07-28',
    to: '2026-07-29'
  });
  assert.equal(providerCalls, 1, 'dashboard GET must not call the provider');
  assert.equal(dashboard.revision, run.runId);
  assert.equal(dashboard.states.snapshotContentState, 'DATA');
  assert.equal(dashboard.states.snapshotFreshnessState, 'FRESH');
  assert.deepEqual(dashboard.summary, {
    impressions: '900719925474099312352',
    clicks: '7',
    costAmountScaled: '3000003'
  });
  assert.equal(dashboard.trend.length, 2);
  assert.equal(dashboard.campaigns.length, 1);
  assert.equal(
    dashboard.campaigns[0].campaignId,
    'campaign-0009007199254740993123'
  );
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
    clock: () => Date.parse('2026-07-29T04:00:00.000Z')
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
    clock: () => Date.parse('2026-07-29T04:00:00.000Z')
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
