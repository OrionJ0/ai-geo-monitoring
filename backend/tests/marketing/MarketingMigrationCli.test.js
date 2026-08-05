const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const backendDirectory = path.resolve(__dirname, '../..');
const migrationScript = path.join(
  backendDirectory,
  'scripts',
  'migrateMarketing.js'
);

function runMigration(args, environment) {
  return spawnSync(process.execPath, [migrationScript, ...args], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      DB_LOGGING: 'false',
      DATABASE_URL: '',
      MARKETING_MONITORING_ENABLED: 'false',
      MARKETING_MONITORING_PILOT_MODE: 'false',
      ...environment
    },
    encoding: 'utf8'
  });
}

function seedThrough014(databasePath) {
  const script = `
    const sequelize = require('./config/database');
    const { createMarketingMigrationRunner } = require('./modules/marketing/migrations/MarketingMigrationRunner');
    const { loadMarketingMigrations } = require('./modules/marketing/migrations');
    (async () => {
      await createMarketingMigrationRunner({
        sequelize,
        migrations: loadMarketingMigrations().slice(0, 14)
      }).apply();
    })().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    }).finally(async () => sequelize.close());
  `;
  return spawnSync(process.execPath, ['-e', script], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      DB_LOGGING: 'false',
      DATABASE_URL: '',
      DB_STORAGE: databasePath,
      MARKETING_MONITORING_ENABLED: 'false',
      MARKETING_MONITORING_PILOT_MODE: 'false'
    },
    encoding: 'utf8'
  });
}

test('backend package exposes real marketing test, migration and audit commands', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(backendDirectory, 'package.json'), 'utf8')
  );

  assert.equal(
    packageJson.scripts['test:marketing'],
    'node scripts/runMarketingTests.js'
  );
  assert.equal(
    packageJson.scripts['audit:marketing'],
    'node scripts/migrateMarketing.js'
  );
  assert.equal(
    packageJson.scripts['migrate:marketing'],
    'node scripts/migrateMarketing.js --apply'
  );
});

test('marketing migration CLI applies and audits all immutable migrations', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-cli-'));
  const databasePath = path.join(directory, 'marketing.sqlite');

  try {
    const seed = seedThrough014(databasePath);
    assert.equal(seed.status, 0, seed.stderr);
    const apply = runMigration([
      '--apply',
      '--expected-latest=015-drop-legacy-tongji-credentials'
    ], {
      DB_STORAGE: databasePath,
      MARKETING_MONITORING_ENABLED: 'false'
    });
    assert.equal(apply.status, 0, apply.stderr);
    assert.equal(JSON.parse(apply.stdout).phase, 'migration_complete');

    const audit = runMigration([], {
      DB_STORAGE: databasePath,
      MARKETING_MONITORING_ENABLED: 'false'
    });
    assert.equal(audit.status, 0, audit.stderr);
    assert.deepEqual(JSON.parse(audit.stdout), {
      phase: 'migration_audit',
      configState: 'DISABLED',
      ready: true,
      ledgerPresent: true,
      appliedVersions: [
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
      ],
      pendingVersions: []
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('marketing migration CLI rejects a repository boundary mismatch before apply', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-gate-'));
  const databasePath = path.join(directory, 'marketing.sqlite');

  try {
    const execution = runMigration([
      '--apply',
      '--expected-latest=014-unified-oauth-context'
    ], {
      DB_STORAGE: databasePath,
      MARKETING_MONITORING_ENABLED: 'false'
    });
    assert.notEqual(execution.status, 0);
    assert.equal(
      JSON.parse(execution.stderr).errorCode,
      'MARKETING_MIGRATION_EXPECTED_LATEST_MISMATCH'
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('marketing migration CLI rejects unexpected pending history at an A2 gate', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-pending-gate-'));
  const databasePath = path.join(directory, 'marketing.sqlite');

  try {
    const execution = runMigration([
      '--apply',
      '--expected-latest=015-drop-legacy-tongji-credentials'
    ], {
      DB_STORAGE: databasePath,
      MARKETING_MONITORING_ENABLED: 'false'
    });
    assert.notEqual(execution.status, 0);
    assert.equal(
      JSON.parse(execution.stderr).errorCode,
      'MARKETING_MIGRATION_UNEXPECTED_PENDING'
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('marketing audit rejects an unsafe callback without echoing config values', () => {
  const secret = 'cli-marketing-secret-canary';
  const execution = runMigration([], {
    DB_STORAGE: ':memory:',
    NODE_ENV: 'production',
    MARKETING_MONITORING_ENABLED: 'true',
    MARKETING_MONITORING_PILOT_MODE: 'false',
    MARKETING_MONITORING_ALLOWED_PROJECT_IDS: 'project-1',
    CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    BAIDU_MARKETING_APP_ID: 'app-id-canary',
    BAIDU_MARKETING_SECRET_KEY: secret,
    BAIDU_MARKETING_SCOPE: 'search-report-read-canary',
    BAIDU_MARKETING_REDIRECT_URI: 'http://marketing.example.test/callback?code=canary',
    BAIDU_MARKETING_CONTRACT_VERSION: 'baidu-search-test-v1',
    BAIDU_MARKETING_HTTP_TIMEOUT_MS: '10000'
  });

  assert.notEqual(execution.status, 0);
  const failure = JSON.parse(execution.stderr);
  assert.equal(failure.errorCode, 'MARKETING_REDIRECT_URI_INVALID');
  assert.doesNotMatch(execution.stdout + execution.stderr, new RegExp(secret));
  assert.doesNotMatch(execution.stdout + execution.stderr, /code=canary/);
});
