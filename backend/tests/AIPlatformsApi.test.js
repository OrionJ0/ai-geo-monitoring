const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.DB_STORAGE = ':memory:';
process.env.JWT_SECRET = 'ai-platform-api-test-secret';
process.env.CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');

const { sequelize, AIPlatformConfig, User } = require('../models');
const AIPlatformConfigService = require('../services/AIPlatformConfigService');
const AIPlatformRequestService = require('../services/AIPlatformRequestService');
const WebPlatformRuntimeStatusService = require('../services/WebPlatformRuntimeStatusService');
const WebPlatformRegistry = require('../services/WebPlatformRegistry');
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
  await User.bulkCreate([
    {
      id: 1,
      username: 'admin',
      email: 'admin@example.com',
      password: 'not-used-in-route-tests',
      role: 'admin',
      status: 'active'
    },
    {
      id: 2,
      username: 'user',
      email: 'user@example.com',
      password: 'not-used-in-route-tests',
      role: 'user',
      status: 'active'
    }
  ]);
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
  const reads = [];
  WebPlatformRuntimeStatusService.getStatus = async (platformCode) => {
    reads.push(platformCode);
    return {
      schema_version: `${platformCode}-runtime-v1`,
      platform: platformCode,
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
      (await api(catalogRouter, 'GET', '/:platformCode/runtime-status', {
        params: { platformCode: 'deepseek-web' }
      })).status,
      401
    );
    const response = await api(
      catalogRouter,
      'GET',
      '/:platformCode/runtime-status',
      { role: 'user', params: { platformCode: 'deepseek-web' } }
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
    const doubao = await api(
      catalogRouter,
      'GET',
      '/:platformCode/runtime-status',
      { role: 'user', params: { platformCode: 'doubao-web' } }
    );
    assert.equal(doubao.status, 200);
    assert.equal(doubao.json.data.platform, 'doubao-web');
    assert.deepEqual(reads, ['deepseek-web', 'doubao-web']);

    const unknown = await api(
      catalogRouter,
      'GET',
      '/:platformCode/runtime-status',
      { role: 'user', params: { platformCode: 'doubao' } }
    );
    assert.equal(unknown.status, 404);
    assert.deepEqual(reads, ['deepseek-web', 'doubao-web']);
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
      '/:platformCode/runtime-status',
      { role: 'user', params: { platformCode: 'deepseek-web' } }
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

test('lets only administrators inspect, open and verify a managed Web login session', async () => {
  const web = await AIPlatformConfig.findOne({ where: { code: 'doubao-web' } });
  const originalGetService = WebPlatformRegistry.getService;
  const calls = [];
  const snapshots = {
    initial: {
      schema_version: 'managed-web-session-v1',
      platform: 'doubao-web',
      browser_configured: true,
      profile_initialized: false,
      login_state: 'unchecked',
      reason_code: null,
      last_verified_at: null
    },
    opened: {
      schema_version: 'managed-web-session-v1',
      platform: 'doubao-web',
      browser_configured: true,
      profile_initialized: true,
      login_state: 'login_required',
      reason_code: 'web_login_required',
      last_verified_at: null
    },
    verified: {
      schema_version: 'managed-web-session-v1',
      platform: 'doubao-web',
      browser_configured: true,
      profile_initialized: true,
      login_state: 'ready',
      reason_code: null,
      last_verified_at: '2026-07-27T08:00:00.000Z'
    }
  };
  WebPlatformRegistry.getService = (platformCode) => {
    assert.equal(platformCode, 'doubao-web');
    return {
      getAdminSessionSnapshot() {
        calls.push('status');
        return snapshots.initial;
      },
      async beginInteractiveLogin() {
        calls.push('open');
        return snapshots.opened;
      },
      async verifyInteractiveLogin() {
        calls.push('verify');
        return snapshots.verified;
      }
    };
  };

  try {
    assert.equal((await api(adminRouter, 'GET', '/:id/web-session', {
      role: 'user',
      params: { id: web.id }
    })).status, 403);

    const status = await api(adminRouter, 'GET', '/:id/web-session', {
      role: 'admin',
      params: { id: web.id }
    });
    assert.equal(status.status, 200);
    assert.equal(status.headers['Cache-Control'], 'no-store');
    assert.deepEqual(status.json.data, snapshots.initial);

    const opened = await api(adminRouter, 'POST', '/:id/web-session/open', {
      role: 'admin',
      params: { id: web.id }
    });
    assert.equal(opened.status, 200);
    assert.deepEqual(opened.json.data, snapshots.opened);

    const verified = await api(adminRouter, 'POST', '/:id/web-session/verify', {
      role: 'admin',
      params: { id: web.id }
    });
    assert.equal(verified.status, 200);
    assert.deepEqual(verified.json.data, snapshots.verified);
    assert.deepEqual(calls, ['status', 'open', 'verify']);
    assert.doesNotMatch(
      JSON.stringify([status.json, opened.json, verified.json]),
      /profile_dir|chrome_executable|cookie|authorization/i
    );
  } finally {
    WebPlatformRegistry.getService = originalGetService;
  }
});

test('rejects Web session operations for API platforms before touching a Web runtime', async () => {
  const apiPlatform = await AIPlatformConfig.findOne({ where: { code: 'deepseek' } });
  const originalGetService = WebPlatformRegistry.getService;
  let runtimeReads = 0;
  WebPlatformRegistry.getService = () => {
    runtimeReads += 1;
    return {};
  };

  try {
    for (const [method, routePath] of [
      ['GET', '/:id/web-session'],
      ['POST', '/:id/web-session/open'],
      ['POST', '/:id/web-session/verify']
    ]) {
      const response = await api(adminRouter, method, routePath, {
        role: 'admin',
        params: { id: apiPlatform.id }
      });
      assert.equal(response.status, 400);
      assert.equal(
        response.json.data.error_code,
        'unsupported_platform_capability'
      );
    }
    assert.equal(runtimeReads, 0);
  } finally {
    WebPlatformRegistry.getService = originalGetService;
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
