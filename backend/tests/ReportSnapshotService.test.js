const test = require('node:test');
const assert = require('node:assert/strict');
const ReportSnapshotService = require('../services/ReportSnapshotService');

test('finds the latest report snapshot without creating a new one', async () => {
  const repository = {
    createCalls: 0,
    findOneQuery: null,
    async create() {
      this.createCalls += 1;
      throw new Error('latest lookup must not create a report');
    },
    async findOne(query) {
      this.findOneQuery = query;
      return { id: 9, project_id: 2, summary: { total_checks: 3 } };
    }
  };

  const report = await ReportSnapshotService.findLatest({
    project: { id: 2 },
    repositories: { ReportSnapshot: repository }
  });

  assert.equal(report.id, 9);
  assert.equal(repository.createCalls, 0);
  assert.deepEqual(repository.findOneQuery.where, { project_id: 2, status: 'generated' });
  assert.deepEqual(repository.findOneQuery.order, [['created_at', 'DESC'], ['id', 'DESC']]);
});

test('finds the latest report snapshot for a selected period window', async () => {
  const repository = {
    findAllQuery: null,
    async findAll(query) {
      this.findAllQuery = query;
      return [
        { id: 9, project_id: 2, summary: { period_days: 30 } },
        { id: 8, project_id: 2, summary: { period_days: 7 } }
      ];
    }
  };

  const report = await ReportSnapshotService.findLatest({
    project: { id: 2 },
    days: 7,
    repositories: { ReportSnapshot: repository }
  });

  assert.equal(report.id, 8);
  assert.deepEqual(repository.findAllQuery.where, { project_id: 2, status: 'generated' });
  assert.deepEqual(repository.findAllQuery.order, [['created_at', 'DESC'], ['id', 'DESC']]);
});

test('continues scanning report snapshots when the selected period is beyond the first page', async () => {
  const queries = [];
  const repository = {
    async findAll(query) {
      queries.push(query);
      if (query.offset === 0) {
        return Array.from({ length: 50 }, (_, index) => ({
          id: 100 - index,
          project_id: 2,
          summary: { period_days: 30 }
        }));
      }
      return [
        { id: 49, project_id: 2, summary: { period_days: 7 } }
      ];
    }
  };

  const report = await ReportSnapshotService.findLatest({
    project: { id: 2 },
    days: 7,
    repositories: { ReportSnapshot: repository }
  });

  assert.equal(report.id, 49);
  assert.equal(queries.length, 2);
  assert.equal(queries[0].offset, 0);
  assert.equal(queries[1].offset, 50);
});

test('treats legacy report snapshots without period length as 30 day reports', async () => {
  const repository = {
    async findAll() {
      return [
        { id: 10, project_id: 2, summary: {} },
        { id: 9, project_id: 2, summary: { period_days: 7 } }
      ];
    }
  };

  const report = await ReportSnapshotService.findLatest({
    project: { id: 2 },
    days: 30,
    repositories: { ReportSnapshot: repository }
  });

  assert.equal(report.id, 10);
});

test('attributes admin generated report snapshots to the project owner', () => {
  const owner = ReportSnapshotService.resolveSnapshotUser(
    { id: 2, user_id: 9 },
    { id: 1, role: 'admin', username: 'admin' }
  );
  const regularUser = ReportSnapshotService.resolveSnapshotUser(
    { id: 2, user_id: 9 },
    { id: 9, role: 'user', username: 'owner' }
  );

  assert.equal(owner.id, 9);
  assert.equal(owner.actor_user_id, 1);
  assert.equal(regularUser.id, 9);
  assert.equal(regularUser.actor_user_id, undefined);
});

test('stores the selected period length in generated report summaries', async () => {
  const payload = await ReportSnapshotService.buildSnapshotPayload({
    project: { id: 2, user_id: 9, toJSON: () => ({ id: 2, user_id: 9 }) },
    user: { id: 9, role: 'user' },
    days: 7,
    now: new Date('2026-05-15T00:00:00.000Z'),
    repositories: {
      VisibilityMetric: { findAll: async () => [] },
      QuestionRecord: { findAll: async () => [] },
      TrackedPrompt: { findAll: async () => [] },
      BrandCompetitor: { findAll: async () => [] }
    }
  });

  assert.equal(payload.summary.period_days, 7);
});

test('stores top citation urls in generated report summaries', async () => {
  const metric = {
    toJSON: () => ({
      id: 1,
      project_id: 2,
      platform: 'deepseek',
      prompt_id: 7,
      prompt_category: '购买决策',
      metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
      answer_competitor_share: 100,
      sov_numerator: 1,
      sov_denominator: 1,
      competition_entities: [],
      citation_sources: [{ url: 'https://example.com/guide?utm_source=ai' }],
      analysis_structure: {
        citations: { semantics_version: 'explicit-citation-v2' }
      },
      created_at: '2026-05-14T00:00:00.000Z'
    })
  };
  const payload = await ReportSnapshotService.buildSnapshotPayload({
    project: { id: 2, user_id: 9, toJSON: () => ({ id: 2, user_id: 9 }) },
    user: { id: 9, role: 'user' },
    days: 7,
    now: new Date('2026-05-15T00:00:00.000Z'),
    repositories: {
      VisibilityMetric: { findAll: async () => [metric] },
      QuestionRecord: { findAll: async () => [] },
      TrackedPrompt: { findAll: async () => [] },
      BrandCompetitor: { findAll: async () => [] }
    }
  });

  assert.deepEqual(payload.summary.source_urls, [
    {
      url: 'https://example.com/guide',
      domain: 'example.com',
      source_type: '其他第三方来源',
      citation_count: 1,
      response_count: 1,
      platforms: ['deepseek'],
      categories: ['购买决策']
    }
  ]);
});

test('新版报告快照按当前指标版本查询全部实际历史平台', async () => {
  const visibilityQueries = [];
  const recordQueries = [];
  await ReportSnapshotService.buildSnapshotPayload({
    project: { id: 2, user_id: 9, platforms: ['deepseek'], toJSON: () => ({ id: 2, user_id: 9, platforms: ['deepseek'] }) },
    user: { id: 9, role: 'user' },
    days: 7,
    now: new Date('2026-05-15T00:00:00.000Z'),
    repositories: {
      VisibilityMetric: {
        findAll: async (query) => {
          visibilityQueries.push(query);
          return [];
        }
      },
      QuestionRecord: {
        findAll: async (query) => {
          recordQueries.push(query);
          return [];
        }
      },
      TrackedPrompt: { findAll: async () => [] },
      BrandCompetitor: { findAll: async () => [] }
    }
  });

  assert.equal(visibilityQueries.length, 2);
  assert.equal(visibilityQueries[0].where.platform, undefined);
  assert.equal(visibilityQueries[1].where.platform, undefined);
  assert.equal(visibilityQueries[0].where.metric_semantics_version, 'contextual_competitor_mentions_sov_v2_scoped');
  assert.equal(visibilityQueries[1].where.metric_semantics_version, 'contextual_competitor_mentions_sov_v2_scoped');
  assert.equal(recordQueries.length, 1);
  recordQueries.forEach((query) => {
    assert.equal(query.where.platform, undefined);
    assert.equal(query.where.metric_semantics_version, 'contextual_competitor_mentions_sov_v2_scoped');
  });
});

test('新版报告一次固化全部平台和单平台视图且使用同一回答级 SOV reducer', async () => {
  const current = 'contextual_competitor_mentions_sov_v2_scoped';
  const metrics = [
    {
      id: 1,
      question_record_id: 11,
      project_id: 2,
      platform: 'deepseek',
      metric_semantics_version: current,
      answer_competitor_share: 100,
      sov_numerator: 1,
      sov_denominator: 1,
      brand_mentioned: true,
      brand_recommended: true,
      competition_entities: [],
      created_at: '2026-05-14T00:00:00.000Z'
    },
    {
      id: 2,
      question_record_id: 12,
      project_id: 2,
      platform: 'removed-platform',
      metric_semantics_version: current,
      answer_competitor_share: 0,
      sov_numerator: 0,
      sov_denominator: 9,
      brand_mentioned: false,
      brand_recommended: false,
      competition_entities: [{
        name: '海康',
        relation: 'competitor',
        mentions: 9,
        reason: '提供同类方案'
      }],
      created_at: '2026-05-14T01:00:00.000Z'
    }
  ];
  const records = [11, 12].map((id, index) => ({
    id,
    status: 'completed',
    tracked_prompt_id: 3,
    platform: index === 0 ? 'deepseek' : 'removed-platform',
    metric_semantics_version: current,
    resultDetail: { ai_response_original: `完整回答 ${id}` },
    created_at: `2026-05-14T0${index}:00:00.000Z`
  }));
  let metricQueries = 0;
  let recordQueries = 0;

  const payload = await ReportSnapshotService.buildSnapshotPayload({
    project: {
      id: 2,
      user_id: 9,
      platforms: ['deepseek'],
      toJSON: () => ({ id: 2, user_id: 9, platforms: ['deepseek'] })
    },
    user: { id: 9, role: 'user' },
    days: 7,
    now: new Date('2026-05-15T00:00:00.000Z'),
    repositories: {
      VisibilityMetric: {
        findAll: async () => {
          metricQueries += 1;
          return metrics;
        }
      },
      QuestionRecord: {
        findAll: async () => {
          recordQueries += 1;
          return records;
        }
      },
      TrackedPrompt: {
        findAll: async () => [{
          id: 3,
          question: '工业监控方案',
          tags: ['购买决策'],
          platforms: ['deepseek'],
          enabled: true
        }]
      },
      BrandCompetitor: { findAll: async () => [] }
    }
  });

  assert.equal(metricQueries, 2);
  assert.equal(recordQueries, 1);
  assert.equal(payload.metric_semantics_version, current);
  assert.deepEqual(payload.summary.available_platforms, ['deepseek', 'removed-platform']);
  assert.equal(payload.summary.metric_views.all.summary.sov_summary.average, 50);
  assert.equal(payload.summary.metric_views.all.summary.sov_summary.calculable_answers, 2);
  assert.deepEqual(
    payload.summary.metric_views.platforms.map((item) => [
      item.platform,
      item.summary.sov_summary.average,
      item.summary.sov_summary.calculable_answers
    ]),
    [
      ['deepseek', 100, 1],
      ['removed-platform', 0, 1]
    ]
  );
  assert.match(payload.summary.usage_guidance.monitoring_questions, /非品牌词问题/);
  assert.match(payload.summary.usage_guidance.trend_comparison, /问题集合/);
});
