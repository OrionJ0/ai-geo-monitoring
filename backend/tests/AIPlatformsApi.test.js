const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.DB_STORAGE = ':memory:';
process.env.JWT_SECRET = 'ai-platform-api-test-secret';
process.env.CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');

const { sequelize, AIPlatformConfig } = require('../models');
const AIPlatformConfigService = require('../services/AIPlatformConfigService');
const AIPlatformRequestService = require('../services/AIPlatformRequestService');
const WebPlatformRuntimeStatusService = require('../services/WebPlatformRuntimeStatusService');
const adminRouter = require('../routes/adminAIPlatforms');
const catalogRouter = require('../routes/aiPlatforms');

function token(role) {
  return jwt.sign({ userId: role === 'admin' ? 1 : 2, username: role, role }, process.env.JWT_SECRET);
}

async function api(router, method, routePath, { role, body = {}, params = {} } = {}) {
  const layer = router.stack.find((item) => item.route?.path === routePath && item.route.methods?.[method.toLowerCase()]);
  assert.ok(layer, `route ${method} ${routePath} should exist`);
  const req = {
    headers: role ? { authorization: `Bearer ${token(role)}` } : {},
    body,
    params,
    query: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    app: { get: () => false }
  };
  const response = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    set(name, value) {
      this.headers = { ...(this.headers || {}), [name]: value };
      return this;
    }
  };
  const middleware = router.stack.filter((item) => !item.route).map((item) => item.handle);
  const handlers = [...middleware, ...layer.route.stack.map((item) => item.handle)];
  const dispatch = async (index) => {
    if (!handlers[index]) return;
    await handlers[index](req, response, () => dispatch(index + 1));
  };
  await dispatch(0);
  return { status: response.statusCode, json: response.payload, headers: response.headers || {} };
}

test.before(async () => {
  await sequelize.sync({ force: true });
  await AIPlatformConfigService.ensurePresets();
});

test.after(async () => {
  await sequelize.close();
});

test('protects platform management with administrator authorization', async () => {
  assert.equal((await api(adminRouter, 'GET', '/')).status, 401);
  assert.equal((await api(adminRouter, 'GET', '/', { role: 'user' })).status, 403);
  assert.equal((await api(adminRouter, 'GET', '/', { role: 'admin' })).status, 200);
});

test('creates and updates a platform without returning its API key', async () => {
  const created = await api(adminRouter, 'POST', '/', {
    role: 'admin',
    body: {
      code: 'example-ai',
      name: 'Example AI',
      adapter_type: 'openai_chat_completions',
      base_url: 'https://1.1.1.1/v1/chat/completions',
      default_model: 'example-model',
      api_key: 'sk-api-route-secret'
    }
  });

  assert.equal(created.status, 201);
  assert.equal(created.json.data.enabled, true);
  assert.equal(created.json.data.configured, true);
  assert.equal(created.json.data.api_key_last4, 'cret');
  assert.equal(JSON.stringify(created.json).includes('sk-api-route-secret'), false);
  assert.equal('encrypted_api_key' in created.json.data, false);

  const updated = await api(adminRouter, 'PUT', '/:id', {
    role: 'admin',
    params: { id: created.json.data.id },
    body: { name: 'Example AI CN', api_key: '' }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.name, 'Example AI CN');
  assert.equal(updated.json.data.configured, true);
});

test('reveals a configured API key only to an administrator and marks the response no-store', async () => {
  const platform = await AIPlatformConfig.findOne({ where: { code: 'example-ai' } });

  assert.equal((await api(adminRouter, 'GET', '/:id/api-key', {
    role: 'user',
    params: { id: platform.id }
  })).status, 403);

  const response = await api(adminRouter, 'GET', '/:id/api-key', {
    role: 'admin',
    params: { id: platform.id }
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.data.api_key, 'sk-api-route-secret');
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('returns selectable models for one configured platform', async () => {
  const platform = await AIPlatformConfig.findOne({ where: { code: 'example-ai' } });
  const original = AIPlatformRequestService.listModels;
  AIPlatformRequestService.listModels = async () => ({
    success: true,
    models: ['example-model', 'example-model-pro'],
    current_model: 'example-model'
  });

  try {
    const response = await api(adminRouter, 'GET', '/:id/models', {
      role: 'admin',
      params: { id: platform.id }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.json.data.models, ['example-model', 'example-model-pro']);
  } finally {
    AIPlatformRequestService.listModels = original;
  }
});

test('returns a non-sensitive platform catalog to authenticated users', async () => {
  const response = await api(catalogRouter, 'GET', '/', { role: 'user' });

  assert.equal(response.status, 200);
  assert.ok(response.json.data.length >= 2);
  for (const platform of response.json.data) {
    assert.deepEqual(Object.keys(platform).sort(), [
      'capabilities',
      'code',
      'configured',
      'enabled',
      'name',
      'selectable',
      'unavailable_reason'
    ]);
  }
});

test('returns the no-store Web runtime status only to authenticated users', async () => {
  const original = WebPlatformRuntimeStatusService.getStatus;
  let reads = 0;
  WebPlatformRuntimeStatusService.getStatus = async () => {
    reads += 1;
    return {
      schema_version: 'deepseek-web-runtime-v1',
      platform: 'deepseek-web',
      enabled: true,
      state: 'idle',
      running_count: 0,
      queued_count: 0,
      pending_count: 0,
      needs_action: false,
      action_code: null,
      reason_code: null,
      observed_at: '2026-07-27T02:00:00.000Z'
    };
  };

  try {
    assert.equal(
      (await api(catalogRouter, 'GET', '/deepseek-web/runtime-status')).status,
      401
    );
    const response = await api(
      catalogRouter,
      'GET',
      '/deepseek-web/runtime-status',
      { role: 'user' }
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
    assert.deepEqual(Object.keys(response.json.data).sort(), [
      'action_code',
      'enabled',
      'needs_action',
      'observed_at',
      'pending_count',
      'platform',
      'queued_count',
      'reason_code',
      'running_count',
      'schema_version',
      'state'
    ]);
    assert.equal(reads, 1);
  } finally {
    WebPlatformRuntimeStatusService.getStatus = original;
  }
});

test('keeps Web runtime status read failures generic and non-cacheable', async () => {
  const original = WebPlatformRuntimeStatusService.getStatus;
  WebPlatformRuntimeStatusService.getStatus = async () => {
    throw new Error('database path and query details');
  };

  try {
    const response = await api(
      catalogRouter,
      'GET',
      '/deepseek-web/runtime-status',
      { role: 'user' }
    );
    assert.equal(response.status, 500);
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
    assert.equal(response.json.message, '读取 DeepSeek Web 运行状态失败');
    assert.doesNotMatch(JSON.stringify(response.json), /database path|query details/);
  } finally {
    WebPlatformRuntimeStatusService.getStatus = original;
  }
});

test('rejects API-only administrator operations for the managed Web platform', async () => {
  const web = await AIPlatformConfig.findOne({ where: { code: 'deepseek-web' } });
  const calls = { models: 0, connection: 0, search: 0 };
  const originals = {
    models: AIPlatformRequestService.listModels,
    connection: AIPlatformRequestService.testConnection,
    search: AIPlatformRequestService.testWebSearch
  };
  AIPlatformRequestService.listModels = async () => { calls.models += 1; };
  AIPlatformRequestService.testConnection = async () => { calls.connection += 1; };
  AIPlatformRequestService.testWebSearch = async () => { calls.search += 1; };

  try {
    for (const [method, routePath] of [
      ['GET', '/:id/api-key'],
      ['DELETE', '/:id/api-key'],
      ['GET', '/:id/models'],
      ['POST', '/:id/test'],
      ['POST', '/:id/test-web-search']
    ]) {
      const response = await api(adminRouter, method, routePath, {
        role: 'admin',
        params: { id: web.id }
      });
      assert.equal(response.status, 400);
      assert.equal(response.json.data.error_code, 'unsupported_platform_capability');
    }
    assert.deepEqual(calls, { models: 0, connection: 0, search: 0 });
  } finally {
    AIPlatformRequestService.listModels = originals.models;
    AIPlatformRequestService.testConnection = originals.connection;
    AIPlatformRequestService.testWebSearch = originals.search;
  }
});

test('clears API keys through a dedicated endpoint', async () => {
  const platform = await AIPlatformConfig.findOne({ where: { code: 'example-ai' } });
  const response = await api(adminRouter, 'DELETE', '/:id/api-key', {
    role: 'admin',
    params: { id: platform.id }
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.data.configured, false);
  await platform.reload();
  assert.equal(platform.encrypted_api_key, null);
});

test('changes enabled state independently through the patch endpoint', async () => {
  const platform = await AIPlatformConfig.findOne({ where: { code: 'example-ai' } });
  const response = await api(adminRouter, 'PATCH', '/:id/enabled', {
    role: 'admin',
    params: { id: platform.id },
    body: { enabled: false }
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.data.enabled, false);
  assert.equal(response.json.data.configured, false);
});

test('runs an optional connection test without changing enabled state', async () => {
  const deepseek = await AIPlatformConfig.findOne({ where: { code: 'deepseek' } });
  await deepseek.update({ enabled: false });
  const original = AIPlatformRequestService.testConnection;
  AIPlatformRequestService.testConnection = async () => ({
    platform: { id: deepseek.id, code: 'deepseek', enabled: false, test_status: 'success' },
    connection: { success: true, message: '连接成功', response_time_ms: 25, model_name: 'deepseek-v4-flash' }
  });

  try {
    const response = await api(adminRouter, 'POST', '/:id/test', {
      role: 'admin',
      params: { id: deepseek.id }
    });
    assert.equal(response.status, 200);
    assert.equal(response.json.data.connection.success, true);
    assert.equal(response.json.data.platform.enabled, false);
  } finally {
    AIPlatformRequestService.testConnection = original;
  }
});

test('runs an independent web-search capability test', async () => {
  const deepseek = await AIPlatformConfig.findOne({ where: { code: 'deepseek' } });
  const original = AIPlatformRequestService.testWebSearch;
  AIPlatformRequestService.testWebSearch = async () => ({
    platform: { id: deepseek.id, code: 'deepseek', web_search_test_status: 'inconclusive' },
    web_search: {
      success: false,
      status: 'inconclusive',
      message: '模型调用成功，但响应中没有可验证的联网搜索证据'
    }
  });

  try {
    const response = await api(adminRouter, 'POST', '/:id/test-web-search', {
      role: 'admin',
      params: { id: deepseek.id }
    });
    assert.equal(response.status, 200);
    assert.equal(response.json.data.web_search.status, 'inconclusive');
  } finally {
    AIPlatformRequestService.testWebSearch = original;
  }
});
