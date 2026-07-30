const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAuditHandler,
  createSiteAuditHandler,
  createJobDetailHandler,
  createRuntimeInfoHandler,
  createListHandler,
  createDetailHandler,
  createExportHandler,
  createImportHandler
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
    },
    type(value) {
      this.headers = { ...(this.headers || {}), 'content-type': value };
      return this;
    },
    set(name, value) {
      this.headers = { ...(this.headers || {}), [String(name).toLowerCase()]: value };
      return this;
    },
    send(payload) {
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

test('POST handler applies a request-local private target policy to the saved report', async () => {
  const savedReports = [];
  const handler = createAuditHandler({
    runtimeFactory(url) {
      assert.equal(url, 'http://192.168.9.206:3003/');
      return {
        requestedUrl: url,
        policy: {
          networkScope: 'private',
          allowedPrivateOrigin: 'http://192.168.9.206:3003'
        },
        service: {
          async audit(requestedUrl) {
            return {
              mode: 'page',
              requestedUrl,
              finalUrl: requestedUrl,
              score: 82,
              categories: []
            };
          }
        }
      };
    },
    historyService: {
      async save(userId, report) {
        savedReports.push({ userId, report });
        return { id: 42 };
      }
    }
  });
  const response = createResponse();

  await handler({
    body: { url: 'http://192.168.9.206:3003/' },
    user: { id: 7 }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.data.networkPolicy.scope, 'private');
  assert.deepEqual(savedReports[0].report.networkPolicy, {
    scope: 'private'
  });
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

test('POST handler returns a WAF stop reason without saving a false success history', async () => {
  let saveCalls = 0;
  const handler = createAuditHandler({
    runtimeFactory(url) {
      return {
        requestedUrl: url,
        policy: { networkScope: 'public' },
        service: {
          async audit() {
            throw Object.assign(new Error(
              '当前 GoodieAI 审计身份或出口被目标站点安全策略拦截，无法完成检测；不能据此判断搜索引擎是否也被阻止。'
            ), {
              code: 'SEO_AUDIT_BLOCKED_BY_WAF',
              status: 502
            });
          }
        }
      };
    },
    historyService: {
      async save() {
        saveCalls += 1;
      }
    }
  });
  const response = createResponse();

  await handler({
    body: { url: 'https://example.com/' },
    user: { id: 7 }
  }, response);

  assert.equal(response.statusCode, 502);
  assert.equal(response.payload.code, 'SEO_AUDIT_BLOCKED_BY_WAF');
  assert.match(response.payload.message, /GoodieAI/);
  assert.match(response.payload.message, /不能据此判断搜索引擎/);
  assert.equal(saveCalls, 0);
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

test('用户只能把自己的 SEO 历史导出为标准 CSV', async () => {
  const historyService = {
    async get(userId, auditId) {
      return userId === 7 && auditId === 23
        ? { auditId: 23, finalUrl: 'https://example.com/', score: 82 }
        : null;
    }
  };
  const exchangeService = {
    buildCsv(report) {
      return `csv:${report.auditId}`;
    }
  };
  const handler = createExportHandler({ historyService, exchangeService });

  const ownedResponse = createResponse();
  await handler({ user: { id: 7 }, params: { id: '23' } }, ownedResponse);
  assert.equal(ownedResponse.statusCode, 200);
  assert.equal(ownedResponse.payload, 'csv:23');
  assert.match(ownedResponse.headers['content-type'], /text\/csv/);
  assert.match(ownedResponse.headers['content-disposition'], /seo-audit-23\.csv/);

  const hiddenResponse = createResponse();
  await handler({ user: { id: 8 }, params: { id: '23' } }, hiddenResponse);
  assert.equal(hiddenResponse.statusCode, 404);
  assert.deepEqual(hiddenResponse.payload, { success: false, message: 'SEO 检测历史不存在' });
});

test('标准 CSV 可以作为当前用户的新历史报告导回', async () => {
  const saved = [];
  const historyService = {
    async save(userId, report) {
      saved.push({ userId, report });
      return { id: 77 };
    }
  };
  const exchangeService = {
    parseCsv(csv) {
      assert.equal(csv, 'standard csv');
      return { sourceAuditId: 23, report: { score: 82 } };
    },
    prepareImportedReport(parsed) {
      return { ...parsed.report, source: 'imported', checkedAt: '2026-07-23T04:00:00.000Z' };
    }
  };
  const response = createResponse();

  await createImportHandler({ historyService, exchangeService })({
    user: { id: 7 },
    body: 'standard csv'
  }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.data.auditId, 77);
  assert.equal(response.payload.data.source, 'imported');
  assert.deepEqual(saved, [{
    userId: 7,
    report: { score: 82, source: 'imported', checkedAt: '2026-07-23T04:00:00.000Z' }
  }]);
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

test('SEO runtime endpoint exposes the active score contract', () => {
  const response = createResponse();

  createRuntimeInfoHandler()({}, response);

  assert.deepEqual(response.payload, {
    success: true,
    data: {
      scoreVersion: '2026-07-23-v4',
      scoreModel: 'technical-health-v4',
      privateTargetsEnabled: false
    }
  });
});

test('SEO runtime endpoint exposes whether this deployment allows private targets', () => {
  const response = createResponse();

  createRuntimeInfoHandler({ allowPrivateTargets: () => true })({}, response);

  assert.equal(response.payload.data.privateTargetsEnabled, true);
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
