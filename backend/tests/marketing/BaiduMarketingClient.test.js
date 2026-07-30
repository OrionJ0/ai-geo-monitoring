const assert = require('node:assert/strict');
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

const manifest = loadBaiduContract('baidu-marketing-docs-2026-07-30');
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

test('plan report sends only documented SEARCH fields and blocks undocumented response parsing', async () => {
  let captured;
  const client = createClient(async (request) => {
    captured = request;
    return {
      header: {
        status: 0,
        desc: 'success',
        failures: []
      },
      body: {
        undocumentedShape: []
      }
    };
  });

  await assert.rejects(
    client.fetchSearchReport({
      binding: {
        accountId: '1234',
        accountName: '主账户'
      },
      accessToken: 'access-token-fixture',
      coverage: {
        from: '2026-07-01',
        to: '2026-07-30'
      }
    }),
    { code: 'BAIDU_REPORT_RESPONSE_UNVERIFIED' }
  );
  assert.deepEqual(captured.json, {
    header: {
      userName: '主账户',
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
