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

test('concurrent refresh creation returns one active run with a fixed window', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  const service = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports() { return campaignOnlyReports(); }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 6,
    clock: () => Date.parse('2026-07-29T04:00:00.000Z')
  });

  const runs = await Promise.all([
    service.createRun({ projectId: 11, triggerType: 'ON_DEMAND' }),
    service.createRun({ projectId: 11, triggerType: 'ON_DEMAND' })
  ]);
  assert.equal(runs[0].runId, runs[1].runId);
  assert.deepEqual(runs[0].coverage, {
    from: '2026-06-30',
    to: '2026-07-29'
  });
  const [rows] = await database.sequelize.query(
    'SELECT id FROM baidu_marketing_refresh_runs'
  );
  assert.equal(rows.length, 1);
});

test('a queue rejection releases the project refresh slot', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  const service = new MarketingRefreshService({
    sequelize: database.sequelize,
    reportProvider: {
      async fetchSearchReports() { return campaignOnlyReports(); }
    },
    contractVersion: 'fixture-contract-v1',
    currencyCode: 'CNY',
    costScale: 6
  });
  const run = await service.createRun({
    projectId: 11,
    triggerType: 'MANUAL'
  });

  assert.equal(
    await service.rejectQueuedRun(run.runId, 'MARKETING_EXECUTOR_QUEUE_FULL'),
    true
  );
  const next = await service.createRun({
    projectId: 11,
    triggerType: 'MANUAL'
  });

  assert.notEqual(next.runId, run.runId);
  const [rows] = await database.sequelize.query(
    `SELECT status, failure_code
     FROM baidu_marketing_refresh_runs
     WHERE id = :runId`,
    { replacements: { runId: run.runId } }
  );
  assert.deepEqual(rows[0], {
    status: 'FAILED',
    failure_code: 'MARKETING_EXECUTOR_QUEUE_FULL'
  });
});
