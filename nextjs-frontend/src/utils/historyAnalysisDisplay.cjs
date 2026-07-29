function getBrandSentimentDisplay(metric = {}) {
  if (!metric.brand_mentioned) {
    return { sentimentLabel: '-', sentimentColor: 'default', sentimentReason: '', sentimentRiskTerms: [] };
  }

  const sentiment = metric.sentiment || 'neutral';
  const sentimentMap = {
    positive: { label: '正向', color: 'green' },
    negative: { label: '负向', color: 'red' },
    neutral: { label: '中性', color: 'default' }
  };
  const sentimentDisplay = sentimentMap[sentiment] || sentimentMap.neutral;
  const riskTerms = Array.isArray(metric.sentiment_risk_terms)
    ? metric.sentiment_risk_terms.map((item) => sanitizeSentimentRiskTerm(item)).filter(Boolean)
    : [];
  return {
    sentimentLabel: sentimentDisplay.label,
    sentimentColor: sentimentDisplay.color,
    sentimentReason: sanitizeSentimentReason(metric.sentiment_reason),
    sentimentRiskTerms: riskTerms
  };
}

function sanitizeSentimentText(value) {
  return String(value || '')
    .replace(/DeepSeek/ig, '')
    .replace(/API\s*Key/ig, '')
    .replace(/API/ig, '')
    .replace(/\s+/g, '')
    .trim();
}

function sanitizeSentimentReason(value) {
  const cleaned = sanitizeSentimentText(value).split(/[，,；;。.!！?？]/)[0] || '';
  return cleaned.slice(0, 20);
}

function sanitizeSentimentRiskTerm(value) {
  return sanitizeSentimentText(value).slice(0, 14);
}

function getHistoryAnalysisDisplay(row = {}) {
  if (row.status !== 'completed') {
    return {
      sov: '-',
      sovLabel: '回答内竞品提及占比（SOV）',
      metricSemanticsLabel: '-',
      sentimentLabel: '-',
      sentimentColor: 'default',
      sentimentReason: '',
      sentimentRiskTerms: [],
      brandMentionLabel: '-',
      brandMentionColor: 'default'
    };
  }

  const metric = row.visibilityMetric || {};
  const sentimentDisplay = getBrandSentimentDisplay(metric);
  const mentioned = !!metric.brand_mentioned;
  const isCurrent = metric.metric_semantics_version === 'contextual_competitor_mentions_sov_v1';
  const denominator = Number(metric.sov_denominator);
  const numerator = Number(metric.sov_numerator);
  const currentValue = metric.answer_competitor_share;
  const sov = isCurrent
    ? (Number.isInteger(denominator) && denominator > 0
        && Number.isInteger(numerator) && numerator >= 0
        && currentValue !== null && currentValue !== undefined
        && Number.isFinite(Number(currentValue))
      ? `${Number(currentValue).toFixed(2)}%（${numerator} / ${denominator}）`
      : 'N/A')
    : (metric.share_of_voice !== null
        && metric.share_of_voice !== undefined
        && Number.isFinite(Number(metric.share_of_voice))
      ? `${Number(metric.share_of_voice).toFixed(2)}%`
      : 'N/A');
  return {
    sov,
    sovLabel: isCurrent ? '回答内竞品提及占比（SOV）' : '声量占比（SOV）',
    metricSemanticsLabel: isCurrent ? '当前回答级竞品提及口径' : '历史竞品配置口径',
    sentimentLabel: sentimentDisplay.sentimentLabel,
    sentimentColor: sentimentDisplay.sentimentColor,
    sentimentReason: sentimentDisplay.sentimentReason,
    sentimentRiskTerms: sentimentDisplay.sentimentRiskTerms,
    brandMentionLabel: mentioned ? '已提及' : '未提及',
    brandMentionColor: mentioned ? 'green' : 'default'
  };
}

module.exports = { getBrandSentimentDisplay, getHistoryAnalysisDisplay };
