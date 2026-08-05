const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createSanitizedProviderTrace,
  errorTuple
} = require('./helpers/createSanitizedProviderTrace');
const provider = require('../../modules/marketing/adapters/BaiduMarketingClient');
const {
  loadBaiduContract
} = require('../../modules/marketing/contracts/baidu/loadBaiduContract');
const {
  buildSourcePartition
} = require('../../modules/marketing/services/BaiduTongjiService');

const {
  BaiduContractBlockedError,
  BaiduMarketingClient,
  BaiduMarketingError
} = provider;
const manifest = loadBaiduContract('baidu-marketing-pilot-2026-07-30');
const config = Object.freeze({
  appId: 'synthetic-app',
  secretKey: '0123456789abcdef-synthetic-secret',
  scope: 'synthetic-read-scope',
  redirectUri: 'https://example.test/oauth/callback',
  timeoutMs: 10000
});

function clientOptions(overrides = {}) {
  return { manifest, ...config, ...overrides };
}

function reportEnvelope(rows) {
  return {
    header: { status: 0, failures: [] },
    body: {
      data: [{ rowCount: rows.length, totalRowCount: rows.length, rows }]
    }
  };
}

const reportRows = Object.freeze({
  2290316: {
    date: '2026-08-03', userName: 'synthetic-account', userId: 1234,
    campaignId: 101, campaignNameStatus: 'synthetic-campaign',
    impression: 100, click: 8, cost: 12.34
  },
  2284618: {
    date: '2026-08-03', userName: 'synthetic-account', userId: 1234,
    campaignId: 101, campaignNameStatus: 'synthetic-campaign',
    adGroupId: 201, adGroupNameStatus: 'synthetic-ad-group',
    impression: 80, click: 6, cost: 10.2
  },
  2602783: {
    date: '2026-08-03', userName: 'synthetic-account', userId: 1234,
    campaignId: 101, campaignNameStatus: 'synthetic-campaign',
    adGroupId: 201, adGroupNameStatus: 'synthetic-ad-group',
    winfoIdTypeEnum: 0, wInfoId: 301,
    wInfoNameStatus: 'synthetic-keyword', impression: 50, click: 4, cost: 8.75
  },
  2307838: {
    date: '2026-08-03', userName: 'synthetic-account', userId: 1234,
    campaignId: 101, campaignNameStatus: 'synthetic-campaign',
    adGroupId: 201, adGroupNameStatus: 'synthetic-ad-group',
    wInfoNameStatus: 'synthetic-keyword', queryWord: 'synthetic-search-term',
    queryStatusName: 1, wMatchId: 31, impression: 20, click: 2, cost: 5.5
  }
});

test('provider equivalence harness records a secret-free request shape', async () => {
  const trace = createSanitizedProviderTrace();

  await trace.transport({
    method: 'POST',
    url: 'https://example.test/provider',
    headers: { Authorization: 'Bearer synthetic-token' },
    json: {
      header: {
        accessToken: 'synthetic-token',
        secretKey: 'synthetic-secret'
      },
      body: {
        method: 'trend/time/a',
        keyword: 'synthetic-keyword',
        queryWord: 'synthetic-search-term'
      }
    },
    timeoutMs: 1234,
    maxResponseBytes: 5678
  });

  assert.deepEqual(trace.events, [{
    type: 'request',
    method: 'POST',
    path: 'https://example.test/provider',
    bodyShape: {
      header: {
        accessToken: '[REDACTED]',
        secretKey: '[REDACTED]'
      },
      body: {
        method: 'string',
        keyword: '[REDACTED]',
        queryWord: '[REDACTED]'
      }
    },
    timeoutMs: 1234,
    maxResponseBytes: 5678,
    responseBytes: 2
  }]);
  assert.doesNotMatch(JSON.stringify(trace.events), /synthetic-(?:token|secret|keyword|search-term)/u);
});

test('public facade surface and error identities are frozen', () => {
  assert.deepEqual(Object.keys(provider).sort(), [
    'BaiduContractBlockedError',
    'BaiduMarketingClient',
    'BaiduMarketingError',
    'decimalNumberToScaledText'
  ]);
  assert.deepEqual(
    Object.getOwnPropertyNames(BaiduMarketingClient.prototype).sort(),
    [
      'acquireSearchReportSlot',
      'assertAllowed',
      'buildAuthorizationUrl',
      'constructor',
      'createSearchReportBudget',
      'exchangeAuthorizationCode',
      'fetchConfiguredSearchReport',
      'fetchSearchAdGroupReport',
      'fetchSearchKeywordReport',
      'fetchSearchReport',
      'fetchSearchReports',
      'fetchSearchTermReport',
      'fetchTongjiPageReport',
      'fetchTongjiQualityTrend',
      'fetchTongjiSourceSummary',
      'fetchTongjiTrend',
      'listAccounts',
      'listTongjiSites',
      'refreshAccessToken',
      'requestJson',
      'verifyCallbackSignature'
    ]
  );
  const base = new BaiduMarketingError('synthetic', 'SYNTHETIC', 418, true);
  const blocked = new BaiduContractBlockedError();
  assert.deepEqual(errorTuple(base), {
    name: 'BaiduMarketingError', code: 'SYNTHETIC', status: 418, retryable: true
  });
  assert.equal(blocked instanceof BaiduMarketingError, true);
  assert.equal(blocked.constructor, BaiduContractBlockedError);
  assert.deepEqual(errorTuple(blocked), {
    name: 'BaiduContractBlockedError',
    code: 'BAIDU_CONTRACT_NOT_RUNNABLE',
    status: 503,
    retryable: false
  });
});

test('OAuth and account-directory facade calls retain sanitized request contracts', async () => {
  const trace = createSanitizedProviderTrace({
    responseFor: async (request) => {
      if (request.url === manifest.oauth.token.url) {
        return {
          code: 0,
          data: {
            accessToken: 'synthetic-access-token',
            refreshToken: 'synthetic-refresh-token',
            openId: 'synthetic-open-id',
            expiresIn: 3600,
            refreshExpiresIn: 7200,
            userId: 1234,
            scope: config.scope
          }
        };
      }
      return {
        code: 0,
        data: {
          masterUid: 1234,
          masterName: 'synthetic-account',
          userAcctType: 1,
          subUserList: [],
          hasNext: false
        }
      };
    }
  });
  const client = new BaiduMarketingClient(clientOptions({ transport: trace.transport }));

  const token = await client.exchangeAuthorizationCode({
    appId: config.appId,
    authCode: 'synthetic-auth-code',
    userId: '1234'
  });
  const accounts = await client.listAccounts({
    connection: {
      authorized_principal_id: '1234',
      authorized_open_id: 'synthetic-open-id'
    },
    accessToken: token.accessToken
  });

  assert.equal(token.principalId, '1234');
  assert.deepEqual(accounts, [{
    accountId: '1234',
    accountName: 'synthetic-account',
    product: 'SEARCH',
    readOnly: true
  }]);
  assert.deepEqual(trace.events.map(({ method, path, timeoutMs, maxResponseBytes }) => ({
    method, path, timeoutMs, maxResponseBytes
  })), [
    {
      method: 'POST', path: manifest.oauth.token.url,
      timeoutMs: 10000, maxResponseBytes: 1048576
    },
    {
      method: 'POST', path: manifest.oauth.userInfo.url,
      timeoutMs: 10000, maxResponseBytes: 1048576
    }
  ]);
  assert.doesNotMatch(
    JSON.stringify(trace.events),
    /synthetic-(?:access-token|refresh-token|auth-code)|0123456789abcdef/u
  );
});

test('four SEARCH reports retain order, double-read, QPS waits, budgets and output', async () => {
  let now = 0;
  const reportTypes = [];
  const trace = createSanitizedProviderTrace({
    responseFor: async (request) => {
      reportTypes.push(request.json.body.reportType);
      return reportEnvelope([reportRows[request.json.body.reportType]]);
    }
  });
  const client = new BaiduMarketingClient(clientOptions({
    transport: trace.transport,
    monotonicClock: () => now,
    wait: async (milliseconds) => {
      await trace.wait(milliseconds);
      now += milliseconds;
    }
  }));

  const reports = await client.fetchSearchReports({
    binding: { accountId: '1234', accountName: 'synthetic-account' },
    accessToken: 'synthetic-access-token',
    coverage: { from: '2026-08-03', to: '2026-08-03' }
  });
  const requests = trace.events.filter((event) => event.type === 'request');
  assert.deepEqual(requests.map((event) => event.bodyShape.body.reportType), [
    'number', 'number', 'number', 'number',
    'number', 'number', 'number', 'number'
  ]);
  assert.deepEqual(reportTypes, [
    2290316, 2284618, 2602783, 2307838,
    2290316, 2284618, 2602783, 2307838
  ]);
  assert.deepEqual(requests.map((event) => event.maxResponseBytes), [
    8388608, 8388608, 8388608, 8388608,
    8388608, 8388608, 8388608, 8388608
  ]);
  assert.deepEqual(
    trace.events.filter((event) => event.type === 'wait').map((event) => event.milliseconds),
    [20, 80]
  );
  assert.deepEqual(Object.keys(reports), ['campaigns', 'adGroups', 'keywords', 'searchTerms']);
  assert.equal(reports.campaigns[0].costAmountScaled, '1234');
  assert.equal(reports.adGroups[0].adGroupId, '201');
  assert.equal(reports.keywords[0].keywordId, '301');
  assert.equal(reports.searchTerms[0].keywordId, undefined);
  assert.equal(reports.searchTerms[0].matchType, 'PHRASE');
  const serialized = JSON.stringify(trace.events);
  assert.doesNotMatch(serialized, /synthetic-(?:access-token|keyword|search-term)/u);

  const requestBudget = client.createSearchReportBudget();
  for (let index = 0; index < 512; index += 1) requestBudget.beginRequest();
  assert.throws(
    () => requestBudget.beginRequest(),
    { code: 'BAIDU_REPORT_RESOURCE_BUDGET_EXCEEDED', status: 502 }
  );
});

test('Tongji site, trend, source, quality and page contracts retain success and empty shapes', async () => {
  const fixtureDirectory = path.resolve(
    __dirname,
    '../../modules/marketing/contracts/baidu/baidu-marketing-pilot-2026-07-30/fixtures'
  );
  const sitesFixture = JSON.parse(fs.readFileSync(
    path.join(fixtureDirectory, 'tongji-sites.success.redacted.json'),
    'utf8'
  ));
  const trendFixture = JSON.parse(fs.readFileSync(
    path.join(fixtureDirectory, 'tongji-trend.success.redacted.json'),
    'utf8'
  ));
  const trace = createSanitizedProviderTrace({
    responseFor: async (request) => {
      if (request.url === manifest.tongji.siteDirectory.url) return sitesFixture;
      const { method } = request.json.body;
      if (
        method === 'trend/time/a'
        && request.json.body.metrics === 'pv_count,visit_count,visitor_count'
      ) return trendFixture;
      if (method === 'source/engine/a') {
        return {
          header: { status: 0, failures: [] },
          body: { data: [{ result: {
            fields: ['source_engine_title', 'pv_count', 'visit_count', 'visitor_count'],
            items: [
              [[{ name: 'synthetic-engine', source: 'search,2', engineId: '2', url: 'example.test' }]],
              [['12', '3', '2']], [], []
            ],
            total: 1,
            offset: 0
          } }] }
        };
      }
      if (method === 'visit/toppage/a') {
        return {
          header: { status: 0, failures: [] },
          body: { data: [{ result: {
            fields: [
              'visit_page_title', 'pv_count', 'visitor_count',
              'average_stay_time', 'outward_count', 'exit_ratio'
            ],
            items: [
              [[{ name: 'https://example.test/synthetic-page', pageId: '101' }]],
              [['12', '3', '4.5', '2', '10.0']], [], []
            ],
            total: 1,
            offset: 0
          } }] }
        };
      }
      if (request.json.body.metrics === 'bounce_ratio,avg_visit_time,avg_visit_pages') {
        return {
          header: { status: 0, failures: [] },
          body: { data: [{ result: {
            fields: [
              'simple_date_title', 'bounce_ratio',
              'avg_visit_time', 'avg_visit_pages'
            ],
            sum: [['0', '0', '0'], []],
            items: [[['2026/07/30']], [['--', 0, '0.00']], [], []],
            total: 1,
            offset: 0
          } }] }
        };
      }
      throw new Error(`unexpected synthetic method: ${method}`);
    }
  });
  const client = new BaiduMarketingClient(clientOptions({ transport: trace.transport }));
  const common = {
    accountName: 'synthetic-account',
    accessToken: 'synthetic-access-token',
    siteId: '301'
  };

  assert.deepEqual(await client.listTongjiSites(common), [
    { siteId: '301', domain: 'active.example.test', status: 'ACTIVE' },
    { siteId: '302', domain: 'paused.example.test', status: 'PAUSED' }
  ]);
  const trend = await client.fetchTongjiTrend({
    ...common,
    coverage: { from: '2026-07-28', to: '2026-07-30' }
  });
  assert.deepEqual(trend.map((row) => row.date), [
    '2026-07-28', '2026-07-29', '2026-07-30'
  ]);
  assert.equal(trend[1].visits, null);
  const quality = await client.fetchTongjiQualityTrend({
    ...common,
    coverage: { from: '2026-07-30', to: '2026-07-30' }
  });
  assert.deepEqual(quality.rows[0], {
    date: '2026-07-30',
    bounceRate: null,
    averageVisitTimeSeconds: '0',
    averageVisitPages: '0'
  });
  assert.deepEqual(await client.fetchTongjiSourceSummary({
    ...common,
    coverage: { from: '2026-07-30', to: '2026-07-30' },
    reportKey: 'ENGINE'
  }), [{
    name: 'synthetic-engine',
    source: 'search,2',
    engineId: '2',
    url: 'example.test',
    pageviews: '12',
    visits: '3',
    visitors: '2'
  }]);
  assert.deepEqual(await client.fetchTongjiPageReport({
    ...common,
    coverage: { from: '2026-07-30', to: '2026-07-30' },
    view: 'visited'
  }), {
    view: 'visited',
    total: 1,
    rows: [{
      pageId: '101',
      pageUrl: 'https://example.test/synthetic-page',
      pageviews: '12',
      visitors: '3',
      averageStayTimeSeconds: '4.5',
      downstreamPageviews: '2',
      exitRate: '10'
    }]
  });
  assert.deepEqual(
    trace.events.filter((event) => event.type === 'request').map((event) => ({
      path: event.path,
      maxResponseBytes: event.maxResponseBytes
    })),
    [
      { path: manifest.tongji.siteDirectory.url, maxResponseBytes: 2097152 },
      { path: manifest.tongji.report.url, maxResponseBytes: 2097152 },
      { path: manifest.tongji.report.url, maxResponseBytes: 2097152 },
      { path: manifest.tongji.report.url, maxResponseBytes: 2097152 },
      { path: manifest.tongji.report.url, maxResponseBytes: 2097152 }
    ]
  );
  assert.doesNotMatch(JSON.stringify(trace.events), /synthetic-access-token/u);

  const emptyTrace = createSanitizedProviderTrace({
    responseFor: async () => ({
      header: { status: 0, failures: [] },
      body: { data: [{ result: {
        fields: [
          'visit_page_title', 'pv_count', 'visitor_count',
          'average_stay_time', 'outward_count', 'exit_ratio'
        ],
        items: [[], [], [], []],
        total: 0,
        offset: 0
      } }] }
    })
  });
  const emptyClient = new BaiduMarketingClient(clientOptions({
    transport: emptyTrace.transport
  }));
  assert.deepEqual(await emptyClient.fetchTongjiPageReport({
    ...common,
    coverage: { from: '2026-07-30', to: '2026-07-30' },
    view: 'visited'
  }), { view: 'visited', total: 0, rows: [] });
  await assert.rejects(
    client.fetchTongjiSourceSummary({
      ...common,
      coverage: { from: '2026-07-30', to: '2026-07-30' },
      reportKey: 'UNSUPPORTED'
    }),
    { code: 'BAIDU_TONGJI_SOURCE_REPORT_INVALID', status: 400 }
  );
});

test('007 source partition and same-path identity remain the equivalence baseline', () => {
  const sourceRows = (values) => values.map((current, index) => ({
    sourceKey: `SYNTHETIC_${index + 1}`,
    summary: { current }
  }));
  assert.deepEqual(buildSourcePartition('82', sourceRows([
    '5', '20', '25', '10', '7', '8', '7'
  ])), {
    metric: 'visits',
    state: 'COMPLETE',
    totalVisits: '82',
    classifiedVisits: '82',
    unclassifiedVisits: '0',
    reasonCode: null
  });
  assert.deepEqual(buildSourcePartition('83', sourceRows([
    '5', '20', '25', '10', '7', '8', '7'
  ])), {
    metric: 'visits',
    state: 'PARTIAL',
    totalVisits: '83',
    classifiedVisits: '82',
    unclassifiedVisits: '1',
    reasonCode: 'SOURCE_COVERAGE_INCOMPLETE'
  });
  assert.throws(
    () => buildSourcePartition('81', sourceRows([
      '5', '20', '25', '10', '7', '8', '7'
    ])),
    { code: 'TONGJI_SOURCE_PARTITION_INVALID', status: 502 }
  );
  const collision = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    '../../../tests/fixtures/marketing-production-correctness/tongji-page-path-collision.json'
  ), 'utf8'));
  assert.deepEqual(collision.response.rows.map((row) => ({
    pageId: row.pageId,
    key: row.key,
    path: row.path,
    collision: row.pathCollision
  })), [
    {
      pageId: '1001', key: 'baidu-page:1001', path: '/',
      collision: { ordinal: 1, count: 2 }
    },
    {
      pageId: '1002', key: 'baidu-page:1002', path: '/',
      collision: { ordinal: 2, count: 2 }
    }
  ]);
});

test('outbound safety failures retain stable four-tuples and cancellation evidence', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const trace = createSanitizedProviderTrace();
  const client = new BaiduMarketingClient(clientOptions({ timeoutMs: 100 }));
  const request = () => client.requestJson({
    method: 'POST',
    url: manifest.oauth.token.url,
    json: {}
  });
  const capture = async (operation) => {
    try {
      await operation();
      assert.fail('expected provider failure');
    } catch (error) {
      return errorTuple(error);
    }
  };

  const allowlist = await capture(() => client.requestJson({
    method: 'POST',
    url: 'https://api.baidu.com/json/sms/service/CampaignService/updateCampaign',
    json: {}
  }));
  global.fetch = async () => ({
    ok: false,
    status: 503,
    headers: { get: () => null },
    body: { async cancel() { trace.cancel('http'); } }
  });
  const http = await capture(request);
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => String(2 * 1024 * 1024) },
    body: { async cancel() { trace.cancel('content-length'); } }
  });
  const oversized = await capture(request);
  global.fetch = async () => new Response('synthetic-not-json', {
    status: 200,
    headers: { 'content-type': 'text/plain' }
  });
  const nonJson = await capture(request);
  global.fetch = async () => {
    throw new Error('synthetic-network-detail');
  };
  const network = await capture(request);
  global.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      trace.cancel('timeout-abort');
      const error = new Error('synthetic-abort-detail');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  const timeout = await capture(request);

  assert.deepEqual({ allowlist, http, timeout, oversized, nonJson, network }, {
    allowlist: {
      name: 'BaiduMarketingError', code: 'BAIDU_OUTBOUND_NOT_ALLOWED',
      status: 500, retryable: false
    },
    http: {
      name: 'BaiduMarketingError', code: 'BAIDU_HTTP_ERROR',
      status: 502, retryable: true
    },
    timeout: {
      name: 'BaiduMarketingError', code: 'BAIDU_REQUEST_TIMEOUT',
      status: 504, retryable: false
    },
    oversized: {
      name: 'BaiduMarketingError', code: 'BAIDU_RESPONSE_TOO_LARGE',
      status: 502, retryable: false
    },
    nonJson: {
      name: 'BaiduMarketingError', code: 'BAIDU_RESPONSE_INVALID',
      status: 502, retryable: false
    },
    network: {
      name: 'BaiduMarketingError', code: 'BAIDU_UPSTREAM_UNAVAILABLE',
      status: 502, retryable: true
    }
  });
  assert.deepEqual(trace.events, [
    { type: 'cancel', reason: 'http' },
    { type: 'cancel', reason: 'content-length' },
    { type: 'cancel', reason: 'timeout-abort' }
  ]);
  assert.doesNotMatch(JSON.stringify({ allowlist, http, timeout, oversized, nonJson, network }), /synthetic-/u);
});
