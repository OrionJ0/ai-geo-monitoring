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

test('seeds only non-sensitive Doubao, DeepSeek, Qwen and Hunyuan preset information', async () => {
  const service = createService();
  await service.ensurePresets();

  const rows = await AIPlatformConfig.findAll({ order: [['code', 'ASC']] });
  assert.deepEqual(rows.map((row) => row.code), ['deepseek', 'doubao', 'hunyuan', 'qwen']);
  assert.equal(rows.every((row) => row.enabled && row.builtin), true);
  assert.equal(rows.every((row) => row.encrypted_api_key === null), true);
  assert.equal(rows.every((row) => row.api_key_last4 === null), true);
  assert.equal(rows.find((row) => row.code === 'deepseek').default_model, 'deepseek-v4-flash');
  const doubao = rows.find((row) => row.code === 'doubao');
  assert.equal(doubao.adapter_type, 'openai_responses');
  assert.equal(doubao.base_url, 'https://ark.cn-beijing.volces.com/api/v3');
  assert.deepEqual(doubao.request_options, {});
  const qwen = rows.find((row) => row.code === 'qwen');
  assert.equal(qwen.name, '千问');
  assert.equal(qwen.adapter_type, 'openai_responses');
  assert.equal(qwen.default_model, 'qwen3.7-plus');
  assert.equal(qwen.base_url, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  const hunyuan = rows.find((row) => row.code === 'hunyuan');
  assert.equal(hunyuan.name, '腾讯混元');
  assert.equal(hunyuan.adapter_type, 'openai_chat_completions');
  assert.equal(hunyuan.default_model, 'hy3');
  assert.equal(hunyuan.base_url, 'https://tokenhub.tencentmaas.com/v1');
  assert.equal(PRESET_PLATFORMS.length, 4);
});

test('promotes an existing Qwen row to builtin without overwriting its connection settings', async () => {
  const service = createService();
  await AIPlatformConfig.create({
    code: 'qwen',
    name: '千问工作区',
    adapter_type: 'openai_responses',
    base_url: 'https://workspace.example.com/compatible-mode/v1',
    default_model: 'qwen3.7-plus',
    encrypted_api_key: 'already-encrypted',
    api_key_last4: '1234',
    enabled: false,
    builtin: false
  });

  await service.ensurePresets();

  const qwen = await AIPlatformConfig.findOne({ where: { code: 'qwen' } });
  assert.equal(qwen.builtin, true);
  assert.equal(qwen.name, '千问工作区');
  assert.equal(qwen.base_url, 'https://workspace.example.com/compatible-mode/v1');
  assert.equal(qwen.default_model, 'qwen3.7-plus');
  assert.equal(qwen.encrypted_api_key, 'already-encrypted');
  assert.equal(qwen.enabled, false);
});

test('migrates the retired provider-specific Responses type and obsolete max_keyword preset', async () => {
  const service = createService();
  await AIPlatformConfig.create({
    code: 'doubao',
    name: '豆包',
    adapter_type: 'doubao_responses',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    default_model: 'doubao-model',
    request_options: { tools: [{ type: 'web_search', max_keyword: 2 }] },
    enabled: true,
    builtin: true
  });

  await service.ensurePresets();
  const migrated = await AIPlatformConfig.findOne({ where: { code: 'doubao' } });
  assert.equal(migrated.adapter_type, 'openai_responses');
  assert.deepEqual(migrated.request_options, {});

  await migrated.update({ request_options: { temperature: 0.2 } });
  await service.ensurePresets();
  await migrated.reload();
  assert.deepEqual(migrated.request_options, { temperature: 0.2 });
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

test('reveals one API key only through the explicit administrator operation', async () => {
  const service = createService();
  await service.ensurePresets();
  const deepseek = await AIPlatformConfig.findOne({ where: { code: 'deepseek' } });
  await service.updatePlatform(deepseek.id, { api_key: 'sk-visible-on-demand' });

  const revealed = await service.revealApiKey(deepseek.id);

  assert.deepEqual(revealed, {
    api_key: 'sk-visible-on-demand',
    api_key_last4: 'mand'
  });
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

test('stores safe model request parameters and resets both test states when they change', async () => {
  const service = createService();
  await service.ensurePresets();
  const platform = await AIPlatformConfig.findOne({ where: { code: 'deepseek' } });
  await platform.update({
    test_status: 'success',
    web_search_test_status: 'success',
    last_tested_at: new Date(),
    last_web_search_tested_at: new Date()
  });

  const updated = await service.updatePlatform(platform.id, {
    request_options: {
      enable_search: true,
      search_options: { forced_search: true },
      temperature: 0.2
    }
  });
  await platform.reload();

  assert.deepEqual(updated.request_options, {
    enable_search: true,
    search_options: { forced_search: true },
    temperature: 0.2
  });
  assert.equal(platform.test_status, 'untested');
  assert.equal(platform.web_search_test_status, 'untested');
});

test('rejects request parameter arrays, protected fields and prototype-pollution keys', async () => {
  const service = createService();
  await service.ensurePresets();
  const platform = await AIPlatformConfig.findOne({ where: { code: 'deepseek' } });

  await assert.rejects(
    service.updatePlatform(platform.id, { request_options: [] }),
    /JSON 对象/
  );
  await assert.rejects(
    service.updatePlatform(platform.id, { request_options: { model: 'shadow-model' } }),
    /model/
  );
  const unsafe = JSON.parse('{"search_options":{"__proto__":{"polluted":true}}}');
  await assert.rejects(
    service.updatePlatform(platform.id, { request_options: unsafe }),
    /__proto__/
  );
});

test('creates enabled custom platforms and deletes only custom platforms', async () => {
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

  await service.deletePlatform(created.id);
  const archived = await AIPlatformConfig.findByPk(created.id);
  assert.ok(archived.archived_at);

  const doubao = await AIPlatformConfig.findOne({ where: { code: 'doubao' } });
  await assert.rejects(service.deletePlatform(doubao.id), /预置平台不能删除/);
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
