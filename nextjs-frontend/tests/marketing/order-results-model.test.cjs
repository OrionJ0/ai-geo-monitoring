const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ORDER_RESULTS_DEMO_ORDERS,
  ORDER_RESULTS_DEMO_RANGE
} = require('../../src/fixtures/orderResults.fixture.cjs');
const {
  deriveOrderResultsView,
  summarizeOrders
} = require('../../src/utils/orderResults.cjs');

function filters(overrides = {}) {
  return {
    from: ORDER_RESULTS_DEMO_RANGE.from,
    to: ORDER_RESULTS_DEMO_RANGE.to,
    source: 'ALL',
    status: 'ALL',
    query: '',
    sortKey: 'signedDate',
    sortOrder: 'desc',
    page: 1,
    pageSize: 10,
    metric: 'count',
    ...overrides
  };
}

test('derives the demo summary and source percentages from the same filtered rows', () => {
  const view = deriveOrderResultsView(ORDER_RESULTS_DEMO_ORDERS, filters());
  assert.deepEqual(view.summary, {
    totalCount: 12,
    signedAmountYuan: '1286000',
    trustedCount: 9,
    unresolvedCount: 3,
    associationRate: '75.0%'
  });
  assert.deepEqual(
    view.sourceOverview.map(({ key, count, percentageLabel }) => ({
      key,
      count,
      percentageLabel
    })),
    [
      { key: 'BAIDU_PAID', count: 5, percentageLabel: '41.7%' },
      { key: 'ORGANIC_SEARCH', count: 3, percentageLabel: '25.0%' },
      { key: 'DIRECT', count: 1, percentageLabel: '8.3%' },
      { key: 'UNKNOWN', count: 1, percentageLabel: '8.3%' },
      { key: 'PENDING', count: 2, percentageLabel: '16.7%' }
    ]
  );
  assert.equal(
    Math.round(view.sourceOverview.reduce((sum, item) => sum + item.percentage, 0)),
    100
  );
});

test('keeps summary and donut denominators independent from pagination', () => {
  const first = deriveOrderResultsView(ORDER_RESULTS_DEMO_ORDERS, filters({ page: 1 }));
  const second = deriveOrderResultsView(ORDER_RESULTS_DEMO_ORDERS, filters({ page: 2 }));
  assert.equal(first.pageRows.length, 10);
  assert.equal(second.pageRows.length, 2);
  assert.deepEqual(first.summary, second.summary);
  assert.deepEqual(first.sourceOverview, second.sourceOverview);
});

test('applies source, status and search to summary, trend and rows together', () => {
  const view = deriveOrderResultsView(ORDER_RESULTS_DEMO_ORDERS, filters({
    source: 'BAIDU_PAID',
    status: 'TRUSTED',
    query: '园区'
  }));
  assert.equal(view.summary.totalCount, 1);
  assert.equal(view.summary.signedAmountYuan, '320000');
  assert.deepEqual(view.sourceOverview.map((item) => item.key), ['BAIDU_PAID']);
  assert.equal(
    view.trend.current.reduce((sum, row) => sum + BigInt(row.value), 0n),
    1n
  );
});

test('counts orders and sums signed amounts independently', () => {
  const summary = summarizeOrders([
    { signedAmountYuan: '0', attributionStatus: 'TRUSTED' },
    { signedAmountYuan: '90071992547409931235', attributionStatus: 'PENDING' }
  ]);
  assert.equal(summary.totalCount, 2);
  assert.equal(summary.signedAmountYuan, '90071992547409931235');
  assert.equal(summary.trustedCount, 1);
  assert.equal(summary.unresolvedCount, 1);
});

test('each fixture order has at most one primary consultation and no fake sales URL', () => {
  for (const order of ORDER_RESULTS_DEMO_ORDERS) {
    assert.ok(order.primaryConsultation === null || !Array.isArray(order.primaryConsultation));
    assert.equal(order.salesSystemRecordUrl, null);
    if (order.attributionStatus === 'PENDING') {
      assert.equal(order.primaryConsultation, null);
      assert.equal(order.sourceKey, null);
    }
  }
});
