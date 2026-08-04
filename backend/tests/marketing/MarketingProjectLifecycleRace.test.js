const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MarketingRefreshService
} = require('../../modules/marketing/services/MarketingRefreshService');
const {
  campaignOnlyReports,
  createMarketingTestDatabase,
  seedConnectionAndBinding
} = require('./helpers/createMarketingTestDatabase');

test('project archived before final commit rejects late provider results', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  let release;
  const providerStarted = new Promise((resolve) => {
    release = resolve;
  });
  let continueRequest;
  const providerCanFinish = new Promise((resolve) => {
    continueRequest = resolve;
  });
  const refresh = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports({ binding }) {
        release();
        await providerCanFinish;
        return campaignOnlyReports([{
          accountId: binding.accountId,
          campaignId: 'late-campaign',
          campaignName: '晚到计划',
          metricDate: '2026-07-29',
          impressions: '1',
          clicks: '1',
          costAmountScaled: '1'
        }]);
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
  const execution = refresh.executeRun(run.runId);
  await providerStarted;
  await database.sequelize.query(
    "UPDATE brand_projects SET status = 'archived' WHERE id = 11"
  );
  continueRequest();
  await assert.rejects(execution, { code: 'PROJECT_ARCHIVED' });
  const [metrics] = await database.sequelize.query(
    'SELECT id FROM baidu_campaign_daily_metrics'
  );
  assert.equal(metrics.length, 0);
});
