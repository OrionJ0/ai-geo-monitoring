const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldSkipGeneralLimiter,
  WEB_RUNTIME_STATUS_RATE_LIMIT
} = require('../config/apiRateLimitPolicy');

test('skips the general limiter only for the exact Web runtime status path', () => {
  assert.equal(
    shouldSkipGeneralLimiter('/ai-platforms/deepseek-web/runtime-status'),
    true
  );
  assert.equal(
    shouldSkipGeneralLimiter('/ai-platforms/deepseek-web/runtime-status/extra'),
    false
  );
  assert.equal(
    shouldSkipGeneralLimiter('/ai-platforms/deepseek-web/runtime-statuses'),
    false
  );
  assert.equal(shouldSkipGeneralLimiter('/ai-platforms'), false);
  assert.equal(WEB_RUNTIME_STATUS_RATE_LIMIT, 1000);
});
