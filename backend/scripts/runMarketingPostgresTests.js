const crypto = require('node:crypto');
const { Sequelize } = require('sequelize');
const {
  createMarketingMigrationRunner
} = require('../modules/marketing/migrations/MarketingMigrationRunner');
const {
  MarketingDashboardService
} = require('../modules/marketing/services/MarketingDashboardService');
const {
  MarketingRefreshService
} = require('../modules/marketing/services/MarketingRefreshService');

function postgresSafetyError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertDisposablePostgresUrl(rawUrl, productionUrl = '') {
  const value = String(rawUrl || '').trim();
  if (!value) {
    throw postgresSafetyError(
      '缺少 POSTGRES_TEST_URL',
      'MARKETING_POSTGRES_TEST_URL_REQUIRED'
    );
  }
  if (productionUrl && value === String(productionUrl).trim()) {
    throw postgresSafetyError(
      '测试数据库不得与 DATABASE_URL 相同',
      'MARKETING_POSTGRES_PRODUCTION_URL_REJECTED'
    );
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw postgresSafetyError(
      'POSTGRES_TEST_URL 无效',
      'MARKETING_POSTGRES_TEST_URL_INVALID'
    );
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw postgresSafetyError(
      'POSTGRES_TEST_URL 必须使用 PostgreSQL',
      'MARKETING_POSTGRES_TEST_URL_INVALID'
    );
  }
  const safetyText = [
    url.hostname,
    url.pathname,
    url.username
  ].join(' ').toLowerCase();
  if (!/(?:test|testing|localhost|127\.0\.0\.1|::1)/u.test(safetyText)) {
    throw postgresSafetyError(
      'POSTGRES_TEST_URL 缺少明确测试标识',
      'MARKETING_POSTGRES_TEST_URL_UNSAFE'
    );
  }
  return value;
}

async function run() {
  const connectionUrl = assertDisposablePostgresUrl(
    process.env.POSTGRES_TEST_URL,
    process.env.DATABASE_URL
  );
  const schema = (
    `marketing_test_${crypto.randomUUID().replaceAll('-', '')}`
  );
  const admin = new Sequelize(connectionUrl, {
    logging: false,
    pool: { min: 0, max: 1 }
  });
  let database = null;
  try {
    await admin.authenticate();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    database = new Sequelize(connectionUrl, {
      logging: false,
      pool: {
        min: 0,
        max: 1,
        afterCreate(connection, done) {
          connection.query(`SET search_path TO "${schema}"`, (error) => {
            done(error, connection);
          });
        }
      },
      define: { schema }
    });
    await database.authenticate();
    await database.query(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        role TEXT NOT NULL,
        status TEXT NOT NULL
      )
    `);
    await database.query(`
      CREATE TABLE brand_projects (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL
      )
    `);
    const result = await createMarketingMigrationRunner({
      sequelize: database
    }).apply();
    if (!result.ready || result.appliedVersions.length !== 3) {
      throw postgresSafetyError(
        'PostgreSQL 营销迁移验收失败',
        'MARKETING_POSTGRES_MIGRATION_FAILED'
      );
    }
    await database.query(
      `INSERT INTO users (id, role, status)
       VALUES (1, 'admin', 'active'), (2, 'user', 'active')`
    );
    await database.query(
      `INSERT INTO brand_projects (id, user_id, name, status)
       VALUES (11, 2, 'PostgreSQL 营销验收', 'active')`
    );
    await database.query(
      `INSERT INTO baidu_marketing_connections (
        id, status, authorized_principal_id, authorized_principal_name,
        access_token_ciphertext, refresh_token_ciphertext,
        access_token_expires_at, auth_generation, token_version,
        refresh_claim_token, refresh_claim_until, created_by_user_id,
        last_error_code, created_at, updated_at
      ) VALUES (
        'pg-connection-1', 'CONNECTED', 'pg-principal-1', '脱敏主体',
        'fixture-ciphertext', NULL, NULL, 0, 1,
        NULL, NULL, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )`
    );
    await database.query(
      `INSERT INTO baidu_project_bindings (
        id, project_id, connection_id, external_account_id,
        external_account_name, status, binding_version, paused_reason,
        created_by_user_id, created_at, updated_at
      ) VALUES (
        'pg-binding-1', 11, 'pg-connection-1',
        '0009007199254740993123', '脱敏搜索账户',
        'ACTIVE', 0, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )`
    );
    const clock = () => Date.parse('2026-07-29T04:00:00.000Z');
    const refresh = new MarketingRefreshService({
      sequelize: database,
      reportProvider: {
        async fetchSearchReport() {
          return [{
            accountId: '0009007199254740993123',
            campaignId: 'campaign-0009007199254740993123',
            campaignName: 'PostgreSQL 验收计划',
            metricDate: '2026-07-29',
            impressions: '900719925474099312345',
            clicks: '7',
            costAmountScaled: '3000003'
          }];
        }
      },
      contractVersion: 'postgres-fixture-v1',
      currencyCode: 'CNY',
      costScale: 6,
      clock
    });
    const concurrentRuns = await Promise.all([
      refresh.createRun({ projectId: 11, triggerType: 'MANUAL' }),
      refresh.createRun({ projectId: 11, triggerType: 'MANUAL' })
    ]);
    if (concurrentRuns[0].runId !== concurrentRuns[1].runId) {
      throw postgresSafetyError(
        'PostgreSQL 活动刷新唯一性验收失败',
        'MARKETING_POSTGRES_RUN_UNIQUENESS_FAILED'
      );
    }
    await refresh.executeRun(concurrentRuns[0].runId);
    const dashboardService = new MarketingDashboardService({
      sequelize: database,
      clock
    });
    const dashboard = await dashboardService.read({ projectId: 11 });
    if (
      dashboard.revision !== concurrentRuns[0].runId
      || dashboard.summary.impressions !== '900719925474099312345'
      || dashboard.summary.costAmountScaled !== '3000003'
    ) {
      throw postgresSafetyError(
        'PostgreSQL 精确快照验收失败',
        'MARKETING_POSTGRES_SNAPSHOT_FAILED'
      );
    }
    const failingRefresh = new MarketingRefreshService({
      sequelize: database,
      reportProvider: {
        async fetchSearchReport() {
          const error = new Error('synthetic provider failure');
          error.code = 'SYNTHETIC_PROVIDER_FAILURE';
          throw error;
        }
      },
      contractVersion: 'postgres-fixture-v1',
      currencyCode: 'CNY',
      costScale: 6,
      clock
    });
    const failingRun = await failingRefresh.createRun({
      projectId: 11,
      triggerType: 'MANUAL'
    });
    await failingRefresh.executeRun(failingRun.runId).then(
      () => {
        throw postgresSafetyError(
          'PostgreSQL 失败刷新未失败',
          'MARKETING_POSTGRES_FAILURE_PATH_FAILED'
        );
      },
      () => {}
    );
    const preserved = await dashboardService.read({ projectId: 11 });
    if (preserved.revision !== concurrentRuns[0].runId) {
      throw postgresSafetyError(
        'PostgreSQL 失败刷新破坏旧快照',
        'MARKETING_POSTGRES_SNAPSHOT_PRESERVATION_FAILED'
      );
    }
    process.stdout.write(JSON.stringify({
      status: 'passed',
      dialect: 'postgres',
      appliedVersions: result.appliedVersions,
      snapshotRevision: dashboard.revision,
      failurePreservedRevision: preserved.revision
    }));
  } finally {
    await database?.close().catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      .catch(() => {});
    await admin.close().catch(() => {});
  }
}

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(JSON.stringify({
      status: 'failed',
      errorCode: error?.code || 'MARKETING_POSTGRES_TEST_FAILED',
      message: error?.message || 'PostgreSQL 营销测试失败'
    }));
    process.exitCode = 1;
  });
}

module.exports = {
  assertDisposablePostgresUrl
};
