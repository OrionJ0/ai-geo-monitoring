const test = require('node:test');
const assert = require('node:assert/strict');

const { createAuditHandler } = require('../routes/seoAudits');

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

test('POST handler validates the URL and returns the SEO report contract', async () => {
  const service = {
    async audit(url) {
      return { requestedUrl: `https://${url}/`, score: 82, categories: [] };
    }
  };
  const handler = createAuditHandler({ service });

  const missingResponse = createResponse();
  await handler({ body: {} }, missingResponse);
  assert.equal(missingResponse.statusCode, 400);
  assert.deepEqual(missingResponse.payload, { success: false, message: '请输入需要检测的网址' });

  const response = createResponse();
  await handler({ body: { url: 'example.com' } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.success, true);
  assert.equal(response.payload.data.score, 82);
});

test('POST handler exposes safe SEO audit errors without leaking internals', async () => {
  const service = {
    async audit() {
      const error = new Error('不能检测本机或内网地址');
      error.code = 'PRIVATE_NETWORK_URL';
      error.status = 400;
      throw error;
    }
  };
  const response = createResponse();

  await createAuditHandler({ service })({ body: { url: 'http://127.0.0.1' } }, response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.payload, {
    success: false,
    message: '不能检测本机或内网地址',
    code: 'PRIVATE_NETWORK_URL'
  });
});
