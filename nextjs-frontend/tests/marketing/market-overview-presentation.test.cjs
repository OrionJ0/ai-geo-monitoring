const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPeriodRows,
  buildDailyChannelComparison,
  calculateRate,
  completeAdTrendWithinCoverage,
  divideScaledAmount,
  formatRatioChange,
  summarizeMetric
} = require('../../src/utils/marketOverviewPresentation.cjs');

const rows = [
  { date: '2026-07-01', clicks: '10', costAmountScaled: '10000000' },
  { date: '2026-07-02', clicks: '20', costAmountScaled: '20000000' },
  { date: '2026-07-03', clicks: '30', costAmountScaled: '30000000' },
  { date: '2026-07-04', clicks: '40', costAmountScaled: '40000000' }
];

test('period builder aligns an equal adjacent previous period without inventing rows', () => {
  const result = buildPeriodRows(rows, '2026-07-03', '2026-07-04');

  assert.deepEqual(result.current.map((row) => row.date), [
    '2026-07-03',
    '2026-07-04'
  ]);
  assert.deepEqual(result.previous.map((row) => row.date), [
    '2026-07-01',
    '2026-07-02'
  ]);
  assert.equal(result.previousFrom, '2026-07-01');
  assert.equal(result.previousTo, '2026-07-02');
});

test('verified ad coverage fills only omitted in-coverage days with exact zero', () => {
  const completed = completeAdTrendWithinCoverage([
    {
      date: '2026-07-02',
      costAmountScaled: '1200000',
      impressions: '30',
      clicks: '2'
    }
  ], {
    from: '2026-07-01',
    to: '2026-07-03'
  });

  assert.deepEqual(completed, [
    {
      date: '2026-07-01',
      costAmountScaled: '0',
      impressions: '0',
      clicks: '0'
    },
    {
      date: '2026-07-02',
      costAmountScaled: '1200000',
      impressions: '30',
      clicks: '2'
    },
    {
      date: '2026-07-03',
      costAmountScaled: '0',
      impressions: '0',
      clicks: '0'
    }
  ]);
  assert.deepEqual(
    completeAdTrendWithinCoverage([], {
      from: '2026-07-02',
      to: '2026-07-03'
    }).map((row) => row.date),
    ['2026-07-02', '2026-07-03']
  );
  assert.throws(
    () => completeAdTrendWithinCoverage([
      {
        date: '2026-06-30',
        costAmountScaled: '1',
        impressions: '1',
        clicks: '1'
      }
    ], { from: '2026-07-01', to: '2026-07-03' }),
    /广告趋势日期超出已验证覆盖范围/u
  );
});

test('all-channel comparison keeps total first and sorts exact channel visits', () => {
  const rows = buildDailyChannelComparison(
    [{ date: '2026-07-01', current: '18014398509481988' }],
    [
      {
        sourceKey: 'DIRECT',
        sourceLabel: '直接访问',
        trend: [{ date: '2026-07-01', visits: '9007199254740993' }]
      },
      {
        sourceKey: 'BAIDU_SEARCH',
        sourceLabel: '百度搜索',
        trend: [{ date: '2026-07-01', visits: '9007199254740995' }]
      },
      {
        sourceKey: 'BING_SEARCH',
        sourceLabel: '必应搜索',
        trend: [{ date: '2026-07-01', visits: '1' }]
      }
    ],
    new Set(['BING_SEARCH'])
  );

  assert.deepEqual(rows.map((row) => [row.sourceKey, row.value]), [
    ['ALL', '18014398509481988'],
    ['BAIDU_SEARCH', '9007199254740995'],
    ['DIRECT', '9007199254740993']
  ]);
  assert.equal(rows[0].isTotal, true);
  assert.ok(rows.slice(1).every((row) => row.isTotal === false));
});

test('exact ratios and summaries use decimal strings beyond safe integer range', () => {
  assert.equal(
    calculateRate('90071992547409931235', '9007199254740993123500', 2),
    '1.00%'
  );
  assert.equal(divideScaledAmount('12345678', '2', 6, 'CNY'), '¥6.17');

  const summary = summarizeMetric([
    { date: '2026-07-01', value: '90071992547409931235' },
    { date: '2026-07-02', value: '5' }
  ]);
  assert.equal(summary.total, '90071992547409931240');
  assert.equal(summary.averageTenths, '45035996273704965620.0');
  assert.deepEqual(summary.peak, {
    date: '2026-07-01',
    value: '90071992547409931235'
  });
  assert.ok(summary.coordinates.every((value) => value >= 0 && value <= 100));
});

test('unsupported or zero-denominator conversions stay missing', () => {
  assert.equal(calculateRate(null, '10', 2), null);
  assert.equal(calculateRate('2', '0', 2), null);
  assert.equal(divideScaledAmount('1000000', null, 6, 'CNY'), null);
});

test('ratio change compares two exact fractions without floating point conversion', () => {
  assert.equal(
    formatRatioChange('12000000', '4', '10000000', '5', 1),
    '+50.0%'
  );
  assert.equal(formatRatioChange('1', '0', '1', '1', 1), null);
});
