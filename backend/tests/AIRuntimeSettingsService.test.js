const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_STORAGE = ':memory:';

const { sequelize, Setting } = require('../models');
const {
  AIRuntimeSettingsService,
  DEFAULT_AI_RUNTIME_SETTINGS
} = require('../services/AIRuntimeSettingsService');

test.before(async () => {
  await sequelize.sync({ force: true });
});

test.after(async () => {
  await sequelize.close();
});

test('returns typed defaults and persists missing setting rows', async () => {
  const service = new AIRuntimeSettingsService({ model: Setting });
  await service.ensureDefaults();

  assert.deepEqual(await service.getSettings(), DEFAULT_AI_RUNTIME_SETTINGS);
  assert.equal(await Setting.count({ where: { key: Object.keys(DEFAULT_AI_RUNTIME_SETTINGS) } }), 4);
});

test('reads valid database values as integers and falls back for corrupt values', async () => {
  const service = new AIRuntimeSettingsService({ model: Setting });
  await service.ensureDefaults();
  await Setting.update({ value: '5' }, { where: { key: 'ai_run_concurrency' } });
  await Setting.update({ value: 'invalid' }, { where: { key: 'ai_retry_count' } });

  const settings = await service.getSettings();
  assert.equal(settings.ai_run_concurrency, 5);
  assert.equal(settings.ai_retry_count, 3);
});

test('validates every runtime setting boundary', () => {
  const service = new AIRuntimeSettingsService({ model: Setting });

  assert.equal(service.isValid('ai_run_concurrency', 1), true);
  assert.equal(service.isValid('ai_run_concurrency', 6), false);
  assert.equal(service.isValid('ai_retry_count', 0), true);
  assert.equal(service.isValid('ai_retry_count', 4), false);
  assert.equal(service.isValid('ai_default_timeout_seconds', 180), true);
  assert.equal(service.isValid('ai_default_timeout_seconds', 9), false);
  assert.equal(service.isValid('ai_default_max_tokens', 32768), true);
  assert.equal(service.isValid('ai_default_max_tokens', 255), false);
});
