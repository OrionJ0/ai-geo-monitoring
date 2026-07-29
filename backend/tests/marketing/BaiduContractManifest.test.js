const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const contractDirectory = path.resolve(
  __dirname,
  '../../modules/marketing/contracts/baidu/baidu-marketing-pending-2026-07-29'
);
const manifestPath = path.join(contractDirectory, 'manifest.json');

test('pending Baidu contract traces confirmed OAuth facts to official sources', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.contractVersion, 'baidu-marketing-pending-2026-07-29');
  assert.equal(manifest.status, 'BLOCKED');
  assert.ok(manifest.sources.every((source) => (
    source.official === true
    && new URL(source.url).hostname.endsWith('baidu.com')
  )));
  assert.deepEqual(manifest.oauth.authorization, {
    method: 'GET',
    url: 'https://openapi.baidu.com/oauth/2.0/authorize',
    responseType: 'code',
    statePurpose: 'csrf',
    codeSingleUse: true,
    codeTtlSeconds: 600
  });
  assert.equal(
    manifest.oauth.token.url,
    'https://openapi.baidu.com/oauth/2.0/token'
  );
  assert.equal(manifest.oauth.refresh.responseRotation, 'UNVERIFIED_FOR_MARKETING');
});

test('unverified marketing business contract remains an explicit production blocker', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const blockerKeys = manifest.blockers.map((blocker) => blocker.key);

  assert.deepEqual(blockerKeys, [
    'approved_read_scopes',
    'account_directory',
    'search_report',
    'external_id_wire_types',
    'money_currency_scale',
    'timezone_latency_window',
    'pagination_rate_limits',
    'error_mapping_retry',
    'refresh_rotation_replay',
    'provider_revocation',
    'pilot_account_scale'
  ]);
  assert.deepEqual(manifest.productionAllowlist, []);
  assert.equal(manifest.fixtures.observedRealResponses, false);
});
