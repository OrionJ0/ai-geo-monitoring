const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildSourcePartition
} = require('../../modules/marketing/services/BaiduTongjiService');

function rows(values) {
  return values.map((current, index) => ({
    sourceKey: `SOURCE_${index + 1}`,
    summary: { current }
  }));
}

test('来源 visits 分区区分 COMPLETE、83/82 PARTIAL、缺失与总量不可用', () => {
  assert.deepEqual(buildSourcePartition('82', rows([
    '5', '20', '25', '10', '7', '8', '7'
  ])), {
    metric: 'visits',
    state: 'COMPLETE',
    totalVisits: '82',
    classifiedVisits: '82',
    unclassifiedVisits: '0',
    reasonCode: null
  });
  assert.deepEqual(buildSourcePartition('83', rows([
    '5', '20', '25', '10', '7', '8', '7'
  ])), {
    metric: 'visits',
    state: 'PARTIAL',
    totalVisits: '83',
    classifiedVisits: '82',
    unclassifiedVisits: '1',
    reasonCode: 'SOURCE_COVERAGE_INCOMPLETE'
  });
  assert.deepEqual(buildSourcePartition('83', rows([
    null, '20', '25', '10', '7', '8', '7'
  ])), {
    metric: 'visits',
    state: 'PARTIAL',
    totalVisits: '83',
    classifiedVisits: '77',
    unclassifiedVisits: '6',
    reasonCode: 'SOURCE_METRIC_MISSING'
  });
  assert.deepEqual(buildSourcePartition(null, rows([
    '5', '20', '25', '10', '7', '8', '7'
  ])), {
    metric: 'visits',
    state: 'PARTIAL',
    totalVisits: null,
    classifiedVisits: '82',
    unclassifiedVisits: null,
    reasonCode: 'SOURCE_TOTAL_UNAVAILABLE'
  });
  assert.deepEqual(buildSourcePartition('0', rows([
    '0', '0', '0', '0', '0', '0', '0'
  ])).state, 'COMPLETE');
});

test('不可能的来源 visits 分区使用稳定错误拒绝', () => {
  for (const [total, values] of [
    ['81', ['5', '20', '25', '10', '7', '8', '7']],
    ['83', ['-1', '20', '25', '10', '7', '8', '7']],
    ['83', ['1.5', '20', '25', '10', '7', '8', '7']],
    ['invalid', ['5', '20', '25', '10', '7', '8', '7']]
  ]) {
    assert.throws(
      () => buildSourcePartition(total, rows(values)),
      { code: 'TONGJI_SOURCE_PARTITION_INVALID', status: 502 }
    );
  }
});
