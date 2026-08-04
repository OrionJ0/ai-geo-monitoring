const assert = require('node:assert/strict');
const test = require('node:test');

const {
  WebsiteFormConsultationService
} = require('../../modules/websiteFormConsultations/services/WebsiteFormConsultationService');

function record(overrides = {}) {
  return {
    id: '1',
    createdAt: '2026-08-01T01:00:00.000Z',
    sourceChannel: 'direct',
    firstSourceChannel: 'direct',
    referrer: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    bdVid: null,
    sdclkid: null,
    name: '不应进入快照',
    phone: '13800000000',
    detail: '不应进入快照的咨询内容',
    ...overrides
  };
}

function serviceWith({
  records,
  snapshot = null,
  clock = () => Date.parse('2026-08-03T12:00:00.000Z'),
  readError = null
}) {
  const calls = [];
  const saved = [];
  const service = new WebsiteFormConsultationService({
    sourceClient: {
      async readContactRecords(value) {
        calls.push(value);
        if (readError) throw readError;
        return records;
      }
    },
    snapshotRepository: {
      async read(value) {
        calls.push({ cacheRead: value });
        return snapshot;
      },
      async save(value) { saved.push(value); }
    },
    configuredProjectId: '11',
    cacheTtlMs: 600000,
    clock
  });
  return { calls, saved, service };
}

test('aggregates every form record into the canonical nine-key contract', async () => {
  const records = [
    record(),
    record({
      id: '2',
      referrer: 'https://cn.bing.com/search?q=industrial+tablet',
      sourceChannel: 'organic_search',
      firstSourceChannel: 'organic_search'
    }),
    record({
      id: '3',
      createdAt: '2026-08-02T02:00:00.000Z',
      sourceChannel: 'campaign',
      firstSourceChannel: 'campaign',
      utmSource: 'newsletter',
      utmCampaign: 'summer'
    }),
    record({
      id: '4',
      createdAt: '2026-08-02T03:00:00.000Z',
      sourceChannel: null,
      firstSourceChannel: null
    }),
    record({
      id: '5',
      createdAt: '2026-08-03T04:00:00.000Z',
      sourceChannel: 'referral',
      firstSourceChannel: 'referral',
      referrer: 'https://partner.example.com/article'
    })
  ];
  const { calls, saved, service } = serviceWith({ records });

  const result = await service.read({
    projectId: '11',
    from: '2026-08-01',
    to: '2026-08-03'
  });

  assert.deepEqual(result, {
    projectId: '11',
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    dataCoverage: 'ALL_FORM_RECORDS',
    coverage: {
      from: '2026-08-01',
      to: '2026-08-03',
      timeZone: 'Asia/Shanghai'
    },
    dataState: 'DATA',
    summary: { formConsultationRecords: '5' },
    sourceBreakdown: [
      { sourceKey: 'DIRECT', formConsultationRecords: '1' },
      { sourceKey: 'BING_SEARCH', formConsultationRecords: '1' },
      { sourceKey: 'EXTERNAL_REFERRAL', formConsultationRecords: '1' },
      { sourceKey: 'UTM_CAMPAIGN', formConsultationRecords: '1' },
      { sourceKey: 'UNKNOWN', formConsultationRecords: '1' }
    ],
    cache: {
      state: 'REFRESHED',
      refreshedAt: '2026-08-03T12:00:00.000Z',
      expiresAt: '2026-08-03T12:10:00.000Z'
    }
  });
  assert.deepEqual(calls[1], {
    from: '2026-08-01',
    to: '2026-08-03',
    maxRecords: 10000
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].schemaVersion, 'website_form_consultations_v3');
  assert.doesNotMatch(
    JSON.stringify(saved[0].payload),
    /不应进入快照|13800000000|industrial\+tablet/u
  );
});

test('builds the daily contract from one bounded contact-list read in Shanghai time', async () => {
  const { calls, saved, service } = serviceWith({
    records: [
      record({
        id: '1',
        createdAt: '2026-07-31T16:30:00.000Z'
      }),
      record({
        id: '2',
        createdAt: '2026-08-01T16:30:00.000Z',
        referrer: 'https://www.baidu.com/s?wd=test',
        sourceChannel: 'organic_search',
        firstSourceChannel: 'organic_search'
      })
    ]
  });

  const result = await service.readDaily({
    projectId: '11',
    from: '2026-08-01',
    to: '2026-08-03'
  });

  assert.equal(result.summary.formConsultationRecords, '2');
  assert.deepEqual(result.days, [
    {
      date: '2026-08-01',
      formConsultationRecords: '1',
      sourceBreakdown: [
        { sourceKey: 'DIRECT', formConsultationRecords: '1' }
      ]
    },
    {
      date: '2026-08-02',
      formConsultationRecords: '1',
      sourceBreakdown: [
        { sourceKey: 'BAIDU_SEARCH', formConsultationRecords: '1' }
      ]
    },
    {
      date: '2026-08-03',
      formConsultationRecords: '0',
      sourceBreakdown: []
    }
  ]);
  assert.deepEqual(calls[1], {
    from: '2026-08-01',
    to: '2026-08-03',
    maxRecords: 10000
  });
  assert.equal(saved[0].payload.days.length, 3);
});

test('returns a fresh v3 snapshot without calling the contact list', async () => {
  const { calls, service } = serviceWith({
    records: [],
    snapshot: {
      projectId: '11',
      coverage: {
        from: '2026-08-01',
        to: '2026-08-03',
        timeZone: 'Asia/Shanghai'
      },
      payload: {
        formConsultationRecords: '2',
        sourceBreakdown: [
          { sourceKey: 'DIRECT', formConsultationRecords: '2' }
        ]
      },
      refreshedAt: '2026-08-03T11:59:00.000Z',
      expiresAt: '2026-08-03T12:09:00.000Z'
    }
  });

  const result = await service.read({
    projectId: '11',
    from: '2026-08-01',
    to: '2026-08-03'
  });

  assert.equal(result.summary.formConsultationRecords, '2');
  assert.equal(result.cache.state, 'HIT');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cacheRead.schemaVersion, 'website_form_consultations_v3');
});

test('falls back only to a recent matching v3 snapshot after an upstream failure', async () => {
  const upstreamError = Object.assign(new Error('upstream unavailable'), {
    code: 'GATO_WEBSITE_CONTACT_UPSTREAM_FAILED'
  });
  const snapshot = {
    projectId: '11',
    coverage: {
      from: '2026-08-01',
      to: '2026-08-03',
      timeZone: 'Asia/Shanghai'
    },
    payload: {
      formConsultationRecords: '1',
      sourceBreakdown: [
        { sourceKey: 'UNKNOWN', formConsultationRecords: '1' }
      ]
    },
    refreshedAt: '2026-08-03T11:40:00.000Z',
    expiresAt: '2026-08-03T11:50:00.000Z'
  };
  const { service } = serviceWith({
    records: [],
    snapshot,
    readError: upstreamError
  });

  const result = await service.read({
    projectId: '11',
    from: '2026-08-01',
    to: '2026-08-03'
  });
  assert.equal(result.summary.formConsultationRecords, '1');
  assert.equal(result.cache.state, 'FALLBACK');

  const stale = serviceWith({
    records: [],
    snapshot: {
      ...snapshot,
      refreshedAt: '2026-08-02T11:59:59.000Z',
      expiresAt: '2026-08-02T12:09:59.000Z'
    },
    readError: upstreamError
  }).service;
  await assert.rejects(
    stale.read({
      projectId: '11',
      from: '2026-08-01',
      to: '2026-08-03'
    }),
    (error) => error === upstreamError
  );
});

test('rejects duplicate, out-of-range or over-budget contact records', async () => {
  for (const records of [
    [record(), record()],
    [record({ createdAt: '2026-07-31T15:59:59.000Z' })],
    Array.from({ length: 10001 }, (_, index) => record({
      id: String(index + 1)
    }))
  ]) {
    const { service } = serviceWith({ records });
    await assert.rejects(
      service.read({
        projectId: '11',
        from: '2026-08-01',
        to: '2026-08-03'
      }),
      { code: 'WEBSITE_FORM_CONTACT_RECORDS_INVALID' }
    );
  }
});
