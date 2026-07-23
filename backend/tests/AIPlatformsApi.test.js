const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.DB_STORAGE = ':memory:';
process.env.JWT_SECRET = 'ai-platform-api-test-secret';
process.env.CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');

const { sequelize, AIPlatformConfig } = require('../models');
const AIPlatformConfigService = require('../services/AIPlatformConfigService');
const AIPlatformRequestService = require('../services/AIPlatformRequestService');
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
    query: {}
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
    }
  };
  const middleware = router.stack.filter((item) => !item.route).map((item) => item.handle);
  const handlers = [...middleware, ...layer.route.stack.map((item) => item.handle)];
  const dispatch = async (index) => {
    if (!handlers[index]) return;
    await handlers[index](req, response, () => dispatch(index + 1));
  };
  await dispatch(0);
  return { status: response.statusCode, json: response.payload };
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

test('returns a non-sensitive platform catalog to authenticated users', async () => {
  const response = await api(catalogRouter, 'GET', '/', { role: 'user' });

  assert.equal(response.status, 200);
  assert.ok(response.json.data.length >= 2);
  for (const platform of response.json.data) {
    assert.deepEqual(Object.keys(platform).sort(), [
      'code',
      'configured',
      'enabled',
      'name',
      'selectable',
      'unavailable_reason'
    ]);
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
