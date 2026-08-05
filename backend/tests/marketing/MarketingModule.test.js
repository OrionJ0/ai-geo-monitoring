const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createConcurrencyGate,
  createMarketingModule
} = require('../../modules/marketing');
const {
  buildMarketingCapabilities
} = require('../../modules/marketing/marketingCapabilities');
const {
  campaignOnlyReports,
  createMarketingTestDatabase,
  seedConnectionAndBinding
} = require('./helpers/createMarketingTestDatabase');
const {
  encryptSecret
} = require('../../services/SecretEncryptionService');

function expectedStatus(moduleState, errorCode = null) {
  return {
    moduleState,
    errorCode,
    capabilities: buildMarketingCapabilities(moduleState)
  };
}

test('Tongji concurrency gate limits bursts and releases capacity after rejection', async () => {
  const run = createConcurrencyGate(2);
  let active = 0;
  let maximum = 0;
  const task = (shouldFail = false) => run(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (shouldFail) throw new Error('synthetic failure');
    return 'ok';
  });

  const outcomes = await Promise.allSettled([
    task(), task(true), task(), task(), task()
  ]);

  assert.equal(maximum, 2);
  assert.deepEqual(
    outcomes.map((outcome) => outcome.status),
    ['fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled']
  );
});

test('Tongji concurrency gate rejects excess queued work with retry metadata', async () => {
  const run = createConcurrencyGate(1, {
    maxQueue: 1,
    waitTimeoutMs: 1_000
  });
  let releaseFirst;
  let signalStarted;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  const first = run(() => new Promise((resolve) => {
    releaseFirst = resolve;
    signalStarted();
  }));
  await started;

  const second = run(async () => 'queued');
  await assert.rejects(
    run(async () => 'rejected'),
    (error) => error.code === 'BAIDU_TONGJI_QUEUE_FULL'
      && error.status === 503
      && error.retryAfterSeconds === 2
  );

  releaseFirst('first');
  assert.deepEqual(await Promise.all([first, second]), ['first', 'queued']);
});

test('Tongji concurrency gate expires work that waits too long', async () => {
  const run = createConcurrencyGate(1, {
    maxQueue: 1,
    waitTimeoutMs: 10
  });
  let releaseFirst;
  let signalStarted;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  const first = run(() => new Promise((resolve) => {
    releaseFirst = resolve;
    signalStarted();
  }));
  await started;

  await assert.rejects(
    run(async () => 'expired'),
    (error) => error.code === 'BAIDU_TONGJI_QUEUE_TIMEOUT'
      && error.status === 503
      && error.retryAfterSeconds === 2
  );

  releaseFirst('first');
  assert.equal(await first, 'first');
});

function enabledConfig(overrides = {}) {
  return {
    NODE_ENV: 'production',
    MARKETING_MONITORING_ENABLED: 'true',
    MARKETING_MONITORING_PILOT_MODE: 'false',
    MARKETING_MONITORING_ALLOWED_PROJECT_IDS: 'project-1',
    CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
    BAIDU_MARKETING_APP_ID: 'app-id-canary',
    BAIDU_MARKETING_SECRET_KEY: '0123456789abcdef-module-secret-canary',
    BAIDU_MARKETING_SCOPE: 'search-report-read-canary',
    BAIDU_MARKETING_REDIRECT_URI: 'https://marketing.example.test/api/admin/marketing/baidu/oauth/callback',
    BAIDU_MARKETING_CONTRACT_VERSION: 'baidu-search-test-v1',
    BAIDU_MARKETING_HTTP_TIMEOUT_MS: '10000',
    ...overrides
  };
}

const loadVerifiedContract = () => ({
  status: 'VERIFIED',
  productionAllowlist: ['GET https://provider.example.test/report'],
  blockers: [],
  oauth: {
    authorization: {
      approvedScopeValues: ['search-report-read-canary']
    }
  },
  runtime: {
    adapterImplemented: true,
    reportResponseParserImplemented: true
  },
  money: { currencyCode: 'CNY', costScale: 6 }
});

async function callStatusRoute(module, role) {
  const layers = [...module.router.stack];
  let layer = null;
  while (layers.length && !layer) {
    const candidate = layers.shift();
    if (
      candidate.route?.path === '/status'
      && candidate.route.methods?.get
    ) {
      layer = candidate;
    } else if (candidate.handle?.stack) {
      layers.push(...candidate.handle.stack);
    }
  }
  assert.ok(layer, 'GET /status route should exist');

  const req = { user: { id: 1, role } };
  const response = {
    statusCode: 200,
    payload: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
  await layer.route.stack[0].handle(req, response);
  return response;
}

test('disabled module never audits marketing schema', async () => {
  let auditCalls = 0;
  const module = createMarketingModule({
    env: {},
    migrationAuditor: {
      async audit() {
        auditCalls += 1;
        throw new Error('disabled module must not inspect marketing schema');
      }
    }
  });

  assert.deepEqual(await module.getStatus(), expectedStatus('DISABLED'));
  assert.equal(auditCalls, 0);
});

test('status route reveals missing config key names only to administrators', async () => {
  const module = createMarketingModule({
    env: {
      MARKETING_MONITORING_ENABLED: 'true',
      BAIDU_MARKETING_SECRET_KEY: '0123456789abcdef-module-secret-canary'
    }
  });

  const userResponse = await callStatusRoute(module, 'user');
  const adminResponse = await callStatusRoute(module, 'admin');

  assert.equal(userResponse.statusCode, 200);
  assert.deepEqual(
    userResponse.payload,
    expectedStatus('MISCONFIGURED', 'MARKETING_CONFIG_INCOMPLETE')
  );
  assert.ok(adminResponse.payload.missingKeys.length > 0);
  assert.doesNotMatch(JSON.stringify(userResponse.payload), /module-secret-canary/);
  assert.doesNotMatch(JSON.stringify(adminResponse.payload), /module-secret-canary/);
  assert.equal(userResponse.headers['cache-control'], 'private, no-store');
});

test('enabled module distinguishes missing schema from a ready migration ledger', async () => {
  const missing = createMarketingModule({
    env: enabledConfig(),
    contractLoader: loadVerifiedContract,
    migrationAuditor: {
      async audit() {
        return { ready: false };
      }
    }
  });
  const ready = createMarketingModule({
    env: enabledConfig(),
    contractLoader: loadVerifiedContract,
    migrationAuditor: {
      async audit() {
        return { ready: true };
      }
    }
  });

  assert.deepEqual(
    await missing.getStatus(),
    expectedStatus('SCHEMA_MISSING', 'MARKETING_SCHEMA_MISSING')
  );
  assert.deepEqual(await ready.getStatus(), expectedStatus('READY'));
});

test('pilot module exposes OAuth callback parsing but blocks dashboard runtime', async (t) => {
  const database = await createMarketingTestDatabase('marketing-pilot-module-');
  t.after(database.close);
  const module = createMarketingModule({
    env: enabledConfig({
      MARKETING_MONITORING_PILOT_MODE: 'true',
      BAIDU_MARKETING_CONTRACT_VERSION:
        'baidu-marketing-docs-2026-07-30'
    }),
    sequelize: database.sequelize
  });
  assert.deepEqual(await module.getStatus(), expectedStatus('PILOT_READY'));
  assert.deepEqual(await module.start(), expectedStatus('PILOT_READY'));

  const app = express();
  app.use('/api/admin/marketing/baidu', module.authorizationRouter);
  app.use('/api/marketing', module.router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const invalidCallback = await fetch(
    `${baseUrl}/api/admin/marketing/baidu/oauth/callback`
  );
  assert.equal(invalidCallback.status, 400);
  assert.equal(
    (await invalidCallback.json()).error.code,
    'OAUTH_CALLBACK_INVALID'
  );
  const dashboard = await fetch(
    `${baseUrl}/api/marketing/projects/11/dashboard`
  );
  assert.equal(dashboard.status, 503);
  assert.equal(
    (await dashboard.json()).error.code,
    'MARKETING_PILOT_AUTH_ONLY'
  );
});

test('pilot data module mounts allowlisted binding and dashboard routes', async (t) => {
  const database = await createMarketingTestDatabase(
    'marketing-pilot-data-module-'
  );
  t.after(database.close);
  const module = createMarketingModule({
    env: enabledConfig({
      MARKETING_MONITORING_PILOT_MODE: 'true',
      MARKETING_MONITORING_ALLOWED_PROJECT_IDS: '11',
      BAIDU_MARKETING_SCOPE: '67,71,1004606,1002161',
      BAIDU_MARKETING_CONTRACT_VERSION:
        'baidu-marketing-pilot-2026-07-30'
    }),
    sequelize: database.sequelize
  });

  assert.deepEqual(
    await module.getStatus(),
    expectedStatus('PILOT_DATA_READY')
  );
  assert.deepEqual(
    await module.start(),
    expectedStatus('PILOT_DATA_READY')
  );

  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 2, role: 'user', status: 'active' };
    next();
  });
  app.use('/api/marketing', module.router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const dashboard = await fetch(
    `${baseUrl}/api/marketing/projects/11/dashboard`
  );
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.headers.get('cache-control'), 'private, no-store');
  assert.equal(
    (await dashboard.json()).states.moduleState,
    'PILOT_DATA_READY'
  );
  await module.shutdown();
});

test('pilot data module requests advertising on dashboard access instead of a timer', async (t) => {
  const database = await createMarketingTestDatabase(
    'marketing-on-demand-module-'
  );
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, {
    accountId: 'search-account-1',
    projectId: 11
  });
  const env = enabledConfig({
    MARKETING_MONITORING_PILOT_MODE: 'true',
    MARKETING_MONITORING_ALLOWED_PROJECT_IDS: '11',
    BAIDU_MARKETING_SCOPE: '67,71,1004606,1002161',
    BAIDU_MARKETING_CONTRACT_VERSION:
      'baidu-marketing-pilot-2026-07-30'
  });
  await database.sequelize.query(
    `UPDATE baidu_marketing_connections
     SET access_token_ciphertext = :ciphertext,
         access_token_expires_at = '2099-01-01T00:00:00.000Z'
     WHERE id = 'connection-1'`,
    {
      replacements: {
        ciphertext: encryptSecret(
          'search-token-test',
          env.CONFIG_ENCRYPTION_KEY
        )
      }
    }
  );
  let reportCalls = 0;
  const module = createMarketingModule({
    env,
    sequelize: database.sequelize,
    provider: {
      async fetchSearchReports({ binding, coverage, accessToken }) {
        reportCalls += 1;
        assert.equal(accessToken, 'search-token-test');
        const campaign = {
          accountId: binding.accountId,
          campaignId: 'on-demand-campaign',
          campaignName: '按需刷新',
          metricDate: coverage.to,
          impressions: '10',
          clicks: '2',
          costAmountScaled: '3000000'
        };
        const adGroup = {
          ...campaign,
          adGroupId: 'on-demand-ad-group',
          adGroupName: '按需刷新单元'
        };
        return {
          campaigns: [campaign],
          adGroups: [adGroup],
          keywords: [{
            ...adGroup,
            keywordId: 'on-demand-keyword',
            keywordName: '周界报警',
            targetingType: 'KEYWORD'
          }],
          searchTerms: [{
            ...adGroup,
            keywordName: '周界报警',
            searchTerm: '周界报警厂家',
            queryStatus: 'NOT_ADDED',
            matchType: 'PHRASE'
          }]
        };
      }
    }
  });
  await module.start();
  assert.equal(reportCalls, 0, '模块启动不得请求百度推广');

  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 2, role: 'user', status: 'active' };
    next();
  });
  app.use('/api/marketing', module.router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const first = await fetch(
    `${baseUrl}/api/marketing/projects/11/dashboard`
  );
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.summary.impressions, '10');
  assert.equal(firstBody.adGroups[0].adGroupId, 'on-demand-ad-group');
  assert.equal(firstBody.keywords[0].keywordId, 'on-demand-keyword');
  assert.equal(firstBody.searchTerms[0].searchTerm, '周界报警厂家');
  assert.equal('keywordId' in firstBody.searchTerms[0], false);
  assert.equal(reportCalls, 1);

  const cached = await fetch(
    `${baseUrl}/api/marketing/projects/11/dashboard`
  );
  assert.equal(cached.status, 200);
  assert.equal((await cached.json()).summary.impressions, '10');
  assert.equal(reportCalls, 1);
  await module.shutdown();
});

test('pilot data route uses the unified OAuth token and explicitly bound site', async (t) => {
  const database = await createMarketingTestDatabase(
    'marketing-explicit-tongji-site-'
  );
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize, {
    accountId: 'search-account-1',
    projectId: 11,
    tongjiSiteId: '23412673',
    tongjiSiteDomain: 'gato.com.cn'
  });
  const env = enabledConfig({
    MARKETING_MONITORING_PILOT_MODE: 'true',
    MARKETING_MONITORING_ALLOWED_PROJECT_IDS: '11',
    BAIDU_MARKETING_SCOPE: '67,71,1004606,1002161',
    BAIDU_MARKETING_CONTRACT_VERSION:
      'baidu-marketing-pilot-2026-07-30'
  });
  await database.sequelize.query(
    `UPDATE baidu_marketing_connections
     SET access_token_ciphertext = :ciphertext,
         tongji_user_name = 'shb-广拓信息',
         tongji_user_name_verified_at = '2099-01-01T00:00:00.000Z',
         tongji_account_name = 'legacy-account-canary',
         tongji_access_token_ciphertext = 'not-a-valid-legacy-ciphertext',
         access_token_expires_at = '2099-01-01T00:00:00.000Z'
     WHERE id = 'connection-1'`,
    {
      replacements: {
        ciphertext: encryptSecret('unified-oauth-token-test', env.CONFIG_ENCRYPTION_KEY)
      }
    }
  );
  const tongjiReportCalls = [];
  const tongjiCredentials = [];
  const module = createMarketingModule({
    env,
    sequelize: database.sequelize,
    provider: {
      async listAccounts() {
        return [{
          accountId: 'search-account-1',
          accountName: '搜索账户',
          product: 'SEARCH',
          readOnly: true
        }];
      },
      async listTongjiSites({ accountName, accessToken }) {
        tongjiCredentials.push({ accountName, accessToken });
        return [
          { siteId: '11111111', domain: 'other.example', status: 'ACTIVE' },
          { siteId: '23412673', domain: 'gato.com.cn', status: 'ACTIVE' }
        ];
      },
      async fetchTongjiTrend({ siteId, sourceKey = 'ALL', device, coverage }) {
        tongjiReportCalls.push({
          kind: 'trend',
          siteId,
          sourceKey,
          device,
          coverage
        });
        return [{
          date: coverage.from,
          pageviews: null,
          visits: null,
          visitors: null
        }];
      },
      async fetchTongjiSourceSummary({ siteId, reportKey, device }) {
        tongjiReportCalls.push({ kind: 'summary', siteId, reportKey, device });
        return [];
      },
      async fetchTongjiQualityTrend() {
        return null;
      }
    }
  });
  await module.start();

  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 2, role: 'user', status: 'active' };
    next();
  });
  app.use('/api/marketing', module.router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const url = (
    `${baseUrl}/api/marketing/projects/11/website-traffic-overview`
    + '?device=pc&from=2026-08-03&to=2026-08-03'
    + '&source=ALL&metric=visits'
  );
  const response = await fetch(url);
  const body = await response.json();
  const retiredResponse = await fetch(
    `${baseUrl}/api/marketing/projects/11/tongji-trend`
  );
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await module.shutdown();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.site.domain, 'gato.com.cn');
  assert.equal(body.selectedSource.sourceKey, 'ALL');
  assert.equal(retiredResponse.status, 404);
  assert.equal(tongjiReportCalls.length, 6);
  assert.ok(tongjiReportCalls.every((call) => (
    call.siteId === '23412673' && call.device === 'pc'
  )));
  assert.deepEqual(
    tongjiReportCalls.filter((call) => call.kind === 'summary').map(
      (call) => call.reportKey
    ),
    ['ALL', 'ENGINE', 'ALL', 'ENGINE']
  );
  assert.deepEqual(
    tongjiReportCalls.filter((call) => call.kind === 'trend').map((call) => call.sourceKey),
    ['ALL', 'ALL']
  );
  assert.deepEqual(tongjiCredentials, [
    {
      accountName: 'shb-广拓信息',
      accessToken: 'unified-oauth-token-test'
    },
    {
      accountName: 'shb-广拓信息',
      accessToken: 'unified-oauth-token-test'
    }
  ]);
});

test('marketing runtime has no legacy Tongji credential service or resolver', () => {
  const moduleSource = fs.readFileSync(
    path.resolve(__dirname, '../../modules/marketing/index.js'),
    'utf8'
  );
  assert.doesNotMatch(moduleSource, /BaiduTongjiCredentialService/u);
  assert.doesNotMatch(moduleSource, /tongjiCredentialService/u);
  assert.doesNotMatch(moduleSource, /getCredential/u);
  assert.doesNotMatch(moduleSource, /tongji_access_token_ciphertext/u);
  assert.doesNotMatch(moduleSource, /resolveBoundContext/u);
  assert.equal((moduleSource.match(/withBoundContext/gu) || []).length, 3);
});

test('the application mounts marketing through its facade without changing global readiness inputs', () => {
  const appSource = fs.readFileSync(
    path.resolve(__dirname, '../../app.js'),
    'utf8'
  );

  assert.match(appSource, /createMarketingModule/);
  assert.match(
    appSource,
    /app\.use\('\/api\/marketing',\s*authRequired,\s*marketingModule\.router\)/
  );
  assert.match(
    appSource,
    /marketingModule\.authorizationRouter/
  );
  assert.match(appSource, /await marketingModule\.start\(\)/);
  assert.match(
    appSource,
    /const ready = database\.status === 'ready' && scheduler\.started === true/
  );
  assert.doesNotMatch(
    appSource,
    /const ready = [^\n]*marketing/
  );
});
