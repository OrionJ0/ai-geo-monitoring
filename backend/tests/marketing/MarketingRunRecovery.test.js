const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MarketingExecutor
} = require('../../modules/marketing/services/MarketingExecutor');
const {
  MarketingRefreshService
} = require('../../modules/marketing/services/MarketingRefreshService');
const {
  campaignOnlyReports,
  createMarketingTestDatabase,
  seedConnectionAndBinding
} = require('./helpers/createMarketingTestDatabase');

test('executor singleton interrupts inherited nonterminal runs before accepting work', async (t) => {
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
    costScale: 6
  });
  const run = await refresh.createRun({
    projectId: 11,
    triggerType: 'ON_DEMAND'
  });
  const first = new MarketingExecutor({
    sequelize: database.sequelize,
    refreshService: refresh
  });
  const second = new MarketingExecutor({
    sequelize: database.sequelize,
    refreshService: refresh
  });
  await first.start();
  assert.equal((await refresh.getRun(11, run.runId)).status, 'INTERRUPTED');
  await assert.rejects(
    second.start(),
    { code: 'MARKETING_EXECUTOR_SINGLETON_UNAVAILABLE' }
  );
  await first.stop();
  await second.start();
  await second.stop();
});

test('executor shutdown interrupts queued runs that were not yet drained', async (t) => {
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
    costScale: 6
  });
  const executor = new MarketingExecutor({
    sequelize: database.sequelize,
    refreshService: refresh
  });
  await executor.start();
  const run = await refresh.createRun({
    projectId: 11,
    triggerType: 'ON_DEMAND'
  });

  await executor.stop();

  assert.throws(
    () => executor.enqueue(run.runId),
    {
      code: 'MARKETING_EXECUTOR_NOT_ACCEPTING',
      status: 503,
      retryAfterSeconds: 2
    }
  );

  const terminal = await refresh.getRun(11, run.runId);
  assert.equal(terminal.status, 'INTERRUPTED');
  assert.equal(terminal.failure.code, 'APPLICATION_SHUTDOWN');
  const replacement = await refresh.createRun({
    projectId: 11,
    triggerType: 'ON_DEMAND'
  });
  assert.notEqual(replacement.runId, run.runId);
});
