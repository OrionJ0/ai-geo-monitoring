const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DeepSeekFlashConfigMigrationService
} = require('../services/DeepSeekFlashConfigMigrationService');

const OFFICIAL_URL = 'https://api.deepseek.com/v1/chat/completions';
const PRO_MODEL = 'deepseek-v4-pro';
const FLASH_MODEL = 'deepseek-v4-flash';

function buildRow(overrides = {}) {
  const values = {
    id: 7,
    code: 'deepseek',
    name: 'DeepSeek',
    adapter_type: 'openai_chat_completions',
    base_url: OFFICIAL_URL,
    encrypted_api_key: 'encrypted-production-key-canary',
    api_key_last4: '1234',
    default_model: PRO_MODEL,
    request_timeout_seconds: 90,
    max_tokens: 8192,
    request_options: {},
    enabled: true,
    builtin: true,
    archived_at: null,
    test_status: 'success',
    last_tested_at: new Date('2026-08-05T00:00:00.000Z'),
    last_test_error_code: null,
    last_test_message: '连接成功',
    web_search_test_status: 'inconclusive',
    last_web_search_tested_at: new Date('2026-08-05T00:00:00.000Z'),
    last_web_search_test_error_code: 'unsupported',
    last_web_search_test_message: '能力不可用',
    ...overrides
  };
  const updates = [];
  return {
    ...values,
    updates,
    get(key) {
      if (key === undefined) return { ...this };
      return this[key];
    },
    async update(patch, options = {}) {
      updates.push({ patch: { ...patch }, options });
      Object.assign(this, patch);
      return this;
    }
  };
}

function buildService(row) {
  const transactions = [];
  const model = {
    async findAll(options = {}) {
      assert.deepEqual(options.where, { code: 'deepseek' });
      return row ? [row] : [];
    }
  };
  const sequelize = {
    async transaction(callback) {
      const transaction = { LOCK: { UPDATE: 'UPDATE' } };
      transactions.push(transaction);
      return callback(transaction);
    }
  };
  return {
    service: new DeepSeekFlashConfigMigrationService({ model, sequelize }),
    transactions
  };
}

test('only upgrades the exact official builtin Pro preset and preserves every other field', async () => {
  const row = buildRow();
  const before = { ...row };
  delete before.updates;
  delete before.get;
  delete before.update;
  const { service, transactions } = buildService(row);

  const preflight = await service.audit();
  assert.equal(preflight.migration_required, true);
  assert.equal(preflight.ready, false);
  assert.equal(preflight.current_model, PRO_MODEL);

  const result = await service.apply();
  assert.equal(result.ready, true);
  assert.equal(result.migration_required, false);
  assert.equal(result.applied, true);
  assert.equal(result.current_model, FLASH_MODEL);
  assert.equal(transactions.length, 1);
  assert.equal(row.updates.length, 1);
  assert.deepEqual(row.updates[0].patch, { default_model: FLASH_MODEL });

  for (const [key, value] of Object.entries(before)) {
    if (key === 'default_model') continue;
    assert.deepEqual(row[key], value, `${key} must be preserved`);
  }
});

test('an already migrated official Flash preset is an idempotent no-op', async () => {
  const row = buildRow({ default_model: FLASH_MODEL, enabled: false });
  const { service } = buildService(row);

  const result = await service.apply();
  assert.equal(result.ready, true);
  assert.equal(result.applied, false);
  assert.equal(result.current_model, FLASH_MODEL);
  assert.equal(row.enabled, false);
  assert.equal(row.updates.length, 0);
});

for (const [name, overrides, expectedCode] of [
  ['custom base URL', { base_url: 'https://proxy.example.invalid/v1' }, 'DEEPSEEK_FLASH_CONFIG_IDENTITY_MISMATCH'],
  ['non-builtin row', { builtin: false }, 'DEEPSEEK_FLASH_CONFIG_IDENTITY_MISMATCH'],
  ['unknown model', { default_model: 'deepseek-v5-unknown' }, 'DEEPSEEK_FLASH_CONFIG_MODEL_UNSUPPORTED'],
  ['unknown request options', { request_options: { temperature: 0.7 } }, 'DEEPSEEK_FLASH_CONFIG_OPTIONS_UNSAFE'],
  ['archived row', { archived_at: new Date('2026-08-01T00:00:00.000Z') }, 'DEEPSEEK_FLASH_CONFIG_IDENTITY_MISMATCH']
]) {
  test(`fails closed for ${name} without changing credentials or model`, async () => {
    const row = buildRow(overrides);
    const before = { ...row };
    const { service } = buildService(row);

    await assert.rejects(service.apply(), (error) => {
      assert.equal(error.code, expectedCode);
      return true;
    });
    assert.equal(row.updates.length, 0);
    assert.equal(row.default_model, before.default_model);
    assert.equal(row.encrypted_api_key, before.encrypted_api_key);
    assert.equal(row.enabled, before.enabled);
  });
}

test('fails closed when the DeepSeek preset is missing', async () => {
  const { service } = buildService(null);
  await assert.rejects(service.audit(), (error) => {
    assert.equal(error.code, 'DEEPSEEK_FLASH_CONFIG_MISSING');
    return true;
  });
});
