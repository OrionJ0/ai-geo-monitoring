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

test('dashboard marks an old snapshot stale without creating a run or calling provider', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  let providerCalls = 0;
  const refresh = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReport() {
        providerCalls += 1;
        return [];
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
