const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OFFICIAL_BASE,
  evaluateEvidence,
  extractRecordId,
  toEvidence
} = require('../scripts/geo010Acceptance');

function validEntry(overrides = {}) {
  return {
    id: 1,
    status: 'completed',
    execution_mode: 'full_monitoring',
    analysis_contract_version: 'ai_structured_v5',
    metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
    analysis_method: 'ai_structured_v5',
    analysis_platform: 'deepseek',
    analysis_model: 'deepseek-v4-flash',
    ...overrides
  };
}

test('production acceptance is pinned to the only supported HTTPS entry', () => {
  assert.equal(OFFICIAL_BASE, 'https://insight.guangtuo.com/api');
});

test('extracts current single and question-set response record ids', () => {
  assert.equal(extractRecordId({ data: { record_ids: [11] } }), 11);
  assert.equal(extractRecordId({ data: { results: [{ record_id: 12 }] } }), 12);
  assert.equal(extractRecordId({ data: {} }), null);
});

test('requires all four named entries instead of accepting a partial sample', () => {
  const entries = {
    single_question: validEntry(),
    question_set: validEntry(),
    automatic_monitoring: validEntry(),
    analysis_only: validEntry({ execution_mode: 'analysis_only' })
  };
  assert.equal(evaluateEvidence(entries, true).pass, true);
  delete entries.automatic_monitoring;
  assert.equal(evaluateEvidence(entries, true).pass, false);
});

test('rejects Pro, v4, non-scoped semantics and missing historical-read evidence', () => {
  const base = {
    single_question: validEntry(),
    question_set: validEntry(),
    automatic_monitoring: validEntry(),
    analysis_only: validEntry({ execution_mode: 'analysis_only' })
  };
  assert.equal(evaluateEvidence({ ...base, single_question: validEntry({ analysis_model: 'deepseek-v4-pro' }) }, true).pass, false);
  assert.equal(evaluateEvidence({ ...base, question_set: validEntry({ analysis_contract_version: 'ai_structured_v4' }) }, true).pass, false);
  assert.equal(evaluateEvidence({ ...base, automatic_monitoring: validEntry({ metric_semantics_version: 'contextual_competitor_mentions_sov_v1' }) }, true).pass, false);
  assert.equal(evaluateEvidence(base, false).pass, false);
});

test('builds evidence from the record and its persisted visibility metric', () => {
  const evidence = toEvidence({
    id: 8,
    status: 'completed',
    execution_mode: 'analysis_only',
    analysis_contract_version: 'ai_structured_v5',
    metric_semantics_version: 'wrong-row-value',
    visibilityMetric: {
      metric_semantics_version: 'contextual_competitor_mentions_sov_v2_scoped',
      analysis_method: 'ai_structured_v5',
      analysis_platform: 'deepseek',
      analysis_model: 'deepseek-v4-flash'
    }
  });
  assert.deepEqual(evidence, validEntry({ id: 8, execution_mode: 'analysis_only' }));
});
