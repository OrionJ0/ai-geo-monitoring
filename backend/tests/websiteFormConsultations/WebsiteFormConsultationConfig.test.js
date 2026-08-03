const assert = require('node:assert/strict');
const test = require('node:test');

const {
  auditWebsiteFormConsultationConfig
} = require('../../modules/websiteFormConsultations/config');

test('website-form configuration is independent, disabled by default and fail-closed', () => {
  assert.deepEqual(auditWebsiteFormConsultationConfig({}), {
    moduleState: 'DISABLED',
    errorCode: null,
    missingKeys: []
  });

  const incomplete = auditWebsiteFormConsultationConfig({
    GATO_WEBSITE_FORM_ENABLED: 'true',
    GATO_WEBSITE_FORM_BASE_URL: 'https://gato.com.cn'
  });
  assert.equal(incomplete.moduleState, 'MISCONFIGURED');
  assert.equal(incomplete.errorCode, 'WEBSITE_FORM_CONFIG_INCOMPLETE');
  assert.deepEqual(incomplete.missingKeys, [
    'GATO_WEBSITE_FORM_PROJECT_ID',
    'GATO_WEBSITE_FORM_USERNAME',
    'GATO_WEBSITE_FORM_PASSWORD',
    'GATO_WEBSITE_FORM_HTTP_TIMEOUT_MS',
    'GATO_WEBSITE_FORM_CACHE_TTL_MS'
  ]);

  assert.deepEqual(auditWebsiteFormConsultationConfig({
    GATO_WEBSITE_FORM_ENABLED: 'true',
    GATO_WEBSITE_FORM_BASE_URL: 'https://gato.com.cn',
    GATO_WEBSITE_FORM_PROJECT_ID: '11',
    GATO_WEBSITE_FORM_USERNAME: 'website-reader',
    GATO_WEBSITE_FORM_PASSWORD: 'secret-from-env',
    GATO_WEBSITE_FORM_HTTP_TIMEOUT_MS: '10000',
    GATO_WEBSITE_FORM_CACHE_TTL_MS: '600000'
  }), {
    moduleState: 'READY',
    errorCode: null,
    missingKeys: []
  });

  assert.deepEqual(auditWebsiteFormConsultationConfig({
    GATO_WEBSITE_FORM_ENABLED: 'yes'
  }), {
    moduleState: 'MISCONFIGURED',
    errorCode: 'WEBSITE_FORM_CONFIG_INVALID',
    missingKeys: []
  });

  assert.deepEqual(auditWebsiteFormConsultationConfig({
    GATO_WEBSITE_FORM_ENABLED: 'true',
    GATO_WEBSITE_FORM_BASE_URL: 'https://attacker.example',
    GATO_WEBSITE_FORM_PROJECT_ID: '11',
    GATO_WEBSITE_FORM_USERNAME: 'website-reader',
    GATO_WEBSITE_FORM_PASSWORD: 'secret-from-env',
    GATO_WEBSITE_FORM_HTTP_TIMEOUT_MS: '10000',
    GATO_WEBSITE_FORM_CACHE_TTL_MS: '600000'
  }), {
    moduleState: 'MISCONFIGURED',
    errorCode: 'WEBSITE_FORM_CONFIG_INVALID',
    missingKeys: []
  });
});
