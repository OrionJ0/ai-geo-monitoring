const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSeoAuditSettingsHandlers
} = require('../routes/settings');
const settingsRouter = require('../routes/settings');

function createResponse() {
  return {
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
}

test('administrator settings API returns and replaces the owned origin list', async () => {
  let ownedOrigins = ['https://gato.com.cn'];
  const handlers = createSeoAuditSettingsHandlers({
    settingsService: {
      async getSettings() {
        return { ownedOrigins };
      },
      async setOwnedOrigins(values) {
        ownedOrigins = values;
        return { ownedOrigins };
      }
    }
  });

  const getResponse = createResponse();
  await handlers.get({}, getResponse);
  assert.deepEqual(getResponse.payload, {
    success: true,
    data: { ownedOrigins: ['https://gato.com.cn'] }
  });

  const putResponse = createResponse();
  await handlers.put({
    body: { ownedOrigins: ['https://insight.guangtuo.com'] }
  }, putResponse);
  assert.equal(putResponse.statusCode, 200);
  assert.deepEqual(putResponse.payload, {
    success: true,
    message: '自有站点配置已更新',
    data: { ownedOrigins: ['https://insight.guangtuo.com'] }
  });
});

test('administrator settings API exposes validation errors without leaking internals', async () => {
  const handlers = createSeoAuditSettingsHandlers({
    settingsService: {
      async setOwnedOrigins() {
        throw Object.assign(new Error('请输入站点 Origin，不能包含路径'), {
          code: 'INVALID_SEO_AUDIT_OWNED_ORIGIN',
          status: 400
        });
      }
    }
  });
  const response = createResponse();

  await handlers.put({ body: { ownedOrigins: ['https://example.com/path'] } }, response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.payload, {
    success: false,
    message: '请输入站点 Origin，不能包含路径',
    code: 'INVALID_SEO_AUDIT_OWNED_ORIGIN'
  });
});

test('owned-site settings routes require administrator authorization', () => {
  const routeLayers = settingsRouter.stack
    .filter((layer) => layer.route?.path === '/seo-audit')
    .flatMap((layer) => layer.route.stack);

  assert.equal(routeLayers.length, 4);
  assert.deepEqual(
    routeLayers.map((layer) => layer.handle.name),
    ['adminRequired', 'get', 'adminRequired', 'put']
  );
});
