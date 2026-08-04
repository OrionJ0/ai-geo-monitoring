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

function refreshService(sequelize, reportProvider) {
  return new MarketingRefreshService({
    sequelize,
    reportProvider,
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 6,
    clock: () => Date.parse('2026-07-30T04:00:00.000Z')
  });
}

test('all bindings replace one project snapshot atomically', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  await seedConnectionAndBinding(database.sequelize, {
    bindingId: 'binding-2',
    connectionId: 'connection-2',
    accountId: 'account-2'
  });
  const service = refreshService(database.sequelize, {
    async fetchSearchReports({ binding }) {
      return campaignOnlyReports([{
        accountId: binding.accountId,
        campaignId: `campaign-${binding.id}`,
        campaignName: `计划-${binding.id}`,
        metricDate: '2026-07-29',
        impressions: '900719925474099312345',
        clicks: '7',
        costAmountScaled: '1234567'
      }]);
    }
  });
  const run = await service.createRun({
    projectId: 11,
    triggerType: 'MANUAL',
    userId: 2
  });
  const completed = await service.executeRun(run.runId);
  assert.equal(completed.status, 'SUCCEEDED');
  const [metrics] = await database.sequelize.query(
    `SELECT refresh_run_id, external_account_id, impressions_text
     FROM baidu_campaign_daily_metrics
     ORDER BY binding_id`
  );
  assert.equal(metrics.length, 2);
  assert.ok(metrics.every((row) => row.refresh_run_id === run.runId));
  assert.equal(metrics[0].impressions_text, '900719925474099312345');
  await assert.rejects(
    database.sequelize.query(
      "UPDATE baidu_campaign_daily_metrics SET impressions_text = '1e3'"
    ),
    /constraint|check/iu
  );
});

test('all bindings in one refresh share the same provider resource budget', async (t) => {
  const database = await createMarketingTestDatabase('marketing-shared-budget-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  await seedConnectionAndBinding(database.sequelize, {
    bindingId: 'binding-2',
    connectionId: 'connection-2',
    accountId: 'account-2'
  });
  const budget = { marker: 'one-refresh-budget' };
  const observedBudgets = [];
  const service = refreshService(database.sequelize, {
    createSearchReportBudget() { return budget; },
    async fetchSearchReports({ budget: requestBudget }) {
      observedBudgets.push(requestBudget);
      return campaignOnlyReports();
    }
  });

  const run = await service.createRun({
    projectId: 11,
    triggerType: 'MANUAL',
    userId: 2
  });
  await service.executeRun(run.runId);

  assert.deepEqual(observedBudgets, [budget, budget]);
});

test('rejects legacy duplicate active bindings for the same upstream account', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, {
    bindingId: 'binding-1',
    connectionId: 'connection-1',
    accountId: 'same-account'
  });
  await seedConnectionAndBinding(database.sequelize, {
    bindingId: 'binding-2',
    connectionId: 'connection-2',
    accountId: 'same-account'
  });
  const service = refreshService(database.sequelize, {
    async fetchSearchReports() {
      assert.fail('重复上游账户必须在真实调用前失败');
    }
  });

  await assert.rejects(
    service.createRun({
      projectId: 11,
      triggerType: 'MANUAL',
      userId: 2
    }),
    { code: 'DUPLICATE_UPSTREAM_ACCOUNT_BINDING', status: 409 }
  );
});

test('a later binding failure preserves the complete prior snapshot', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  await seedConnectionAndBinding(database.sequelize, {
    bindingId: 'binding-2',
    connectionId: 'connection-2',
    accountId: 'account-2'
  });
  const successful = refreshService(database.sequelize, {
    async fetchSearchReports({ binding }) {
      return campaignOnlyReports([{
        accountId: binding.accountId,
        campaignId: `old-${binding.id}`,
        campaignName: '旧快照',
        metricDate: '2026-07-29',
        impressions: '1',
        clicks: '1',
        costAmountScaled: '1'
      }]);
    }
  });
  const oldRun = await successful.createRun({
    projectId: 11,
    triggerType: 'MANUAL',
    userId: 2
  });
  await successful.executeRun(oldRun.runId);

  const failing = refreshService(database.sequelize, {
    async fetchSearchReports({ binding }) {
      if (binding.id === 'binding-2') {
        const error = new Error('upstream failed');
        error.code = 'REPORT_UPSTREAM_FAILED';
        throw error;
      }
      return campaignOnlyReports([{
        accountId: binding.accountId,
        campaignId: 'new-campaign',
        campaignName: '不得提交',
        metricDate: '2026-07-29',
        impressions: '99',
        clicks: '99',
        costAmountScaled: '99'
      }]);
    }
  });
  const newRun = await failing.createRun({
    projectId: 11,
    triggerType: 'MANUAL',
    userId: 2
  });
  await assert.rejects(
    failing.executeRun(newRun.runId),
    { code: 'REPORT_UPSTREAM_FAILED' }
  );

  const [metrics] = await database.sequelize.query(
    'SELECT refresh_run_id, campaign_name FROM baidu_campaign_daily_metrics'
  );
  assert.equal(metrics.length, 2);
  assert.ok(metrics.every((row) => row.refresh_run_id === oldRun.runId));
  assert.ok(metrics.every((row) => row.campaign_name === '旧快照'));
  assert.equal(
    (await failing.getRun(11, newRun.runId)).status,
    'FAILED'
  );
});
