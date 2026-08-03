function groupDigits(value) {
  if (value == null) return '—';
  return BigInt(value).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

function signed(value, suffix = '') {
  if (value == null) return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const sign = number > 0 ? '+' : '';
  return `${sign}${number.toFixed(1)}${suffix}`;
}

function formatPercentChange(value) {
  return signed(value, '%');
}

function formatPointChange(value) {
  return signed(value, ' 个百分点');
}

function formatDuration(seconds) {
  if (seconds == null) return '—';
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric) || numeric < 0) return '—';
  const whole = Math.round(numeric);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function formatDurationChange(seconds) {
  if (seconds == null) return '—';
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric)) return '—';
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  return `${sign}${formatDuration(Math.abs(numeric))}`;
}

function formatPagesChange(value) {
  if (value == null) return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const sign = number > 0 ? '+' : '';
  return `${sign}${number.toFixed(2)} 页`;
}

function formatRate(value) {
  if (value == null) return '—';
  return `${Number(value).toFixed(1)}%`;
}

function formatPages(value) {
  if (value == null) return '—';
  return Number(value).toFixed(2);
}

function formatTrendChange(current, previous, metric) {
  if (current == null || previous == null) return '—';
  const difference = Number(current) - Number(previous);
  if (metric === 'bounceRate') return formatPointChange(difference);
  if (metric === 'averageVisitTime') return formatDurationChange(difference);
  if (metric === 'averageVisitPages') return formatPagesChange(difference);
  if (Number(previous) === 0) return '—';
  return formatPercentChange((difference / Number(previous)) * 100);
}

module.exports = {
  formatDuration,
  formatDurationChange,
  formatPages,
  formatPagesChange,
  formatPercentChange,
  formatPointChange,
  formatRate,
  formatTrendChange,
  groupDigits
};
