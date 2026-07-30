const test = require('node:test');
const assert = require('node:assert/strict');

const { createSeoAuditJobService } = require('../services/SeoAuditJobService');

function createRow(values) {
  return {
    ...values,
    async update(patch) {
      Object.assign(this, patch);
      return this;
    },
    get() {
      return { ...this, update: undefined, get: undefined };
    }
  };
}

test('creates an async site audit job, persists progress and saves the completed report', async () => {
  const scheduled = [];
  const rows = new Map();
  let nextId = 1;
  const model = {
    async create(values) {
      const row = createRow({ id: nextId++, ...values, created_at: new Date('2026-07-23T01:00:00Z') });
      rows.set(row.id, row);
      return row;
    },
    async findByPk(id) {
      return rows.get(id) || null;
    },
    async findOne({ where }) {
      const row = rows.get(where.id);
      return row?.user_id === where.user_id ? row : null;
    }
  };
  const report = {
    mode: 'site', requestedUrl: 'https://example.com/', finalUrl: 'https://www.example.com/',
    checkedAt: '2026-07-23T01:02:00Z', statusCode: 200, durationMs: 120000,
    score: 80, grade: 'good', summary: { issues: 2 },
    site: {
      origin: 'https://www.example.com',
      auditedPages: 5,
      failedPages: 0,
      truncated: false
    },
    pages: [],
    issues: [],
    sitewide: { checks: [], issues: [] }
  };
  const siteAuditService = {
    async audit(url, { onProgress }) {
      assert.equal(url, 'https://example.com/');
      await onProgress({ phase: 'crawling', auditedPages: 2, discoveredPages: 5, failedPages: 0 });
      return report;
    }
  };
  const historyService = {
    async save(userId, value) {
      assert.equal(userId, 7);
      assert.equal(value, report);
      return { id: 77 };
    },
    async get(userId, auditId) {
      return userId === 7 && auditId === 77 ? { ...report, auditId } : null;
    },
    async findPreviousSiteReport(userId, url, { before }) {
      assert.equal(userId, 7);
      assert.equal(url, 'https://www.example.com');
      assert.equal(before, report.checkedAt);
      return {
        auditId: 55,
        mode: 'site',
        site: { origin: 'https://www.example.com', truncated: false },
        pages: [],
        issues: [],
        sitewide: { checks: [], issues: [] }
      };
    }
  };
  const service = createSeoAuditJobService({
    model,
    siteAuditService,
    historyService,
    schedule: (callback) => scheduled.push(callback)
  });

  const created = await service.create(7, 'example.com');
  assert.equal(created.id, 1);
  assert.equal(created.status, 'queued');
  assert.equal(created.progress.phase, 'queued');
  assert.equal(scheduled.length, 1);

  await scheduled[0]();

  const completed = await service.get(7, created.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.auditId, 77);
  assert.equal(completed.progress.phase, 'completed');
  assert.equal(completed.report.comparison.previous_audit_id, 55);
  assert.deepEqual(completed.report, { ...report, auditId: 77 });
  assert.equal(await service.get(8, created.id), null);
});

test('marks failed jobs safely and does not create a false history report', async () => {
  const scheduled = [];
  const row = createRow({
    id: 4,
    user_id: 7,
    requested_url: 'https://example.com/',
    status: 'queued',
    progress: { phase: 'queued' },
    created_at: new Date('2026-07-23T01:00:00Z')
  });
  let saveCalls = 0;
  const service = createSeoAuditJobService({
    model: {
      async create() { return row; },
      async findByPk() { return row; },
      async findOne() { return row; }
    },
    siteAuditService: {
      async audit() {
        throw Object.assign(new Error('网站响应超时，请稍后重试'), {
          code: 'UPSTREAM_TIMEOUT',
          status: 504,
          stopReason: 'entry_http_error',
          retryAt: '2026-07-30T10:00:00.000Z',
          crawlDiagnostics: {
            networkRequests: {
              total: 3,
              byKind: { page: 1, robots: 1, sitemap: 1, link_probe: 0, secret: 99 },
              redirectHops: 0
            },
            renderAttempts: 0,
            stopReason: 'entry_http_error',
            rawBody: 'SECRET_DIAGNOSTIC_BODY'
          },
          responseBody: 'SECRET_RESPONSE_MUST_NOT_BE_PERSISTED'
        });
      }
    },
    historyService: { async save() { saveCalls += 1; } },
    schedule: (callback) => scheduled.push(callback)
  });

  await service.create(7, 'https://example.com/');
  await scheduled[0]();

  assert.equal(row.status, 'failed');
  assert.equal(row.error_code, 'UPSTREAM_TIMEOUT');
  assert.equal(row.error_message, '网站响应超时，请稍后重试');
  assert.equal(row.progress.phase, 'failed');
  assert.equal(row.progress.stopReason, 'entry_http_error');
  assert.equal(row.progress.retryAt, '2026-07-30T10:00:00.000Z');
  assert.equal(row.progress.crawlDiagnostics.networkRequests.total, 3);
  assert.equal(Object.hasOwn(row.progress.crawlDiagnostics, 'rawBody'), false);
  assert.equal(Object.hasOwn(row.progress.crawlDiagnostics.networkRequests.byKind, 'secret'), false);
  assert.equal(JSON.stringify(row.progress).includes('SECRET_RESPONSE'), false);
  assert.equal(JSON.stringify(row.progress).includes('SECRET_DIAGNOSTIC_BODY'), false);
  assert.equal(saveCalls, 0);

  const refreshed = await service.get(7, row.id);
  assert.equal(refreshed.error.code, 'UPSTREAM_TIMEOUT');
  assert.equal(refreshed.progress.stopReason, 'entry_http_error');
  assert.equal(refreshed.progress.crawlDiagnostics.networkRequests.total, 3);
});

test('requeues interrupted jobs after a service restart', async () => {
  const jobs = [
    createRow({ id: 8, status: 'running', progress: { phase: 'crawling', auditedPages: 3 } }),
    createRow({ id: 9, status: 'queued', progress: { phase: 'queued' } })
  ];
  const scheduled = [];
  const service = createSeoAuditJobService({
    model: {
      async findAll() { return jobs; }
    },
    siteAuditService: {},
    historyService: {},
    schedule: (callback) => scheduled.push(callback)
  });

  const recovered = await service.recoverInterruptedJobs();

  assert.equal(recovered, 2);
  assert.equal(scheduled.length, 2);
  assert.equal(jobs[0].status, 'queued');
  assert.equal(jobs[0].progress.phase, 'queued');
  assert.equal(jobs[0].progress.recovered, true);
});

test('rebuilds a private audit runtime from the stored URL after restart', async () => {
  const job = createRow({
    id: 12,
    user_id: 7,
    requested_url: 'http://192.168.9.206:3003/',
    status: 'running',
    progress: { phase: 'crawling', auditedPages: 1 },
    created_at: new Date('2026-07-23T01:00:00Z')
  });
  const scheduled = [];
  const savedReports = [];
  const service = createSeoAuditJobService({
    model: {
      async findAll() { return [job]; },
      async findByPk(id) { return id === job.id ? job : null; },
      async findOne() { return job; }
    },
    targetResolver(url) {
      assert.equal(url, 'http://192.168.9.206:3003/');
      return {
        requestedUrl: url,
        policy: {
          networkScope: 'private',
          allowedPrivateOrigin: 'http://192.168.9.206:3003'
        }
      };
    },
    runtimeFactory(url) {
      assert.equal(url, 'http://192.168.9.206:3003/');
      return {
        requestedUrl: url,
        policy: {
          networkScope: 'private',
          allowedPrivateOrigin: 'http://192.168.9.206:3003'
        },
        service: {
          async audit() {
            return {
              mode: 'site',
              requestedUrl: url,
              finalUrl: url,
              checkedAt: '2026-07-23T01:02:00Z',
              site: {
                origin: 'http://192.168.9.206:3003',
                discoveredPages: 2,
                auditedPages: 2,
                failedPages: 0,
                truncated: false
              },
              pages: [],
              issues: [],
              sitewide: { checks: [], issues: [] }
            };
          }
        }
      };
    },
    historyService: {
      async findPreviousSiteReport() { return null; },
      async save(userId, report) {
        savedReports.push({ userId, report });
        return { id: 91 };
      },
      async get() { return null; }
    },
    schedule: (callback) => scheduled.push(callback)
  });

  await service.recoverInterruptedJobs();
  await scheduled[0]();

  assert.equal(job.status, 'completed');
  assert.equal(savedReports[0].userId, 7);
  assert.deepEqual(savedReports[0].report.networkPolicy, {
    scope: 'private',
    externalLinkProbes: 'not_checked',
    javascriptRendering: 'not_checked'
  });
});
