const test = require('node:test');
const assert = require('node:assert/strict');

const { AIPlatformService } = require('../services/AIPlatformService');

function createService() {
  const rows = [
    {
      code: 'doubao',
      name: '豆包',
      enabled: true,
      archived_at: null,
      encrypted_api_key: null,
      base_url: 'https://ark.example.com/responses',
      default_model: 'doubao-model'
    },
    {
      code: 'deepseek',
      name: 'DeepSeek',
      enabled: true,
      archived_at: null,
      encrypted_api_key: 'encrypted',
      base_url: 'https://api.example.com/chat/completions',
      default_model: 'deepseek-v4-flash'
    },
    {
      code: 'archived-ai',
      name: 'Archived AI',
      enabled: false,
      archived_at: new Date(),
      encrypted_api_key: 'encrypted',
      base_url: 'https://archive.example.com/chat/completions',
      default_model: 'archive-model'
    }
  ];
  const calls = [];
  const requestService = {
    queryPlatform: async (...args) => {
      calls.push(args);
      return { success: true, platform: args[0], text: 'OK', data: { answer: 'OK' } };
    }
  };
  const configService = {
    listCatalog: async () => rows
      .filter((row) => !row.archived_at)
      .map((row) => ({
        code: row.code,
        name: row.name,
        enabled: row.enabled,
        configured: Boolean(row.encrypted_api_key),
        selectable: row.enabled && Boolean(row.encrypted_api_key),
        unavailable_reason: row.encrypted_api_key ? null : 'missing_api_key'
      })),
    listPlatformRows: async () => rows
  };
  return { service: new AIPlatformService({ requestService, configService }), rows, calls };
}

test('reports runnable platforms from database configuration only', async () => {
  const { service } = createService();

  assert.deepEqual(await service.getAvailablePlatforms(), ['deepseek']);
});

test('resolves detailed availability for requested dynamic platform codes', async () => {
  const { service } = createService();
  const statuses = await service.getPlatformAvailability(['doubao', 'deepseek', 'custom-missing', 'archived-ai']);

  assert.deepEqual(statuses.map((item) => ({ code: item.code, available: item.available, reason: item.reason })), [
    { code: 'doubao', available: false, reason: 'missing_api_key' },
    { code: 'deepseek', available: true, reason: null },
    { code: 'custom-missing', available: false, reason: 'config_unavailable' },
    { code: 'archived-ai', available: false, reason: 'archived' }
  ]);
  assert.equal(statuses[1].model_name, 'deepseek-v4-flash');
  assert.equal(statuses[1].platform_name, 'DeepSeek');
});

test('delegates platform calls with a supplied database configuration snapshot', async () => {
  const { service, rows, calls } = createService();
  const result = await service.queryPlatform('deepseek', '测试问题', { config: rows[1] });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'deepseek');
  assert.equal(calls[0][1], '测试问题');
  assert.equal(calls[0][2].config.default_model, 'deepseek-v4-flash');
});

test('AI platform service contains no provider credential environment fallback', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../services/AIPlatformService.js'), 'utf8');

  assert.doesNotMatch(source, /DOUBAO_|DEEPSEEK_|KIMI_|QIANWEN_|AI_MAX_TOKENS/);
  assert.doesNotMatch(source, /process\.env/);
});
