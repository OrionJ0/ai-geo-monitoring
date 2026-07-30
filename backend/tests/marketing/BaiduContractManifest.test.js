const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const contractDirectory = path.resolve(
  __dirname,
  '../../modules/marketing/contracts/baidu/baidu-marketing-docs-2026-07-30'
);
const manifestPath = path.join(contractDirectory, 'manifest.json');

test('documented Baidu Marketing contract traces OAuth facts to official sources', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.contractVersion, 'baidu-marketing-docs-2026-07-30');
  assert.equal(manifest.status, 'DOCUMENTED_PENDING_PILOT');
  assert.ok(manifest.sources.every((source) => (
    source.official === true
    && new URL(source.url).hostname.endsWith('baidu.com')
  )));
  assert.deepEqual(manifest.oauth.authorization, {
    method: 'GET',
    url: 'https://u.baidu.com/oauth/page/index',
    platformId: '4960345965958561794',
    parameters: ['platformId', 'appId', 'scope', 'state', 'callback'],
    stateMaxLength: 512
  });
  assert.deepEqual(manifest.oauth.callback, {
    method: 'GET',
    parameters: [
      'appId',
      'authCode',
      'state',
      'userId',
      'timestamp',
      'signature'
    ],
    signature: {
      canonicalization: 'NATURAL_KEY_ORDER_JSON_EXCLUDING_SIGNATURE',
      base64: 'UTF8_JSON',
      cipher: 'AES-128-CBC-NO_PADDING',
      key: 'SECRET_KEY_FIRST_16_CHARACTERS',
      iv: '16_NUL_BYTES',
      output: 'UPPERCASE_HEX'
    }
  });
  assert.equal(
    manifest.oauth.token.url,
    'https://u.baidu.com/oauth/accessToken'
  );
  assert.equal(manifest.oauth.token.method, 'POST');
  assert.equal(manifest.oauth.token.grantType, 'auth_code');
  assert.equal(
    manifest.oauth.refresh.url,
    'https://u.baidu.com/oauth/refreshToken'
  );
  assert.equal(
    manifest.oauth.userInfo.url,
    'https://u.baidu.com/oauth/getUserInfo'
  );
});

test('documented account and SEARCH report requests are exact but pilot blockers remain', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const blockerKeys = manifest.blockers.map((blocker) => blocker.key);

  assert.deepEqual(manifest.accountDirectory.pagination, {
    defaultPageSize: 100,
    maxPageSize: 500,
    firstLastPageMaxUcId: 1
  });
  assert.deepEqual(manifest.searchPlanReport, {
    method: 'POST',
    url: 'https://api.baidu.com/json/sms/service/OpenApiReportService/getReportData',
    reportType: 2290316,
    timeUnit: 'DAY',
    maxDateRangeDays: 731,
    qps: 50,
    pageSize: 200,
    columns: [
      'date',
      'userName',
      'userId',
      'campaignId',
      'campaignNameStatus',
      'campaignName',
      'impression',
      'click',
      'cost'
    ]
  });
  assert.deepEqual(blockerKeys, [
    'approved_read_scopes',
    'token_grant_type_conflict',
    'account_directory_real_fixture',
    'report_response_body_fixture',
    'money_currency_scale',
    'timezone_latency_window',
    'business_error_retry',
    'refresh_rotation_replay',
    'provider_revocation',
    'pilot_account_scale'
  ]);
  assert.deepEqual(manifest.productionAllowlist, []);
  assert.deepEqual(manifest.documentedOutboundAllowlist, [
    'GET https://u.baidu.com/oauth/page/index',
    'POST https://u.baidu.com/oauth/accessToken',
    'POST https://u.baidu.com/oauth/refreshToken',
    'POST https://u.baidu.com/oauth/getUserInfo',
    'POST https://api.baidu.com/json/sms/service/OpenApiReportService/getReportData'
  ]);
  assert.equal(manifest.fixtures.observedRealResponses, false);
  assert.equal(manifest.runtime.adapterImplemented, true);
  assert.equal(manifest.runtime.reportResponseParserImplemented, false);
});
