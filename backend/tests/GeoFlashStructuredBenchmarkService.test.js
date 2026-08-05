const test = require('node:test');
const assert = require('node:assert/strict');

const {
  competitionJaccard,
  entityQualityStats,
  fieldStatusDistribution,
  metricSignature,
  relationQualityStats,
  semanticTruthCoverage,
  summarizeArm,
  validateTruthEntry
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

function spanMention(start, end, surfaceForm) {
  return { source_id: 'L001', start, end, surface_form: surfaceForm };
}

function v3Truth(overrides = {}) {
  return {
    sample_id: 'S01',
    truth_version: 'truth_v3_2026-08-05',
    review_status: 'confirmed',
    reviewer: 'human-a',
    reviewed_at: '2026-08-05',
    dispute: 'none',
    answer_sha256: 'f'.repeat(64),
    entities: [
      {
        canonical_name: '海康威视',
        surface_forms: ['海康威视', 'Hikvision'],
        type: 'brand',
        mentions: [spanMention(0, 4, '海康威视')]
      },
      {
        canonical_name: '大华股份',
        surface_forms: ['大华股份'],
        type: 'brand',
        mentions: [spanMention(5, 9, '大华股份')]
      }
    ],
    relations: [
      { canonical_name: '海康威视', relation: 'competitor', evidence_source_ids: ['L001'] },
      { canonical_name: '大华股份', relation: 'competitor', evidence_source_ids: ['L001'] }
    ],
    recommendation: true,
    rank: 1,
    sentiment: 'positive',
    ...overrides
  };
}

function predictedResult(entities) {
  return {
    sample_id: 'S01',
    repeat: 1,
    ok: true,
    result: {
      analysis_structure: {
        entities: entities.map(({ name, entity_id }) => ({ entity_id, name })),
        mentions: entities.flatMap(({ entity_id, mentions }) => (
          mentions.map((mention) => ({ entity_id, ...mention }))
        )),
        competitor_relations: []
      }
    }
  };
}

test('entityQualityStats span-based：按 mention span 对齐评估 precision/recall/canonicalization', () => {
  const entries = [predictedResult([
    { entity_id: 'E001', name: '海康威视', mentions: [spanMention(0, 4, '海康威视')] },
    { entity_id: 'E002', name: '大华股份', mentions: [spanMention(5, 9, '大华股份')] }
  ])];
  const truthBySample = new Map([['S01', v3Truth()]]);
  const stats = entityQualityStats(entries, truthBySample);
  assert.equal(stats.status, 'EVALUATED');
  assert.equal(stats.tp, 2);
  assert.equal(stats.fp, 0);
  assert.equal(stats.fn, 0);
  assert.equal(stats.precision, 1);
  assert.equal(stats.recall, 1);
  assert.equal(stats.micro_f1, 1);
  assert.equal(stats.canonicalization_accuracy, 1);
  assert.equal(stats.merged_entity_count, 0);
  assert.equal(stats.split_entity_count, 0);
});

test('entityQualityStats span-based：组合实体（一个 span 覆盖两个真值实体）计错', () => {
  const entries = [predictedResult([
    { entity_id: 'E001', name: '海康威视大华股份', mentions: [spanMention(0, 9, '海康威视大华股份')] }
  ])];
  const truthBySample = new Map([['S01', v3Truth()]]);
  const stats = entityQualityStats(entries, truthBySample);
  assert.equal(stats.status, 'EVALUATED');
  // 组合：预测 1 个实体，真值 2 个；span [0,9) 与两个 truth span 重叠
  assert.equal(stats.tp, 0);
  assert.equal(stats.fp, 1);
  assert.equal(stats.fn, 2);
  assert.equal(stats.merged_entity_count, 1);
  assert.equal(stats.precision, 0);
});

test('entityQualityStats span-based：无依据拆分（两个预测实体共享同一 truth span）计错', () => {
  const entries = [predictedResult([
    { entity_id: 'E001', name: '海康威视', mentions: [spanMention(0, 4, '海康威视')] },
    { entity_id: 'E002', name: 'Hikvision', mentions: [spanMention(0, 4, '海康威视')] }
  ])];
  const truthBySample = new Map([['S01', v3Truth()]]);
  const stats = entityQualityStats(entries, truthBySample);
  assert.equal(stats.status, 'EVALUATED');
  // 第二个实体共享同一 span -> 无依据拆分
  assert.equal(stats.tp, 1);
  assert.equal(stats.fp, 1);
  assert.equal(stats.split_entity_count, 1);
});

test('entityQualityStats span-based：canonicalization 按对齐实体计分，别名归一错误被计错', () => {
  const entries = [predictedResult([
    // 正确 span 对齐，但 name 归并错误（与 truth canonical 不一致）
    { entity_id: 'E001', name: '杭州海康威视', mentions: [spanMention(0, 4, '海康威视')] }
  ])];
  const truthBySample = new Map([['S01', v3Truth()]]);
  const stats = entityQualityStats(entries, truthBySample);
  assert.equal(stats.status, 'EVALUATED');
  assert.equal(stats.tp, 1);
  assert.equal(stats.canonicalization_accuracy, 0);
});

test('entityQualityStats 真值缺失或未复核时 NOT_EVALUABLE，不得冒充 PASS', () => {
  const entries = [predictedResult([
    { entity_id: 'E001', name: '海康威视', mentions: [spanMention(0, 4, '海康威视')] }
  ])];
  const noTruth = entityQualityStats(entries, new Map());
  assert.equal(noTruth.status, 'NOT_EVALUABLE');
  const pendingTruth = entityQualityStats(entries, new Map([
    ['S01', { ...v3Truth(), review_status: 'pending_review', reviewer: '', reviewed_at: '' }]
  ]));
  assert.equal(pendingTruth.status, 'NOT_EVALUABLE');
});

test('relationQualityStats 计算预测关系对真值关系的真实 TP/FP/FN', () => {
  const answer = '候选品牌：海康威视、大华股份、宇视科技。';
  const structure = {
    entities: [
      { entity_id: 'E001', name: '海康威视' },
      { entity_id: 'E002', name: '大华股份' },
      { entity_id: 'E003', name: '宇视科技' }
    ],
    competitor_relations: [
      { entity_id: 'E001', relation: 'competitor' },
      { entity_id: 'E002', relation: 'competitor' },
      // 模型多判宇视为 competitor，真值为 non_competitor
      { entity_id: 'E003', relation: 'competitor' }
    ]
  };
  const entries = [{
    sample_id: 'S01',
    repeat: 1,
    ok: true,
    result: { analysis_structure: structure }
  }];
  const truthBySample = new Map([['S01', v3Truth({
    entities: [
      { canonical_name: '海康威视', surface_forms: ['海康威视'], type: 'brand', mentions: [] },
      { canonical_name: '大华股份', surface_forms: ['大华股份'], type: 'brand', mentions: [] },
      { canonical_name: '宇视科技', surface_forms: ['宇视科技'], type: 'brand', mentions: [] }
    ],
    relations: [
      { canonical_name: '海康威视', relation: 'competitor' },
      { canonical_name: '大华股份', relation: 'competitor' },
      { canonical_name: '宇视科技', relation: 'non_competitor' }
    ]
  })]]);
  const stats = relationQualityStats(entries, truthBySample);
  assert.equal(stats.status, 'EVALUATED');
  assert.equal(stats.tp, 2);
  assert.equal(stats.fp, 1);
  assert.equal(stats.fn, 1);
  assert.equal(stats.precision, 2 / 3);
  assert.equal(stats.recall, 2 / 3);
});

test('relationQualityStats 关系全错时 precision 为 0，不因覆盖数达标而 PASS', () => {
  const structure = {
    entities: [{ entity_id: 'E001', name: '海康威视' }],
    competitor_relations: [{ entity_id: 'E001', relation: 'non_competitor' }]
  };
  const entries = [{
    sample_id: 'S01',
    repeat: 1,
    ok: true,
    result: { analysis_structure: structure }
  }];
  const truthBySample = new Map([['S01', v3Truth({
    entities: [{ canonical_name: '海康威视', surface_forms: ['海康威视'], type: 'brand', mentions: [] }],
    relations: [{ canonical_name: '海康威视', relation: 'competitor' }]
  })]]);
  const stats = relationQualityStats(entries, truthBySample);
  assert.equal(stats.status, 'EVALUATED');
  assert.equal(stats.tp, 0);
  assert.equal(stats.fp, 1);
  assert.equal(stats.fn, 1);
  assert.equal(stats.precision, 0);
});

test('validateTruthEntry fail-closed：缺字段、哈希不匹配、重复 ID、引用悬空均报错', () => {
  const sampleById = new Map([
    ['S01', { response_text: '海康威视、大华股份。' }]
  ]);
  // 合法条目
  const hash = require('node:crypto').createHash('sha256').update('海康威视、大华股份。').digest('hex');
  const valid = v3Truth({ answer_sha256: hash });
  assert.deepEqual(validateTruthEntry(valid, sampleById), []);

  // 缺 review_status
  const noStatus = { ...valid };
  delete noStatus.review_status;
  assert.ok(validateTruthEntry(noStatus, sampleById).some((error) => /review_status/.test(error)));

  // confirmed 缺 reviewer
  const noReviewer = { ...valid, reviewer: '', reviewed_at: '' };
  assert.ok(validateTruthEntry(noReviewer, sampleById).some((error) => /reviewer/.test(error)));

  // answer_sha256 不匹配
  const badHash = { ...valid, answer_sha256: 'a'.repeat(64) };
  assert.ok(validateTruthEntry(badHash, sampleById).some((error) => /answer_sha256/.test(error)));

  // 重复 canonical_name
  const dupName = {
    ...valid,
    entities: [...valid.entities, { ...valid.entities[0] }]
  };
  assert.ok(validateTruthEntry(dupName, sampleById).some((error) => /重复/.test(error)));

  // relation 引用未定义实体
  const dangling = {
    ...valid,
    relations: [{ canonical_name: '不存在品牌', relation: 'competitor' }]
  };
  assert.ok(validateTruthEntry(dangling, sampleById).some((error) => /未在 entities/.test(error)));

  // mention span 与原文不一致
  const badSpan = {
    ...valid,
    entities: [{
      ...valid.entities[0],
      mentions: [{ source_id: 'L001', start: 0, end: 9, surface_form: '海康威视' }]
    }]
  };
  assert.ok(validateTruthEntry(badSpan, sampleById).some((error) => /span/.test(error)));

  // 未在冻结语料中的 sample_id
  const unknownSample = { ...valid, sample_id: 'S999' };
  assert.ok(validateTruthEntry(unknownSample, sampleById).some((error) => /未在冻结语料/.test(error)));
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
