const test = require('node:test');
const assert = require('node:assert/strict');

const { AIPlatformRequestService } = require('../services/AIPlatformRequestService');

const runtimeSettings = {
  ai_retry_count: 0,
  ai_default_timeout_seconds: 90,
  ai_default_max_tokens: 4096,
  ai_run_concurrency: 2
};

function createService({ row, post, savedResults = [] }) {
  const configService = {
    getPlatformByCode: async () => row,
    getPlatform: async () => row,
    decryptApiKey: () => 'sk-configured',
    saveTestResult: async (id, result) => {
      savedResults.push({ id, result });
      return { id, enabled: row.enabled, test_status: result.success ? 'success' : 'failed' };
    }
  };
  return new AIPlatformRequestService({
    configService,
    settingsService: { getSettings: async () => runtimeSettings },
    httpClient: { post },
    urlValidator: async (url) => ({
      url,
      hostname: 'api.example.com',
      addresses: ['93.184.216.34'],
      allowPrivate: false
    }),
    now: (() => {
      let value = 1000;
      return () => (value += 25);
    })(),
    wait: async () => {}
  });
}

test('calls an OpenAI compatible platform from the saved database configuration', async () => {
  let request;
  const row = {
    id: 3,
    code: 'example-ai',
    name: 'Example AI',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1/chat/completions',
    encrypted_api_key: 'encrypted',
    default_model: 'example-model',
    request_timeout_seconds: 30,
    max_tokens: 2048,
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async (url, body, options) => {
      request = { url, body, options };
      return { data: { choices: [{ message: { content: 'OK' } }] }, headers: {} };
    }
  });

  const result = await service.queryPlatform('example-ai', '测试问题');

  assert.equal(result.success, true);
  assert.equal(result.text, 'OK');
  assert.equal(result.model_name, 'example-model');
  assert.equal(request.url, row.base_url);
  assert.deepEqual(request.body.messages, [{ role: 'user', content: '测试问题' }]);
  assert.equal(request.body.max_tokens, 2048);
  assert.equal(request.options.timeout, 30000);
  assert.equal(request.options.headers.Authorization, 'Bearer sk-configured');
  assert.equal(request.options.maxRedirects, 0);
});

test('uses the Responses request contract for the Doubao adapter', async () => {
  let requestBody;
  const row = {
    id: 1,
    code: 'doubao',
    name: '豆包',
    adapter_type: 'doubao_responses',
    base_url: 'https://ark.example.com/api/v3/responses',
    encrypted_api_key: 'encrypted',
    default_model: 'doubao-model',
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async (_url, body) => {
      requestBody = body;
      return { data: { output_text: '豆包结果' }, headers: {} };
    }
  });

  const result = await service.queryPlatform('doubao', '测试问题');

  assert.equal(result.success, true);
  assert.equal(result.text, '豆包结果');
  assert.deepEqual(requestBody.tools, [{ type: 'web_search' }]);
  assert.equal(requestBody.max_output_tokens, 4096);
});

test('normalizes provider failures without exposing raw provider data', async () => {
  const row = {
    id: 3,
    code: 'example-ai',
    name: 'Example AI',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1/chat/completions',
    encrypted_api_key: 'encrypted',
    default_model: 'example-model',
    enabled: true,
    archived_at: null
  };
  const service = createService({
    row,
    post: async () => {
      const error = new Error('request failed');
      error.response = { status: 401, data: { secret: 'must-not-leak' } };
      throw error;
    }
  });

  const result = await service.queryPlatform('example-ai', '测试问题');

  assert.equal(result.success, false);
  assert.equal(result.error_code, 'authentication_failed');
  assert.equal(result.error, '平台认证失败，请管理员检查 API Key。');
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
});

test('tests disabled platforms without changing their enabled state', async () => {
  const savedResults = [];
  const row = {
    id: 9,
    code: 'disabled-ai',
    name: 'Disabled AI',
    adapter_type: 'openai_chat_completions',
    base_url: 'https://api.example.com/v1/chat/completions',
    encrypted_api_key: 'encrypted',
    default_model: 'example-model',
    enabled: false,
    archived_at: null
  };
  const service = createService({
    row,
    savedResults,
    post: async () => ({ data: { choices: [{ message: { content: 'OK' } }] }, headers: {} })
  });

  const result = await service.testConnection(row.id);

  assert.equal(result.connection.success, true);
  assert.equal(result.platform.enabled, false);
  assert.equal(savedResults[0].result.success, true);
});
