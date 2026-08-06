const test = require('node:test');
const assert = require('node:assert/strict');

const ProjectMetricsService = require('../services/ProjectMetricsService');
const CitationMetricSemanticsService = require('../services/CitationMetricSemanticsService');

const CURRENT = 'contextual_competitor_mentions_sov_v2_scoped';
const EXPLICIT_CITATION = {
  analysis_structure: {
    citations: { semantics_version: 'explicit-citation-v2' }
  }
};

function currentMetric(overrides = {}) {
  const row = {
    metric_semantics_version: CURRENT,
    answer_competitor_share: null,
    sov_numerator: 0,
    sov_denominator: 0,
    brand_mentioned: false,
    brand_recommended: false,
    competition_entities: [],
    ...overrides
  };
  const providedStructure = row.analysis_structure || {};
  row.analysis_structure = {
      target_fact: providedStructure.target_fact || {
        status: 'complete',
        brand_mentioned: Boolean(row.brand_mentioned),
        brand_mentions: row.brand_mentioned ? 1 : 0
      },
      target_semantics: providedStructure.target_semantics || {
        recommendation: { status: 'assessed', value: Boolean(row.brand_recommended) },
        rank: { status: 'assessed', value: row.brand_rank ?? null },
        sentiment: { status: 'assessed', value: row.sentiment || 'neutral' }
      },
      sov: providedStructure.sov || {
        status: 'observed_only',
        scope: 'open_discovery',
        completeness: 'not_proven'
      },
      ...providedStructure
    };
  return row;
}

function currentRecord(overrides = {}) {
  return {
    metric_semantics_version: CURRENT,
    status: 'completed',
    resultDetail: { ai_response_original: '完整回答' },
    ...overrides
  };
}

test('normalizes analytics day windows safely', () => {
  assert.equal(ProjectMetricsService.normalizeDays(undefined), 30);
  assert.equal(ProjectMetricsService.normalizeDays('abc'), 30);
  assert.equal(ProjectMetricsService.normalizeDays('0'), 1);
  assert.equal(ProjectMetricsService.normalizeDays('7.8'), 7);
  assert.equal(ProjectMetricsService.normalizeDays('500'), 365);
});
test('builds calendar aligned metric query windows', () => {
  const window = ProjectMetricsService.buildPeriodWindow(7, {
    referenceDate: new Date('2026-05-17T15:30:00.000+08:00')
  });

  assert.equal(ProjectMetricsService.formatDateKey(window.periodStart), '2026-05-11');
  assert.equal(ProjectMetricsService.formatDateKey(window.changePeriodStart), '2026-05-04');
  assert.equal(window.periodStart.getHours(), 0);
  assert.equal(window.periodEnd.toISOString(), new Date('2026-05-17T15:30:00.000+08:00').toISOString());
});

test('新版项目聚合按回答等权平均并只让分析失败降低覆盖率', () => {
  const metrics = [
    currentMetric({
      question_record_id: 1,
      platform: 'doubao',
      answer_competitor_share: 100,
      sov_numerator: 1,
      sov_denominator: 1,
      brand_mentioned: true,
      brand_recommended: true,
      brand_rank: 1
    }),
    currentMetric({
      question_record_id: 2,
      platform: 'deepseek',
      answer_competitor_share: 0,
      sov_numerator: 0,
      sov_denominator: 9,
      competition_entities: [{
        name: '海康',
        relation: 'competitor',
        mentions: 9,
        reason: '提供同类方案'
      }]
    }),
    currentMetric({
      question_record_id: 3,
      platform: 'doubao',
      competition_entities: [{
        name: '国家电网',
        relation: 'non_competitor',
        mentions: 1,
        reason: '属于采购方'
      }]
    }),
    {
      metric_semantics_version: 'configured_competitor_sov_v1',
      question_record_id: 99,
      platform: 'doubao',
      share_of_voice: 90,
      brand_mentioned: true
    }
  ];
  const records = [
    currentRecord({ id: 1, platform: 'doubao' }),
    currentRecord({ id: 2, platform: 'deepseek' }),
    currentRecord({ id: 3, platform: 'doubao' }),
    currentRecord({ id: 4, platform: 'deepseek', status: 'failed' }),
    currentRecord({ id: 5, platform: 'deepseek', status: 'failed', resultDetail: null }),
    {
      id: 99,
      metric_semantics_version: 'configured_competitor_sov_v1',
      platform: 'doubao',
      resultDetail: { ai_response_original: '历史回答' },
      status: 'completed'
    }
  ];

  const view = ProjectMetricsService.buildCurrentMetricView({ metrics, records });

  assert.equal(view.valid_answers, 3);
  assert.equal(view.acquired_answers, 4);
  assert.equal(view.analysis_coverage_rate, 75);
  assert.equal(view.brand_mention_rate, 33.33);
  assert.equal(view.recommendation_rate, 33.33);
  assert.equal(view.recommendation_assessed_answers, 3);
  assert.equal(view.sentiment_assessed_answers, 3);
  assert.equal(view.ranked_answers, 1);
  assert.equal(view.avg_brand_rank, 1);
  assert.deepEqual(view.sov_summary, {
    metric_semantics_version: CURRENT,
    kind: 'observed_competitor_mentions',
    scope: 'open_discovery',
    completeness: 'not_proven',
    average: 50,
    calculable_answers: 2
  });
  assert.deepEqual(view.competitors, [{
    name: '海康',
    mentions: 9,
    appeared_answers: 1
  }]);
});

test('v5 项目聚合只把 assessed 语义纳入各自分母且不读取兼容占位', () => {
  const metrics = [
    currentMetric({
      brand_mentioned: true,
      brand_recommended: true,
      brand_rank: 1,
      sentiment: 'positive'
    }),
    currentMetric({
      brand_mentioned: true,
      brand_recommended: false,
      brand_rank: null,
      sentiment: 'negative'
    }),
    currentMetric({
      brand_mentioned: true,
      brand_recommended: true,
      brand_rank: 1,
      sentiment: 'neutral',
      analysis_structure: {
        target_fact: { status: 'unavailable', brand_mentioned: true },
        target_semantics: {
          recommendation: { status: 'unavailable', value: null },
          rank: { status: 'unresolved', value: null },
          sentiment: { status: 'unavailable', value: null }
        },
        sov: { status: 'observed_only', scope: 'open_discovery', completeness: 'not_proven' }
      }
    })
  ];

  const view = ProjectMetricsService.buildCurrentMetricView({ metrics, records: [] });
  assert.equal(view.valid_answers, 3);
  assert.equal(view.brand_mention_assessed_answers, 2);
  assert.equal(view.brand_mention_rate, 100);
  assert.equal(view.recommendation_assessed_answers, 2);
  assert.equal(view.recommended_answers, 1);
  assert.equal(view.recommendation_rate, 50);
  assert.equal(view.rank_assessed_answers, 2);
  assert.equal(view.ranked_answers, 1);
  assert.equal(view.avg_brand_rank, 1);
  assert.equal(view.sentiment_assessed_answers, 2);
  assert.equal(view.negative_sentiment_answers, 1);
  assert.equal(view.negative_sentiment_rate, 50);
});

test('问题集重试只统计当前槽位记录，不让已被替代的失败尝试污染覆盖率', () => {
  const metrics = [currentMetric({
    question_record_id: 102,
    platform: 'deepseek',
    answer_competitor_share: 50,
    sov_numerator: 1,
    sov_denominator: 2
  })];
  const records = [
    currentRecord({
      id: 101,
      question_set_run_id: 9,
      run_slot_index: null,
      platform: 'deepseek',
      status: 'failed'
    }),
    currentRecord({
      id: 102,
      question_set_run_id: 9,
      run_slot_index: 0,
      platform: 'deepseek'
    })
  ];

  const summary = ProjectMetricsService.buildCurrentDashboardSummary({
    metrics,
    records,
    prompts: []
  });

  assert.equal(summary.valid_answers, 1);
  assert.equal(summary.acquired_answers, 1);
  assert.equal(summary.analysis_coverage_rate, 100);
  assert.equal(summary.total_runs, 1);
  assert.equal(summary.failed_runs, 0);
});

test('引用证据独立于品牌分析，分析失败的已抓取回答仍进入引用指标', () => {
  const records = [currentRecord({
    id: 201,
    platform: 'doubao',
    status: 'failed',
    resultDetail: {
      ai_response_original: '回答原文',
      citation_analysis: {
        semantics_version: 'explicit-citation-v2',
        evidence_status: 'explicit',
        citation_count: 1,
        owned_citation_count: 1,
        competitor_citation_count: 0,
        sources: [{
          url: 'https://brand.example.com/report',
          domain: 'brand.example.com',
          owned: true,
          competitor_owned: false
        }]
      }
    }
  })];

  const view = ProjectMetricsService.buildCurrentMetricView({
    metrics: [],
    records
  });

  assert.equal(view.valid_answers, 0);
  assert.equal(view.acquired_answers, 1);
  assert.equal(view.analysis_coverage_rate, 0);
  assert.equal(view.citation_eligible_checks, 1);
  assert.equal(view.citation_unverified_checks, 0);
  assert.equal(view.citation_rate, 100);
  assert.equal(view.owned_citation_rate, 100);
});

test('项目覆盖率排除豆包采集过渡态并单独计数', () => {
  const metrics = [currentMetric({
    question_record_id: 202,
    platform: 'doubao-web',
    brand_mentioned: true,
    brand_recommended: true
  })];
  const records = [currentRecord({
    id: 202,
    platform: 'doubao-web',
    status: 'failed',
    result_summary: {
      web_capture: { schema_version: 'doubao-web-capture-v1', status: 'completed' }
    },
    resultDetail: {
      ai_response_original: '梳理品牌核心特点我将梳理目标品牌信息，为后续对比表格制作做准备。'
    }
  })];

  const view = ProjectMetricsService.buildCurrentMetricView({
    metrics,
    records
  });

  assert.equal(view.valid_answers, 0);
  assert.equal(view.invalid_captures, 1);
  assert.equal(view.acquired_answers, 0);
  assert.equal(view.analysis_coverage_rate, null);
});

test('同一新版 reducer 用于全部平台和单平台，空集合保持 N/A', () => {
  const metrics = [currentMetric({
    question_record_id: 1,
    platform: 'deepseek',
    answer_competitor_share: 0,
    sov_numerator: 0,
    sov_denominator: 2
  })];
  const records = [
    currentRecord({ id: 1, platform: 'deepseek' }),
    currentRecord({ id: 2, platform: 'deepseek', status: 'failed' })
  ];
  const all = ProjectMetricsService.buildCurrentMetricView({ metrics, records });
  const deepseek = ProjectMetricsService.buildCurrentMetricView({
    metrics: ProjectMetricsService.filterByPlatform(metrics, 'deepseek'),
    records: ProjectMetricsService.filterByPlatform(records, 'deepseek')
  });
  const empty = ProjectMetricsService.buildCurrentMetricView({ metrics: [], records: [] });

  assert.deepEqual(deepseek, all);
  assert.equal(deepseek.sov_summary.average, 0);
  assert.equal(deepseek.analysis_coverage_rate, 50);
  assert.equal(empty.sov_summary.average, null);
  assert.equal(empty.analysis_coverage_rate, null);
  assert.equal(empty.brand_mention_rate, null);
});

test('平台筛选默认合并并从实际历史数据列出平台', () => {
  const metrics = [
    currentMetric({ platform: 'doubao' }),
    currentMetric({ platform: 'legacy-removed' })
  ];
  const records = [
    currentRecord({ platform: 'deepseek-web' }),
    currentRecord({ platform: 'legacy-removed' })
  ];

  assert.equal(ProjectMetricsService.normalizePlatformFilter(), 'all');
  assert.equal(ProjectMetricsService.normalizePlatformFilter(' DeepSeek-Web '), 'deepseek-web');
  assert.throws(
    () => ProjectMetricsService.normalizePlatformFilter('../deepseek'),
    (error) => error?.code === 'INVALID_PLATFORM_FILTER'
  );
  assert.deepEqual(
    ProjectMetricsService.listActualPlatforms(metrics, records),
    ['deepseek-web', 'doubao', 'legacy-removed']
  );
});

test('新版问题表现保留 SOV N/A、覆盖率和运行失败', () => {
  const prompts = [
    { id: 1, question: '工业监控方案', enabled: true },
    { id: 2, question: '智能巡检方案', enabled: true }
  ];
  const metrics = [currentMetric({
    prompt_id: 1,
    question_record_id: 11,
    platform: 'deepseek',
    brand_mentioned: true,
    sentiment: 'neutral',
    created_at: '2026-07-28T01:00:00.000Z'
  })];
  const records = [
    currentRecord({
      id: 11,
      tracked_prompt_id: 1,
      platform: 'deepseek',
      created_at: '2026-07-28T01:00:00.000Z'
    }),
    currentRecord({
      id: 12,
      tracked_prompt_id: 2,
      platform: 'deepseek',
      status: 'failed',
      created_at: '2026-07-28T02:00:00.000Z'
    })
  ];

  const performance = ProjectMetricsService.buildCurrentPromptPerformance(prompts, metrics, records);

  assert.equal(performance['1'].valid_answers, 1);
  assert.equal(performance['1'].sov_summary.average, null);
  assert.equal(performance['1'].neutral_sentiment_count, 1);
  assert.equal(performance['2'].valid_answers, 0);
  assert.equal(performance['2'].failed_runs, 1);
  assert.equal(performance['2'].analysis_coverage_rate, 0);
});

test('新版项目汇总复用同一 reducer 并保留来源分析字段', () => {
  const metrics = [currentMetric({
    platform: 'deepseek',
    prompt_id: 1,
    answer_competitor_share: 50,
    sov_numerator: 1,
    sov_denominator: 2,
    brand_mentioned: true,
    brand_recommended: true,
    citation_count: 1,
    owned_citation_count: 1,
    ...EXPLICIT_CITATION
  })];
  const records = [
    currentRecord({ platform: 'deepseek', tracked_prompt_id: 1 }),
    currentRecord({
      platform: 'deepseek',
      tracked_prompt_id: 1,
      status: 'failed',
      resultDetail: null
    })
  ];
  const summary = ProjectMetricsService.buildCurrentDashboardSummary({
    metrics,
    records,
    prompts: [{ id: 1, enabled: true, category: '购买决策' }],
    sourceAnalysis: {
      summary: { total_citations: 2 },
      source_types: [{ type: '自有来源', citation_count: 1 }],
      domains: [{ domain: 'brand.example.com', citation_count: 1 }],
      urls: [{ url: 'https://brand.example.com/guide', citation_count: 1 }]
    }
  });

  assert.equal(summary.valid_answers, 1);
  assert.equal(summary.total_runs, 2);
  assert.equal(summary.failed_runs, 1);
  assert.equal(summary.platforms[0].sov_summary.average, 50);
  assert.equal(summary.categories[0].sov_summary.average, 50);
  assert.equal(summary.categories[0].total_runs, 2);
  assert.deepEqual(summary.source_summary, { total_citations: 2 });
  assert.deepEqual(summary.source_domains, [{ domain: 'brand.example.com', citation_count: 1 }]);
});

test('新版趋势按自然日补齐且空日保持 N/A', () => {
  const metrics = [currentMetric({
    created_at: '2026-05-14T10:00:00.000+08:00',
    answer_competitor_share: 80,
    sov_numerator: 4,
    sov_denominator: 5,
    brand_mentioned: true
  })];
  const records = [currentRecord({ created_at: '2026-05-14T10:00:00.000+08:00' })];

  const trend = ProjectMetricsService.buildCurrentTrend(metrics, records, 3, {
    referenceDate: new Date('2026-05-15T12:00:00.000+08:00')
  });

  assert.deepEqual(trend.map((row) => ({
    date: row.date,
    valid_answers: row.valid_answers,
    sov: row.sov_summary.average
  })), [
    { date: '2026-05-13', valid_answers: 0, sov: null },
    { date: '2026-05-14', valid_answers: 1, sov: 80 },
    { date: '2026-05-15', valid_answers: 0, sov: null }
  ]);
});

test('normalizes legacy mixed citation evidence before direct API display', () => {
  const normalized = CitationMetricSemanticsService.normalizeForRead({
    citation_count: 43,
    owned_citation_count: 3,
    citation_sources: [{ url: 'https://legacy.example/a' }],
    analysis_structure: {
      citations: { semantics_version: 'explicit-citation-v1' }
    }
  });

  assert.equal(normalized.citation_evidence_status, 'legacy_unverified');
  assert.equal(normalized.citation_count, 0);
  assert.equal(normalized.owned_citation_count, 0);
  assert.deepEqual(normalized.citation_sources, []);
  assert.equal(normalized.legacy_citation_count, 43);
});

test('distinguishes a platform-unobservable citation result from a verified zero', () => {
  const normalized = CitationMetricSemanticsService.normalizeForRead({
    citation_count: 0,
    owned_citation_count: 0,
    citation_sources: [],
    analysis_structure: {
      citations: {
        semantics_version: 'explicit-citation-v2',
        evidence_status: 'unavailable'
      }
    }
  });

  assert.equal(normalized.citation_evidence_status, 'unavailable');
  assert.equal(normalized.citation_count, 0);
  assert.deepEqual(normalized.citation_sources, []);
});

test('summarizes run records separately from effective analysis metrics', () => {
  assert.deepEqual(ProjectMetricsService.summarizeRuns([
    { status: 'completed' },
    { status: 'failed' },
    { status: 'pending' }
  ]), {
    total_runs: 3,
    completed_runs: 1,
    failed_runs: 1,
    pending_runs: 1,
    failure_rate: 33.33
  });
});
