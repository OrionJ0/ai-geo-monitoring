const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-seo-audit-jobs-'));
process.env.DB_STORAGE = path.join(databaseDir, 'test.sqlite');
delete process.env.DATABASE_URL;

const { sequelize, User, SeoAuditJob, SeoAuditRecord } = require('../models');
const { createSeoAuditJobService } = require('../services/SeoAuditJobService');
const { createSeoAuditHistoryService } = require('../services/SeoAuditHistoryService');

test.after(async () => {
  await sequelize.close();
  fs.rmSync(databaseDir, { recursive: true, force: true });
});

test('persists a completed site audit job and report in SQLite', async () => {
  await sequelize.sync({ force: true });
  const user = await User.create({
    username: 'seo-audit-sqlite-user',
    email: 'seo-audit-sqlite@example.com',
    password: 'not-used-in-test'
  });
  const report = {
    mode: 'site',
    scoreVersion: 'test-v1',
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    checkedAt: '2026-07-23T01:00:00.000Z',
    statusCode: 200,
    durationMs: 1200,
    score: 88,
    grade: 'good',
    summary: { total: 40, totalWeight: 200, issues: 2 },
    site: { discoveredPages: 3, auditedPages: 3, successfulPages: 3, failedPages: 0, truncated: false },
    issues: [],
    pages: []
  };
  const scheduled = [];
  const historyService = createSeoAuditHistoryService({ model: SeoAuditRecord });
  const service = createSeoAuditJobService({
    model: SeoAuditJob,
    siteAuditService: { async audit() { return report; } },
    historyService,
    schedule: (callback) => scheduled.push(callback)
  });

  const created = await service.create(user.id, 'example.com');
  await scheduled[0]();
  const completed = await service.get(user.id, created.id);

  assert.equal(completed.status, 'completed');
  assert.equal(completed.report.mode, 'site');
  assert.equal(completed.report.site.auditedPages, 3);
  assert.equal(await SeoAuditJob.count({ where: { user_id: user.id } }), 1);
  assert.equal(await SeoAuditRecord.count({ where: { user_id: user.id } }), 1);
  const history = await historyService.list(user.id);
  assert.equal(history.items[0].summary.mode, 'site');
  assert.equal(history.items[0].summary.pages, 3);
});
