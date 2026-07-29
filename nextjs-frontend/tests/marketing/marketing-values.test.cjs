const assert = require('node:assert/strict');
const test = require('node:test');

const {
  boundedPercent,
  formatScaled,
  groupDigits
} = require('../../src/utils/marketingValues.cjs');

test('marketing values format exact strings without floating point conversion', () => {
  assert.equal(groupDigits('900719925474099312345'), '900,719,925,474,099,312,345');
  assert.equal(formatScaled('1234567', 6, 'CNY'), 'CNY 1.234567');
  assert.equal(boundedPercent('1', '3'), '33.33%');
});

test('marketing values reject exponent and numeric inputs', () => {
  assert.throws(() => groupDigits(9007199254740993));
  assert.throws(() => groupDigits('1e3'));
});
