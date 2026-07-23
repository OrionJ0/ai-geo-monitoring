const test = require('node:test');
const assert = require('node:assert/strict');

const { createSeoAuditHistoryService } = require('../services/SeoAuditHistoryService');

test('lists only the requested user audit summaries with stable pagination', async () => {
  let receivedQuery;
  const model = {
    async findAndCountAll(query) {
      receivedQuery = query;
      return {
        count: 11,
        rows: [{
          id: 23,
          requested_url: 'example.com',
          final_url: 'https://example.com/',
          status_code: 200,
          duration_ms: 320,
          score: 82,
          grade: 'good',
          summary: { total: 19, issues: 3 },
          checked_at: new Date('2026-07-23T01:00:00.000Z')
        }]
      };
    }
  };
  const service = createSeoAuditHistoryService({ model });

  const result = await service.list(7, { page: 2, pageSize: 10 });

  assert.deepEqual(receivedQuery.where, { user_id: 7 });
  assert.deepEqual(receivedQuery.order, [['checked_at', 'DESC'], ['id', 'DESC']]);
  assert.equal(receivedQuery.limit, 10);
  assert.equal(receivedQuery.offset, 10);
  assert.equal(receivedQuery.attributes.includes('report'), false);
  assert.deepEqual(result.pagination, { page: 2, pageSize: 10, totalItems: 11, totalPages: 2 });
  assert.deepEqual(result.items[0], {
    id: 23,
    requestedUrl: 'example.com',
    finalUrl: 'https://example.com/',
    statusCode: 200,
    durationMs: 320,
    score: 82,
    grade: 'good',
    summary: { total: 19, issues: 3, mode: 'page', pages: 1, failedPages: 0, truncated: false },
    checkedAt: '2026-07-23T01:00:00.000Z'
  });
});

test('stores site audit mode and page coverage in the history summary', async () => {
  let created;
  const model = {
    async create(values) {
      created = values;
      return { id: 31, ...values };
    }
  };
  const service = createSeoAuditHistoryService({ model });
  const report = {
    mode: 'site',
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    statusCode: 200,
    durationMs: 5000,
    score: 76,
    grade: 'good',
    scoreVersion: '2026-07-23-v4',
    scoreModel: 'technical-health-v4',
    checkedAt: '2026-07-23T01:00:00.000Z',
    summary: { total: 100, issues: 4 },
    site: { auditedPages: 8, failedPages: 1, truncated: true },
    health: {
      status: 'needs_improvement',
      rawScore: 75.625,
      scoreCap: null,
      stages: [
        { key: 'access', label: '访问与发现', score: 20, budget: 30, deduction: 10 }
      ]
    }
  };

  await service.save(7, report);

  assert.deepEqual(created.summary, {
    total: 100,
    issues: 4,
    mode: 'site',
    pages: 8,
    failedPages: 1,
    truncated: true,
    scoreStatus: 'needs_improvement',
    scoreVersion: '2026-07-23-v4',
    scoreModel: 'technical-health-v4',
    rawScore: 75.625,
    scoreCap: null,
    stageScores: [
      { key: 'access', label: '访问与发现', score: 20, budget: 30, deduction: 10 }
    ]
  });
  assert.equal(created.report, report);
});

test('loads a complete report only inside the requested user scope', async () => {
  let receivedQuery;
  const model = {
    async findOne(query) {
      receivedQuery = query;
      return {
        id: 23,
        report: {
          requestedUrl: 'https://example.com/',
          score: 82,
          categories: [{ key: 'metadata', checks: [] }]
        }
      };
    }
  };
  const service = createSeoAuditHistoryService({ model });

  const report = await service.get(7, 23);

  assert.deepEqual(receivedQuery.where, { id: 23, user_id: 7 });
  assert.deepEqual(report, {
    requestedUrl: 'https://example.com/',
    score: 82,
    categories: [{ key: 'metadata', checks: [] }],
    auditId: 23
  });
});

test('persists an unknown score without presenting the database sentinel as a real score', async () => {
  let created;
  const model = {
    async create(values) {
      created = values;
      return values;
    },
    async findAndCountAll() {
      return {
        count: 1,
        rows: [{
          id: 41,
          requested_url: 'https://example.com/',
          final_url: 'https://example.com/',
          status_code: 200,
          duration_ms: 500,
          score: 0,
          grade: 'unknown',
          summary: created.summary,
          checked_at: new Date('2026-07-23T01:00:00.000Z')
        }]
      };
    }
  };
  const service = createSeoAuditHistoryService({ model });
  const report = {
    mode: 'page',
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    statusCode: 200,
    durationMs: 500,
    score: null,
    grade: 'unknown',
    checkedAt: '2026-07-23T01:00:00.000Z',
    summary: { total: 23, issues: 4 },
    health: { status: 'unknown', unknownReasons: ['robots.txt 证据不足'] }
  };

  await service.save(7, report);
  const history = await service.list(7);

  assert.equal(created.score, 0);
  assert.equal(created.report.score, null);
  assert.equal(created.summary.scoreStatus, 'unknown');
  assert.equal(history.items[0].score, null);
});

test('finds the latest previous full-site report for the same origin and user', async () => {
  let receivedQuery;
  const model = {
    async findAll(query) {
      receivedQuery = query;
      return [
        {
          id: 31,
          report: {
            mode: 'page',
            finalUrl: 'https://example.com/',
            checkedAt: '2026-07-23T02:00:00.000Z'
          }
        },
        {
          id: 30,
          report: {
            mode: 'site',
            finalUrl: 'https://other.example/',
            checkedAt: '2026-07-23T01:30:00.000Z'
          }
        },
        {
          id: 29,
          report: {
            mode: 'site',
            finalUrl: 'https://example.com/',
            checkedAt: '2026-07-23T01:00:00.000Z'
          }
        }
      ];
    }
  };
  const service = createSeoAuditHistoryService({ model });

  const report = await service.findPreviousSiteReport(7, 'https://example.com/product');

  assert.deepEqual(receivedQuery.where, { user_id: 7 });
  assert.deepEqual(receivedQuery.order, [['checked_at', 'DESC'], ['id', 'DESC']]);
  assert.equal(report.auditId, 29);
  assert.equal(report.mode, 'site');
});
