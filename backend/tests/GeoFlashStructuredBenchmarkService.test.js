const test = require('node:test');
const assert = require('node:assert/strict');

const {
  competitionJaccard,
  metricSignature,
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
