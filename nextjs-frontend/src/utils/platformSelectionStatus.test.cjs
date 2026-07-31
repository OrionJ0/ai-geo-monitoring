const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getUnavailablePlatformLabel
} = require('./platformSelectionStatus.cjs');

test('maps global platform configuration failures to actionable labels', () => {
  assert.equal(getUnavailablePlatformLabel('disabled'), '已停用');
  assert.equal(getUnavailablePlatformLabel('missing_api_key'), '管理员尚未配置');
  assert.equal(getUnavailablePlatformLabel('unknown'), '当前不可用');
});
