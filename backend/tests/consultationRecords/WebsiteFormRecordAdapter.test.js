const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeDetail,
  normalizeSummary
} = require('../../modules/consultationRecords/contracts/consultationRecordContract');
const {
  WebsiteFormRecordAdapter
} = require('../../modules/consultationRecords/adapters/WebsiteFormRecordAdapter');

const upstreamRecord = Object.freeze({
  id: '91',
  name: '测试姓名',
  phone: '13812345678',
  email: 'person@example.com',
  demandType: '技术咨询',
  company: '测试企业',
  region: '上海',
  detail: '联系电话 13812345678，需要了解周界报警方案',
  status: 'pending',
  createdAt: '2026-08-03T03:08:00.000Z'
});

test('website record adapter is available only with a configured real source client', async () => {
  const disabled = new WebsiteFormRecordAdapter();
  assert.equal((await disabled.getStatus()).sourceState, 'AGGREGATE_ONLY');

  const adapter = new WebsiteFormRecordAdapter({
    configuredProjectId: '7',
    sourceClient: {
      async readContactRecords() { return [upstreamRecord]; },
      async readContactRecord() { return upstreamRecord; }
    }
  });
  assert.deepEqual(await adapter.getStatus(), {
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    sourceState: 'AVAILABLE',
    recordCoverage: 'FULL',
    reasonCode: null
  });
  assert.deepEqual(await adapter.getStatus({ projectId: '8' }), {
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    sourceState: 'NOT_CONNECTED',
    recordCoverage: 'NONE',
    reasonCode: 'WEBSITE_FORM_PROJECT_NOT_CONFIGURED'
  });
});

test('website record adapter exposes bounded upstream pagination for the default list path', async () => {
  const calls = [];
  const adapter = new WebsiteFormRecordAdapter({
    configuredProjectId: '7',
    sourceClient: {
      async readContactRecords() { throw new Error('full scan must not run'); },
      async readContactRecordPage(value) {
        calls.push(value);
        return { total: 1, records: [upstreamRecord] };
      },
      async readContactRecord() { return upstreamRecord; }
    }
  });
  const result = await adapter.listRecordPage({
    projectId: '7',
    query: { from: '2026-08-01', to: '2026-08-03' },
    page: 2,
    pageSize: 10
  });
  assert.equal(result.totalItems, 1);
  assert.equal(result.items[0].id, 'website:91');
  assert.deepEqual(calls, [{
    from: '2026-08-01',
    to: '2026-08-03',
    page: 2,
    pageSize: 10
  }]);
});

test('website record adapter binds records to the configured project and the contract masks PII', async () => {
  const calls = [];
  const adapter = new WebsiteFormRecordAdapter({
    configuredProjectId: '7',
    sourceClient: {
      async readContactRecords(value) {
        calls.push(['list', value]);
        return [upstreamRecord];
      },
      async readContactRecord(value) {
        calls.push(['detail', value]);
        return upstreamRecord;
      }
    }
  });
  const [rawSummary] = await adapter.listRecords({
    projectId: '7',
    query: { from: '2026-08-01', to: '2026-08-03' },
    limit: 10001
  });
  const summary = normalizeSummary(rawSummary, '7');
  assert.equal(summary.id, 'website:91');
  assert.equal(summary.maskedContact.displayName, '测**');
  assert.equal(summary.maskedContact.phone, '138****5678');
  assert.equal(summary.maskedContact.email, 'p***@example.com');
  assert.doesNotMatch(JSON.stringify(summary), /13812345678|person@example\.com/u);

  const rawDetail = await adapter.getRecord({
    projectId: '7',
    recordId: 'website:91'
  });
  const detail = normalizeDetail(rawDetail, adapter.allowedExternalOrigins, '7');
  assert.equal(detail.form.fields.length, 3);
  assert.match(detail.form.content, /138\*{4}5678/u);
  assert.doesNotMatch(JSON.stringify(detail), /13812345678|person@example\.com/u);
  assert.deepEqual(calls, [
    ['list', { from: '2026-08-01', to: '2026-08-03', maxRecords: 10001 }],
    ['detail', '91']
  ]);
});

test('website record adapter rejects a project mismatch before calling upstream', async () => {
  let called = false;
  const adapter = new WebsiteFormRecordAdapter({
    configuredProjectId: '7',
    sourceClient: {
      async readContactRecords() { called = true; return []; },
      async readContactRecord() { called = true; return null; }
    }
  });
  await assert.rejects(
    adapter.listRecords({
      projectId: '8',
      query: { from: '2026-08-01', to: '2026-08-03' },
      limit: 10001
    }),
    (error) => error.code === 'WEBSITE_FORM_PROJECT_MISMATCH'
      && error.status === 404
  );
  assert.equal(called, false);
});
