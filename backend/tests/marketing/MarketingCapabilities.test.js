const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMarketingCapabilities
} = require('../../modules/marketing/marketingCapabilities');

const blocked = {
  pilotDataAccess: false,
  formalNavigation: false,
  adsRead: false,
  trafficRead: false,
  refreshAds: false
};

test('disabled, invalid and auth-only states expose no data or navigation capability', () => {
  for (const state of [
    'DISABLED',
    'MISCONFIGURED',
    'SCHEMA_MISSING',
    'RECOVERY_FAILED',
    'PILOT_READY'
  ]) {
    assert.deepEqual(buildMarketingCapabilities(state), blocked);
  }
});

test('data pilot allows white-listed reads without exposing formal navigation', () => {
  assert.deepEqual(buildMarketingCapabilities('PILOT_DATA_READY'), {
    pilotDataAccess: true,
    formalNavigation: false,
    adsRead: true,
    trafficRead: true,
    refreshAds: true
  });
});

test('verified production state enables the complete read-only workspace capability', () => {
  assert.deepEqual(buildMarketingCapabilities('READY'), {
    pilotDataAccess: true,
    formalNavigation: true,
    adsRead: true,
    trafficRead: true,
    refreshAds: true
  });
});

test('unknown future states fail closed', () => {
  assert.deepEqual(buildMarketingCapabilities('UNKNOWN'), blocked);
});
