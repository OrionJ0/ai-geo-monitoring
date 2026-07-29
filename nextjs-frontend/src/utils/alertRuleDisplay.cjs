function thresholdUnit(type) {
  if (type === 'task_failure') return '条';
  if (type === 'source_drop') return '个';
  if (type === 'competitor_ahead') return '次';
  return '%';
}

function isCountThreshold(type) {
  return type === 'task_failure' || type === 'source_drop' || type === 'competitor_ahead';
}

function normalizeThresholdInput(type, value) {
  const numeric = Number(value || 0);
  if (type === 'competitor_ahead') return Math.max(1, Math.min(1000, Math.ceil(numeric)));
  if (isCountThreshold(type)) return Math.max(1, Math.ceil(numeric));
  if (type === 'negative_sentiment') return Math.max(1, Math.min(100, numeric));
  return Math.max(0, Math.min(100, numeric));
}

function defaultThresholdForType(type) {
  return normalizeThresholdInput(type, 10);
}

function thresholdMin(type) {
  return isCountThreshold(type) || type === 'negative_sentiment' ? 1 : 0;
}

module.exports = {
  defaultThresholdForType,
  isCountThreshold,
  normalizeThresholdInput,
  thresholdMin,
  thresholdUnit
};
