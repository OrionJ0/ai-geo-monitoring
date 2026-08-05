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

test('fresh filtered dashboard reads facts only once', async () => {
  const reads = [];
  const dashboard = {
    states: {
      projectState: 'ACTIVE',
      sourceSummaryState: 'CONNECTED',
      bindingSummaryState: 'ACTIVE',
      snapshotFreshnessState: 'FRESH'
    }
  };
  const service = new MarketingOnDemandDashboardService({
    dashboardService: {
      assertAccess() {},
      async read(input) {
        reads.push(input);
        return dashboard;
      }
    },
    refreshService: {
      async createRun() {
        throw new Error('fresh dashboard must not create a refresh run');
      }
    },
    executeRefresh: async () => {
      throw new Error('fresh dashboard must not execute a refresh run');
    }
  });

  const input = {
    projectId: 11,
    from: '2026-07-28',
    to: '2026-08-03'
  };
  assert.equal(await service.read(input), dashboard);
  assert.deepEqual(reads, [input]);
});

test('first filtered dashboard request refreshes before applying the requested range', async (t) => {
  const database = await createMarketingTestDatabase('marketing-on-demand-filter-first-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  let providerCalls = 0;
  const now = Date.parse('2026-08-03T04:00:00.000Z');
  const refreshService = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports({ binding, coverage }) {
        providerCalls += 1;
        return campaignOnlyReports([{
          accountId: binding.accountId,
          campaignId: 'campaign-filter-first',
          campaignName: '首次筛选计划',
          metricDate: coverage.to,
          impressions: '3',
          clicks: '1',
          costAmountScaled: '2'
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

  const result = await service.read({
    projectId: 11,
    from: '2026-07-31',
    to: '2026-08-02'
  });
  assert.equal(providerCalls, 1);
  assert.deepEqual(result.filter, {
    from: '2026-07-31',
    to: '2026-08-02'
  });
});

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

test('dashboard returns an old revision with an explicit stale failure state', async (t) => {
  const database = await createMarketingTestDatabase('marketing-on-demand-stale-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  let now = Date.parse('2026-08-03T04:00:00.000Z');
  let providerCalls = 0;
  const refreshService = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports({ binding, coverage }) {
        providerCalls += 1;
        if (providerCalls > 1) {
          const error = new Error('上游快照漂移');
          error.code = 'BAIDU_REPORT_SNAPSHOT_UNSTABLE';
          throw error;
        }
        return campaignOnlyReports([{
          accountId: binding.accountId,
          campaignId: 'old-campaign',
          campaignName: '旧快照',
          metricDate: coverage.to,
          impressions: '1',
          clicks: '1',
          costAmountScaled: '1'
        }]);
      }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 6,
    clock: () => now
  });
  const dashboardReader = new MarketingDashboardService({
    sequelize: database.sequelize,
    clock: () => now
  });
  const service = new MarketingOnDemandDashboardService({
    dashboardService: dashboardReader,
    refreshService,
    executeRefresh: (runId) => refreshService.executeRun(runId),
    clock: () => now
  });

  const first = await service.read({ projectId: 11 });
  now += 11 * 60 * 1000;
  const fallback = await service.read({ projectId: 11 });
  assert.equal(fallback.revision, first.revision);
  assert.equal(fallback.states.snapshotFreshnessState, 'STALE');
  assert.equal(
    fallback.lastRun.failureCode,
    'BAIDU_REPORT_SNAPSHOT_UNSTABLE'
  );
  const repeatedFallback = await service.read({ projectId: 11 });
  assert.equal(repeatedFallback.revision, first.revision);
  assert.equal(providerCalls, 2, '失败冷却内不得重复调用百度四份报告');
});

test('crossed-day stale recovery refreshes once before coverage discovery and clamped read', async (t) => {
  const database = await createMarketingTestDatabase('marketing-on-demand-crossed-day-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  let now = Date.parse('2026-08-03T04:00:00.000Z');
  let providerCalls = 0;
  const refreshService = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports({ binding, coverage }) {
        providerCalls += 1;
        if (providerCalls > 1) {
          const error = new Error('上游快照漂移');
          error.code = 'BAIDU_REPORT_SNAPSHOT_UNSTABLE';
          throw error;
        }
        return campaignOnlyReports([{
          accountId: binding.accountId,
          campaignId: 'old-campaign',
          campaignName: '旧快照',
          metricDate: coverage.to,
          impressions: '1',
          clicks: '1',
          costAmountScaled: '1'
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
    executeRefresh: (runId) => refreshService.executeRun(runId),
    clock: () => now
  });

  const first = await service.read({ projectId: 11 });
  now += 24 * 60 * 60 * 1000 + 11 * 60 * 1000;
  await assert.rejects(
    service.read({
      projectId: 11,
      from: first.coverage.from,
      to: '2026-08-03'
    }),
    { code: 'DASHBOARD_DATE_OUT_OF_RANGE', status: 422 }
  );
  await assert.rejects(
    service.read({
      projectId: 11,
      from: first.coverage.from,
      to: '2026-08-03'
    }),
    { code: 'DASHBOARD_DATE_OUT_OF_RANGE', status: 422 }
  );
  const coverage = await service.read({ projectId: 11 });
  const clamped = await service.read({
    projectId: 11,
    from: coverage.coverage.from,
    to: coverage.coverage.to
  });

  assert.equal(clamped.revision, first.revision);
  assert.deepEqual(clamped.filter, {
    from: first.coverage.from,
    to: first.coverage.to
  });
  assert.equal(providerCalls, 2, '范围发现与钳制读取不得重复刷新上游');
});
