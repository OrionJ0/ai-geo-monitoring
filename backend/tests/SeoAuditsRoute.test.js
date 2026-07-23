const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAuditHandler,
  createSiteAuditHandler,
  createJobDetailHandler,
  createListHandler,
  createDetailHandler
} = require('../routes/seoAudits');

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
  const savedReports = [];
  const service = {
    async audit(url) {
      return { requestedUrl: `https://${url}/`, score: 82, categories: [] };
    }
  };
  const historyService = {
    async save(userId, report) {
      savedReports.push({ userId, report });
      return { id: 41 };
    }
  };
  const handler = createAuditHandler({ service, historyService });

  const missingResponse = createResponse();
  await handler({ body: {} }, missingResponse);
  assert.equal(missingResponse.statusCode, 400);
  assert.deepEqual(missingResponse.payload, { success: false, message: '请输入需要检测的网址' });

  const response = createResponse();
  await handler({ body: { url: 'example.com' }, user: { id: 7 } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.success, true);
  assert.equal(response.payload.data.score, 82);
  assert.equal(response.payload.data.auditId, 41);
  assert.deepEqual(savedReports, [{
    userId: 7,
    report: { requestedUrl: 'https://example.com/', score: 82, categories: [] }
  }]);
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

test('GET collection handler returns the current user paginated history', async () => {
  const received = [];
  const historyService = {
    async list(userId, pagination) {
      received.push({ userId, pagination });
      return {
        items: [{ id: 23, finalUrl: 'https://example.com/', score: 82 }],
        pagination: { page: 2, pageSize: 10, totalItems: 11, totalPages: 2 }
      };
    }
  };
  const response = createResponse();

  await createListHandler({ historyService })({
    user: { id: 7 },
    query: { page: '2', pageSize: '10' }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.success, true);
  assert.equal(response.payload.data.items[0].id, 23);
  assert.deepEqual(received, [{ userId: 7, pagination: { page: '2', pageSize: '10' } }]);
});

test('GET detail handler returns an owned report and hides unowned records', async () => {
  const historyService = {
    async get(userId, auditId) {
      if (userId === 7 && auditId === 23) return { auditId: 23, score: 82, categories: [] };
      return null;
    }
  };
  const handler = createDetailHandler({ historyService });
  const ownedResponse = createResponse();
  await handler({ user: { id: 7 }, params: { id: '23' } }, ownedResponse);
  assert.equal(ownedResponse.statusCode, 200);
  assert.equal(ownedResponse.payload.data.auditId, 23);

  const hiddenResponse = createResponse();
  await handler({ user: { id: 8 }, params: { id: '23' } }, hiddenResponse);
  assert.equal(hiddenResponse.statusCode, 404);
  assert.deepEqual(hiddenResponse.payload, { success: false, message: 'SEO 检测历史不存在' });
});

test('POST site handler creates an asynchronous audit job', async () => {
  const received = [];
  const jobService = {
    async create(userId, url) {
      received.push({ userId, url });
      return { id: 51, status: 'queued', progress: { phase: 'queued' } };
    }
  };
  const response = createResponse();

  await createSiteAuditHandler({ jobService })({
    user: { id: 7 },
    body: { url: 'example.com' }
  }, response);

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.payload, {
    success: true,
    data: { id: 51, status: 'queued', progress: { phase: 'queued' } }
  });
  assert.deepEqual(received, [{ userId: 7, url: 'example.com' }]);
});

test('GET job handler returns only a job owned by the current user', async () => {
  const jobService = {
    async get(userId, jobId) {
      return userId === 7 && jobId === 51 ? { id: 51, status: 'running' } : null;
    }
  };
  const handler = createJobDetailHandler({ jobService });
  const ownedResponse = createResponse();
  await handler({ user: { id: 7 }, params: { jobId: '51' } }, ownedResponse);
  assert.equal(ownedResponse.statusCode, 200);
  assert.equal(ownedResponse.payload.data.status, 'running');

  const hiddenResponse = createResponse();
  await handler({ user: { id: 8 }, params: { jobId: '51' } }, hiddenResponse);
  assert.equal(hiddenResponse.statusCode, 404);
  assert.deepEqual(hiddenResponse.payload, { success: false, message: 'SEO 检测任务不存在' });
});
