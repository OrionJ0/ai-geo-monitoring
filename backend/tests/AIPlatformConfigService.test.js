const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_STORAGE = ':memory:';
process.env.DOUBAO_API_KEY = 'must-not-be-imported';
process.env.DEEPSEEK_API_KEY = 'must-not-be-imported-either';

const { sequelize, AIPlatformConfig } = require('../models');
const {
  AIPlatformConfigService,
  PRESET_PLATFORMS
} = require('../services/AIPlatformConfigService');

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const passthroughUrlValidator = async (value) => ({ url: value });

function createService() {
  return new AIPlatformConfigService({
    model: AIPlatformConfig,
    encryptionKeyProvider: () => ENCRYPTION_KEY,
    urlValidator: passthroughUrlValidator
  });
}

test.before(async () => {
  await sequelize.sync({ force: true });
});

test.beforeEach(async () => {
  await AIPlatformConfig.destroy({ where: {}, force: true });
});

test.after(async () => {
  await sequelize.close();
});

test('seeds only non-sensitive Doubao and DeepSeek preset information', async () => {
  const service = createService();
  await service.ensurePresets();

  const rows = await AIPlatformConfig.findAll({ order: [['code', 'ASC']] });
  assert.deepEqual(rows.map((row) => row.code), ['deepseek', 'doubao']);
  assert.equal(rows.every((row) => row.enabled && row.builtin), true);
  assert.equal(rows.every((row) => row.encrypted_api_key === null), true);
  assert.equal(rows.every((row) => row.api_key_last4 === null), true);
  assert.equal(rows.find((row) => row.code === 'deepseek').default_model, 'deepseek-v4-flash');
  assert.equal(PRESET_PLATFORMS.length, 2);
});

test('stores an encrypted API key and never exposes stored secret fields', async () => {
  const service = createService();
  await service.ensurePresets();
  const deepseek = await AIPlatformConfig.findOne({ where: { code: 'deepseek' } });

  const updated = await service.updatePlatform(deepseek.id, { api_key: 'sk-test-secret' });
  const stored = await AIPlatformConfig.findByPk(deepseek.id);

  assert.equal(stored.encrypted_api_key.includes('sk-test-secret'), false);
  assert.equal(stored.api_key_last4, 'cret');
  assert.equal(service.decryptApiKey(stored), 'sk-test-secret');
  assert.equal(updated.configured, true);
  assert.equal('encrypted_api_key' in updated, false);
  assert.equal('api_key' in updated, false);
});

test('keeps the existing key for blank edits and resets test status on critical changes', async () => {
  const service = createService();
  await service.ensurePresets();
  const platform = await AIPlatformConfig.findOne({ where: { code: 'deepseek' } });
  await service.updatePlatform(platform.id, { api_key: 'sk-original' });
  await platform.reload();
  await platform.update({ test_status: 'success', last_tested_at: new Date(), last_test_message: '连接成功' });

  await service.updatePlatform(platform.id, { name: 'DeepSeek CN', api_key: '' });
  await platform.reload();
  assert.equal(service.decryptApiKey(platform), 'sk-original');
  assert.equal(platform.test_status, 'success');

  await service.updatePlatform(platform.id, { default_model: 'deepseek-next' });
  await platform.reload();
  assert.equal(platform.test_status, 'untested');
  assert.equal(platform.last_tested_at, null);
});

test('creates enabled custom platforms and archives only custom platforms', async () => {
  const service = createService();
  await service.ensurePresets();

  const created = await service.createPlatform({
    code: 'example-ai',
    name: 'Example AI',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1/chat/completions',
    default_model: 'example-model'
  });
  assert.equal(created.enabled, true);
  assert.equal(created.builtin, false);
  assert.equal(created.configured, false);

  await service.archivePlatform(created.id);
  const archived = await AIPlatformConfig.findByPk(created.id);
  assert.ok(archived.archived_at);

  const doubao = await AIPlatformConfig.findOne({ where: { code: 'doubao' } });
  await assert.rejects(service.archivePlatform(doubao.id), /预置平台不能归档/);
});

test('clears an API key through a dedicated operation', async () => {
  const service = createService();
  await service.ensurePresets();
  const platform = await AIPlatformConfig.findOne({ where: { code: 'deepseek' } });
  await service.updatePlatform(platform.id, { api_key: 'sk-to-clear' });

  const cleared = await service.clearApiKey(platform.id);
  const stored = await AIPlatformConfig.findByPk(platform.id);

  assert.equal(cleared.configured, false);
  assert.equal(stored.encrypted_api_key, null);
  assert.equal(stored.api_key_last4, null);
  assert.equal(stored.test_status, 'untested');
});

test('reports a deployment configuration error when encryption is unavailable', async () => {
  const service = new AIPlatformConfigService({
    model: AIPlatformConfig,
    encryptionKeyProvider: () => '',
    urlValidator: passthroughUrlValidator
  });
  await service.ensurePresets();
  const platform = await AIPlatformConfig.findOne({ where: { code: 'deepseek' } });

  await assert.rejects(
    service.updatePlatform(platform.id, { api_key: 'sk-cannot-store' }),
    (error) => error.code === 'encryption_unavailable' && error.status === 503
  );
});
