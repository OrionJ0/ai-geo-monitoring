const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MarketingDashboardService
} = require('../../modules/marketing/services/MarketingDashboardService');
const {
  MarketingOnDemandDashboardService
} = require('../../modules/marketing/services/MarketingOnDemandDashboardService');
const {
  MarketingRefreshService
} = require('../../modules/marketing/services/MarketingRefreshService');
const {
  campaignOnlyReports,
  createMarketingTestDatabase,
  seedConnectionAndBinding
} = require('./helpers/createMarketingTestDatabase');

test('on-demand admission rejection releases the project refresh slot', async (t) => {
  const database = await createMarketingTestDatabase('marketing-on-demand-reject-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  const refreshService = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports() { return campaignOnlyReports(); }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 6,
    clock: () => Date.parse('2026-08-03T04:00:00.000Z')
  });
  const service = new MarketingOnDemandDashboardService({
    dashboardService: new MarketingDashboardService({
      sequelize: database.sequelize,
      clock: () => Date.parse('2026-08-03T04:00:00.000Z')
    }),
    refreshService,
    executeRefresh: async (runId) => {
      const error = new Error('营销执行器队列已满');
      error.code = 'MARKETING_EXECUTOR_QUEUE_FULL';
      throw error;
    }
  });

  await assert.rejects(
    service.read({ projectId: 11 }),
    { code: 'MARKETING_EXECUTOR_QUEUE_FULL' }
  );
  const [rows] = await database.sequelize.query(
    `SELECT status, failure_code
     FROM baidu_marketing_refresh_runs
     WHERE project_id = 11`,
    {}
  );
  assert.deepEqual(rows[0], {
    status: 'FAILED',
    failure_code: 'MARKETING_EXECUTOR_QUEUE_FULL'
  });
  const [active] = await database.sequelize.query(
    `SELECT id FROM baidu_marketing_refresh_runs
     WHERE project_id = 11 AND active_project_key IS NOT NULL`,
    {}
  );
  assert.equal(active.length, 0, '被拒绝的运行必须释放项目刷新槽');
});

test('dashboard refreshes advertising only when requested and reuses it for ten minutes', async (t) => {
  const database = await createMarketingTestDatabase('marketing-on-demand-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  let now = Date.parse('2026-08-03T04:00:00.000Z');
  let providerCalls = 0;
  const refreshService = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports({ binding, coverage }) {
        providerCalls += 1;
        return campaignOnlyReports([{
          accountId: binding.accountId,
          campaignId: 'campaign-on-demand',
          campaignName: '按需刷新计划',
          metricDate: coverage.to,
          impressions: String(providerCalls),
          clicks: '1',
          costAmountScaled: '1000000'
        }]);
      }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 6,
    clock: () => now
  });
  const service = new MarketingOnDemandDashboardService({
    dashboardService: new MarketingDashboardService({
      sequelize: database.sequelize,
      clock: () => now
    }),
    refreshService,
    executeRefresh: (runId) => refreshService.executeRun(runId)
  });

  assert.equal(providerCalls, 0, '没有访问时不得调用百度推广');
  const first = await service.read({ projectId: 11 });
  assert.equal(providerCalls, 1);
  assert.equal(first.summary.impressions, '1');

  now += 9 * 60 * 1000;
  const cached = await service.read({ projectId: 11 });
  assert.equal(providerCalls, 1);
  assert.equal(cached.revision, first.revision);

  now += 2 * 60 * 1000;
  const refreshed = await service.read({ projectId: 11 });
  assert.equal(providerCalls, 2);
  assert.notEqual(refreshed.revision, first.revision);
  assert.equal(refreshed.summary.impressions, '2');
});
