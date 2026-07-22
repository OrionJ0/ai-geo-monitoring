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
    summary: { total: 19, issues: 3 },
    checkedAt: '2026-07-23T01:00:00.000Z'
  });
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
