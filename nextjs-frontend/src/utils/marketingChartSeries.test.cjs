const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRelativeSeries } = require('./marketingChartSeries.cjs');

test('relative chart series preserves exact source strings', () => {
  const result = buildRelativeSeries([
    { date: '2026-07-29', value: '900719925474099312345' },
    { date: '2026-07-30', value: '7' }
  ]);

  assert.equal(result[0].exactValue, '900719925474099312345');
  assert.equal(result[0].relativePercent, '100%');
  assert.match(result[1].relativePercent, /%$/u);
});

test('relative chart series keeps missing values distinct from zero', () => {
  const result = buildRelativeSeries([
    { date: '2026-07-29', value: null },
    { date: '2026-07-30', value: '0' }
  ]);

  assert.deepEqual(result, [
    {
      date: '2026-07-29',
      exactValue: null,
      relativePercent: null
    },
    {
      date: '2026-07-30',
      exactValue: '0',
      relativePercent: '0%'
    }
  ]);
});

test('relative chart series rejects non-canonical numeric inputs', () => {
  assert.throws(
    () => buildRelativeSeries([{ date: '2026-07-30', value: 12 }]),
    /十进制字符串/u
  );
  assert.throws(
    () => buildRelativeSeries([{ date: '2026-07-30', value: '1e3' }]),
    /十进制字符串/u
  );
});
