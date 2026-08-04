const assert = require('node:assert/strict');
const test = require('node:test');

const {
  WebsiteFormConsultationService
} = require('../../modules/websiteFormConsultations/services/WebsiteFormConsultationService');

test('publishes a website-form-only contract with canonical source keys', async () => {
  const saved = [];
  const service = new WebsiteFormConsultationService({
    sourceClient: {
      async readFormConsultations() {
        return {
          attributedFormSubmissionSessions: '4',
          sourceBreakdown: [
            { upstreamSource: 'direct', attributedFormSubmissionSessions: '2' },
            { upstreamSource: 'organic_search', attributedFormSubmissionSessions: '1' },
            { upstreamSource: 'future_source', attributedFormSubmissionSessions: '1' }
          ]
        };
      }
    },
    snapshotRepository: {
      async read() { return null; },
      async save(snapshot) { saved.push(snapshot); }
    },
    configuredProjectId: '11',
    cacheTtlMs: 600000,
    clock: () => Date.parse('2026-08-03T12:00:00.000Z')
  });

  const result = await service.read({
    projectId: '11',
    from: '2026-08-01',
    to: '2026-08-03'
  });

  assert.deepEqual(result, {
    projectId: '11',
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    dataCoverage: 'ATTRIBUTED_SESSION_SUBMISSIONS_ONLY',
    formRecordTotalAvailable: false,
    coverage: {
      from: '2026-08-01',
      to: '2026-08-03',
      timeZone: 'Asia/Shanghai'
    },
    dataState: 'DATA',
    summary: {
      attributedFormSubmissionSessions: '4'
    },
    capabilities: {
      dailyBreakdown: true,
      formRecordTotal: false,
      unattributedFormRecords: false,
      attributionRate: false
    },
    attributionCoverage: {
      state: 'FORM_RECORD_TOTAL_UNAVAILABLE',
      attributedFormSubmissionSessions: '4',
      formRecordTotal: null,
      unattributedFormRecords: null,
      attributionRatePercent: null
    },
    sourceBreakdown: [
      {
        sourceKey: 'DIRECT',
        upstreamSources: ['direct'],
        attributedFormSubmissionSessions: '2'
      },
      {
        sourceKey: 'UNKNOWN',
        upstreamSources: ['organic_search', 'future_source'],
        attributedFormSubmissionSessions: '2'
      }
    ],
    cache: {
      state: 'REFRESHED',
      refreshedAt: '2026-08-03T12:00:00.000Z',
      expiresAt: '2026-08-03T12:10:00.000Z'
    }
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].schemaVersion, 'website_form_consultations_v2');
  assert.equal(JSON.stringify(result).includes('53KF'), false);
  assert.equal(JSON.stringify(result).includes('contact'), false);
});

test('publishes a cached daily website-form contract without claiming total form coverage', async () => {
  const saved = [];
  const service = new WebsiteFormConsultationService({
    sourceClient: {
      async readFormConsultations() {
        assert.fail('daily interface must use the bounded daily source method');
      },
      async readFormConsultationDays() {
        return {
          attributedFormSubmissionSessions: '3',
          sourceBreakdown: [
            { upstreamSource: 'direct', attributedFormSubmissionSessions: '2' },
            { upstreamSource: 'organic_search', attributedFormSubmissionSessions: '1' }
          ],
          days: [
            {
              date: '2026-08-01',
              attributedFormSubmissionSessions: '2',
              sourceBreakdown: [
                { upstreamSource: 'direct', attributedFormSubmissionSessions: '2' }
              ]
            },
            {
              date: '2026-08-02',
              attributedFormSubmissionSessions: '1',
              sourceBreakdown: [
                { upstreamSource: 'organic_search', attributedFormSubmissionSessions: '1' }
              ]
            }
          ]
        };
      }
    },
    snapshotRepository: {
      async read() { return null; },
      async save(snapshot) { saved.push(snapshot); }
    },
    configuredProjectId: '11',
    cacheTtlMs: 600000,
    clock: () => Date.parse('2026-08-03T12:00:00.000Z')
  });

  const result = await service.readDaily({
    projectId: '11',
    from: '2026-08-01',
    to: '2026-08-02'
  });

  assert.equal(result.formRecordTotalAvailable, false);
  assert.deepEqual(result.capabilities, {
    dailyBreakdown: true,
    formRecordTotal: false,
    unattributedFormRecords: false,
    attributionRate: false
  });
  assert.deepEqual(result.attributionCoverage, {
    state: 'FORM_RECORD_TOTAL_UNAVAILABLE',
    attributedFormSubmissionSessions: '3',
    formRecordTotal: null,
    unattributedFormRecords: null,
    attributionRatePercent: null
  });
  assert.deepEqual(result.days.map((day) => [
    day.date,
    day.attributedFormSubmissionSessions,
    day.sourceBreakdown[0].sourceKey
  ]), [
    ['2026-08-01', '2', 'DIRECT'],
    ['2026-08-02', '1', 'UNKNOWN']
  ]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].payload.days.length, 2);
});

test('returns a fresh persisted website-form snapshot without calling the website', async () => {
  const service = new WebsiteFormConsultationService({
    sourceClient: {
      async readFormConsultations() {
        assert.fail('fresh cache must avoid an upstream website request');
      }
    },
    snapshotRepository: {
      async read() {
        return {
          projectId: '11',
          coverage: {
            from: '2026-08-01',
            to: '2026-08-03',
            timeZone: 'Asia/Shanghai'
          },
          payload: {
            attributedFormSubmissionSessions: '2',
            sourceBreakdown: [
              {
                sourceKey: 'DIRECT',
                upstreamSources: ['direct'],
                attributedFormSubmissionSessions: '2'
              }
            ]
          },
          refreshedAt: '2026-08-03T11:59:00.000Z',
          expiresAt: '2026-08-03T12:09:00.000Z'
        };
      },
      async save() {
        assert.fail('fresh cache must not be rewritten');
      }
    },
    configuredProjectId: '11',
    cacheTtlMs: 600000,
    clock: () => Date.parse('2026-08-03T12:00:00.000Z')
  });

  const result = await service.read({
    projectId: '11',
    from: '2026-08-01',
    to: '2026-08-03'
  });

  assert.equal(result.summary.attributedFormSubmissionSessions, '2');
  assert.equal(result.cache.state, 'HIT');
  assert.equal(result.cache.refreshedAt, '2026-08-03T11:59:00.000Z');
});

test('falls back to the last matching website-form snapshot after an upstream failure', async () => {
  const service = new WebsiteFormConsultationService({
    sourceClient: {
      async readFormConsultations() {
        const error = new Error('upstream unavailable');
        error.code = 'GATO_WEBSITE_FORM_UPSTREAM_UNAVAILABLE';
        throw error;
      }
    },
    snapshotRepository: {
      async read() {
        return {
          projectId: '11',
          coverage: {
            from: '2026-08-01',
            to: '2026-08-03',
            timeZone: 'Asia/Shanghai'
          },
          payload: {
            attributedFormSubmissionSessions: '1',
            sourceBreakdown: [
              {
                sourceKey: 'UNKNOWN',
                upstreamSources: ['organic_search'],
                attributedFormSubmissionSessions: '1'
              }
            ]
          },
          refreshedAt: '2026-08-03T11:40:00.000Z',
          expiresAt: '2026-08-03T11:50:00.000Z'
        };
      },
      async save() {
        assert.fail('a failed refresh must not replace the last success');
      }
    },
    configuredProjectId: '11',
    cacheTtlMs: 600000,
    clock: () => Date.parse('2026-08-03T12:00:00.000Z')
  });

  const result = await service.read({
    projectId: '11',
    from: '2026-08-01',
    to: '2026-08-03'
  });

  assert.equal(result.summary.attributedFormSubmissionSessions, '1');
  assert.equal(result.cache.state, 'FALLBACK');
  assert.equal(result.cache.refreshedAt, '2026-08-03T11:40:00.000Z');
});

test('does not serve a website-form fallback older than the configured maximum', async () => {
  const upstreamError = Object.assign(new Error('upstream unavailable'), {
    code: 'GATO_WEBSITE_FORM_UPSTREAM_UNAVAILABLE'
  });
  const service = new WebsiteFormConsultationService({
    sourceClient: {
      async readFormConsultations() { throw upstreamError; }
    },
    snapshotRepository: {
      async read() {
        return {
          projectId: '11',
          coverage: {
            from: '2026-08-01',
            to: '2026-08-03',
            timeZone: 'Asia/Shanghai'
          },
          payload: {
            attributedFormSubmissionSessions: '1',
            sourceBreakdown: [{
              sourceKey: 'DIRECT',
              upstreamSources: ['direct'],
              attributedFormSubmissionSessions: '1'
            }]
          },
          refreshedAt: '2026-08-02T11:59:59.000Z',
          expiresAt: '2026-08-02T12:09:59.000Z'
        };
      },
      async save() { assert.fail('a failed refresh must not save'); }
    },
    configuredProjectId: '11',
    cacheTtlMs: 600000,
    maxStaleMs: 86400000,
    clock: () => Date.parse('2026-08-03T12:00:00.000Z')
  });

  await assert.rejects(
    service.read({
      projectId: '11',
      from: '2026-08-01',
      to: '2026-08-03'
    }),
    (error) => error === upstreamError
  );
});
