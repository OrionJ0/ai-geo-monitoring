const test = require('node:test');
const assert = require('node:assert/strict');

const { summarize } = require('../services/QuestionSetRunService');
const { SCOPED_METRIC_SEMANTICS, V5_ANALYSIS_CONTRACT } = require('../services/GeoMetricSemanticsService');

function v5Row({ mentioned = true, recStatus = 'assessed', recValue = true, rankStatus = 'assessed', rankValue = 1, sovDenominator = 2 }) {
  return {
    status: 'completed',
    has_metrics: true,
    capture_quality: {},
    metric_semantics_version: SCOPED_METRIC_SEMANTICS,
    analysis_method: V5_ANALYSIS_CONTRACT,
    brand_mentioned: mentioned,
    analysis_structure: {
      target_fact: { status: 'complete', brand_mentioned: mentioned, brand_mentions: 1, mentions: [] },
      target_semantics: {
        recommendation: { status: recStatus, value: recValue, evidence_source_ids: [] },
        rank: { status: rankStatus, value: rankValue, evidence_source_ids: [] },
        sentiment: { status: 'assessed', value: 'positive', evidence_source_ids: [] }
      },
      sov: { status: 'observed_only', scope: 'open_discovery', completeness: 'not_proven', numerator: 1, denominator: sovDenominator, value: sovDenominator > 0 ? 50 : null }
    }
  };
}

test('问题集 v5 统计只把 recommendation/rank 的 assessed 记录纳入对应分母', () => {
  const rows = [
    v5Row({ recStatus: 'assessed', recValue: true, rankStatus: 'assessed', rankValue: 1 }),
    v5Row({ recStatus: 'assessed', recValue: false, rankStatus: 'assessed', rankValue: null }),
    v5Row({ recStatus: 'unresolved', rankStatus: 'unresolved' })
  ];
  const summary = summarize(rows);
  assert.equal(summary.recommendation_assessed_answers, 2);
  assert.equal(summary.recommended_answers, 1);
  assert.equal(summary.ranked_answers, 1);
  assert.equal(summary.brand_mentioned_answers, 3);
});

test('问题集 v5 统计：target_fact 未完成或 brand_mentioned=false 不计为提及', () => {
  const rows = [
    v5Row({ mentioned: true }),
    v5Row({ mentioned: false }),
    {
      ...v5Row({ mentioned: true }),
      analysis_structure: {
        ...v5Row({ mentioned: true }).analysis_structure,
        target_fact: { status: 'complete', brand_mentioned: false, brand_mentions: 0, mentions: [] }
      }
    }
  ];
  const summary = summarize(rows);
  assert.equal(summary.brand_mentioned_answers, 1);
});

test('问题集 v5 统计：sov 只统计 observed_only 且分母大于 0 的 scoped SOV', () => {
  const rows = [
    v5Row({ sovDenominator: 2 }),
    v5Row({ sovDenominator: 0 })
  ];
  const summary = summarize(rows);
  assert.equal(summary.sov_calculable_answers, 1);
  assert.equal(summary.sov_summary.metric_semantics_version, SCOPED_METRIC_SEMANTICS);
  assert.equal(summary.sov_summary.average, 50);
});
