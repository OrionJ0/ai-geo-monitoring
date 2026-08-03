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

test('Tongji trend parses exact strings and preserves provider no-data markers', async () => {
  let captured;
  const fixture = JSON.parse(fs.readFileSync(path.resolve(
    __dirname,
    '../../modules/marketing/contracts/baidu/baidu-marketing-pilot-2026-07-30/fixtures/tongji-trend.success.redacted.json'
  ), 'utf8'));
  const client = createClient(async (request) => {
    captured = request;
    return fixture;
  });

  const rows = await client.fetchTongjiTrend({
    accountName: '脱敏搜索账户',
    accessToken: 'access-token-fixture',
    siteId: '301',
    coverage: {
      from: '2026-07-01',
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
    start_date: '20260701',
    end_date: '20260730',
    metrics: 'pv_count,visit_count,visitor_count',
    max_results: 0,
    gran: 'day'
  });
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
      from: '2026-07-01',
      to: '2026-07-30'
    }
  };

  for (const [sourceKey, providerValue] of [
    ['DIRECT', 'through'],
    ['SEARCH', 'search,0'],
    ['EXTERNAL', 'link']
  ]) {
    await client.fetchTongjiTrend({ ...request, sourceKey });
    assert.equal(calls.at(-1).json.body.source, providerValue);
  }

  await client.fetchTongjiTrend({ ...request, sourceKey: 'ALL' });
  assert.equal(Object.hasOwn(calls.at(-1).json.body, 'source'), false);

  await assert.rejects(
    client.fetchTongjiTrend({ ...request, sourceKey: 'BAIDU' }),
    { code: 'BAIDU_TONGJI_SOURCE_INVALID', status: 400 }
  );
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
