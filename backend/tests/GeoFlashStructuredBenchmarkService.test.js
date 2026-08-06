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
    // confirmed 必须提供全部目标字段（第三轮 P0 完整性合同）
    mentioned: true,
    mentions: 2,
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
    // 预测侧必须带可对齐的 mention span，关系才参与 TP 比较
    mentions: [
      { entity_id: 'E001', start: 5, end: 9, surface_form: '海康威视' },
      { entity_id: 'E002', start: 10, end: 14, surface_form: '大华股份' },
      { entity_id: 'E003', start: 15, end: 19, surface_form: '宇视科技' }
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
      { canonical_name: '海康威视', surface_forms: ['海康威视'], type: 'brand', mentions: [spanMention(5, 9, '海康威视')] },
      { canonical_name: '大华股份', surface_forms: ['大华股份'], type: 'brand', mentions: [spanMention(10, 14, '大华股份')] },
      { canonical_name: '宇视科技', surface_forms: ['宇视科技'], type: 'brand', mentions: [spanMention(15, 19, '宇视科技')] }
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
    mentions: [{ entity_id: 'E001', start: 5, end: 9, surface_form: '海康威视' }],
    competitor_relations: [{ entity_id: 'E001', relation: 'non_competitor' }]
  };
  const entries = [{
    sample_id: 'S01',
    repeat: 1,
    ok: true,
    result: { analysis_structure: structure }
  }];
  const truthBySample = new Map([['S01', v3Truth({
    entities: [{ canonical_name: '海康威视', surface_forms: ['海康威视'], type: 'brand', mentions: [spanMention(5, 9, '海康威视')] }],
    relations: [{ canonical_name: '海康威视', relation: 'competitor' }]
  })]]);
  const stats = relationQualityStats(entries, truthBySample);
  assert.equal(stats.status, 'EVALUATED');
  assert.equal(stats.tp, 0);
  assert.equal(stats.fp, 1);
  assert.equal(stats.fn, 1);
  assert.equal(stats.precision, 0);
});

test('validateTruthEntry P0：confirmed 目标字段类型严格校验，字符串 false/负 mentions/非法 sentiment 拒绝', () => {
  const sampleById = new Map([
    ['S01', { response_text: '海康威视、大华股份。' }]
  ]);
  const hash = require('node:crypto').createHash('sha256').update('海康威视、大华股份。').digest('hex');
  const base = v3Truth({ answer_sha256: hash });
  // 合法 confirmed 记录通过
  assert.deepEqual(validateTruthEntry(base, sampleById), []);
  // 字符串 "false" 会被 Boolean() 强转 true，必须拒绝
  const strFalse = { ...base, mentioned: 'false' };
  assert.ok(validateTruthEntry(strFalse, sampleById).some((error) => /mentioned/.test(error)));
  const strFalseRec = { ...base, recommendation: 'false' };
  assert.ok(validateTruthEntry(strFalseRec, sampleById).some((error) => /recommendation/.test(error)));
  // 负 mentions 拒绝
  const negMentions = { ...base, mentions: -7 };
  assert.ok(validateTruthEntry(negMentions, sampleById).some((error) => /mentions/.test(error)));
  // 非整数 mentions 拒绝
  const floatMentions = { ...base, mentions: 1.5 };
  assert.ok(validateTruthEntry(floatMentions, sampleById).some((error) => /mentions/.test(error)));
  // 非法 sentiment 拒绝
  const badSentiment = { ...base, sentiment: 'excellent' };
  assert.ok(validateTruthEntry(badSentiment, sampleById).some((error) => /sentiment/.test(error)));
  // 非法 rank 拒绝
  const badRank = { ...base, rank: 'first' };
  assert.ok(validateTruthEntry(badRank, sampleById).some((error) => /rank/.test(error)));
  // 缺 truth_version / dispute 拒绝
  const noVersion = { ...base };
  delete noVersion.truth_version;
  assert.ok(validateTruthEntry(noVersion, sampleById).some((error) => /truth_version/.test(error)));
  const noDispute = { ...base };
  delete noDispute.dispute;
  assert.ok(validateTruthEntry(noDispute, sampleById).some((error) => /dispute/.test(error)));
  // 目标未出现时字段组合约束：mentioned=false 时 mentions 必须为 0、rank/sentiment 必须为 null
  const inconsistent = { ...base, mentioned: false, mentions: 2 };
  assert.ok(validateTruthEntry(inconsistent, sampleById).some((error) => /mentioned/.test(error)));
});

test('validateTruthEntry P1：实体 type 必须是 brand/company/other_organization', () => {
  const sampleById = new Map([
    ['S01', { response_text: '海康威视、大华股份。' }]
  ]);
  const hash = require('node:crypto').createHash('sha256').update('海康威视、大华股份。').digest('hex');
  const base = v3Truth({ answer_sha256: hash });
  const badType = { ...base, entities: [{ ...base.entities[0], type: 'organization' }] };
  assert.ok(validateTruthEntry(badType, sampleById).some((error) => /type/.test(error)));
  const goodType = {
    ...base,
    entities: base.entities.map((entity, index) => ({
      ...entity,
      type: index === 0 ? 'other_organization' : 'brand'
    }))
  };
  assert.deepEqual(validateTruthEntry(goodType, sampleById), []);
});

test('relationQualityStats P1：按 span 对齐实体计分，归一化差异（杭州海康威视 vs 海康威视）不算 FP', () => {
  const entries = [{
    sample_id: 'S01',
    repeat: 1,
    ok: true,
    result: {
      analysis_structure: {
        entities: [{ entity_id: 'E001', name: '杭州海康威视' }],
        mentions: [{ entity_id: 'E001', start: 0, end: 6, surface_form: '杭州海康威视' }],
        competitor_relations: [{ entity_id: 'E001', relation: 'competitor' }]
      }
    }
  }];
  const truthBySample = new Map([['S01', v3Truth({
    entities: [{
      canonical_name: '海康威视',
      surface_forms: ['海康威视'],
      type: 'brand',
      mentions: [{ source_id: 'L001', start: 2, end: 6, surface_form: '海康威视' }]
    }],
    relations: [{ canonical_name: '海康威视', relation: 'competitor' }]
  })]]);
  const stats = relationQualityStats(entries, truthBySample);
  assert.equal(stats.status, 'EVALUATED');
  assert.equal(stats.tp, 1);
  assert.equal(stats.fp, 0);
  assert.equal(stats.fn, 0);
  assert.equal(stats.precision, 1);
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

// ---- 第三轮反例回归（数据所有者核验真实反例后补修）----

test('第三轮反例 P0：confirmed 缺少目标字段时校验必须报错（不得 0 错误）', () => {
  const sampleById = new Map([
    ['S01', { response_text: '海康威视、大华股份。' }]
  ]);
  const hash = require('node:crypto').createHash('sha256').update('海康威视、大华股份。').digest('hex');
  const base = v3Truth({ answer_sha256: hash });
  // 反例：删除全部目标字段，confirmed 记录此前返回 0 错误
  const stripped = { ...base };
  ['mentioned', 'mentions', 'recommendation', 'rank', 'sentiment'].forEach((field) => {
    delete stripped[field];
  });
  const errors = validateTruthEntry(stripped, sampleById);
  ['mentioned', 'mentions', 'recommendation', 'rank', 'sentiment'].forEach((field) => {
    assert.ok(errors.some((error) => error.includes(field)), `缺 ${field} 必须报错: ${errors.join('; ')}`);
  });
  // 只缺一个字段也必须报错
  const missingMentions = { ...base };
  delete missingMentions.mentions;
  assert.ok(validateTruthEntry(missingMentions, sampleById).some((error) => /mentions/.test(error)));
  // 完整目标字段的 confirmed 记录仍然通过
  assert.deepEqual(validateTruthEntry(base, sampleById), []);
});

test('第三轮反例 P0：mentioned=false 时 recommendation=true 必须拒绝', () => {
  const sampleById = new Map([
    ['S01', { response_text: '海康威视、大华股份。' }]
  ]);
  const hash = require('node:crypto').createHash('sha256').update('海康威视、大华股份。').digest('hex');
  const base = v3Truth({ answer_sha256: hash });
  const contradiction = {
    ...base,
    mentioned: false,
    mentions: 0,
    recommendation: true,
    rank: null,
    sentiment: null
  };
  assert.ok(validateTruthEntry(contradiction, sampleById).some((error) => /recommendation/.test(error)));
  // mentioned=false 且 recommendation=false 的组合合法
  const consistent = { ...contradiction, recommendation: false };
  assert.deepEqual(validateTruthEntry(consistent, sampleById), []);
});

test('第三轮反例 P1：实体缺少 type 必须拒绝（不能只校验存在时的枚举）', () => {
  const sampleById = new Map([
    ['S01', { response_text: '海康威视、大华股份。' }]
  ]);
  const hash = require('node:crypto').createHash('sha256').update('海康威视、大华股份。').digest('hex');
  const base = v3Truth({ answer_sha256: hash });
  const noType = {
    ...base,
    entities: base.entities.map((entity) => {
      const { type: _removed, ...rest } = entity;
      return rest;
    })
  };
  assert.ok(validateTruthEntry(noType, sampleById).some((error) => /type/.test(error)));
});

test('第三轮反例 P1：预测关系没有可对齐 span 时，仅名称相同不得判 TP', () => {
  // 反例：预测实体完全没有 mention span（只输出实体名与关系），truth 有同名实体
  const structure = {
    entities: [{ entity_id: 'E001', name: '海康威视' }],
    // 没有 mentions 数组：预测关系无 span 可对齐
    competitor_relations: [{ entity_id: 'E001', relation: 'competitor' }]
  };
  const entries = [{
    sample_id: 'S01',
    repeat: 1,
    ok: true,
    result: { analysis_structure: structure }
  }];
  const truthBySample = new Map([['S01', v3Truth({
    entities: [{ canonical_name: '海康威视', surface_forms: ['海康威视'], type: 'brand', mentions: [spanMention(0, 4, '海康威视')] }],
    relations: [{ canonical_name: '海康威视', relation: 'competitor' }]
  })]]);
  const stats = relationQualityStats(entries, truthBySample);
  assert.equal(stats.status, 'EVALUATED');
  assert.equal(stats.tp, 0, '无 span 对齐的关系不得判 TP');
  assert.equal(stats.fp, 1, '无对齐依据的预测关系计 FP');
  assert.equal(stats.fn, 1, '真值关系未被证实');
  assert.equal(stats.precision, 0);
});

test('第三轮：truth target_mapping 真值结构校验与 conflicting_identity 不变量', () => {
  const sampleById = new Map([
    ['S01', { response_text: '海康威视、大华股份。' }]
  ]);
  const hash = require('node:crypto').createHash('sha256').update('海康威视、大华股份。').digest('hex');
  const base = v3Truth({ answer_sha256: hash });
  // S53 形态合法：mentioned=true/mentions=1 + conflicting_identity，语义字段 null 表示 unavailable
  const conflict = {
    ...base,
    mentioned: true,
    mentions: 1,
    recommendation: null,
    rank: null,
    sentiment: null,
    target_mapping: { status: 'conflicting_identity', target_mapped: false }
  };
  assert.deepEqual(validateTruthEntry(conflict, sampleById), []);
  // 非法 status 拒绝
  const badStatus = { ...conflict, target_mapping: { status: 'same_company' } };
  assert.ok(validateTruthEntry(badStatus, sampleById).some((error) => /target_mapping/.test(error)));
  // conflicting_identity 与 mentioned=false 冲突拒绝
  const contradiction = {
    ...conflict,
    mentioned: false,
    mentions: 0,
    recommendation: false,
    target_mapping: { status: 'conflicting_identity' }
  };
  assert.ok(validateTruthEntry(contradiction, sampleById).some((error) => /target_mapping/.test(error)));
  // 不带 target_mapping 的记录仍然合法（可选字段）
  assert.deepEqual(validateTruthEntry(base, sampleById), []);
});

// ---- issue 015 语义门禁指标（四组合同）：推荐/情绪/排名/target_mapping/grounding ----

const {
  groundingEvidenceStats,
  rankQualityStats,
  recommendationQualityStats,
  semanticFieldOf,
  sentimentQualityStats,
  spread,
  targetMappingQualityStats
} = require('../services/GeoFlashStructuredBenchmarkService');

function confirmedTruth(overrides = {}) {
  return {
    review_status: 'confirmed',
    reviewer: 'tester',
    reviewed_at: '2026-08-06T00:00:00Z',
    recommendation: true,
    rank: 1,
    sentiment: 'positive',
    ...overrides
  };
}

function v5Entry({ sampleId = 'S01', repeat = 1, rec = { status: 'assessed', value: true }, rank = { status: 'assessed', value: 1 }, sent = { status: 'assessed', value: 'positive' }, mapping = { status: 'resolved', target_entity_id: 'E001' }, codes = [], mentions = [], ok = true } = {}) {
  return {
    sample_id: sampleId,
    repeat,
    ok,
    total_tokens: 1000,
    result: {
      brand_mentioned: true,
      analysis_structure: {
        target_semantics: { recommendation: rec, rank, sentiment: sent },
        target_mapping: mapping,
        diagnostics: { error_codes: codes.map((code) => ({ code })) },
        target_mentions: mentions,
        mentions: []
      }
    }
  };
}

function makeTruths(specs) {
  return new Map(specs.map((spec) => [spec.sample_id, confirmedTruth(spec)]));
}

test('015 推荐指标：正例 TP/TN 计分与 F1=1', () => {
  const truths = makeTruths([
    { sample_id: 'S01', recommendation: true },
    { sample_id: 'S02', recommendation: false }
  ]);
  const entries = [
    v5Entry({ sampleId: 'S01', rec: { status: 'assessed', value: true } }),
    v5Entry({ sampleId: 'S02', rec: { status: 'assessed', value: false } })
  ];
  const stats = recommendationQualityStats(entries, truths);
  assert.equal(stats.tp, 1);
  assert.equal(stats.fp, 0);
  assert.equal(stats.fn, 0);
  assert.equal(stats.precision, 1);
  assert.equal(stats.recall, 1);
  assert.equal(stats.f1, 1);
  assert.equal(stats.coverage, 1);
});

test('015 推荐指标：反例检出 FN 与 FP', () => {
  const truths = makeTruths([
    { sample_id: 'S01', recommendation: true },
    { sample_id: 'S02', recommendation: false }
  ]);
  const entries = [
    v5Entry({ sampleId: 'S01', rec: { status: 'assessed', value: false } }),
    v5Entry({ sampleId: 'S02', rec: { status: 'assessed', value: true } })
  ];
  const stats = recommendationQualityStats(entries, truths);
  assert.equal(stats.tp, 0);
  assert.equal(stats.fp, 1);
  assert.equal(stats.fn, 1);
  assert.equal(stats.precision, 0);
  assert.equal(stats.recall, 0);
  assert.equal(stats.f1, 0);
});

test('015 推荐指标：truth recommendation=null（unavailable）不进入评估分母', () => {
  const truths = makeTruths([
    { sample_id: 'S01', recommendation: null },
    { sample_id: 'S02', recommendation: true }
  ]);
  const entries = [
    v5Entry({ sampleId: 'S01', rec: { status: 'assessed', value: false } }),
    v5Entry({ sampleId: 'S02', rec: { status: 'assessed', value: true } })
  ];
  const stats = recommendationQualityStats(entries, truths);
  // S01 的 assessed=false 预测不得因 truth=null 而计 FN——null 是 unavailable 不是 false
  assert.equal(stats.tp, 1);
  assert.equal(stats.fn, 0);
  assert.equal(stats.evaluated_samples, 1);
  assert.deepEqual(stats.sample_ids, ['S02']);
});

test('015 推荐指标：诚实降级（unresolved）降低 coverage、不计错误', () => {
  const truths = makeTruths([
    { sample_id: 'S01', recommendation: true },
    { sample_id: 'S02', recommendation: false }
  ]);
  const entries = [
    v5Entry({ sampleId: 'S01', rec: { status: 'assessed', value: true } }),
    v5Entry({ sampleId: 'S02', rec: { status: 'unresolved', value: null } })
  ];
  const stats = recommendationQualityStats(entries, truths);
  assert.equal(stats.tp, 1);
  assert.equal(stats.fp, 0);
  assert.equal(stats.fn, 0);
  assert.equal(stats.degraded_count, 1);
  assert.equal(stats.coverage, 0.5);
  assert.equal(stats.f1, 1);
});

test('015 推荐指标：防投机——全部 unresolved 时 precision/recall/F1 为 null 且 coverage=0', () => {
  const truths = makeTruths([
    { sample_id: 'S01', recommendation: true },
    { sample_id: 'S02', recommendation: false }
  ]);
  const entries = [
    v5Entry({ sampleId: 'S01', rec: { status: 'unresolved', value: null } }),
    v5Entry({ sampleId: 'S02', rec: { status: 'unresolved', value: null } })
  ];
  const stats = recommendationQualityStats(entries, truths);
  assert.equal(stats.tp, 0);
  assert.equal(stats.degraded_count, 2);
  assert.equal(stats.coverage, 0);
  assert.equal(stats.precision, null);
  assert.equal(stats.recall, null);
  assert.equal(stats.f1, null);
});

test('015 推荐指标：逐次计分并报告方差，不合并重复、不投票', () => {
  const truths = makeTruths([{ sample_id: 'S01', recommendation: true }]);
  const entries = [
    v5Entry({ sampleId: 'S01', repeat: 1, rec: { status: 'assessed', value: true } }),
    v5Entry({ sampleId: 'S01', repeat: 2, rec: { status: 'assessed', value: false } }),
    v5Entry({ sampleId: 'S01', repeat: 3, rec: { status: 'assessed', value: true } })
  ];
  const stats = recommendationQualityStats(entries, truths);
  assert.equal(stats.tp, 2);
  assert.equal(stats.fn, 1);
  assert.equal(stats.per_repeat[1].f1, 1);
  assert.equal(stats.per_repeat[2].f1, 0);
  assert.equal(stats.per_repeat[3].f1, 1);
  assert.equal(stats.repeat_variance.f1.min, 0);
  assert.equal(stats.repeat_variance.f1.max, 1);
  assert.equal(stats.repeat_variance.f1.stddev, 0.5773502691896258);
});

test('015 推荐指标：可评估样本不足时 NOT_EVALUABLE 且不阻塞（状态判定基于唯一真值样本）', () => {
  const truths = makeTruths([{ sample_id: 'S01', recommendation: true }]);
  const stats = recommendationQualityStats([v5Entry({ sampleId: 'S01' })], truths);
  assert.equal(stats.status, 'NOT_EVALUABLE');
  assert.ok(/< 20/.test(stats.status_reason));
  assert.equal(stats.evaluated_samples, 1);
  assert.equal(stats.f1, 1);
});

test('015 情绪指标：准确率与 3×3 混淆矩阵', () => {
  const truths = makeTruths([
    { sample_id: 'S01', sentiment: 'positive' },
    { sample_id: 'S02', sentiment: 'neutral' },
    { sample_id: 'S03', sentiment: 'negative' },
    { sample_id: 'S04', sentiment: 'positive' }
  ]);
  const entries = [
    v5Entry({ sampleId: 'S01', sent: { status: 'assessed', value: 'positive' } }),
    v5Entry({ sampleId: 'S02', sent: { status: 'assessed', value: 'neutral' } }),
    v5Entry({ sampleId: 'S03', sent: { status: 'assessed', value: 'negative' } }),
    v5Entry({ sampleId: 'S04', sent: { status: 'assessed', value: 'neutral' } })
  ];
  const stats = sentimentQualityStats(entries, truths);
  assert.equal(stats.accuracy, 0.75);
  assert.equal(stats.correct, 3);
  assert.equal(stats.confusion_matrix.positive.positive, 1);
  assert.equal(stats.confusion_matrix.positive.neutral, 1);
  assert.equal(stats.confusion_matrix.neutral.neutral, 1);
  assert.equal(stats.confusion_matrix.negative.negative, 1);
});

test('015 情绪指标：truth sentiment=null 不评估；预测降级计诚实降级不计错误', () => {
  const truths = makeTruths([
    { sample_id: 'S01', sentiment: null },
    { sample_id: 'S02', sentiment: 'positive' }
  ]);
  const entries = [
    v5Entry({ sampleId: 'S01', sent: { status: 'assessed', value: 'positive' } }),
    v5Entry({ sampleId: 'S02', sent: { status: 'unresolved', value: null } })
  ];
  const stats = sentimentQualityStats(entries, truths);
  assert.equal(stats.evaluated_samples, 1);
  assert.equal(stats.predictions, 1);
  assert.equal(stats.degraded_count, 1);
  assert.equal(stats.accuracy, null);
  assert.equal(stats.coverage, 0);
});

test('015 排名指标：exact accuracy 只对 rank 非空真值计分', () => {
  const truths = makeTruths([
    { sample_id: 'S01', rank: 1 },
    { sample_id: 'S02', rank: 5 },
    { sample_id: 'S03', rank: null },
    { sample_id: 'S04', rank: 2 }
  ]);
  const entries = [
    v5Entry({ sampleId: 'S01', rank: { status: 'assessed', value: 1 } }),
    v5Entry({ sampleId: 'S02', rank: { status: 'assessed', value: 3 } }),
    v5Entry({ sampleId: 'S03', rank: { status: 'assessed', value: 1 } }),
    v5Entry({ sampleId: 'S04', rank: { status: 'assessed', value: 2 } })
  ];
  const stats = rankQualityStats(entries, truths);
  assert.equal(stats.denominator_samples, 3);
  assert.deepEqual(stats.sample_ids, ['S01', 'S02', 'S04']);
  assert.equal(stats.exact_accuracy, 2 / 3);
  assert.equal(stats.exact_matches, 2);
});

test('015 排名指标：真值不足（<20）NOT_EVALUABLE，仍报告分母与样本 ID，不伪造', () => {
  const truths = makeTruths([{ sample_id: 'S01', rank: 1 }]);
  const stats = rankQualityStats([v5Entry({ sampleId: 'S01' })], truths);
  assert.equal(stats.status, 'NOT_EVALUABLE');
  assert.ok(/不伪造/.test(stats.status_reason));
  assert.equal(stats.denominator_samples, 1);
  assert.deepEqual(stats.sample_ids, ['S01']);
  assert.equal(stats.exact_accuracy, 1);
});

test('015 排名指标：预测 unresolved 计降级并降低 coverage', () => {
  const truths = makeTruths([{ sample_id: 'S01', rank: 1 }]);
  const entries = [
    v5Entry({ sampleId: 'S01', rank: { status: 'assessed', value: 1 } }),
    v5Entry({ sampleId: 'S01', repeat: 2, rank: { status: 'unresolved', value: null } })
  ];
  const stats = rankQualityStats(entries, truths);
  assert.equal(stats.exact_matches, 1);
  assert.equal(stats.degraded_count, 1);
  assert.equal(stats.coverage, 0.5);
});

test('015 target_mapping：状态判断与成功映射分别计分', () => {
  const truths = makeTruths([
    { sample_id: 'S01', target_mapping: { status: 'conflicting_identity', target_mapped: false } }
  ]);
  const wrongStatus = v5Entry({ sampleId: 'S01', mapping: { status: 'resolved', target_entity_id: 'E003' } });
  const rightStatus = v5Entry({ sampleId: 'S01', repeat: 2, mapping: { status: 'conflicting_identity', target_entity_id: null } });
  const stats = targetMappingQualityStats([wrongStatus, rightStatus], truths);
  // 状态判断：1/2 正确
  assert.equal(stats.status_accuracy, 0.5);
  assert.equal(stats.status_evaluated_samples, 2);
  // 成功映射：resolved+非空 id 被 truth.target_mapped=false 判错；非 resolved 判对
  assert.equal(stats.mapped_accuracy, 0.5);
  assert.equal(stats.mapped_evaluated_samples, 2);
});

test('015 target_mapping：无真值样本不评估；预测缺结构计诚实降级', () => {
  const truths = makeTruths([{ sample_id: 'S01' }]);
  const entry = { sample_id: 'S01', repeat: 1, ok: true, result: { brand_mentioned: true, analysis_structure: {} } };
  const stats = targetMappingQualityStats([entry], truths);
  assert.equal(stats.status_evaluated_samples, 0);
  assert.equal(stats.degraded_count, 0);
});

test('015 groundingEvidenceStats：evidence 错误码计数与 mention span 原文校验', () => {
  const text = '你好广拓。';
  const samplesById = new Map([['S01', { response_text: text }]]);
  const good = v5Entry({
    sampleId: 'S01',
    mentions: [{ source_id: 'L001', start: 2, end: 4, surface_form: '广拓' }]
  });
  const bad = v5Entry({
    sampleId: 'S01',
    repeat: 2,
    codes: ['analysis_evidence_reference_invalid'],
    mentions: [{ source_id: 'L001', start: 0, end: 99, surface_form: '不存在' }]
  });
  const stats = groundingEvidenceStats([good, bad], samplesById);
  assert.equal(stats.evidence_invalid_count, 1);
  assert.equal(stats.grounding_error_count, 1);
  assert.equal(stats.evaluated, 2);
});

test('015 spread：逐次分数方差（样本方差 n-1）', () => {
  const result = spread([1, 1, 1]);
  assert.equal(result.mean, 1);
  assert.equal(result.stddev, 0);
  const varied = spread([0, 1]);
  assert.equal(varied.min, 0);
  assert.equal(varied.max, 1);
  assert.equal(varied.mean, 0.5);
  assert.equal(varied.stddev, 0.7071067811865476);
});

test('015 semanticFieldOf：v5 合同字段状态与值提取；无结构返回 null', () => {
  const result = {
    analysis_structure: {
      target_semantics: { recommendation: { status: 'assessed', value: true } }
    }
  };
  assert.deepEqual(semanticFieldOf(result, 'recommendation'), { status: 'assessed', value: true });
  assert.equal(semanticFieldOf(result, 'sentiment'), null);
  assert.equal(semanticFieldOf({}, 'recommendation'), null);
});

test('015 推荐指标：目标未出现（mentioned=false）预测 not_applicable 是合同正常状态，不计降级、不进 coverage 分母', () => {
  const truths = makeTruths([
    { sample_id: 'S01', recommendation: false, mentioned: false },
    { sample_id: 'S02', recommendation: true, mentioned: true }
  ]);
  const entries = [
    v5Entry({ sampleId: 'S01', rec: { status: 'not_applicable', value: null } }),
    v5Entry({ sampleId: 'S02', rec: { status: 'assessed', value: true } })
  ];
  const stats = recommendationQualityStats(entries, truths);
  assert.equal(stats.degraded_count, 0);
  assert.equal(stats.coverage, 1);
  assert.equal(stats.evaluated_samples, 1);
  assert.equal(stats.tp, 1);
  assert.equal(stats.f1, 1);
});

test('015 排名指标：assessed value=null（明确无排名）计错判而非降级', () => {
  const truths = makeTruths([{ sample_id: 'S01', rank: 1 }]);
  const entries = [
    v5Entry({ sampleId: 'S01', rank: { status: 'assessed', value: null } })
  ];
  const stats = rankQualityStats(entries, truths);
  assert.equal(stats.degraded_count, 0);
  assert.equal(stats.coverage, 1);
  assert.equal(stats.exact_accuracy, 0);
  assert.equal(stats.exact_matches, 0);
});
