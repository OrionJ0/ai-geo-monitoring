/* eslint-disable @typescript-eslint/no-require-imports */
const { boundedPercent, requireDecimalText } = require('./marketingValues.cjs');

function normalizePercent(value) {
  return value.replace(/\.00%$/u, '%');
}

function buildRelativeSeries(rows) {
  const normalized = rows.map((row) => ({
    date: String(row.date || ''),
    exactValue: row.value == null ? null : requireDecimalText(row.value)
  }));
  const maximum = normalized.reduce((largest, row) => {
    if (row.exactValue == null) return largest;
    return BigInt(row.exactValue) > BigInt(largest) ? row.exactValue : largest;
  }, '0');
  return normalized.map((row) => ({
    ...row,
    relativePercent: row.exactValue == null
      ? null
      : normalizePercent(boundedPercent(row.exactValue, maximum))
  }));
}

module.exports = {
  buildRelativeSeries
};
