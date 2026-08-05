const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  loadBaiduContract
} = require('../../modules/marketing/contracts/baidu/loadBaiduContract');
const {
  BaiduMarketingClient
} = require('../../modules/marketing/adapters/BaiduMarketingClient');
const {
  createBaiduCallbackSignature
} = require('../../modules/marketing/domain/baiduOAuthSignature');

const manifest = loadBaiduContract('baidu-marketing-pilot-2026-07-30');
const config = Object.freeze({
  appId: 'app-id-fixture',
  secretKey: '0123456789abcdef-secret-key-fixture',
  scope: 'search-report-read-fixture',
  redirectUri: 'https://marketing.example.test/api/admin/marketing/baidu/oauth/callback',
  timeoutMs: 10000
});

function createClient(transport = async () => {
  throw new Error('unexpected request');
}) {
  return new BaiduMarketingClient({
    manifest,
    ...config,
    transport
  });
}

test('authorization URL uses Baidu Marketing platform, app, scope, state and callback', () => {
  const client = createClient();
  const url = new URL(client.buildAuthorizationUrl({
    state: 'state-fixture'
  }));

  assert.equal(url.origin + url.pathname, manifest.oauth.authorization.url);
  assert.deepEqual(
    Object.fromEntries(url.searchParams),
    {
      platformId: '4960345965958561794',
      appId: config.appId,
      scope: config.scope,
      state: 'state-fixture',
      callback: config.redirectUri
    }
  );
});

test('callback verification binds the signature to the configured app', () => {
  const client = createClient();
  const callback = {
    appId: config.appId,
    authCode: 'auth-code-fixture',
    state: 'state-fixture',
    userId: '1234',
    timestamp: '1611216626171'
  };
  const signature = createBaiduCallbackSignature({
    parameters: callback,
    secretKey: config.secretKey
  });

  assert.equal(
    client.verifyCallbackSignature({ ...callback, signature }),
    true
  );
  assert.equal(
    client.verifyCallbackSignature({
      ...callback,
      appId: 'another-app',
      signature
    }),
    false
  );
});

test('authorization-code exchange follows the official JSON request and normalizes token lifetimes', async () => {
  const calls = [];
  const client = createClient(async (request) => {
    calls.push(request);
    return {
      code: 0,
      message: 'success',
      data: {
        accessToken: 'access-token-fixture',
        refreshToken: 'refresh-token-fixture',
        openId: 'open-id-fixture',
        expiresTime: '2026-07-31T00:00:00+08:00',
        refreshExpiresTime: '2026-08-30T00:00:00+08:00',
        expiresIn: 86400,
        refreshExpiresIn: 2592000,
        userId: 1234,
        scope: config.scope
      }
    };
  });

  const result = await client.exchangeAuthorizationCode({
    appId: config.appId,
    authCode: 'auth-code-fixture',
    userId: '1234'
  });

  assert.deepEqual(calls, [{
    method: 'POST',
    url: 'https://u.baidu.com/oauth/accessToken',
    headers: {
      'Content-Type': 'application/json;charset:utf-8'
    },
    json: {
      appId: config.appId,
      authCode: 'auth-code-fixture',
      secretKey: config.secretKey,
      grantType: 'auth_code',
      userId: 1234
    },
    timeoutMs: 10000,
    maxResponseBytes: 1048576
  }]);
  assert.deepEqual(result, {
    principalId: '1234',
    principalName: null,
    openId: 'open-id-fixture',
    accessToken: 'access-token-fixture',
    refreshToken: 'refresh-token-fixture',
    expiresInSeconds: 86400,
    refreshExpiresInSeconds: 2592000,
    scope: config.scope
  });
});

test('refresh request includes the authorized userId and normalizes rotated credentials', async () => {
  const calls = [];
  const client = createClient(async (request) => {
    calls.push(request);
    return {
      code: 0,
      message: 'success',
      data: {
        accessToken: 'access-token-next',
        refreshToken: 'refresh-token-next',
        openId: 'open-id-fixture',
        expiresIn: 86400,
        refreshExpiresIn: 2592000,
        userId: 1234,
        scope: config.scope
      }
    };
  });

  const result = await client.refreshAccessToken({
    refreshToken: 'refresh-token-old',
    userId: '1234'
  });

  assert.deepEqual(calls[0].json, {
    appId: config.appId,
    refreshToken: 'refresh-token-old',
    secretKey: config.secretKey,
    userId: 1234
  });
  assert.equal(result.accessToken, 'access-token-next');
  assert.equal(result.refreshToken, 'refresh-token-next');
  assert.equal(result.refreshExpiresInSeconds, 2592000);
});

test('account directory paginates super-admin children and keeps all ids as strings', async () => {
  const calls = [];
  const responses = [
    {
      code: 0,
      message: 'success',
      data: {
        masterUid: 1234,
        masterName: '主账户',
        userAcctType: 2,
        hasNext: true,
        subUserList: [
          { ucId: 10, ucName: '子账户甲' },
          { ucId: 20, ucName: '子账户乙' }
        ]
      }
    },
    {
      code: 0,
      message: 'success',
      data: {
        masterUid: 1234,
        masterName: '主账户',
        userAcctType: 2,
        hasNext: false,
        subUserList: [
          { ucId: 30, ucName: '子账户丙' }
        ]
      }
    }
  ];
  const client = createClient(async (request) => {
    calls.push(request);
    return responses.shift();
  });

  const accounts = await client.listAccounts({
    connection: {
      authorized_principal_id: '1234',
      authorized_open_id: 'open-id-fixture'
    },
    accessToken: 'access-token-fixture'
  });

  assert.deepEqual(
    calls.map((call) => call.json.lastPageMaxUcId),
    [1, 20]
  );
  assert.ok(calls.every((call) => (
    call.method === 'POST'
    && call.url === 'https://u.baidu.com/oauth/getUserInfo'
    && call.json.pageSize === 500
    && call.json.needSubList === true
  )));
  assert.deepEqual(accounts, [
    {
      accountId: '1234',
      accountName: '主账户',
      product: 'SEARCH',
      readOnly: true
    },
    {
      accountId: '10',
      accountName: '子账户甲',
      product: 'SEARCH',
      readOnly: true
    },
    {
      accountId: '20',
      accountName: '子账户乙',
      product: 'SEARCH',
      readOnly: true
    },
    {
      accountId: '30',
      accountName: '子账户丙',
      product: 'SEARCH',
      readOnly: true
    }
  ]);
});

test('plan report parses the redacted real-response fixture into exact domain rows', async () => {
  let captured;
  const fixture = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    '../../modules/marketing/contracts/baidu/baidu-marketing-pilot-2026-07-30/fixtures/search-report.success.redacted.json'
  ), 'utf8'));
  const client = createClient(async (request) => {
    captured = request;
    return fixture;
  });

  const rows = await client.fetchSearchReport({
    binding: {
      accountId: '1234',
      accountName: '脱敏搜索账户'
    },
    accessToken: 'access-token-fixture',
    coverage: {
      from: '2026-07-01',
      to: '2026-07-30'
    }
  });

  assert.deepEqual(rows, [
    {
      accountId: '1234',
      campaignId: '101',
      campaignName: '脱敏计划甲',
      metricDate: '2026-07-28',
      impressions: '123',
      clicks: '7',
      costAmountScaled: '1234'
    },
    {
      accountId: '1234',
      campaignId: '101',
      campaignName: '脱敏计划甲',
      metricDate: '2026-07-29',
      impressions: '8',
      clicks: '0',
      costAmountScaled: '0'
    },
    {
      accountId: '1234',
      campaignId: '202',
      campaignName: '脱敏计划乙[已删除]',
      metricDate: '2026-07-29',
      impressions: '21',
      clicks: '1',
      costAmountScaled: '50'
    }
  ]);
  assert.deepEqual(captured.json, {
    header: {
      userName: '脱敏搜索账户',
      accessToken: 'access-token-fixture'
    },
    body: {
      reportType: 2290316,
      startDate: '2026-07-01',
      endDate: '2026-07-30',
      timeUnit: 'DAY',
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
      ],
      sorts: [],
      filters: [],
      startRow: 0,
      rowCount: 200,
      needSum: false
    }
  });
});

test('plan report follows totalRowCount pagination without exposing provider rows', async () => {
  const calls = [];
  const responses = [
    {
      header: { status: 0, failures: [] },
      body: {
        data: [{
          rowCount: 2,
          totalRowCount: 3,
          rows: [
            {
              userId: 1234,
              userName: '脱敏搜索账户',
              campaignId: 101,
              campaignNameStatus: '计划甲',
              date: '2026-07-28',
              impression: 3,
              click: 1,
              cost: 1.2
            },
            {
              userId: 1234,
              userName: '脱敏搜索账户',
              campaignId: 101,
              campaignNameStatus: '计划甲',
              date: '2026-07-29',
              impression: 4,
              click: 2,
              cost: 2
            }
          ]
        }]
      }
    },
    {
      header: { status: 0, failures: [] },
      body: {
        data: [{
          rowCount: 1,
          totalRowCount: 3,
          rows: [{
            userId: 1234,
            userName: '脱敏搜索账户',
            campaignId: 202,
            campaignNameStatus: '计划乙',
            date: '2026-07-29',
            impression: 5,
            click: 0,
            cost: 0
          }]
        }]
      }
    }
  ];
  const client = new BaiduMarketingClient({
    manifest: {
      ...manifest,
      searchPlanReport: {
        ...manifest.searchPlanReport,
        pageSize: 2,
        maxRows: 10
      }
    },
    ...config,
    transport: async (request) => {
      calls.push(request);
      return responses.shift();
    }
  });

  const rows = await client.fetchSearchReport({
    binding: {
      accountId: '1234',
      accountName: '脱敏搜索账户'
    },
    accessToken: 'access-token-fixture',
    coverage: {
      from: '2026-07-01',
      to: '2026-07-30'
    }
  });

  assert.equal(rows.length, 3);
  assert.deepEqual(
    calls.map((call) => call.json.body.startRow),
    [0, 2]
  );
});

test('plan report rejects account mismatches and cost precision beyond the pilot scale', async () => {
  const baseRow = {
    userId: 1234,
    userName: '脱敏搜索账户',
    campaignId: 101,
    campaignNameStatus: '计划甲',
    date: '2026-07-29',
    impression: 1,
    click: 1,
    cost: 0.001
  };
  const client = createClient(async () => ({
    header: { status: 0, failures: [] },
    body: {
      data: [{
        rowCount: 1,
        totalRowCount: 1,
        rows: [baseRow]
      }]
    }
  }));

  await assert.rejects(
    client.fetchSearchReport({
      binding: {
        accountId: '1234',
        accountName: '脱敏搜索账户'
      },
      accessToken: 'access-token-fixture',
      coverage: {
        from: '2026-07-01',
        to: '2026-07-30'
      }
    }),
    { code: 'BAIDU_REPORT_COST_SCALE_INVALID' }
  );

  const mismatchClient = createClient(async () => ({
    header: { status: 0, failures: [] },
    body: {
      data: [{
        rowCount: 1,
        totalRowCount: 1,
        rows: [{ ...baseRow, userId: 9999, cost: 1 }]
      }]
    }
  }));
  await assert.rejects(
    mismatchClient.fetchSearchReport({
      binding: {
        accountId: '1234',
        accountName: '脱敏搜索账户'
      },
      accessToken: 'access-token-fixture',
      coverage: {
        from: '2026-07-01',
        to: '2026-07-30'
      }
    }),
    { code: 'BAIDU_REPORT_RESPONSE_INVALID' }
  );
});

test('plan report rejects invalid and out-of-range response dates', async () => {
  const responseForDate = (date) => ({
    header: { status: 0, failures: [] },
    body: {
      data: [{
        rowCount: 1,
        totalRowCount: 1,
        rows: [{
          userId: 1234,
          userName: '脱敏搜索账户',
          campaignId: 101,
          campaignNameStatus: '计划甲',
          date,
          impression: 1,
          click: 1,
          cost: 1
        }]
      }]
    }
  });
  const request = {
    binding: {
      accountId: '1234',
      accountName: '脱敏搜索账户'
    },
    accessToken: 'access-token-fixture',
    coverage: {
      from: '2026-07-01',
      to: '2026-07-30'
    }
  };

  for (const date of ['2026-02-30', '2026-06-30']) {
    const client = createClient(async () => responseForDate(date));
    await assert.rejects(
      client.fetchSearchReport(request),
      { code: 'BAIDU_REPORT_RESPONSE_INVALID' }
    );
  }
});

test('Tongji site directory parses the redacted response fixture', async () => {
  let captured;
  const fixture = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    '../../modules/marketing/contracts/baidu/baidu-marketing-pilot-2026-07-30/fixtures/tongji-sites.success.redacted.json'
  ), 'utf8'));
  const client = createClient(async (request) => {
    captured = request;
    return fixture;
  });

  const sites = await client.listTongjiSites({
    accountName: '脱敏搜索账户',
    accessToken: 'access-token-fixture'
  });

  assert.deepEqual(sites, [
    {
      siteId: '301',
      domain: 'active.example.test',
      status: 'ACTIVE'
    },
    {
      siteId: '302',
      domain: 'paused.example.test',
      status: 'PAUSED'
    }
  ]);
  assert.deepEqual(captured.json, {
    header: {
      userName: '脱敏搜索账户',
      accessToken: 'access-token-fixture'
    },
    body: {}
  });
});

test('Tongji trend parses exact integers and formatted strings without truncating the requested days', async () => {
  let captured;
  const fixture = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    '../../modules/marketing/contracts/baidu/baidu-marketing-pilot-2026-07-30/fixtures/tongji-trend.success.redacted.json'
  ), 'utf8'));
  fixture.body.data[0].result.items[0] = [
    ['2026/07/30'],
    ['2026/07/29'],
    ['2026/07/28']
  ];
  fixture.body.data[0].result.items[1] = [
    ['1,234', 56, 40],
    ['--', '--', '--'],
    [123, 45, 30]
  ];
  const client = createClient(async (request) => {
    captured = request;
    return fixture;
  });

  const rows = await client.fetchTongjiTrend({
    accountName: '脱敏搜索账户',
    accessToken: 'access-token-fixture',
    siteId: '301',
    coverage: {
      from: '2026-07-28',
      to: '2026-07-30'
    }
  });

  assert.deepEqual(rows, [
    {
      date: '2026-07-28',
      pageviews: '123',
      visits: '45',
      visitors: '30'
    },
    {
      date: '2026-07-29',
      pageviews: null,
      visits: null,
      visitors: null
    },
    {
      date: '2026-07-30',
      pageviews: '1234',
      visits: '56',
      visitors: '40'
    }
  ]);
  assert.deepEqual(captured.json.body, {
    site_id: 301,
    method: 'trend/time/a',
    start_date: '20260728',
    end_date: '20260730',
    metrics: 'pv_count,visit_count,visitor_count',
    max_results: 3,
    gran: 'day'
  });
});

test('Tongji trend rejects truncated and unsafe numeric responses', async () => {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    '../../modules/marketing/contracts/baidu/baidu-marketing-pilot-2026-07-30/fixtures/tongji-trend.success.redacted.json'
  ), 'utf8'));
  fixture.body.data[0].result.total = 4;
  const truncatedClient = createClient(async () => fixture);

  await assert.rejects(
    truncatedClient.fetchTongjiTrend({
      accountName: '脱敏搜索账户',
      accessToken: 'access-token-fixture',
      siteId: '301',
      coverage: {
        from: '2026-07-01',
        to: '2026-07-30'
      }
    }),
    { code: 'BAIDU_TONGJI_RESPONSE_INVALID' }
  );

  fixture.body.data[0].result.total = 3;
  fixture.body.data[0].result.items[1][0][0] = Number.MAX_SAFE_INTEGER + 1;
  const unsafeClient = createClient(async () => fixture);
  await assert.rejects(
    unsafeClient.fetchTongjiTrend({
      accountName: '脱敏搜索账户',
      accessToken: 'access-token-fixture',
      siteId: '301',
      coverage: {
        from: '2026-07-01',
        to: '2026-07-30'
      }
    }),
    { code: 'BAIDU_TONGJI_RESPONSE_INVALID' }
  );
});

test('Tongji trend accepts only documented stable source filters', async () => {
  const calls = [];
  const fixture = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    '../../modules/marketing/contracts/baidu/baidu-marketing-pilot-2026-07-30/fixtures/tongji-trend.success.redacted.json'
  ), 'utf8'));
  const client = createClient(async (request) => {
    calls.push(request);
    return structuredClone(fixture);
  });
  const request = {
    accountName: '脱敏搜索账户',
    accessToken: 'access-token-fixture',
    siteId: '301',
    coverage: {
      from: '2026-07-28',
      to: '2026-07-30'
    }
  };

  for (const [sourceKey, providerValue] of [
    ['BAIDU_PAID', 'searchBaiduPro'],
    ['DIRECT', 'through'],
    ['SEARCH', 'search,0'],
    ['EXTERNAL', 'link'],
    ['BAIDU_NATURAL', 'searchBaiduNature'],
    ['OTHER_SEARCH', 'searchOther'],
    ['ENGINE:2', 'search,2']
  ]) {
    await client.fetchTongjiTrend({ ...request, sourceKey, device: 'pc' });
    assert.equal(calls.at(-1).json.body.source, providerValue);
    assert.equal(calls.at(-1).json.body.clientDevice, 'pc');
  }

  await client.fetchTongjiTrend({ ...request, sourceKey: 'ALL' });
  assert.equal(Object.hasOwn(calls.at(-1).json.body, 'source'), false);
  assert.equal(Object.hasOwn(calls.at(-1).json.body, 'clientDevice'), false);

  await client.fetchTongjiTrend({ ...request, device: 'all' });
  assert.equal(Object.hasOwn(calls.at(-1).json.body, 'clientDevice'), false);

  await assert.rejects(
    client.fetchTongjiTrend({ ...request, sourceKey: 'BAIDU' }),
    { code: 'BAIDU_TONGJI_SOURCE_INVALID', status: 400 }
  );
  await assert.rejects(
    client.fetchTongjiTrend({ ...request, device: 'tablet' }),
    { code: 'BAIDU_TONGJI_DEVICE_INVALID', status: 400 }
  );
});

test('Tongji quality parser preserves no-data and zero while runtime stays fail-closed', async () => {
  const request = {
    accountName: '脱敏搜索账户',
    accessToken: 'access-token-fixture',
    siteId: '301',
    coverage: { from: '2026-07-29', to: '2026-07-30' },
    device: 'all'
  };
  const disabledManifest = structuredClone(manifest);
  disabledManifest.tongji.qualityMetrics.runtimeEnabled = false;
  const disabledClient = new BaiduMarketingClient({
    manifest: disabledManifest,
    ...config,
    transport: async () => {
      throw new Error('unexpected request');
    }
  });
  await assert.rejects(
    disabledClient.fetchTongjiQualityTrend(request),
    { code: 'BAIDU_TONGJI_CAPABILITY_NOT_VERIFIED', status: 503 }
  );

  const verifiedManifest = structuredClone(manifest);
  verifiedManifest.tongji.qualityMetrics.runtimeEnabled = true;
  const response = {
    header: { status: 0, failures: [] },
    body: {
      data: [{
        result: {
          fields: [
            'simple_date_title',
            'bounce_ratio',
            'avg_visit_time',
            'avg_visit_pages'
          ],
          sum: [['42.60', '98.0', '2.500'], []],
          items: [
            [['2026/07/30'], ['2026/07/29']],
            [['--', 0, '0.00'], ['42.60', '98.0', '2.500']],
            [],
            []
          ],
          total: 2,
          offset: 0
        }
      }]
    }
  };
  let captured;
  const client = new BaiduMarketingClient({
    manifest: verifiedManifest,
    ...config,
    transport: async (outbound) => {
      captured = outbound;
      return response;
    }
  });
  assert.deepEqual(await client.fetchTongjiQualityTrend(request), {
    summary: {
      bounceRate: '42.6',
      averageVisitTimeSeconds: '98',
      averageVisitPages: '2.5'
    },
    rows: [
      {
        date: '2026-07-29',
        bounceRate: '42.6',
        averageVisitTimeSeconds: '98',
        averageVisitPages: '2.5'
      },
      {
        date: '2026-07-30',
        bounceRate: null,
        averageVisitTimeSeconds: '0',
        averageVisitPages: '0'
      }
    ]
  });
  assert.equal(Object.hasOwn(captured.json.body, 'clientDevice'), false);
  assert.equal(
    captured.json.body.metrics,
    'bounce_ratio,avg_visit_time,avg_visit_pages'
  );

  response.body.data[0].result.fields[1] = 'avg_visit_time';
  await assert.rejects(
    client.fetchTongjiQualityTrend(request),
    { code: 'BAIDU_TONGJI_RESPONSE_INVALID' }
  );
});

test('Tongji landing-page parser returns a strict paginated page contract', async () => {
  const verifiedManifest = structuredClone(manifest);
  verifiedManifest.tongji.pageReports.runtimeEnabled = true;
  let captured;
  const client = new BaiduMarketingClient({
    manifest: verifiedManifest,
    ...config,
    transport: async (outbound) => {
      captured = outbound;
      return {
        header: { status: 0, failures: [] },
        body: {
          data: [{
            result: {
              fields: [
                'visit_page_title',
                'visit_count',
                'out_pv_count',
                'bounce_ratio',
                'avg_visit_time',
                'avg_visit_pages'
              ],
              items: [
                [[{ name: 'https://gato.com.cn/', pageId: '101' }]],
                [['12', '35', '42.60', '98.0', '2.500']],
                [],
                []
              ],
              total: 1,
              offset: 0
            }
          }]
        }
      };
    }
  });

  const result = await client.fetchTongjiPageReport({
    accountName: '脱敏搜索账户',
    accessToken: 'access-token-fixture',
    siteId: '301',
    coverage: { from: '2026-07-29', to: '2026-07-30' },
    device: 'mobile',
    view: 'landing'
  });

  assert.deepEqual(result, {
    view: 'landing',
    total: 1,
    rows: [{
      pageId: '101',
      pageUrl: 'https://gato.com.cn/',
      visits: '12',
      contributionPageviews: '35',
      bounceRate: '42.6',
      averageVisitTimeSeconds: '98',
      averageVisitPages: '2.5'
    }]
  });
  assert.equal(captured.json.body.method, 'visit/landingpage/a');
  assert.equal(captured.json.body.clientDevice, 'mobile');
  assert.equal(captured.json.body.max_results, 100);
  assert.equal(captured.json.body.start_index, 0);
});

test('Tongji page reports paginate explicitly and normalize visited-page metrics', async () => {
  const verifiedManifest = structuredClone(manifest);
  verifiedManifest.tongji.pageReports.runtimeEnabled = true;
  const calls = [];
  const client = new BaiduMarketingClient({
    manifest: verifiedManifest,
    ...config,
    transport: async (outbound) => {
      calls.push(outbound.json.body);
      const offset = outbound.json.body.start_index;
      const pageId = offset === 0 ? '201' : '202';
      const suffix = offset === 0 ? 'product-a' : 'product-b';
      return {
        header: { status: 0, failures: [] },
        body: {
          data: [{
            result: {
              fields: [
                'visit_page_title',
                'pv_count',
                'visitor_count',
                'average_stay_time',
                'outward_count',
                'exit_ratio'
              ],
              items: [
                [[{ name: `https://gato.com.cn/${suffix}`, pageId }]],
                [[offset === 0 ? '30' : '20', '10', '12.5', '8', '40.00']],
                [],
                []
              ],
              total: 2,
              offset
            }
          }]
        }
      };
    }
  });

  const result = await client.fetchTongjiPageReport({
    accountName: '脱敏搜索账户',
    accessToken: 'access-token-fixture',
    siteId: '301',
    coverage: { from: '2026-07-29', to: '2026-07-30' },
    device: 'pc',
    view: 'visited'
  });

  assert.deepEqual(calls.map((call) => call.start_index), [0, 1]);
  assert.deepEqual(calls.map((call) => call.max_results), [100, 100]);
  assert.equal(calls[0].method, 'visit/toppage/a');
  assert.deepEqual(result.rows, [
    {
      pageId: '201',
      pageUrl: 'https://gato.com.cn/product-a',
      pageviews: '30',
      visitors: '10',
      averageStayTimeSeconds: '12.5',
      downstreamPageviews: '8',
      exitRate: '40'
    },
    {
      pageId: '202',
      pageUrl: 'https://gato.com.cn/product-b',
      pageviews: '20',
      visitors: '10',
      averageStayTimeSeconds: '12.5',
      downstreamPageviews: '8',
      exitRate: '40'
    }
  ]);
});

test('Tongji source reports normalize real source identities and device filters', async () => {
  const calls = [];
  const response = {
    header: { status: 0, failures: [] },
    body: {
      data: [{
        result: {
          fields: [
            'source_engine_title',
            'pv_count',
            'visit_count',
            'visitor_count'
          ],
          items: [
            [
              [{ name: '百度自然搜索', source: 'searchBaiduNature', url: 'baidu.test', engineId: '1' }],
              [{ name: 'Google', source: 'search,2', url: 'google.test', engineId: '2' }]
            ],
            [
              ['1,234', 56, 40],
              [123, 45, 30]
            ],
            [],
            []
          ],
          total: 2,
          offset: 0
        }
      }]
    }
  };
  const disabledManifest = structuredClone(manifest);
  disabledManifest.tongji.sourceReports.runtimeEnabled = false;
  const disabledClient = new BaiduMarketingClient({
    manifest: disabledManifest,
    ...config,
    transport: async () => {
      throw new Error('unexpected request');
    }
  });
  await assert.rejects(
    disabledClient.fetchTongjiSourceSummary({
      accountName: '脱敏搜索账户',
      accessToken: 'access-token-fixture',
      siteId: '301',
      coverage: { from: '2026-07-01', to: '2026-07-30' },
      reportKey: 'ENGINE',
      device: 'mobile'
    }),
    { code: 'BAIDU_TONGJI_CAPABILITY_NOT_VERIFIED', status: 503 }
  );
  const verifiedManifest = structuredClone(manifest);
  verifiedManifest.tongji.sourceReports.runtimeEnabled = true;
  const client = new BaiduMarketingClient({
    manifest: verifiedManifest,
    ...config,
    transport: async (request) => {
      calls.push(request);
      return response;
    }
  });

  const rows = await client.fetchTongjiSourceSummary({
    accountName: '脱敏搜索账户',
    accessToken: 'access-token-fixture',
    siteId: '301',
    coverage: { from: '2026-07-01', to: '2026-07-30' },
    reportKey: 'ENGINE',
    device: 'mobile'
  });

  assert.deepEqual(rows, [
    {
      name: '百度自然搜索',
      source: 'searchBaiduNature',
      engineId: '1',
      url: 'baidu.test',
      pageviews: '1234',
      visits: '56',
      visitors: '40'
    },
    {
      name: 'Google',
      source: 'search,2',
      engineId: '2',
      url: 'google.test',
      pageviews: '123',
      visits: '45',
      visitors: '30'
    }
  ]);
  assert.deepEqual(calls[0].json.body, {
    site_id: 301,
    method: 'source/engine/a',
    start_date: '20260701',
    end_date: '20260730',
    metrics: 'pv_count,visit_count,visitor_count',
    max_results: 100,
    clientDevice: 'mobile'
  });
});

test('Tongji trend rejects impossible calendar dates', async () => {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    '../../modules/marketing/contracts/baidu/baidu-marketing-pilot-2026-07-30/fixtures/tongji-trend.success.redacted.json'
  ), 'utf8'));
  fixture.body.data[0].result.items[0][0][0] = '2026/02/30';
  const client = createClient(async () => fixture);

  await assert.rejects(
    client.fetchTongjiTrend({
      accountName: '脱敏搜索账户',
      accessToken: 'access-token-fixture',
      siteId: '301',
      coverage: {
        from: '2026-01-01',
        to: '2026-07-30'
      }
    }),
    { code: 'BAIDU_TONGJI_RESPONSE_INVALID' }
  );
});

test('client rejects endpoints outside the versioned outbound allowlist', async () => {
  const client = createClient();

  for (const url of [
    'https://api.baidu.com/json/sms/service/CampaignService/updateCampaign',
    'https://u.baidu.com/oauth/accessToken?unexpected=1',
    'https://user:password@u.baidu.com/oauth/accessToken'
  ]) {
    await assert.rejects(
      client.requestJson({
        method: 'POST',
        url,
        json: {}
      }),
      { code: 'BAIDU_OUTBOUND_NOT_ALLOWED' }
    );
  }
});

test('authorization-code transport uncertainty is not downgraded to a safe failure', async () => {
  const secret = 'transport-secret-canary';
  const client = createClient(async () => {
    const error = new Error(secret);
    error.code = 'BAIDU_HTTP_ERROR';
    throw error;
  });

  await assert.rejects(
    client.exchangeAuthorizationCode({
      appId: config.appId,
      authCode: 'auth-code-fixture',
      userId: '1234'
    }),
    (error) => (
      error.code === 'OUTCOME_UNKNOWN'
      && !error.message.includes(secret)
    )
  );
});

test('report timeout covers a response body that never finishes', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (_url, options) => ({
    ok: true,
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          read() {
            return new Promise((_resolve, reject) => {
              options.signal.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
              }, { once: true });
            });
          },
          async cancel() {}
        };
      }
    }
  });
  const client = new BaiduMarketingClient({
    manifest,
    ...config,
    timeoutMs: 100
  });

  let safetyTimeout;
  try {
    await assert.rejects(
      Promise.race([
        client.fetchSearchReport({
          binding: {
            accountId: '1234',
            accountName: '脱敏搜索账户'
          },
          accessToken: 'access-token-fixture',
          coverage: { from: '2026-07-05', to: '2026-08-03' }
        }),
        new Promise((_, reject) => {
          safetyTimeout = setTimeout(() => {
            reject(Object.assign(new Error('测试未观测到超时'), {
              code: 'TEST_TIMEOUT_NOT_ENFORCED'
            }));
          }, 500);
        })
      ]),
      { code: 'BAIDU_REQUEST_TIMEOUT' }
    );
  } finally {
    clearTimeout(safetyTimeout);
  }
});

test('search-report aggregate byte budget counts raw response bytes and cancels the reader', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const response = {
    header: { status: 0, failures: [] },
    body: {
      data: [{
        rowCount: 1,
        totalRowCount: 1,
        rows: [{
          userId: 1234,
          userName: '脱敏搜索账户',
          date: '2026-08-03',
          campaignId: 1,
          campaignNameStatus: '品牌推广',
          impression: 10,
          click: 2,
          cost: 1
        }]
      }]
    }
  };
  const compact = JSON.stringify(response);
  const maxResponseBytes = Buffer.byteLength(compact, 'utf8') + 32;
  const raw = Buffer.from(`${compact}${' '.repeat(64)}`, 'utf8');
  let cancelled = false;
  global.fetch = async () => ({
    ok: true,
    headers: { get: () => null },
    body: {
      getReader() {
        let read = false;
        return {
          async read() {
            if (read) return { done: true, value: undefined };
            read = true;
            return { done: false, value: raw };
          },
          async cancel() { cancelled = true; }
        };
      }
    }
  });
  const client = new BaiduMarketingClient({
    manifest,
    ...config,
    searchReportBudgetLimits: {
      maxRequests: 10,
      maxRows: 10,
      maxResponseBytes,
      maxDurationMs: 1000
    }
  });

  await assert.rejects(
    client.fetchSearchReport({
      binding: {
        accountId: '1234',
        accountName: '脱敏搜索账户'
      },
      accessToken: 'access-token-fixture',
      coverage: { from: '2026-07-05', to: '2026-08-03' },
      budget: client.createSearchReportBudget()
    }),
    { code: 'BAIDU_RESPONSE_TOO_LARGE' }
  );
  assert.equal(cancelled, true);
});

test('transport cancels unread bodies on HTTP and Content-Length rejection', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const cancellations = [];
  const responses = [
    { ok: false, status: 503, contentLength: null, label: 'http' },
    { ok: true, status: 200, contentLength: String(2 * 1024 * 1024), label: 'length' }
  ];
  global.fetch = async () => {
    const response = responses.shift();
    return {
      ok: response.ok,
      status: response.status,
      headers: { get: () => response.contentLength },
      body: {
        async cancel() { cancellations.push(response.label); }
      }
    };
  };
  const client = new BaiduMarketingClient({ manifest, ...config });
  const request = () => client.requestJson({
    method: 'POST',
    url: manifest.oauth.token.url,
    json: {}
  });

  await assert.rejects(request(), { code: 'BAIDU_HTTP_ERROR' });
  await assert.rejects(request(), { code: 'BAIDU_RESPONSE_TOO_LARGE' });
  assert.deepEqual(cancellations, ['http', 'length']);
});
