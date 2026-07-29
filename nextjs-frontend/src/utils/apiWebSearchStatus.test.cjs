const test = require('node:test');
const assert = require('node:assert/strict');
const { getApiWebSearchStatusLabel } = require('./apiWebSearchStatus.cjs');

test('maps API web-search evidence states without treating them as selection gates', () => {
  assert.equal(getApiWebSearchStatusLabel('success'), '联网已验证');
  assert.equal(getApiWebSearchStatusLabel('inconclusive'), '联网未确认');
  assert.equal(getApiWebSearchStatusLabel('failed'), '联网检测失败');
  assert.equal(getApiWebSearchStatusLabel('untested'), '联网未检测');
});
