const test = require('node:test');
const assert = require('node:assert/strict');

const { AIPlatformService } = require('../services/AIPlatformService');

function createService(options = {}) {
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
      adapter_type: 'openai_chat_completions',
      enabled: true,
      archived_at: null,
      encrypted_api_key: 'encrypted',
      base_url: 'https://api.example.com/chat/completions',
      default_model: 'deepseek-v4-flash'
    },
    {
      code: 'deepseek-web',
      name: 'DeepSeek 网页版',
      adapter_type: 'deepseek_web',
      enabled: true,
      archived_at: null,
      encrypted_api_key: null,
      base_url: 'https://chat.deepseek.com',
      default_model: 'deepseek-web-ui'
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
        configured: row.adapter_type === 'deepseek_web' || Boolean(row.encrypted_api_key),
        selectable: row.enabled && (row.adapter_type === 'deepseek_web' || Boolean(row.encrypted_api_key)),
        unavailable_reason: row.adapter_type === 'deepseek_web' || row.encrypted_api_key ? null : 'missing_api_key',
        capabilities: row.adapter_type === 'deepseek_web'
          ? { monitoring: true, analysis: false, direct_stream: false }
          : { monitoring: true, analysis: true, direct_stream: true }
      })),
    listPlatformRows: async () => rows
  };
  return {
    service: new AIPlatformService({
      requestService,
      configService,
      webPlatformService: options.webPlatformService
    }),
    rows,
    calls
  };
}

test('reports runnable platforms from database configuration only', async () => {
  const { service } = createService();

  assert.deepEqual(await service.getAvailablePlatforms(), ['deepseek', 'deepseek-web']);
  assert.deepEqual(await service.getAvailablePlatforms({ capability: 'analysis' }), ['deepseek']);
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

test('rejects platforms that do not provide the requested capability', async () => {
  const { service } = createService();

  const [status] = await service.getPlatformAvailability(
    ['deepseek-web'],
    { capability: 'direct_stream', runtimeProbe: false }
  );

  assert.equal(status.available, false);
  assert.equal(status.reason, 'unsupported_platform_capability');
  assert.equal(status.config, null);
});

test('runs DeepSeek Web preflight only for explicit runtime availability checks', async () => {
  const probeCalls = [];
  const { service } = createService({
    webPlatformService: {
      preflight: async () => {
        probeCalls.push('preflight');
        return { ok: true };
      }
    }
  });

  const [staticStatus] = await service.getPlatformAvailability(
    ['deepseek-web'],
    { runtimeProbe: false }
  );
  const [runtimeStatus] = await service.getPlatformAvailability(['deepseek-web']);
  await service.getPlatformAvailability(['deepseek']);

  assert.equal(staticStatus.available, true);
  assert.equal(runtimeStatus.available, true);
  assert.equal(probeCalls.length, 1);
});

test('reports a stable unavailable reason when DeepSeek Web preflight fails', async () => {
  const { service } = createService({
    webPlatformService: {
      preflight: async () => {
        throw Object.assign(new Error('login required'), { code: 'web_login_required' });
      }
    }
  });

  const [status] = await service.getPlatformAvailability(['deepseek-web']);

  assert.equal(status.available, false);
  assert.equal(status.reason, 'web_login_required');
  assert.equal(status.config, null);
});

test('routes only the managed Web adapter to WebPlatformService with no API fallback', async () => {
  const webCalls = [];
  const { service, rows, calls } = createService({
    webPlatformService: {
      queryPlatform: async (...args) => {
        webCalls.push(args);
        return {
          success: true,
          platform: 'deepseek-web',
          text: '网页回答',
          data: {},
          provider_citations: [],
          web_capture: { status: 'completed' }
        };
      }
    }
  });

  const result = await service.queryPlatform('deepseek-web', '测试问题', {
    config: rows[2],
    purpose: 'project_monitoring',
    capture_owner: { record_id: 12, user_id: 7, project_id: 3 }
  });

  assert.equal(result.success, true);
  assert.equal(webCalls.length, 1);
  assert.equal(calls.length, 0);
});

test('rejects Web queries without project purpose and bounded record ownership', async () => {
  const { service, rows, calls } = createService({
    webPlatformService: {
      queryPlatform: async () => {
        throw new Error('must not execute');
      }
    }
  });

  const wrongPurpose = await service.queryPlatform('deepseek-web', '测试问题', {
    config: rows[2],
    purpose: 'direct_stream',
    capture_owner: { record_id: 12, user_id: 7 }
  });
  const missingOwner = await service.queryPlatform('deepseek-web', '测试问题', {
    config: rows[2],
    purpose: 'project_monitoring',
    capture_owner: { user_id: 7 }
  });

  assert.equal(wrongPurpose.error_code, 'unsupported_platform_capability');
  assert.equal(missingOwner.error_code, 'web_capture_owner_missing');
  assert.equal(calls.length, 0);
});

test('an active Web query does not serialize an API platform query', async () => {
  let releaseWeb;
  const webPending = new Promise((resolve) => { releaseWeb = resolve; });
  const { service, rows, calls } = createService({
    webPlatformService: {
      queryPlatform: async () => webPending
    }
  });

  const webResult = service.queryPlatform('deepseek-web', '网页问题', {
    config: rows[2],
    purpose: 'project_monitoring',
    capture_owner: { record_id: 12, user_id: 7 }
  });
  const apiResult = await service.queryPlatform('deepseek', 'API 问题', {
    config: rows[1]
  });

  assert.equal(apiResult.success, true);
  assert.equal(calls.length, 1);
  releaseWeb({ success: true, platform: 'deepseek-web', text: '网页回答' });
  assert.equal((await webResult).success, true);
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
