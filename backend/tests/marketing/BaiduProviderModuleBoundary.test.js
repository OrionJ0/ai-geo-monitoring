const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const facadeExports = require('../../modules/marketing/adapters/BaiduMarketingClient');
const errorExports = require('../../modules/marketing/adapters/baidu/BaiduErrors');
const {
  BaiduHttpKernel
} = require('../../modules/marketing/adapters/baidu/BaiduHttpKernel');
const {
  BaiduOAuthClient
} = require('../../modules/marketing/adapters/baidu/BaiduOAuthClient');
const searchExports = require(
  '../../modules/marketing/adapters/baidu/BaiduSearchAdsClient'
);
const { BaiduSearchAdsClient } = searchExports;
const {
  BaiduTongjiClient
} = require('../../modules/marketing/adapters/baidu/BaiduTongjiClient');
const {
  loadBaiduContract
} = require('../../modules/marketing/contracts/baidu/loadBaiduContract');

const manifest = loadBaiduContract('baidu-marketing-pilot-2026-07-30');

function createClient(transport = async () => ({})) {
  return new facadeExports.BaiduMarketingClient({
    manifest,
    appId: 'synthetic-app',
    secretKey: '0000000000000000-synthetic-only',
    scope: 'synthetic-scope',
    redirectUri: 'https://example.test/oauth/callback',
    timeoutMs: 10000,
    transport
  });
}

test('facade keeps its composed clients private', () => {
  const client = createClient();

  assert.deepEqual(Object.keys(client), ['timeoutMs']);
  assert.equal(Object.hasOwn(client, 'secretKey'), false);
  assert.equal(Object.hasOwn(client, 'transport'), false);
  assert.equal(Object.hasOwn(client, 'allowlist'), false);
  assert.equal(Object.hasOwn(client, 'httpKernel'), false);
  assert.equal(Object.hasOwn(client, 'oauthClient'), false);
  assert.equal(Object.hasOwn(client, 'searchAdsClient'), false);
  assert.equal(Object.hasOwn(client, 'tongjiClient'), false);
});

test('facade re-exports the one shared error class identity', () => {
  assert.equal(facadeExports.BaiduMarketingError, errorExports.BaiduMarketingError);
  assert.equal(
    facadeExports.BaiduContractBlockedError,
    errorExports.BaiduContractBlockedError
  );
  assert.equal(
    facadeExports.decimalNumberToScaledText,
    searchExports.decimalNumberToScaledText
  );
});

test('runtime contains one transport and allowlist implementation', () => {
  const adapterRoot = path.resolve(__dirname, '../../modules/marketing/adapters');
  const files = [
    path.join(adapterRoot, 'BaiduMarketingClient.js'),
    ...fs.readdirSync(path.join(adapterRoot, 'baidu')).map(
      (name) => path.join(adapterRoot, 'baidu', name)
    )
  ];
  const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

  assert.equal((source.match(/async function defaultTransport\s*\(/gu) || []).length, 1);
  assert.equal((source.match(/function documentedAllowlist\s*\(/gu) || []).length, 1);
  assert.doesNotMatch(source, /disableAllowlist|skipAllowlist|unlimitedTimeout/iu);
  const searchSource = fs.readFileSync(
    path.join(adapterRoot, 'baidu/BaiduSearchAdsClient.js'),
    'utf8'
  );
  const tongjiSource = fs.readFileSync(
    path.join(adapterRoot, 'baidu/BaiduTongjiClient.js'),
    'utf8'
  );
  assert.doesNotMatch(searchSource, /BaiduTongjiClient/u);
  assert.doesNotMatch(tongjiSource, /BaiduSearchAdsClient|BaiduOAuthClient/u);
});

test('facade contains composition and delegation but no product implementation', () => {
  const facadeSource = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../modules/marketing/adapters/BaiduMarketingClient.js'
    ),
    'utf8'
  );

  assert.doesNotMatch(
    facadeSource,
    /TONGJI_|SEARCH_|reportType|site_id|max_results|normalize[A-Z]|fallback/iu
  );
  assert.doesNotMatch(facadeSource, /\b(?:for|while)\s*\(/u);
  assert.equal((facadeSource.match(/class BaiduMarketingClient/gu) || []).length, 1);
  for (const dependency of [
    'BaiduHttpKernel',
    'BaiduOAuthClient',
    'BaiduSearchAdsClient',
    'BaiduTongjiClient'
  ]) {
    assert.equal(
      (facadeSource.match(new RegExp(`new ${dependency}\\(`, 'gu')) || []).length,
      1
    );
  }
  assert.equal(
    (facadeSource.match(/httpKernel: this\.#httpKernel/gu) || []).length,
    3
  );
  for (const [client, methods] of Object.entries({
    httpKernel: ['assertAllowed', 'requestJson'],
    oauthClient: [
      'buildAuthorizationUrl',
      'verifyCallbackSignature',
      'exchangeAuthorizationCode',
      'refreshAccessToken',
      'listAccounts'
    ],
    searchAdsClient: [
      'createSearchReportBudget',
      'acquireSearchReportSlot',
      'fetchConfiguredSearchReport',
      'fetchSearchReport',
      'fetchSearchAdGroupReport',
      'fetchSearchKeywordReport',
      'fetchSearchTermReport',
      'fetchSearchReports'
    ],
    tongjiClient: [
      'listTongjiSites',
      'fetchTongjiTrend',
      'fetchTongjiQualityTrend',
      'fetchTongjiPageReport',
      'fetchTongjiSourceSummary'
    ]
  })) {
    for (const method of methods) {
      assert.equal(
        facadeSource.includes(`this.#${client}.${method}(`),
        true,
        `${method} must delegate to ${client}`
      );
    }
  }
});
