const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createMarketingModule
} = require('../../modules/marketing');
const {
  buildMarketingCapabilities
} = require('../../modules/marketing/marketingCapabilities');
const {
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
  assert.equal(
    (await dashboard.json()).states.moduleState,
    'PILOT_DATA_READY'
  );
  await module.shutdown();
});

test('pilot data route reads the explicitly bound Tongji site when multiple sites are active', async (t) => {
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
         access_token_expires_at = '2099-01-01T00:00:00.000Z'
     WHERE id = 'connection-1'`,
    {
      replacements: {
        ciphertext: encryptSecret('access-token-test', env.CONFIG_ENCRYPTION_KEY)
      }
    }
  );
  const requestedSiteIds = [];
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
      async listTongjiSites() {
        return [
          { siteId: '11111111', domain: 'other.example', status: 'ACTIVE' },
          { siteId: '23412673', domain: 'gato.com.cn', status: 'ACTIVE' }
        ];
      },
      async fetchTongjiTrend({ siteId }) {
        requestedSiteIds.push(siteId);
        return [{
          date: '2026-08-03',
          pageviews: null,
          visits: null,
          visitors: null
        }];
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

  const response = await fetch(
    `${baseUrl}/api/marketing/projects/11/tongji-trend`
  );
  const body = await response.json();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await module.shutdown();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.site.siteId, '23412673');
  assert.deepEqual(requestedSiteIds, ['23412673']);
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
