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
      ...environment
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

test('marketing migration CLI applies and audits an empty immutable ledger', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-cli-'));
  const databasePath = path.join(directory, 'marketing.sqlite');

  try {
    const apply = runMigration(['--apply'], {
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
      appliedVersions: [],
      pendingVersions: []
    });
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
    MARKETING_MONITORING_ALLOWED_PROJECT_IDS: 'project-1',
    BAIDU_MARKETING_CLIENT_ID: 'client-id-canary',
    BAIDU_MARKETING_CLIENT_SECRET: secret,
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
