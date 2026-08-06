const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LEGACY_CONFIGURED_SOV_V1,
  isAnswerLevelSovSemantics,
  isCurrentReportSnapshot,
  getSovPresentationTitle,
  formatAnswerLevelSov
} = require('./metricSemantics.cjs');

const V1 = 'contextual_competitor_mentions_sov_v1';
const V2 = 'contextual_competitor_mentions_sov_v2_scoped';

test('共享语义常量冻结迁移后的 legacy 报告版本', () => {
  assert.equal(LEGACY_CONFIGURED_SOV_V1, 'configured_competitor_sov_v1');
});

test('v1 与 v2 scoped 都属于回答级 SOV，但旧配置口径不属于', () => {
  assert.equal(isAnswerLevelSovSemantics(V1), true);
  assert.equal(isAnswerLevelSovSemantics(V2), true);
  assert.equal(isAnswerLevelSovSemantics('configured_competitor_sov_v1'), false);
});

test('v2 observed_only 按有效分母显示，0/0 保持不可计算', () => {
  assert.equal(formatAnswerLevelSov({
    status: 'observed_only',
    value: 40,
    numerator: 2,
    denominator: 5
  }), '40%（2 / 5）');
  assert.equal(formatAnswerLevelSov({
    status: 'observed_only',
    value: null,
    numerator: 0,
    denominator: 0
  }), '—（不可计算：0 / 0）');
});

test('报告与 summary 必须使用同一回答级版本才进入当前报告分支', () => {
  assert.equal(isCurrentReportSnapshot(V1, V1), true);
  assert.equal(isCurrentReportSnapshot(V2, V2), true);
  assert.equal(isCurrentReportSnapshot(V1, V2), false);
  assert.equal(isCurrentReportSnapshot(V2, 'configured_competitor_sov_v1'), false);
});

test('v2 或显式开放发现元数据必须展示完整范围限定语', () => {
  const expected = '开放发现 SOV（仅基于本次已发现实体，不代表完整市场）';
  assert.equal(getSovPresentationTitle({ metric_semantics_version: V2 }), expected);
  assert.equal(getSovPresentationTitle({
    kind: 'observed_competitor_mentions',
    scope: 'open_discovery',
    completeness: 'not_proven'
  }), expected);
  assert.equal(getSovPresentationTitle({ metric_semantics_version: V1 }), '回答内竞品提及占比（SOV）');
});
