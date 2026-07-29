import test from 'node:test';
import assert from 'node:assert/strict';
import { getBrandSentimentDisplay, getHistoryAnalysisDisplay } from './historyAnalysisDisplay.cjs';

test('hides analysis metrics for failed prompt history records', () => {
  assert.deepEqual(getHistoryAnalysisDisplay({ status: 'failed' }), {
    sov: '-',
    sovLabel: '回答内竞品提及占比（SOV）',
    metricSemanticsLabel: '-',
    sentimentLabel: '-',
    sentimentColor: 'default',
    sentimentReason: '',
    sentimentRiskTerms: [],
    brandMentionLabel: '-',
    brandMentionColor: 'default'
  });
});

test('formats completed prompt history analysis metrics', () => {
  assert.deepEqual(getHistoryAnalysisDisplay({
    status: 'completed',
    visibilityMetric: {
      share_of_voice: 37.5,
      sentiment: 'negative',
      sentiment_reason: '价格和售后风险',
      sentiment_risk_terms: ['价格高', '售后'],
      brand_mentioned: true
    }
  }), {
    sov: '37.50%',
    sovLabel: '声量占比（SOV）',
    metricSemanticsLabel: '历史竞品配置口径',
    sentimentLabel: '负向',
    sentimentColor: 'red',
    sentimentReason: '价格和售后风险',
    sentimentRiskTerms: ['价格高', '售后'],
    brandMentionLabel: '已提及',
    brandMentionColor: 'green'
  });
});

test('does not show sentiment when the brand was not mentioned', () => {
  assert.deepEqual(getHistoryAnalysisDisplay({
    status: 'completed',
    visibilityMetric: {
      share_of_voice: 0,
      sentiment: 'neutral',
      brand_mentioned: false
    }
  }), {
    sov: '0.00%',
    sovLabel: '声量占比（SOV）',
    metricSemanticsLabel: '历史竞品配置口径',
    sentimentLabel: '-',
    sentimentColor: 'default',
    sentimentReason: '',
    sentimentRiskTerms: [],
    brandMentionLabel: '未提及',
    brandMentionColor: 'default'
  });
});

test('formats current prompt history with versioned numerator and denominator', () => {
  assert.deepEqual(getHistoryAnalysisDisplay({
    status: 'completed',
    visibilityMetric: {
      metric_semantics_version: 'contextual_competitor_mentions_sov_v1',
      answer_competitor_share: 50,
      sov_numerator: 2,
      sov_denominator: 4,
      sentiment: 'positive',
      brand_mentioned: true
    }
  }), {
    sov: '50.00%（2 / 4）',
    sovLabel: '回答内竞品提及占比（SOV）',
    metricSemanticsLabel: '当前回答级竞品提及口径',
    sentimentLabel: '正向',
    sentimentColor: 'green',
    sentimentReason: '',
    sentimentRiskTerms: [],
    brandMentionLabel: '已提及',
    brandMentionColor: 'green'
  });
});

test('formats current zero-over-zero SOV as N/A instead of zero', () => {
  const display = getHistoryAnalysisDisplay({
    status: 'completed',
    visibilityMetric: {
      metric_semantics_version: 'contextual_competitor_mentions_sov_v1',
      answer_competitor_share: null,
      sov_numerator: 0,
      sov_denominator: 0,
      brand_mentioned: false
    }
  });

  assert.equal(display.sov, 'N/A');
  assert.equal(display.metricSemanticsLabel, '当前回答级竞品提及口径');
});

test('formats brand sentiment only for mentioned metrics', () => {
  assert.deepEqual(getBrandSentimentDisplay({ sentiment: 'positive', brand_mentioned: true }), {
    sentimentLabel: '正向',
    sentimentColor: 'green',
    sentimentReason: '',
    sentimentRiskTerms: []
  });
  assert.deepEqual(getBrandSentimentDisplay({ sentiment: 'negative', brand_mentioned: false }), {
    sentimentLabel: '-',
    sentimentColor: 'default',
    sentimentReason: '',
    sentimentRiskTerms: []
  });
});

test('hides provider details from stored sentiment display fields', () => {
  const display = getBrandSentimentDisplay({
    sentiment: 'negative',
    brand_mentioned: true,
    sentiment_reason: 'DeepSeek API 判断价格和售后风险，需要继续观察',
    sentiment_risk_terms: ['DeepSeek API 价格高', 'API Key 配置异常', '售后慢']
  });

  assert.equal(display.sentimentLabel, '负向');
  assert.equal(display.sentimentReason, '判断价格和售后风险');
  assert.deepEqual(display.sentimentRiskTerms, ['价格高', '配置异常', '售后慢']);
  assert.doesNotMatch(`${display.sentimentReason} ${display.sentimentRiskTerms.join(' ')}`, /DeepSeek|API|Key/i);
});
