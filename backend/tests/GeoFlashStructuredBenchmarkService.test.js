const test = require('node:test');
const assert = require('node:assert/strict');

const {
  competitionJaccard,
  entityQualityStats,
  fieldStatusDistribution,
  metricSignature,
  semanticTruthCoverage,
  summarizeArm
} = require('../services/GeoFlashStructuredBenchmarkService');

function result(overrides = {}) {
  return {
    brand_mentioned: false,
    brand_mentions: 0,
    brand_rank: null,
    brand_recommended: false,
    sentiment: 'neutral',
    sov_numerator: 0,
    sov_denominator: 2,
    answer_competitor_share: 0,
    competition_entities: [
      { name: '海康威视', relation: 'competitor', mentions: 2 }
    ],
    analysis_structure: {
      entities: [{ entity_id: 'E001', name: '海康威视' }]
    },
    analysis_attempts: 2,
    ...overrides
  };
}

test('summarizes completion, target false positives, stability, tokens and latency separately', () => {
  const entries = [
    { sample_id: 'S01', repeat: 1, ok: true, duration_ms: 100, total_tokens: 1000, result: result() },
    { sample_id: 'S01', repeat: 2, ok: true, duration_ms: 200, total_tokens: 1200, result: result() },
    {
      sample_id: 'S01',
      repeat: 3,
      ok: true,
      duration_ms: 300,
      total_tokens: 1400,
      result: result({ brand_mentioned: true, brand_mentions: 1, sov_numerator: 1 })
    },
    { sample_id: 'S02', repeat: 1, ok: false, duration_ms: 400, total_tokens: 800, error: { code: 'invalid' } }
  ];
  const labels = new Map([
    ['S01', { mentioned: false }],
    ['S02', { mentioned: true }]
  ]);

  const summary = summarizeArm(entries, labels);

  assert.equal(summary.total, 4);
  assert.equal(summary.completed, 3);
  assert.equal(summary.completion_rate, 0.75);
  assert.equal(summary.target_false_positives, 1);
  assert.equal(summary.target_presence_correct, 2);
  assert.equal(summary.target_presence_evaluated, 3);
  assert.equal(summary.stability_pairs, 3);
  assert.equal(summary.stability_agreements, 1);
  assert.equal(summary.stability_rate, 1 / 3);
  assert.equal(summary.tokens.median, 1100);
  assert.equal(summary.latency_ms.p95, 385);
  assert.equal(
    metricSignature(result()),
    metricSignature(result({ analysis_attempts: 4 }))
  );
});

test('keeps open competitor discovery outside the target core stability signature', () => {
  const base = {
    brand_mentioned: true,
    brand_mentions: 1,
    brand_rank: 1,
    brand_recommended: true,
    sentiment: 'positive'
  };
  const left = {
    ...base,
    sov_denominator: 2,
    answer_competitor_share: 50,
    competition_entities: [{ name: '海康威视', relation: 'competitor', mentions: 1 }]
  };
  const right = {
    ...base,
    sov_denominator: 3,
    answer_competitor_share: 33.33,
    competition_entities: [
      { name: '海康威视', relation: 'competitor', mentions: 1 },
      { name: '大华股份', relation: 'competitor', mentions: 1 }
    ]
  };

  assert.equal(metricSignature(left), metricSignature(right));
  assert.equal(competitionJaccard(left, right), 0.5);
});

// ---- issue 013：字段状态/降级率、实体质量与语义真值覆盖 ----

function structureOverrides({ semantics = 'complete', rec = 'assessed', rank = 'assessed', sent = 'assessed', degraded = false } = {}) {
  return {
    target_semantics: {
      status: semantics,
      recommendation: { status: rec },
      rank: { status: rank },
      sentiment: { status: sent }
    },
    competition_analysis: { status: degraded ? 'unavailable' : 'partial' },
    diagnostics: {
      stages: degraded
        ? [{ stage: 'semantic_judge', degraded: true, error_code: 'analysis_semantic_output_invalid' }]
        : [{ stage: 'semantic_judge', attempt_count: 1 }]
    }
  };
}

test('fieldStatusDistribution 报告字段状态分布、可用率与阶段 2 降级率', () => {
  const entries = [
    { sample_id: 'S01', repeat: 1, ok: true, result: { analysis_structure: structureOverrides() } },
    { sample_id: 'S01', repeat: 2, ok: true, result: { analysis_structure: structureOverrides({ semantics: 'partial', rec: 'unresolved' }) } },
    { sample_id: 'S01', repeat: 3, ok: true, result: { analysis_structure: structureOverrides({ degraded: true, semantics: 'unavailable', rec: 'unresolved', rank: 'unresolved', sent: 'unresolved' }) } },
    { sample_id: 'S02', repeat: 1, ok: false, result: null, error: { code: 'x' } }
  ];
  const stats = fieldStatusDistribution(entries);
  assert.equal(stats.evaluated, 3);
  assert.equal(stats.degraded_count, 1);
  assert.equal(stats.degradation_rate, 1 / 3);
  assert.deepEqual(stats.target_semantics_distribution, { complete: 1, partial: 1, unavailable: 1 });
  assert.deepEqual(stats.recommendation_distribution, { assessed: 1, unresolved: 2 });
  assert.equal(stats.assessed_rate, 1 / 3);
});

test('entityQualityStats 在已复核真值下评估 precision/recall/micro-F1/canonicalization', () => {
  const entries = [
    {
      sample_id: 'S01', repeat: 1, ok: true,
      result: {
        analysis_structure: {
          entities: [
            { name: '海康威视', surface_forms: ['海康威视', 'Hikvision'] },
            { name: '大华股份', surface_forms: ['大华股份'] }
          ]
        }
      }
    }
  ];
  const truthBySample = new Map([
    ['S01', {
      review_status: 'confirmed',
      entities: [
        { canonical_name: '海康威视', surface_forms: ['海康威视', 'Hikvision'] },
        { canonical_name: '大华股份', surface_forms: ['大华股份'] }
      ]
    }]
  ]);
  const stats = entityQualityStats(entries, truthBySample);
  assert.equal(stats.status, 'EVALUATED');
  assert.equal(stats.tp, 2);
  assert.equal(stats.fp, 0);
  assert.equal(stats.fn, 0);
  assert.equal(stats.precision, 1);
  assert.equal(stats.recall, 1);
  assert.equal(stats.micro_f1, 1);
  assert.equal(stats.canonicalization_accuracy, 1);
});

test('entityQualityStats 检测组合实体并把逐字可定位但不正确的实体计错', () => {
  const entries = [
    {
      sample_id: 'S01', repeat: 1, ok: true,
      result: {
        analysis_structure: {
          entities: [
            // 组合实体：把"海康威视"与"大华股份"合成一个实体
            { name: '海康威视大华股份', surface_forms: ['海康威视大华股份'] }
          ]
        }
      }
    }
  ];
  const truthBySample = new Map([
    ['S01', {
      review_status: 'confirmed',
      entities: [
        { canonical_name: '海康威视', surface_forms: ['海康威视'] },
        { canonical_name: '大华股份', surface_forms: ['大华股份'] }
      ]
    }]
  ]);
  const stats = entityQualityStats(entries, truthBySample);
  assert.equal(stats.status, 'EVALUATED');
  // 组合字符串可逐字定位但实体错误：预测 1 个实体，真值 2 个
  assert.equal(stats.tp, 0);
  assert.equal(stats.fp, 1);
  assert.equal(stats.fn, 2);
  assert.equal(stats.precision, 0);
  assert.equal(stats.merged_entity_count, 1);
});

test('entityQualityStats 真值缺失或未复核时 NOT_EVALUABLE，不得冒充 PASS', () => {
  const entries = [
    {
      sample_id: 'S01', repeat: 1, ok: true,
      result: { analysis_structure: { entities: [{ name: '海康威视' }] } }
    }
  ];
  const noTruth = entityQualityStats(entries, new Map());
  assert.equal(noTruth.status, 'NOT_EVALUABLE');
  const pendingTruth = entityQualityStats(entries, new Map([
    ['S01', { review_status: 'pending_review', entities: [] }]
  ]));
  assert.equal(pendingTruth.status, 'NOT_EVALUABLE');
});

test('semanticTruthCoverage 报告推荐/排名/情绪/关系的已复核实例数', () => {
  const truthBySample = new Map();
  for (let index = 1; index <= 20; index += 1) {
    truthBySample.set(`S${String(index).padStart(2, '0')}`, {
      review_status: 'confirmed',
      recommendation: true,
      rank: index <= 12 ? 1 : null,
      sentiment: 'positive',
      relations: [{ canonical_name: '海康威视', relation: 'competitor' }]
    });
  }
  const coverage = semanticTruthCoverage(truthBySample);
  assert.equal(coverage.recommendation.count, 20);
  assert.equal(coverage.rank.count, 12);
  assert.equal(coverage.sentiment.count, 20);
  assert.equal(coverage.relations.count, 20);
  assert.equal(coverage.recommendation.pass, true);
  assert.equal(coverage.rank.pass, false);
});
