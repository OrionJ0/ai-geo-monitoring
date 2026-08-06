const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Sequelize } = require('sequelize');

const {
  createMarketingMigrationRunner,
  ledgerChecksumConstraint,
  lockLegacyCredentialContractTables
} = require('../../modules/marketing/migrations/MarketingMigrationRunner');
const {
  loadMarketingMigrations
} = require('../../modules/marketing/migrations');

function createDatabase(storage) {
  return new Sequelize({
    dialect: 'sqlite',
    storage,
    logging: false,
    pool: {
      max: 5,
      min: 0,
      idle: 1000
    }
  });
}

async function prepareUnifiedOAuthContractDatabase(database) {
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
  await database.query(
    "INSERT INTO users (id, role, status) VALUES (1, 'admin', 'active')"
  );
  await database.query(
    "INSERT INTO brand_projects (id, user_id, name, status) VALUES (1, 1, '迁移验收项目', 'active')"
  );
  await createMarketingMigrationRunner({
    sequelize: database,
    migrations: loadMarketingMigrations().slice(0, 14)
  }).apply();
  await database.query(`
    INSERT INTO baidu_marketing_connections (
      id, status, authorized_principal_id,
      access_token_ciphertext, refresh_token_ciphertext,
      access_token_expires_at, auth_generation, token_version,
      refresh_claim_token, refresh_claim_until, created_by_user_id,
      tongji_account_name, tongji_access_token_ciphertext,
      tongji_credential_updated_at, tongji_user_name,
      tongji_user_name_verified_at,
      marketing_access_state, marketing_observed_auth_generation,
      marketing_observed_token_version, marketing_checked_at,
      marketing_last_error_code, tongji_access_state,
      tongji_observed_auth_generation, tongji_observed_token_version,
      tongji_checked_at, tongji_last_error_code,
      created_at, updated_at
    ) VALUES (
      'connection-015', 'CONNECTED', 'principal-015',
      'v1:oauth-ciphertext', 'v1:refresh-ciphertext',
      '2026-08-06T00:00:00.000Z', 2, 6,
      NULL, NULL, 1,
      'legacy-user', 'v1:legacy-tongji-canary',
      '2026-08-05T12:00:00.000Z', 'verified-user',
      '2026-08-05T12:30:00.000Z',
      'VERIFIED', 2, 6, '2026-08-05T12:30:00.000Z',
      NULL, 'VERIFIED', 2, 6,
      '2026-08-05T12:30:00.000Z', NULL,
      '2026-08-05T12:00:00.000Z', '2026-08-05T12:30:00.000Z'
    )
  `);
  await database.query(`
    INSERT INTO baidu_project_bindings (
      id, project_id, connection_id, external_account_id,
      external_account_name, status, binding_version, paused_reason,
      created_by_user_id, tongji_site_id, tongji_site_domain,
      created_at, updated_at
    ) VALUES (
      'binding-015', 1, 'connection-015', 'account-015',
      '迁移验收账户', 'ACTIVE', 3, NULL,
      1, 'site-015', 'example.test',
      '2026-08-05T12:00:00.000Z', '2026-08-05T12:30:00.000Z'
    )
  `);
}

test('root sequelize sync never registers or creates marketing domain tables', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-root-sync-'));
  const databasePath = path.join(directory, 'root.sqlite');
  const script = `
    process.env.DB_STORAGE = ${JSON.stringify(databasePath)};
    process.env.DB_LOGGING = 'false';
    delete process.env.DATABASE_URL;
    const { sequelize } = require('./models');
    (async () => {
      await sequelize.sync({ force: true });
      console.log(JSON.stringify(await sequelize.getQueryInterface().showAllTables()));
      await sequelize.close();
    })().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `;

  try {
    const execution = spawnSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf8'
    });
    assert.equal(execution.status, 0, execution.stderr);
    const tables = JSON.parse(execution.stdout.trim());
    assert.equal(tables.some((name) => /^baidu_/u.test(String(name))), false);
    assert.equal(tables.includes('marketing_schema_migrations'), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('marketing ships immutable domain migrations in order', () => {
  assert.deepEqual(
    loadMarketingMigrations().map((migration) => migration.version),
    [
      '001-authorization-connections',
      '002-project-bindings',
      '003-campaign-snapshots',
      '004-baidu-oauth-identity',
      '005-tongji-site-bindings',
      '006-tongji-credentials',
      '007-tongji-snapshots',
      '008-tongji-source-trend-snapshots',
      '009-tongji-range-snapshots',
      '010-search-hierarchy-snapshots',
      '011-tongji-cache-pruning-indexes',
      '012-tongji-snapshot-capabilities',
      '013-tongji-page-report-snapshots',
      '014-unified-oauth-context',
      '015-drop-legacy-tongji-credentials'
    ]
  );
});

test('migration ledger uses a checksum constraint supported by each dialect', () => {
  assert.equal(
    ledgerChecksumConstraint('postgres'),
    "checksum ~ '^[0-9a-f]{64}$'"
  );
  assert.match(ledgerChecksumConstraint('sqlite'), /GLOB/u);
  assert.doesNotMatch(ledgerChecksumConstraint('postgres'), /GLOB/u);
});

test('PostgreSQL locks every 015 contract table against concurrent business writes', async () => {
  const calls = [];
  const transaction = { id: 'migration-transaction' };
  await lockLegacyCredentialContractTables({
    async query(sql, options) {
      calls.push({ sql, options });
    }
  }, transaction);

  assert.deepEqual(calls, [
    {
      sql: "SET LOCAL lock_timeout = '5s'",
      options: { transaction }
    },
    {
      sql: 'LOCK TABLE baidu_marketing_connections IN ACCESS EXCLUSIVE MODE',
      options: { transaction }
    },
    {
      sql: 'LOCK TABLE baidu_project_bindings, baidu_authorization_attempts IN SHARE MODE',
      options: { transaction }
    }
  ]);
});

test('PostgreSQL 015 contract lock timeout fails with a stable code', async () => {
  const transaction = { id: 'migration-transaction' };
  await assert.rejects(
    lockLegacyCredentialContractTables({
      async query(sql) {
        if (sql.startsWith('LOCK TABLE')) {
          throw Object.assign(new Error('canceling statement due to lock timeout'), {
            original: { code: '55P03' }
          });
        }
      }
    }, transaction),
    { code: 'MARKETING_MIGRATION_LOCK_TIMEOUT' }
  );
});

test('marketing migration audit is read-only and applies its source tables idempotently', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-ledger-'));
  const database = createDatabase(path.join(directory, 'ledger.sqlite'));
  t.after(async () => {
    await database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const runner = createMarketingMigrationRunner({ sequelize: database });

  assert.deepEqual(await runner.audit(), {
    ready: false,
    ledgerPresent: false,
    appliedVersions: [],
    pendingVersions: [
      '001-authorization-connections',
      '002-project-bindings',
      '003-campaign-snapshots',
      '004-baidu-oauth-identity',
      '005-tongji-site-bindings',
      '006-tongji-credentials',
      '007-tongji-snapshots',
      '008-tongji-source-trend-snapshots',
      '009-tongji-range-snapshots',
      '010-search-hierarchy-snapshots',
      '011-tongji-cache-pruning-indexes',
      '012-tongji-snapshot-capabilities',
      '013-tongji-page-report-snapshots',
      '014-unified-oauth-context',
      '015-drop-legacy-tongji-credentials'
    ]
  });
  assert.deepEqual(await database.getQueryInterface().showAllTables(), []);

  const first = await runner.apply();
  const second = await runner.apply();
  const tables = await database.getQueryInterface().showAllTables();

  assert.equal(first.ready, true);
  assert.deepEqual(second, first);
  assert.deepEqual([...tables].sort(), [
    'baidu_ad_group_daily_metrics',
    'baidu_authorization_attempts',
    'baidu_campaign_daily_metrics',
    'baidu_keyword_daily_metrics',
    'baidu_marketing_connections',
    'baidu_marketing_refresh_runs',
    'baidu_project_bindings',
    'baidu_search_term_daily_metrics',
    'baidu_tongji_page_report_snapshots',
    'baidu_tongji_range_snapshots',
    'baidu_tongji_snapshots',
    'baidu_tongji_source_trend_snapshots',
    'marketing_schema_migrations'
  ]);
  const columns = await database.getQueryInterface().describeTable(
    'baidu_marketing_connections'
  );
  assert.ok(columns.authorized_open_id);
  assert.ok(columns.refresh_token_expires_at);
  assert.equal(columns.tongji_account_name, undefined);
  assert.equal(columns.tongji_access_token_ciphertext, undefined);
  assert.equal(columns.tongji_credential_updated_at, undefined);
  assert.ok(columns.tongji_user_name);
  assert.ok(columns.tongji_user_name_verified_at);
  assert.ok(columns.marketing_access_state);
  assert.ok(columns.marketing_observed_auth_generation);
  assert.ok(columns.marketing_observed_token_version);
  assert.ok(columns.marketing_checked_at);
  assert.ok(columns.marketing_last_error_code);
  assert.ok(columns.tongji_access_state);
  assert.ok(columns.tongji_observed_auth_generation);
  assert.ok(columns.tongji_observed_token_version);
  assert.ok(columns.tongji_checked_at);
  assert.ok(columns.tongji_last_error_code);
  const bindingColumns = await database.getQueryInterface().describeTable(
    'baidu_project_bindings'
  );
  assert.ok(bindingColumns.tongji_site_id);
  assert.ok(bindingColumns.tongji_site_domain);
  const tongjiIndexes = await database.getQueryInterface().showIndex(
    'baidu_tongji_range_snapshots'
  );
  const rangeIndex = tongjiIndexes.find(
    (index) => index.name === 'baidu_tongji_range_snapshots_scope'
  );
  assert.equal(rangeIndex?.unique, true);
  assert.deepEqual(rangeIndex?.fields.map((field) => field.attribute), [
    'project_id',
    'device',
    'coverage_start',
    'coverage_end'
  ]);
  const snapshotIndexes = await database.getQueryInterface().showIndex(
    'baidu_tongji_snapshots'
  );
  const sourceTrendIndexes = await database.getQueryInterface().showIndex(
    'baidu_tongji_source_trend_snapshots'
  );
  const rangeSnapshotIndexes = await database.getQueryInterface().showIndex(
    'baidu_tongji_range_snapshots'
  );
  const pageReportIndexes = await database.getQueryInterface().showIndex(
    'baidu_tongji_page_report_snapshots'
  );
  assert.deepEqual(
    snapshotIndexes.find(
      (index) => index.name === 'baidu_tongji_snapshots_refreshed'
    )?.fields.map((field) => field.attribute),
    ['refreshed_at']
  );
  assert.deepEqual(
    sourceTrendIndexes.find(
      (index) => index.name === 'baidu_tongji_source_trends_refreshed'
    )?.fields.map((field) => field.attribute),
    ['refreshed_at']
  );
  assert.deepEqual(
    rangeSnapshotIndexes.find(
      (index) => index.name === 'baidu_tongji_range_snapshots_refreshed'
    )?.fields.map((field) => field.attribute),
    ['refreshed_at']
  );
  assert.equal(
    pageReportIndexes.find(
      (index) => index.name === 'baidu_tongji_page_reports_scope'
    )?.unique,
    true
  );
  assert.deepEqual(
    pageReportIndexes.find(
      (index) => index.name === 'baidu_tongji_page_reports_refreshed'
    )?.fields.map((field) => field.attribute),
    ['refreshed_at']
  );
});

test('014 copies only the legacy user name as an unverified candidate', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-014-'));
  const database = createDatabase(path.join(directory, 'migration.sqlite'));
  t.after(async () => {
    await database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
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
  await database.query(
    "INSERT INTO users (id, role, status) VALUES (1, 'admin', 'active')"
  );

  const migrations = loadMarketingMigrations().slice(0, 14);
  await createMarketingMigrationRunner({
    sequelize: database,
    migrations: migrations.slice(0, -1)
  }).apply();
  await database.query(
    `INSERT INTO baidu_marketing_connections (
      id, status, authorized_principal_id,
      access_token_ciphertext, refresh_token_ciphertext,
      access_token_expires_at, auth_generation, token_version,
      refresh_claim_token, refresh_claim_until, created_by_user_id,
      tongji_account_name, tongji_access_token_ciphertext,
      tongji_credential_updated_at, created_at, updated_at
    ) VALUES (
      'connection-014', 'CONNECTED', 'principal-014',
      'v1:oauth-ciphertext', 'v1:refresh-ciphertext',
      NULL, 0, 1, NULL, NULL, 1,
      'legacy-user', 'v1:legacy-tongji-canary', CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`
  );

  await createMarketingMigrationRunner({
    sequelize: database,
    migrations
  }).apply();
  const [rows] = await database.query(
    `SELECT tongji_account_name, tongji_access_token_ciphertext,
            tongji_user_name, tongji_user_name_verified_at,
            marketing_access_state, marketing_observed_auth_generation,
            tongji_access_state, tongji_observed_token_version
     FROM baidu_marketing_connections
     WHERE id = 'connection-014'`
  );
  assert.deepEqual(rows[0], {
    tongji_account_name: 'legacy-user',
    tongji_access_token_ciphertext: 'v1:legacy-tongji-canary',
    tongji_user_name: 'legacy-user',
    tongji_user_name_verified_at: null,
    marketing_access_state: 'UNKNOWN',
    marketing_observed_auth_generation: null,
    tongji_access_state: 'UNKNOWN',
    tongji_observed_token_version: null
  });
});

test('015 rejects every unsafe unified OAuth contract and preserves legacy columns', async (t) => {
  const cases = [
    {
      name: 'active binding connection is not connected',
      mutate: "UPDATE baidu_marketing_connections SET status = 'REAUTH_REQUIRED' WHERE id = 'connection-015'"
    },
    {
      name: 'verified user name is missing',
      mutate: "UPDATE baidu_marketing_connections SET tongji_user_name = NULL WHERE id = 'connection-015'"
    },
    {
      name: 'user name verification is missing',
      mutate: "UPDATE baidu_marketing_connections SET tongji_user_name_verified_at = NULL WHERE id = 'connection-015'"
    },
    {
      name: 'marketing capability is not verified',
      mutate: "UPDATE baidu_marketing_connections SET marketing_access_state = 'UNKNOWN' WHERE id = 'connection-015'"
    },
    {
      name: 'tongji capability is not verified',
      mutate: "UPDATE baidu_marketing_connections SET tongji_access_state = 'UNKNOWN' WHERE id = 'connection-015'"
    },
    {
      name: 'marketing auth generation is stale',
      mutate: "UPDATE baidu_marketing_connections SET marketing_observed_auth_generation = 1 WHERE id = 'connection-015'"
    },
    {
      name: 'marketing token version is stale',
      mutate: "UPDATE baidu_marketing_connections SET marketing_observed_token_version = 5 WHERE id = 'connection-015'"
    },
    {
      name: 'tongji auth generation is stale',
      mutate: "UPDATE baidu_marketing_connections SET tongji_observed_auth_generation = 1 WHERE id = 'connection-015'"
    },
    {
      name: 'tongji token version is stale',
      mutate: "UPDATE baidu_marketing_connections SET tongji_observed_token_version = 5 WHERE id = 'connection-015'"
    },
    {
      name: 'refresh claim is active',
      mutate: `UPDATE baidu_marketing_connections
               SET refresh_claim_token = 'active-claim',
                   refresh_claim_until = '2099-01-01T00:00:00.000Z'
               WHERE id = 'connection-015'`
    }
  ];

  for (const contractCase of cases) {
    await t.test(contractCase.name, async (subtest) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-015-gate-'));
      const database = createDatabase(path.join(directory, 'migration.sqlite'));
      subtest.after(async () => {
        await database.close();
        fs.rmSync(directory, { recursive: true, force: true });
      });
      await prepareUnifiedOAuthContractDatabase(database);
      await database.query(contractCase.mutate);

      await assert.rejects(
        createMarketingMigrationRunner({ sequelize: database }).apply(),
        (error) => error.code === 'MARKETING_LEGACY_TONGJI_CONTRACT_UNSAFE'
      );
      const columns = await database.getQueryInterface().describeTable(
        'baidu_marketing_connections'
      );
      assert.ok(columns.tongji_account_name);
      assert.ok(columns.tongji_access_token_ciphertext);
      assert.ok(columns.tongji_credential_updated_at);
      const [ledger] = await database.query(
        'SELECT version FROM marketing_schema_migrations ORDER BY version'
      );
      assert.equal(ledger.at(-1)?.version, '014-unified-oauth-context');
    });
  }
});

test('015 rejects an in-flight reauthorization and rolls back intact', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-015-reauth-'));
  const database = createDatabase(path.join(directory, 'migration.sqlite'));
  t.after(async () => {
    await database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await prepareUnifiedOAuthContractDatabase(database);
  await database.query(`
    INSERT INTO baidu_authorization_attempts (
      id, launch_ticket_hash, provider_state_hash, result_ticket_hash,
      operation, initiated_by_user_id, target_connection_id,
      expected_auth_generation, status, launch_consumed_at,
      result_consumed_at, expires_at, completed_at, failure_code,
      created_at, updated_at
    ) VALUES (
      'attempt-015', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      NULL, NULL, 'REAUTHORIZE', 1, 'connection-015',
      3, 'PROCESSING', '2026-08-05T12:40:00.000Z',
      NULL, '2099-01-01T00:00:00.000Z', NULL, NULL,
      '2026-08-05T12:40:00.000Z', '2026-08-05T12:40:00.000Z'
    )
  `);

  await assert.rejects(
    createMarketingMigrationRunner({ sequelize: database }).apply(),
    (error) => error.code === 'MARKETING_LEGACY_TONGJI_CONTRACT_UNSAFE'
  );
  const columns = await database.getQueryInterface().describeTable(
    'baidu_marketing_connections'
  );
  assert.ok(columns.tongji_access_token_ciphertext);
});

test('015 removes only legacy Tongji credentials and is idempotently auditable', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-015-success-'));
  const database = createDatabase(path.join(directory, 'migration.sqlite'));
  t.after(async () => {
    await database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await prepareUnifiedOAuthContractDatabase(database);

  const runner = createMarketingMigrationRunner({ sequelize: database });
  const first = await runner.apply({
    expectedLatest: '015-drop-legacy-tongji-credentials'
  });
  const second = await runner.apply({
    expectedLatest: '015-drop-legacy-tongji-credentials'
  });
  const columns = await database.getQueryInterface().describeTable(
    'baidu_marketing_connections'
  );
  assert.equal(columns.tongji_account_name, undefined);
  assert.equal(columns.tongji_access_token_ciphertext, undefined);
  assert.equal(columns.tongji_credential_updated_at, undefined);
  assert.ok(columns.access_token_ciphertext);
  assert.ok(columns.refresh_token_ciphertext);
  assert.ok(columns.tongji_user_name);
  assert.ok(columns.tongji_user_name_verified_at);
  assert.deepEqual(second, first);
  assert.equal(first.ready, true);
  assert.equal(
    first.appliedVersions.at(-1),
    '015-drop-legacy-tongji-credentials'
  );
  const [rows] = await database.query(
    `SELECT status, auth_generation, token_version,
            tongji_user_name, marketing_access_state, tongji_access_state
     FROM baidu_marketing_connections
     WHERE id = 'connection-015'`
  );
  assert.deepEqual(rows[0], {
    status: 'CONNECTED',
    auth_generation: 2,
    token_version: 6,
    tongji_user_name: 'verified-user',
    marketing_access_state: 'VERIFIED',
    tongji_access_state: 'VERIFIED'
  });
});

test('015 DDL failure rolls back every legacy column and its ledger entry', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-015-rollback-'));
  const database = createDatabase(path.join(directory, 'migration.sqlite'));
  t.after(async () => {
    await database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await prepareUnifiedOAuthContractDatabase(database);
  const migration = require('../../modules/marketing/migrations/015-drop-legacy-tongji-credentials');
  let alterCount = 0;

  await assert.rejects(
    database.transaction(async (transaction) => migration.up({
      sequelize: {
        async query(sql, options) {
          if (/^ALTER TABLE/u.test(sql)) {
            alterCount += 1;
            if (alterCount === 2) {
              const error = new Error('synthetic DDL failure');
              error.code = 'SYNTHETIC_DDL_FAILURE';
              throw error;
            }
          }
          return database.query(sql, options);
        }
      },
      transaction
    })),
    (error) => error.code === 'SYNTHETIC_DDL_FAILURE'
  );
  const columns = await database.getQueryInterface().describeTable(
    'baidu_marketing_connections'
  );
  assert.ok(columns.tongji_account_name);
  assert.ok(columns.tongji_access_token_ciphertext);
  assert.ok(columns.tongji_credential_updated_at);
  const [ledger] = await database.query(
    "SELECT version FROM marketing_schema_migrations WHERE version = '015-drop-legacy-tongji-credentials'"
  );
  assert.deepEqual(ledger, []);
});

test('A2 backup restoration is auditable by the 014 recovery revision', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-a2-recovery-'));
  const databasePath = path.join(directory, 'production.sqlite');
  const backupPath = path.join(directory, 'database.pre-a2.sqlite');
  let database = createDatabase(databasePath);
  try {
    await prepareUnifiedOAuthContractDatabase(database);
    await database.close();
    fs.copyFileSync(databasePath, backupPath, fs.constants.COPYFILE_EXCL);

    database = createDatabase(databasePath);
    await createMarketingMigrationRunner({ sequelize: database }).apply({
      expectedLatest: '015-drop-legacy-tongji-credentials'
    });
    await database.close();

    fs.copyFileSync(backupPath, databasePath);
    database = createDatabase(databasePath);
    const recovery = await createMarketingMigrationRunner({
      sequelize: database,
      migrations: loadMarketingMigrations().slice(0, 14)
    }).audit();
    const columns = await database.getQueryInterface().describeTable(
      'baidu_marketing_connections'
    );
    assert.equal(recovery.ready, true);
    assert.equal(recovery.pendingVersions.length, 0);
    assert.equal(
      recovery.appliedVersions.at(-1),
      '014-unified-oauth-context'
    );
    assert.ok(columns.tongji_account_name);
    assert.ok(columns.tongji_access_token_ciphertext);
    assert.ok(columns.tongji_credential_updated_at);
  } finally {
    await database.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('concurrent SQLite runners serialize and apply a migration once', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-lock-'));
  const databasePath = path.join(directory, 'locked.sqlite');
  const migrationDirectory = path.join(directory, 'migrations');
  fs.mkdirSync(migrationDirectory);
  fs.writeFileSync(
    path.join(migrationDirectory, '001-lock-probe.js'),
    [
      'module.exports = {',
      '  async up({ sequelize, transaction }) {',
      "    await sequelize.query('CREATE TABLE marketing_lock_probe (id TEXT PRIMARY KEY)', { transaction });",
      '  }',
      '};',
      ''
    ].join('\n')
  );

  const firstDatabase = createDatabase(databasePath);
  const secondDatabase = createDatabase(databasePath);
  t.after(async () => {
    await Promise.all([
      firstDatabase.close(),
      secondDatabase.close()
    ]);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await Promise.all([
    firstDatabase.query('PRAGMA busy_timeout=5000'),
    secondDatabase.query('PRAGMA busy_timeout=5000')
  ]);

  const migrations = loadMarketingMigrations({ directory: migrationDirectory });
  const firstRunner = createMarketingMigrationRunner({
    sequelize: firstDatabase,
    migrations
  });
  const secondRunner = createMarketingMigrationRunner({
    sequelize: secondDatabase,
    migrations
  });

  const [first, second] = await Promise.all([
    firstRunner.apply(),
    secondRunner.apply()
  ]);
  const [rows] = await firstDatabase.query(
    'SELECT version FROM marketing_schema_migrations'
  );

  assert.equal(first.ready, true);
  assert.equal(second.ready, true);
  assert.deepEqual(rows.map((row) => row.version), ['001-lock-probe']);
});

test('audit rejects an edited migration after its checksum was recorded', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-checksum-'));
  const migrationDirectory = path.join(directory, 'migrations');
  const migrationPath = path.join(migrationDirectory, '001-checksum-probe.js');
  fs.mkdirSync(migrationDirectory);
  fs.writeFileSync(
    migrationPath,
    [
      'module.exports = {',
      '  async up({ sequelize, transaction }) {',
      "    await sequelize.query('CREATE TABLE marketing_checksum_probe (id TEXT PRIMARY KEY)', { transaction });",
      '  }',
      '};',
      ''
    ].join('\n')
  );

  const database = createDatabase(path.join(directory, 'checksum.sqlite'));
  t.after(async () => {
    await database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await createMarketingMigrationRunner({
    sequelize: database,
    migrations: loadMarketingMigrations({ directory: migrationDirectory })
  }).apply();

  fs.appendFileSync(migrationPath, '// edited after apply\n');
  const editedRunner = createMarketingMigrationRunner({
    sequelize: database,
    migrations: loadMarketingMigrations({ directory: migrationDirectory })
  });

  await assert.rejects(
    editedRunner.audit(),
    (error) => error.code === 'MARKETING_MIGRATION_CHECKSUM_MISMATCH'
  );
});
