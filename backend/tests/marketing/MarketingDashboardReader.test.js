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

test('raw dashboard reader reports stale state without an upstream side effect', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  let providerCalls = 0;
  const refresh = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports() {
        providerCalls += 1;
        return campaignOnlyReports();
      }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 6,
    clock: () => Date.parse('2026-07-29T03:00:00.000Z')
  });
  const run = await refresh.createRun({
    projectId: 11,
    triggerType: 'INITIAL'
  });
  await refresh.executeRun(run.runId);
  assert.equal(providerCalls, 1);
  const dashboard = new MarketingDashboardService({
    sequelize: database.sequelize,
    clock: () => Date.parse('2026-07-29T04:00:00.000Z')
  });
  const state = await dashboard.read({ projectId: 11 });
  assert.equal(state.states.snapshotContentState, 'ZERO');
  assert.equal(state.states.snapshotFreshnessState, 'STALE');
  assert.equal(providerCalls, 1);
  const [runs] = await database.sequelize.query(
    'SELECT id FROM baidu_marketing_refresh_runs'
  );
  assert.equal(runs.length, 1);
});

test('raw dashboard reader marks an active snapshot stale after the Shanghai window rolls', async (t) => {
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
    clock: () => Date.parse('2026-07-29T15:58:00.000Z')
  });
  const run = await refresh.createRun({
    projectId: 11,
    triggerType: 'MANUAL'
  });
  await refresh.executeRun(run.runId);
  const dashboard = new MarketingDashboardService({
    sequelize: database.sequelize,
    clock: () => Date.parse('2026-07-29T16:03:00.000Z')
  });
  const state = await dashboard.read({ projectId: 11 });
  assert.equal(state.states.snapshotContentState, 'ZERO');
  assert.equal(
    state.states.snapshotFreshnessState,
    'STALE',
    '即使 10 分钟内，窗口跨上海午夜也应视为过期'
  );
});
