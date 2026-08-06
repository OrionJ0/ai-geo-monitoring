const test = require('node:test');
const assert = require('node:assert/strict');

const GeoMetricSemanticsService = require('../services/GeoMetricSemanticsService');

test('wraps a stored legacy SOV without inventing mention counts', () => {
  const result = GeoMetricSemanticsService.presentSov({
    metric_semantics_version: 'configured_competitor_sov_v1',
    share_of_voice: 37.5
  });

  assert.deepEqual(result, {
    metric_semantics_version: 'configured_competitor_sov_v1',
    kind: 'legacy_configured_competitors',
    status: 'calculated',
    value: 37.5,
    numerator: null,
    denominator: null
  });
});

test('presents a current answer-level SOV with its actual numerator and denominator', () => {
  const result = GeoMetricSemanticsService.presentSov({
    metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
    answer_competitor_share: 50,
    sov_numerator: 2,
    sov_denominator: 4
  });

  assert.deepEqual(result, {
    metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
    kind: 'contextual_competitor_mentions',
    status: 'calculated',
    value: 50,
    numerator: 2,
    denominator: 4
  });
});

test('presents zero-over-zero current SOV as not applicable instead of zero', () => {
  const result = GeoMetricSemanticsService.presentSov({
    metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
    answer_competitor_share: null,
    sov_numerator: 0,
    sov_denominator: 0
  });

  assert.deepEqual(result, {
    metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
    kind: 'contextual_competitor_mentions',
    status: 'not_applicable',
    value: null,
    numerator: 0,
    denominator: 0
  });
});

test('rejects a current SOV value that does not match its numerator and denominator', () => {
  assert.throws(
    () => GeoMetricSemanticsService.presentSov({
      metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
      answer_competitor_share: 90,
      sov_numerator: 1,
      sov_denominator: 2
    }),
    (error) => error.code === 'metric_semantics_mismatch'
  );
});
