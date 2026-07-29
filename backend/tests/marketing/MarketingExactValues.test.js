const assert = require('node:assert/strict');
const test = require('node:test');

const {
  addDecimalText,
  normalizeMetricText
} = require('../../modules/marketing/domain/exactValues');
const {
  fixedShanghaiWindow
} = require('../../modules/marketing/domain/syncWindow');
const {
  normalizeReportRow
} = require('../../modules/marketing/services/MarketingRefreshService');

test('exact metric values remain decimal strings beyond Number safe range', () => {
  assert.equal(
    addDecimalText('900719925474099312345', '7'),
    '900719925474099312352'
  );
  assert.equal(normalizeMetricText('00042'), '42');
  assert.equal(normalizeMetricText('0'), '0');
  assert.throws(() => normalizeMetricText(42), {
    code: 'MARKETING_EXACT_VALUE_INVALID'
  });
  assert.throws(() => normalizeMetricText('1e3'), {
    code: 'MARKETING_EXACT_VALUE_INVALID'
  });
});

test('sync window is exactly 30 Asia Shanghai calendar days', () => {
  const window = fixedShanghaiWindow(Date.parse('2026-07-29T16:30:00.000Z'));
  assert.deepEqual(window, {
    from: '2026-07-01',
    to: '2026-07-30'
  });
});

test('report normalization rejects calendar dates that JavaScript normalizes', () => {
  assert.throws(
    () => normalizeReportRow({
      accountId: 'account-1',
      campaignId: 'campaign-1',
      campaignName: '计划',
      metricDate: '2026-02-30',
      impressions: '1',
      clicks: '1',
      costAmountScaled: '1'
    }, {
      id: 'binding-1',
      external_account_id: 'account-1'
    }, {
      from: '2026-02-01',
      to: '2026-03-02'
    }),
    { code: 'REPORT_ROW_INVALID' }
  );
});
