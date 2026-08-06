const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_STORAGE = ':memory:';
process.env.DOUBAO_API_KEY = 'must-not-be-imported';
process.env.DEEPSEEK_API_KEY = 'must-not-be-imported-either';

const { sequelize, AIPlatformConfig } = require('../models');
const {
  AIPlatformConfigService,
  PlatformConfigError,
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

test('seeds every preset disabled until an administrator enables it', async () => {
  const service = createService();
  await service.ensurePresets();

  const rows = await AIPlatformConfig.findAll({ order: [['code', 'ASC']] });
  assert.deepEqual(rows.map((row) => row.code), [
    'deepseek',
    'deepseek-web',
    'doubao',
    'doubao-web',
    'hunyuan',
    'qwen'
  ]);
  assert.equal(rows.every((row) => row.builtin), true);
  assert.equal(rows.every((row) => row.encrypted_api_key === null), true);
  assert.equal(rows.every((row) => row.api_key_last4 === null), true);
  assert.equal(rows.every((row) => row.enabled === false), true);
  assert.equal(rows.find((row) => row.code === 'deepseek').default_model, 'deepseek-v4-flash');
  const deepseekWeb = rows.find((row) => row.code === 'deepseek-web');
  assert.equal(deepseekWeb.name, 'DeepSeek 网页版');
  assert.equal(deepseekWeb.adapter_type, 'deepseek_web');
  assert.equal(deepseekWeb.base_url, 'https://chat.deepseek.com');
  assert.equal(deepseekWeb.default_model, 'deepseek-web-ui');
  assert.equal(deepseekWeb.enabled, false);
  const doubaoWeb = rows.find((row) => row.code === 'doubao-web');
  assert.equal(doubaoWeb.name, '豆包网页版');
  assert.equal(doubaoWeb.adapter_type, 'doubao_web');
  assert.equal(doubaoWeb.base_url, 'https://www.doubao.com');
  assert.equal(doubaoWeb.default_model, 'doubao-web-ui');
  assert.equal(doubaoWeb.enabled, false);
  const doubao = rows.find((row) => row.code === 'doubao');
  assert.equal(doubao.adapter_type, 'openai_responses');
  assert.equal(doubao.base_url, 'https://ark.cn-beijing.volces.com/api/v3');
  assert.deepEqual(doubao.request_options, {});
  const qwen = rows.find((row) => row.code === 'qwen');
  assert.equal(qwen.name, '千问');
  assert.equal(qwen.adapter_type, 'openai_responses');
  assert.equal(qwen.default_model, 'qwen3.7-plus');
  assert.equal(qwen.base_url, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.deepEqual(qwen.request_options, {
    search_options: { forced_search: true }
  });
  const hunyuan = rows.find((row) => row.code === 'hunyuan');
  assert.equal(hunyuan.name, '腾讯混元');
  assert.equal(hunyuan.adapter_type, 'openai_chat_completions');
  assert.equal(hunyuan.default_model, 'hy3-preview');
  assert.equal(hunyuan.base_url, 'https://tokenhub.tencentmaas.com/v1');
  assert.deepEqual(hunyuan.request_options, {
    web_search_options: { enable: true }
  });
  assert.equal(PRESET_PLATFORMS.length, 6);
});

test('keeps an existing administrator-disabled Doubao Web preset disabled', async () => {
  const service = createService();
  await AIPlatformConfig.create({
    code: 'doubao-web',
    name: '豆包网页版',
    adapter_type: 'doubao_web',
    base_url: 'https://www.doubao.com',
    default_model: 'doubao-web-ui',
    enabled: false,
    builtin: true
  });

  await service.ensurePresets();

  const doubaoWeb = await AIPlatformConfig.findOne({ where: { code: 'doubao-web' } });
  assert.equal(doubaoWeb.builtin, true);
  assert.equal(doubaoWeb.enabled, false);
});

test('keeps existing administrator-enabled presets enabled after defaults change', async () => {
  const service = createService();
  await AIPlatformConfig.create({
    code: 'doubao-web',
    name: '豆包网页版',
    adapter_type: 'doubao_web',
    base_url: 'https://www.doubao.com',
    default_model: 'doubao-web-ui',
    enabled: true,
    builtin: true
  });
  await AIPlatformConfig.create({
    code: 'doubao',
    name: '豆包',
    adapter_type: 'openai_responses',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    default_model: 'doubao-seed-2-1-turbo-260628',
    encrypted_api_key: 'already-encrypted',
    enabled: true,
    builtin: true
  });

  await service.ensurePresets();

  const rows = await AIPlatformConfig.findAll({
    where: { code: ['doubao-web', 'doubao'] }
  });
  assert.equal(rows.every((row) => row.enabled === true), true);
});

test('treats both managed Web presets as configured without API keys and derives capabilities', async () => {
  const service = createService();
  await service.ensurePresets();
  const deepseekWeb = await AIPlatformConfig.findOne({ where: { code: 'deepseek-web' } });
  const doubaoWeb = await AIPlatformConfig.findOne({ where: { code: 'doubao-web' } });
  await service.setEnabled(deepseekWeb.id, true);
  await service.setEnabled(doubaoWeb.id, true);

  const catalog = await service.listCatalog();
  const webPlatforms = catalog.filter((item) => (
    ['deepseek-web', 'doubao-web'].includes(item.code)
  ));
  const api = catalog.find((item) => item.code === 'deepseek');

  for (const web of webPlatforms) {
    assert.equal(web.configured, true);
    assert.equal(web.selectable, true);
    assert.equal(web.unavailable_reason, null);
    assert.deepEqual(web.capabilities, {
      monitoring: true,
      analysis: false,
      prompt_generation: false,
      model_listing: false,
      api_key_management: false,
      connection_test: false,
      api_web_search_test: false,
      direct_stream: false,
      legacy_schedule: false,
      interactive_login: true
    });
  }
  assert.equal(api.capabilities.analysis, true);
  assert.equal(api.capabilities.api_key_management, true);
  assert.equal(api.capabilities.interactive_login, false);
  assert.equal(api.web_search_test_status, 'untested');
});

test('catalog no longer exposes a new-project platform default', async () => {
  const service = createService();
  await service.ensurePresets();
  const deepseekWeb = await AIPlatformConfig.findOne({ where: { code: 'deepseek-web' } });
  const doubaoWeb = await AIPlatformConfig.findOne({ where: { code: 'doubao-web' } });
  await service.setEnabled(deepseekWeb.id, true);
  await service.setEnabled(doubaoWeb.id, true);

  const catalog = await service.listCatalog();
  assert.equal(catalog.every((item) => !Object.hasOwn(item, 'default_for_new_project')), true);
});

test('lists presets in the fixed Web-first product order regardless of database ids', async () => {
  const service = createService();
  await AIPlatformConfig.bulkCreate(
    [...PRESET_PLATFORMS]
      .reverse()
      .map((preset) => ({
        ...preset,
        request_options: preset.request_options
          ? JSON.parse(JSON.stringify(preset.request_options))
          : {}
      }))
  );
  await AIPlatformConfig.create({
    code: 'example-ai',
    name: 'Example AI',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1/chat/completions',
    default_model: 'example-model',
    enabled: false,
    builtin: false
  });

  const adminPlatforms = await service.listAdminPlatforms();
  const catalog = await service.listCatalog();
  const expectedCodes = [
    'doubao-web',
    'deepseek-web',
    'doubao',
    'deepseek',
    'qwen',
    'hunyuan',
    'example-ai'
  ];

  assert.deepEqual(adminPlatforms.map((item) => item.code), expectedCodes);
  assert.deepEqual(catalog.map((item) => item.code), expectedCodes);
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
  assert.deepEqual(qwen.request_options, {});
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

test('upgrades an existing Qwen empty request configuration to the forced-search preset', async () => {
  const service = createService();
  await AIPlatformConfig.create({
    code: 'qwen',
    name: '千问',
    adapter_type: 'openai_responses',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    default_model: 'qwen3.7-plus',
    request_options: {},
    enabled: true,
    builtin: true,
    test_status: 'success',
    web_search_test_status: 'success'
  });

  await service.ensurePresets();
  const qwen = await AIPlatformConfig.findOne({ where: { code: 'qwen' } });

  assert.deepEqual(qwen.request_options, {
    search_options: { forced_search: true }
  });
  assert.equal(qwen.test_status, 'untested');
  assert.equal(qwen.web_search_test_status, 'untested');

  await qwen.update({ request_options: { temperature: 0.2 } });
  await service.ensurePresets();
  await qwen.reload();
  assert.deepEqual(qwen.request_options, { temperature: 0.2 });
});

test('upgrades the legacy official Hunyuan preset to a web-search capable model and request', async () => {
  const service = createService();
  await AIPlatformConfig.create({
    code: 'hunyuan',
    name: '腾讯混元',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://tokenhub.tencentmaas.com/v1',
    default_model: 'hy3',
    request_options: {},
    enabled: true,
    builtin: true,
    test_status: 'success',
    web_search_test_status: 'inconclusive'
  });

  await service.ensurePresets();
  const hunyuan = await AIPlatformConfig.findOne({ where: { code: 'hunyuan' } });

  assert.equal(hunyuan.default_model, 'hy3-preview');
  assert.deepEqual(hunyuan.request_options, {
    web_search_options: { enable: true }
  });
  assert.equal(hunyuan.test_status, 'untested');
  assert.equal(hunyuan.web_search_test_status, 'untested');
});

test('does not overwrite administrator-customized Hunyuan connection or request settings', async () => {
  const service = createService();
  await AIPlatformConfig.create({
    code: 'hunyuan',
    name: '混元企业账号',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://workspace.example.com/v1',
    default_model: 'hy3',
    request_options: { temperature: 0.2 },
    enabled: false,
    builtin: false
  });

  await service.ensurePresets();
  const hunyuan = await AIPlatformConfig.findOne({ where: { code: 'hunyuan' } });

  assert.equal(hunyuan.builtin, true);
  assert.equal(hunyuan.name, '混元企业账号');
  assert.equal(hunyuan.base_url, 'https://workspace.example.com/v1');
  assert.equal(hunyuan.default_model, 'hy3');
  assert.deepEqual(hunyuan.request_options, { temperature: 0.2 });
  assert.equal(hunyuan.enabled, false);
});

test('010 硬切：DeepSeek 分析预设保持 deepseek-v4-flash，不再迁移到 Pro，未配置账户保持禁用', async () => {
  const service = createService();
  await AIPlatformConfig.create({
    code: 'deepseek',
    name: 'DeepSeek',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.deepseek.com/v1/chat/completions',
    default_model: 'deepseek-v4-flash',
    enabled: true,
    builtin: true
  });

  await service.ensurePresets();
  const deepseek = await AIPlatformConfig.findOne({ where: { code: 'deepseek' } });
  // 010 后 flash 是唯一正式分析模型：预设不迁移、未配置账户保持禁用
  assert.equal(deepseek.enabled, false);
  assert.equal(deepseek.default_model, 'deepseek-v4-flash');

  await deepseek.update({
    encrypted_api_key: 'already-encrypted',
    api_key_last4: '1234',
    enabled: true,
    default_model: 'deepseek-v4-flash'
  });
  await service.ensurePresets();
  await deepseek.reload();
  assert.equal(deepseek.enabled, true);
  assert.equal(deepseek.default_model, 'deepseek-v4-flash');
});

test('startup fails closed on the known Pro preset until the explicit release migration runs', async () => {
  const service = createService();
  await AIPlatformConfig.create({
    code: 'deepseek',
    name: 'DeepSeek',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.deepseek.com/v1/chat/completions',
    encrypted_api_key: 'already-encrypted',
    api_key_last4: '1234',
    default_model: 'deepseek-v4-pro',
    request_options: {},
    enabled: true,
    builtin: true
  });

  await assert.rejects(service.ensurePresets(), (error) => {
    assert.equal(error.code, 'deepseek_flash_config_migration_required');
    return true;
  });
  const deepseek = await AIPlatformConfig.findOne({ where: { code: 'deepseek' } });
  assert.equal(deepseek.default_model, 'deepseek-v4-pro');
  assert.equal(deepseek.encrypted_api_key, 'already-encrypted');
  assert.equal(deepseek.enabled, true);
});

test('startup fails closed on a custom DeepSeek identity without overwriting it', async () => {
  const service = createService();
  await AIPlatformConfig.create({
    code: 'deepseek',
    name: 'DeepSeek 企业代理',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://proxy.example.invalid/v1',
    encrypted_api_key: 'custom-encrypted',
    api_key_last4: '9999',
    default_model: 'deepseek-v4-flash',
    request_options: {},
    enabled: true,
    builtin: true
  });

  await assert.rejects(service.ensurePresets(), (error) => {
    assert.equal(error.code, 'deepseek_flash_config_invalid');
    return true;
  });
  const deepseek = await AIPlatformConfig.findOne({ where: { code: 'deepseek' } });
  assert.equal(deepseek.name, 'DeepSeek 企业代理');
  assert.equal(deepseek.base_url, 'https://proxy.example.invalid/v1');
  assert.equal(deepseek.encrypted_api_key, 'custom-encrypted');
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

test('creates custom platforms disabled by default and deletes only custom platforms', async () => {
  const service = createService();
  await service.ensurePresets();

  const created = await service.createPlatform({
    code: 'example-ai',
    name: 'Example AI',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1/chat/completions',
    default_model: 'example-model'
  });
  assert.equal(created.enabled, false);
  assert.equal(created.builtin, false);
  assert.equal(created.configured, false);

  await service.deletePlatform(created.id);
  const archived = await AIPlatformConfig.findByPk(created.id);
  assert.ok(archived.archived_at);

  const doubao = await AIPlatformConfig.findOne({ where: { code: 'doubao' } });
  await assert.rejects(service.deletePlatform(doubao.id), /预置平台不能删除/);
});

test('converts Base URL policy failures into client-visible platform validation errors', async () => {
  const service = new AIPlatformConfigService({
    model: AIPlatformConfig,
    encryptionKeyProvider: () => process.env.CONFIG_ENCRYPTION_KEY,
    urlValidator: async () => {
      throw new Error('Base URL 不能指向本机或私网地址');
    }
  });

  await assert.rejects(
    service.createPlatform({
      code: 'blocked-url-platform',
      name: 'Blocked URL Platform',
      adapter_type: 'openai_chat_completions',
      base_url: 'https://api.example.com/v1',
      default_model: 'example-model'
    }),
    (error) => (
      error instanceof PlatformConfigError
      && error.status === 400
      && error.code === 'invalid_platform_url'
      && error.message === 'Base URL 不能指向本机或私网地址'
    )
  );
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

test('keeps managed Web identity immutable while allowing enable changes', async () => {
  const service = createService();
  await service.ensurePresets();
  const web = await AIPlatformConfig.findOne({ where: { code: 'deepseek-web' } });

  const enabled = await service.setEnabled(web.id, true);
  assert.equal(enabled.enabled, true);
  await assert.rejects(
    service.updatePlatform(web.id, { name: 'Other Web' }),
    (error) => error.code === 'managed_platform_immutable'
  );
  await assert.rejects(
    service.updatePlatform(web.id, { base_url: 'https://example.com' }),
    (error) => error.code === 'managed_platform_immutable'
  );
  await assert.rejects(
    service.updatePlatform(web.id, { api_key: 'must-not-store' }),
    (error) => error.code === 'unsupported_platform_capability'
  );
  await assert.rejects(
    service.revealApiKey(web.id),
    (error) => error.code === 'unsupported_platform_capability'
  );
  await assert.rejects(
    service.clearApiKey(web.id),
    (error) => error.code === 'unsupported_platform_capability'
  );
});

test('reserves the deepseek-web code and never silently converts an existing custom row', async () => {
  const service = createService();
  await AIPlatformConfig.create({
    code: 'deepseek-web',
    name: 'Existing Custom Platform',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1/chat/completions',
    default_model: 'custom-model',
    enabled: true,
    builtin: false
  });

  await assert.rejects(
    service.ensurePresets(),
    (error) => error.code === 'reserved_platform_code_conflict' && error.status === 409
  );
  const existing = await AIPlatformConfig.findOne({ where: { code: 'deepseek-web' } });
  assert.equal(existing.name, 'Existing Custom Platform');
  assert.equal(existing.adapter_type, 'openai_chat_completions');
  assert.equal(existing.builtin, false);
});
