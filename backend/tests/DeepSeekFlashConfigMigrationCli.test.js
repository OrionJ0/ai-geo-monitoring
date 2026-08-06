const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sqlite3 = require('sqlite3');

const migrationScript = path.resolve(
  __dirname,
  '../scripts/migrateDeepSeekFlashConfig.js'
);

function openDatabase(filename) {
  return new sqlite3.Database(filename);
}

function run(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function get(database, sql) {
  return new Promise((resolve, reject) => {
    database.get(sql, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function close(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function createDatabase(filename, overrides = {}) {
  const database = openDatabase(filename);
  await run(database, `
    CREATE TABLE ai_platform_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      adapter_type VARCHAR(50) NOT NULL,
      base_url VARCHAR(2048) NOT NULL,
      encrypted_api_key TEXT,
      api_key_last4 VARCHAR(4),
      default_model VARCHAR(255) NOT NULL,
      request_timeout_seconds INTEGER,
      max_tokens INTEGER,
      request_options JSON NOT NULL DEFAULT '{}',
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      builtin TINYINT(1) NOT NULL DEFAULT 0,
      archived_at DATETIME,
      test_status VARCHAR(20) NOT NULL DEFAULT 'untested',
      last_tested_at DATETIME,
      last_test_error_code VARCHAR(50),
      last_test_message VARCHAR(255),
      web_search_test_status VARCHAR(20) NOT NULL DEFAULT 'untested',
      last_web_search_tested_at DATETIME,
      last_web_search_test_error_code VARCHAR(50),
      last_web_search_test_message VARCHAR(255),
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    )
  `);
  const row = {
    code: 'deepseek',
    name: 'DeepSeek',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.deepseek.com/v1/chat/completions',
    encrypted_api_key: 'encrypted-cli-key-canary',
    api_key_last4: '5678',
    default_model: 'deepseek-v4-pro',
    request_options: '{}',
    enabled: 1,
    builtin: 1,
    ...overrides
  };
  await run(database, `
    INSERT INTO ai_platform_configs (
      code, name, adapter_type, base_url, encrypted_api_key, api_key_last4,
      default_model, request_options, enabled, builtin, test_status,
      web_search_test_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', 'inconclusive', ?, ?)
  `, [
    row.code,
    row.name,
    row.adapter_type,
    row.base_url,
    row.encrypted_api_key,
    row.api_key_last4,
    row.default_model,
    row.request_options,
    row.enabled,
    row.builtin,
    '2026-08-05 00:00:00.000 +00:00',
    '2026-08-05 00:00:00.000 +00:00'
  ]);
  await close(database);
}

function invoke(args, environment = {}) {
  return spawnSync(process.execPath, [migrationScript, ...args], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_LOGGING: 'false',
      ...environment
    },
    encoding: 'utf8'
  });
}

test('backend package exposes explicit DeepSeek Flash config apply and audit commands', () => {
  const packageJson = require('../package.json');
  assert.equal(
    packageJson.scripts['migrate:deepseek-flash-config'],
    'node scripts/migrateDeepSeekFlashConfig.js --apply'
  );
  assert.equal(
    packageJson.scripts['audit:deepseek-flash-config'],
    'node scripts/migrateDeepSeekFlashConfig.js --require-ready'
  );
});

test('CLI migrates only the explicit database and preserves credentials and enabled state', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-flash-config-cli-'));
  const target = path.join(directory, 'target.sqlite');
  const other = path.join(directory, 'other.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createDatabase(target);
  await createDatabase(other);

  const apply = invoke(
    ['--apply', `--db=${target}`],
    { DB_STORAGE: other }
  );
  assert.equal(apply.status, 0, apply.stderr);
  assert.doesNotMatch(`${apply.stdout}${apply.stderr}`, /encrypted-cli-key-canary|5678/u);
  assert.deepEqual(JSON.parse(apply.stdout), {
    phase: 'migration_complete',
    preset: 'deepseek',
    current_model: 'deepseek-v4-flash',
    target_model: 'deepseek-v4-flash',
    enabled: true,
    credential_present: true,
    migration_required: false,
    ready: true,
    applied: true
  });

  const targetDb = openDatabase(target);
  const targetRow = await get(targetDb, `
    SELECT default_model, encrypted_api_key, api_key_last4, enabled,
           test_status, web_search_test_status
    FROM ai_platform_configs WHERE code = 'deepseek'
  `);
  await close(targetDb);
  assert.deepEqual(targetRow, {
    default_model: 'deepseek-v4-flash',
    encrypted_api_key: 'encrypted-cli-key-canary',
    api_key_last4: '5678',
    enabled: 1,
    test_status: 'success',
    web_search_test_status: 'inconclusive'
  });

  const otherDb = openDatabase(other);
  assert.equal(
    (await get(otherDb, "SELECT default_model FROM ai_platform_configs WHERE code = 'deepseek'"))
      .default_model,
    'deepseek-v4-pro'
  );
  await close(otherDb);

  const audit = invoke(['--require-ready', `--db=${target}`]);
  assert.equal(audit.status, 0, audit.stderr);
  assert.equal(JSON.parse(audit.stdout).ready, true);
  const second = invoke(['--apply', `--db=${target}`]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).applied, false);
});

test('CLI fails closed for a custom URL without modifying the row', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-flash-custom-cli-'));
  const databasePath = path.join(directory, 'custom.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await createDatabase(databasePath, {
    base_url: 'https://proxy.example.invalid/v1'
  });

  const result = invoke(['--apply', `--db=${databasePath}`]);
  assert.notEqual(result.status, 0);
  assert.equal(
    JSON.parse(result.stderr).error_code,
    'DEEPSEEK_FLASH_CONFIG_IDENTITY_MISMATCH'
  );
  const database = openDatabase(databasePath);
  assert.equal(
    (await get(database, "SELECT default_model FROM ai_platform_configs WHERE code = 'deepseek'"))
      .default_model,
    'deepseek-v4-pro'
  );
  await close(database);
});

test('CLI rejects missing files, duplicate modes, and unknown arguments without creating a database', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-flash-args-cli-'));
  const missing = path.join(directory, 'missing.sqlite');
  try {
    for (const args of [
      ['--apply', '--require-ready', `--db=${missing}`],
      ['--unknown', `--db=${missing}`],
      ['--apply', '--db=']
    ]) {
      const result = invoke(args);
      assert.notEqual(result.status, 0);
      assert.equal(JSON.parse(result.stderr).error_code, 'DEEPSEEK_FLASH_CONFIG_ARGUMENT_INVALID');
    }
    const missingResult = invoke(['--require-ready', `--db=${missing}`]);
    assert.notEqual(missingResult.status, 0);
    assert.equal(
      JSON.parse(missingResult.stderr).error_code,
      'DEEPSEEK_FLASH_CONFIG_DATABASE_NOT_FOUND'
    );
    assert.equal(fs.existsSync(missing), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
