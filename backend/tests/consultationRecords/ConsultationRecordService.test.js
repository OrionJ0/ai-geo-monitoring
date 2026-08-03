const assert = require('node:assert/strict');
const test = require('node:test');

const { WebsiteFormRecordAdapter } = require('../../modules/consultationRecords/adapters/WebsiteFormRecordAdapter');
const { Kf53ConversationAdapter } = require('../../modules/consultationRecords/adapters/Kf53ConversationAdapter');
const {
  normalizeListQuery
} = require('../../modules/consultationRecords/contracts/consultationRecordContract');
const {
  ConsultationRecordService
} = require('../../modules/consultationRecords/services/ConsultationRecordService');

function summary(overrides = {}) {
  return {
    projectId: '7',
    id: 'website:record_redacted_001',
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    occurredAt: '2026-08-03T03:08:00.000Z',
    source: { key: 'ORGANIC_SEARCH', label: '搜索引擎' },
    landingPage: { label: '振动光纤', path: '/solutions/fiber' },
    contentSummary: '准备建设周界防护项目，希望了解方案范围。',
    maskedContact: {
      displayName: '李**',
      phone: '138****5621',
      email: null
    },
    device: 'PC',
    detailAvailable: true,
    ...overrides
  };
}

test('returns an honest empty list when only aggregate and unverified sources exist', async () => {
  const service = new ConsultationRecordService({
    adapters: [new WebsiteFormRecordAdapter(), new Kf53ConversationAdapter()],
    auditRepository: { async recordView() {} }
  });
  const result = await service.list({
    projectId: '7',
    query: normalizeListQuery({ from: '2026-07-05', to: '2026-08-03' })
  });
  assert.equal(result.coverageState, 'NONE');
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.pagination, {
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 0
  });
  assert.deepEqual(
    result.sources.map((source) => [source.sourceSystem, source.sourceState]),
    [
      ['GATO_WEBSITE', 'AGGREGATE_ONLY'],
      ['KF53', 'NOT_CONNECTED']
    ]
  );
});

test('returns project-level NOT_CONNECTED without calling an upstream configured for another project', async () => {
  let upstreamCalls = 0;
  const service = new ConsultationRecordService({
    adapters: [new WebsiteFormRecordAdapter({
      configuredProjectId: '7',
      sourceClient: {
        async readContactRecords() { upstreamCalls += 1; return []; },
        async readContactRecord() { upstreamCalls += 1; return null; }
      }
    }), new Kf53ConversationAdapter()],
    auditRepository: { async recordView() {} }
  });
  const result = await service.list({
    projectId: '8',
    query: normalizeListQuery({ from: '2026-08-01', to: '2026-08-03' })
  });
  assert.equal(result.coverageState, 'NONE');
  assert.equal(result.sources[0].sourceState, 'NOT_CONNECTED');
  assert.equal(result.sources[0].reasonCode, 'WEBSITE_FORM_PROJECT_NOT_CONFIGURED');
  assert.equal(upstreamCalls, 0);
});

test('uses one bounded upstream page for the default single-source list', async () => {
  let fullScans = 0;
  const pageCalls = [];
  const websiteAdapter = {
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    allowedExternalOrigins: [],
    async getStatus({ projectId }) {
      assert.equal(projectId, '7');
      return {
        sourceSystem: 'GATO_WEBSITE',
        consultationType: 'WEBSITE_FORM',
        sourceState: 'AVAILABLE',
        recordCoverage: 'FULL',
        reasonCode: null
      };
    },
    owns: (recordId) => recordId.startsWith('website:'),
    async listRecords() { fullScans += 1; return []; },
    async listRecordPage(value) {
      pageCalls.push(value);
      return { totalItems: 11, items: [summary()] };
    },
    async getRecord() { return null; }
  };
  const service = new ConsultationRecordService({
    adapters: [websiteAdapter, new Kf53ConversationAdapter()],
    auditRepository: { async recordView() {} }
  });
  const result = await service.list({
    projectId: '7',
    query: normalizeListQuery({
      from: '2026-08-01',
      to: '2026-08-03',
      page: '2',
      pageSize: '10'
    })
  });
  assert.equal(fullScans, 0);
  assert.equal(pageCalls.length, 1);
  assert.equal(pageCalls[0].page, 2);
  assert.equal(result.pagination.totalItems, 11);
  assert.equal(result.items.length, 1);
});

test('rejects a short non-final direct page instead of silently dropping records', async () => {
  const websiteAdapter = {
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    allowedExternalOrigins: [],
    async getStatus() {
      return {
        sourceSystem: 'GATO_WEBSITE',
        consultationType: 'WEBSITE_FORM',
        sourceState: 'AVAILABLE',
        recordCoverage: 'FULL',
        reasonCode: null
      };
    },
    owns: () => true,
    async listRecords() { return []; },
    async listRecordPage() {
      return { totalItems: 11, items: [summary()] };
    },
    async getRecord() { return null; }
  };
  const service = new ConsultationRecordService({
    adapters: [websiteAdapter, new Kf53ConversationAdapter()],
    auditRepository: { async recordView() {} }
  });
  await assert.rejects(
    service.list({
      projectId: '7',
      query: normalizeListQuery({
        from: '2026-08-01',
        to: '2026-08-03',
        page: '1',
        pageSize: '10'
      })
    }),
    { code: 'CONSULTATION_ALL_SOURCES_FAILED', status: 502 }
  );
});

test('rejects an unsorted direct page so pagination remains deterministic', async () => {
  const websiteAdapter = {
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    allowedExternalOrigins: [],
    async getStatus() {
      return {
        sourceSystem: 'GATO_WEBSITE',
        consultationType: 'WEBSITE_FORM',
        sourceState: 'AVAILABLE',
        recordCoverage: 'FULL',
        reasonCode: null
      };
    },
    owns: () => true,
    async listRecords() { return []; },
    async listRecordPage() {
      return {
        totalItems: 2,
        items: [
          summary({ id: 'website:older', occurredAt: '2026-08-01T00:00:00.000Z' }),
          summary({ id: 'website:newer', occurredAt: '2026-08-03T00:00:00.000Z' })
        ]
      };
    },
    async getRecord() { return null; }
  };
  const service = new ConsultationRecordService({
    adapters: [websiteAdapter, new Kf53ConversationAdapter()],
    auditRepository: { async recordView() {} }
  });
  await assert.rejects(
    service.list({
      projectId: '7',
      query: normalizeListQuery({ from: '2026-08-01', to: '2026-08-03' })
    }),
    { code: 'CONSULTATION_ALL_SOURCES_FAILED', status: 502 }
  );
});

test('filters, sorts and paginates only validated redacted summaries', async () => {
  let requestedLimit = null;
  const websiteAdapter = {
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    allowedExternalOrigins: ['https://gato.com.cn'],
    async getStatus() {
      return {
        sourceSystem: 'GATO_WEBSITE',
        consultationType: 'WEBSITE_FORM',
        sourceState: 'AVAILABLE',
        recordCoverage: 'FULL',
        reasonCode: null
      };
    },
    owns: (recordId) => recordId.startsWith('website:'),
    async listRecords({ limit }) {
      requestedLimit = limit;
      return [
        summary(),
        summary({
          id: 'website:record_redacted_002',
          occurredAt: '2026-08-02T03:08:00.000Z',
          source: { key: 'DIRECT', label: '直接访问' },
          contentSummary: '希望了解电子围栏。'
        })
      ];
    },
    async getRecord() { return null; }
  };
  const service = new ConsultationRecordService({
    adapters: [websiteAdapter, new Kf53ConversationAdapter()],
    auditRepository: { async recordView() {} }
  });
  const result = await service.list({
    projectId: '7',
    query: normalizeListQuery({
      from: '2026-08-01',
      to: '2026-08-03',
      source: 'ORGANIC_SEARCH',
      q: '周界',
      pageSize: '1'
    })
  });
  assert.equal(result.coverageState, 'PARTIAL');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'website:record_redacted_001');
  assert.equal(result.pagination.totalItems, 1);
  assert.equal(requestedLimit, 2001);
});

test('isolates one failed consultation source and returns the other source honestly', async () => {
  const websiteAdapter = {
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    allowedExternalOrigins: [],
    async getStatus() {
      return {
        sourceSystem: 'GATO_WEBSITE',
        consultationType: 'WEBSITE_FORM',
        sourceState: 'AVAILABLE',
        recordCoverage: 'FULL',
        reasonCode: null
      };
    },
    owns: (recordId) => recordId.startsWith('website:'),
    async listRecords() { throw new Error('private upstream detail'); },
    async getRecord() { return null; }
  };
  const kf53Adapter = {
    sourceSystem: 'KF53',
    consultationType: 'ONLINE_CHAT',
    allowedExternalOrigins: [],
    async getStatus() {
      return {
        sourceSystem: 'KF53',
        consultationType: 'ONLINE_CHAT',
        sourceState: 'AVAILABLE',
        recordCoverage: 'FULL',
        reasonCode: null
      };
    },
    owns: (recordId) => recordId.startsWith('kf53:'),
    async listRecords() {
      return [summary({
        id: 'kf53:conversation_redacted_001',
        sourceSystem: 'KF53',
        consultationType: 'ONLINE_CHAT'
      })];
    },
    async getRecord() { return null; }
  };
  const service = new ConsultationRecordService({
    adapters: [websiteAdapter, kf53Adapter],
    auditRepository: { async recordView() {} }
  });

  const result = await service.list({
    projectId: '7',
    query: normalizeListQuery({ from: '2026-08-01', to: '2026-08-03' })
  });

  assert.equal(result.coverageState, 'PARTIAL');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sourceSystem, 'KF53');
  assert.deepEqual(result.sources[0], {
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    sourceState: 'ERROR',
    recordCoverage: 'NONE',
    reasonCode: 'CONSULTATION_SOURCE_READ_FAILED'
  });
});

test('writes a minimal audit record before returning full detail', async () => {
  const auditCalls = [];
  const adapter = {
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    allowedExternalOrigins: ['https://gato.com.cn'],
    async getStatus() {
      return {
        sourceSystem: 'GATO_WEBSITE',
        consultationType: 'WEBSITE_FORM',
        sourceState: 'AVAILABLE',
        recordCoverage: 'FULL',
        reasonCode: null
      };
    },
    owns: (recordId) => recordId.startsWith('website:'),
    async listRecords() { return []; },
    async getRecord() {
      return {
        ...summary(),
        externalRecordUrl: 'https://gato.com.cn/admin/contact/redacted',
        form: {
          content: '希望了解周界防护方案和交付周期。',
          fields: [{ label: '需求类型', value: '周界防护' }]
        }
      };
    }
  };
  const service = new ConsultationRecordService({
    adapters: [adapter, new Kf53ConversationAdapter()],
    auditRepository: {
      async recordView(value) { auditCalls.push(value); }
    }
  });
  const result = await service.detail({
    projectId: '7',
    userId: '9',
    recordId: 'website:record_redacted_001'
  });
  assert.equal(result.detail.form.fields.length, 1);
  assert.deepEqual(auditCalls, [{
    userId: '9',
    projectId: '7',
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    recordId: 'website:record_redacted_001'
  }]);
});

test('fails closed when detail audit cannot be persisted', async () => {
  const available = {
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    allowedExternalOrigins: [],
    async getStatus() {
      return {
        sourceSystem: 'GATO_WEBSITE',
        consultationType: 'WEBSITE_FORM',
        sourceState: 'AVAILABLE',
        recordCoverage: 'FULL',
        reasonCode: null
      };
    },
    owns: () => true,
    async listRecords() { return []; },
    async getRecord() {
      return {
        ...summary(),
        externalRecordUrl: null,
        form: { content: '脱敏正文', fields: [] }
      };
    }
  };
  const service = new ConsultationRecordService({
    adapters: [available, new Kf53ConversationAdapter()],
    auditRepository: { async recordView() { throw new Error('db detail'); } }
  });
  await assert.rejects(
    service.detail({
      projectId: '7',
      userId: '9',
      recordId: 'website:record_redacted_001'
    }),
    (error) => error.code === 'CONSULTATION_DETAIL_AUDIT_UNAVAILABLE'
      && error.status === 503
      && !error.message.includes('db detail')
  );
});

test('rejects an adapter record bound to another project before returning or auditing it', async () => {
  const auditCalls = [];
  const adapter = {
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    allowedExternalOrigins: [],
    async getStatus() {
      return {
        sourceSystem: 'GATO_WEBSITE',
        consultationType: 'WEBSITE_FORM',
        sourceState: 'AVAILABLE',
        recordCoverage: 'FULL',
        reasonCode: null
      };
    },
    owns: () => true,
    async listRecords() { return [summary({ projectId: '8' })]; },
    async getRecord() {
      return {
        ...summary({ projectId: '8' }),
        externalRecordUrl: null,
        form: { content: '脱敏正文', fields: [] }
      };
    }
  };
  const service = new ConsultationRecordService({
    adapters: [adapter, new Kf53ConversationAdapter()],
    auditRepository: {
      async recordView(value) { auditCalls.push(value); }
    }
  });
  const query = normalizeListQuery({ from: '2026-08-01', to: '2026-08-03' });
  await assert.rejects(
    service.list({ projectId: '7', query }),
    (error) => error.code === 'CONSULTATION_ALL_SOURCES_FAILED'
      && !error.message.includes('8')
  );
  await assert.rejects(
    service.detail({
      projectId: '7',
      userId: '9',
      recordId: 'website:record_redacted_001'
    }),
    /项目归属无效/u
  );
  assert.deepEqual(auditCalls, []);
});
