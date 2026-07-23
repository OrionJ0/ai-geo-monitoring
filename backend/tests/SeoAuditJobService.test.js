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
    mode: 'site', requestedUrl: 'https://example.com/', finalUrl: 'https://example.com/',
    checkedAt: '2026-07-23T01:02:00Z', statusCode: 200, durationMs: 120000,
    score: 80, grade: 'good', summary: { issues: 2 }, site: { auditedPages: 5 }
  };
  const siteAuditService = {
    async audit(url, { onProgress, previousReport }) {
      assert.equal(url, 'https://example.com/');
      assert.equal(previousReport.auditId, 55);
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
    async findPreviousSiteReport(userId, url) {
      assert.equal(userId, 7);
      assert.equal(url, 'https://example.com/');
      return { auditId: 55, mode: 'site', issues: [] };
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
        throw Object.assign(new Error('网站响应超时，请稍后重试'), { code: 'UPSTREAM_TIMEOUT', status: 504 });
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
  assert.equal(saveCalls, 0);
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
