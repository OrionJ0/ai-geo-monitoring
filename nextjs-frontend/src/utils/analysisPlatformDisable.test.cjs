const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldWarnAnalysisPlatformDisable
} = require('./analysisPlatformDisable.cjs');

test('warns only when disabling the platform currently used for structural analysis', () => {
  assert.equal(shouldWarnAnalysisPlatformDisable('deepseek', false, 'deepseek'), true);
  assert.equal(shouldWarnAnalysisPlatformDisable('qwen', false, 'deepseek'), false);
  assert.equal(shouldWarnAnalysisPlatformDisable('deepseek', true, 'deepseek'), false);
  assert.equal(shouldWarnAnalysisPlatformDisable('deepseek', false, ''), false);
});
