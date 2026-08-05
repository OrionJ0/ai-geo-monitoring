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
    secretKey: '0123456789abcdef-synthetic-secret',
    scope: 'synthetic-scope',
    redirectUri: 'https://example.test/oauth/callback',
    timeoutMs: 10000,
    transport
  });
}

test('facade owns one shared HTTP kernel and keeps the Secret only in OAuth', () => {
  const client = createClient();

  assert.equal(client.httpKernel instanceof BaiduHttpKernel, true);
  assert.equal(client.oauthClient instanceof BaiduOAuthClient, true);
  assert.equal(client.searchAdsClient instanceof BaiduSearchAdsClient, true);
  assert.equal(client.tongjiClient instanceof BaiduTongjiClient, true);
  assert.equal(client.oauthClient.httpKernel, client.httpKernel);
  assert.equal(client.searchAdsClient.httpKernel, client.httpKernel);
  assert.equal(client.tongjiClient.httpKernel, client.httpKernel);
  assert.equal(Object.hasOwn(client, 'secretKey'), false);
  assert.equal(Object.hasOwn(client, 'transport'), false);
  assert.equal(Object.hasOwn(client, 'allowlist'), false);
  assert.equal(client.oauthClient.secretKey, '0123456789abcdef-synthetic-secret');
  assert.equal(Object.hasOwn(client.searchAdsClient, 'secretKey'), false);
  assert.equal(Object.hasOwn(client.tongjiClient, 'secretKey'), false);
});

test('facade delegates every SEARCH method to the one search client', async () => {
  const client = createClient();
  const calls = [];
  for (const method of [
    'createSearchReportBudget',
    'acquireSearchReportSlot',
    'fetchConfiguredSearchReport',
    'fetchSearchReport',
    'fetchSearchAdGroupReport',
    'fetchSearchKeywordReport',
    'fetchSearchTermReport',
    'fetchSearchReports'
  ]) {
    client.searchAdsClient[method] = async (...args) => {
      calls.push({ method, args });
      return method;
    };
  }

  assert.equal(await client.createSearchReportBudget(), 'createSearchReportBudget');
  assert.equal(await client.acquireSearchReportSlot('slot'), 'acquireSearchReportSlot');
  assert.equal(await client.fetchConfiguredSearchReport('configured'), 'fetchConfiguredSearchReport');
  assert.equal(await client.fetchSearchReport('campaign'), 'fetchSearchReport');
  assert.equal(await client.fetchSearchAdGroupReport('group'), 'fetchSearchAdGroupReport');
  assert.equal(await client.fetchSearchKeywordReport('keyword'), 'fetchSearchKeywordReport');
  assert.equal(await client.fetchSearchTermReport('term'), 'fetchSearchTermReport');
  assert.equal(await client.fetchSearchReports('all'), 'fetchSearchReports');
  assert.deepEqual(calls.map(({ method }) => method), [
    'createSearchReportBudget',
    'acquireSearchReportSlot',
    'fetchConfiguredSearchReport',
    'fetchSearchReport',
    'fetchSearchAdGroupReport',
    'fetchSearchKeywordReport',
    'fetchSearchTermReport',
    'fetchSearchReports'
  ]);
});

test('facade delegates every Tongji method to the one Tongji client', async () => {
  const client = createClient();
  const calls = [];
  for (const method of [
    'listTongjiSites',
    'fetchTongjiTrend',
    'fetchTongjiQualityTrend',
    'fetchTongjiPageReport',
    'fetchTongjiSourceSummary'
  ]) {
    client.tongjiClient[method] = async (...args) => {
      calls.push({ method, args });
      return method;
    };
  }

  assert.equal(await client.listTongjiSites('sites'), 'listTongjiSites');
  assert.equal(await client.fetchTongjiTrend('trend'), 'fetchTongjiTrend');
  assert.equal(await client.fetchTongjiQualityTrend('quality'), 'fetchTongjiQualityTrend');
  assert.equal(await client.fetchTongjiPageReport('pages'), 'fetchTongjiPageReport');
  assert.equal(await client.fetchTongjiSourceSummary('sources'), 'fetchTongjiSourceSummary');
  assert.deepEqual(calls.map(({ method }) => method), [
    'listTongjiSites',
    'fetchTongjiTrend',
    'fetchTongjiQualityTrend',
    'fetchTongjiPageReport',
    'fetchTongjiSourceSummary'
  ]);
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
});
