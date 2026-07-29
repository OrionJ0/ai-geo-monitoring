const assert = require('node:assert/strict');
const test = require('node:test');

const {
  REQUIRED_ENABLED_KEYS,
  auditMarketingConfig
} = require('../../modules/marketing/config');

function enabledConfig(overrides = {}) {
  return {
    NODE_ENV: 'production',
    MARKETING_MONITORING_ENABLED: 'true',
    MARKETING_MONITORING_ALLOWED_PROJECT_IDS: 'project-1',
    BAIDU_MARKETING_CLIENT_ID: 'client-id-canary',
    BAIDU_MARKETING_CLIENT_SECRET: 'client-secret-canary',
    BAIDU_MARKETING_REDIRECT_URI: 'https://marketing.example.test/api/admin/marketing/baidu/oauth/callback',
    BAIDU_MARKETING_CONTRACT_VERSION: 'baidu-search-test-v1',
    BAIDU_MARKETING_HTTP_TIMEOUT_MS: '10000',
    ...overrides
  };
}

test('marketing monitoring is disabled by default without requiring provider configuration', () => {
  assert.deepEqual(auditMarketingConfig({}), {
    moduleState: 'DISABLED',
    errorCode: null,
    missingKeys: []
  });
});

test('enabled marketing config reports only missing key names and never values', () => {
  const secret = 'must-not-appear-in-config-audit';
  const result = auditMarketingConfig({
    MARKETING_MONITORING_ENABLED: 'true',
    BAIDU_MARKETING_CLIENT_SECRET: secret
  });

  assert.equal(result.moduleState, 'MISCONFIGURED');
  assert.equal(result.errorCode, 'MARKETING_CONFIG_INCOMPLETE');
  assert.deepEqual(
    result.missingKeys,
    REQUIRED_ENABLED_KEYS.filter((key) => key !== 'BAIDU_MARKETING_CLIENT_SECRET')
  );
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test('marketing callback rejects query strings, fragments and production HTTP URLs', () => {
  for (const redirectUri of [
    'https://marketing.example.test/callback?ticket=canary',
    'https://marketing.example.test/callback#result',
    'http://marketing.example.test/callback'
  ]) {
    const result = auditMarketingConfig(enabledConfig({
      BAIDU_MARKETING_REDIRECT_URI: redirectUri
    }));

    assert.equal(result.moduleState, 'MISCONFIGURED');
    assert.equal(result.errorCode, 'MARKETING_REDIRECT_URI_INVALID');
    assert.deepEqual(result.missingKeys, []);
    assert.doesNotMatch(JSON.stringify(result), /client-secret-canary/);
  }
});

test('loopback HTTP callback is accepted only in the explicit test environment', () => {
  const result = auditMarketingConfig(enabledConfig({
    NODE_ENV: 'test',
    BAIDU_MARKETING_REDIRECT_URI: 'http://127.0.0.1:3100/api/admin/marketing/baidu/oauth/callback'
  }));

  assert.deepEqual(result, {
    moduleState: 'READY',
    errorCode: null,
    missingKeys: []
  });
});
