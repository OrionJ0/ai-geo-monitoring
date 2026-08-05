const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { once } = require('node:events');
const test = require('node:test');
const { QueryTypes } = require('sequelize');

const {
  createBaiduBindingRouter
} = require('../../modules/marketing/routes/baiduBindingRoutes');
const {
  BaiduConnectionService
} = require('../../modules/marketing/services/BaiduConnectionService');
const {
  BaiduTongjiContextService
} = require('../../modules/marketing/services/BaiduTongjiContextService');
const {
  encryptSecret
} = require('../../services/SecretEncryptionService');
const {
  createMarketingTestDatabase,
  seedConnectionAndBinding
} = require('./helpers/createMarketingTestDatabase');

const ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64');
const NOW = Date.parse('2026-08-05T10:00:00.000Z');

async function seedOAuthContext(sequelize, {
  userName = 'old-user',
  verifiedAt = '2026-08-05T09:30:00.000Z'
} = {}) {
  await seedConnectionAndBinding(sequelize, {
    tongjiSiteId: '23412673',
    tongjiSiteDomain: 'gato.com.cn'
  });
  await sequelize.query(
    `UPDATE baidu_marketing_connections
     SET access_token_ciphertext = :oauthCiphertext,
         access_token_expires_at = '2026-08-05T11:00:00.000Z',
         tongji_user_name = :userName,
         tongji_user_name_verified_at = :verifiedAt
     WHERE id = 'connection-1'`,
    {
      replacements: {
        oauthCiphertext: encryptSecret('oauth-access-token', ENCRYPTION_KEY),
        userName,
        verifiedAt
      }
    }
  );
}

function createContextService(sequelize, provider, overrides = {}) {
  const connectionService = new BaiduConnectionService({
    sequelize,
    provider: {},
    encryptionKey: ENCRYPTION_KEY,
    clock: () => NOW,
    wait: async () => {}
  });
  return new BaiduTongjiContextService({
    sequelize,
    provider,
    connectionService,
    runTongjiRequest: (task) => task(),
    clock: () => NOW,
    ...overrides
  });
}

async function listen(app) {
  const server = http.createServer(app);
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  return server;
}

test('admin saves only a verified userName in the unified context', async (t) => {
  const database = await createMarketingTestDatabase('tongji-context-api-');
  t.after(database.close);
  await seedOAuthContext(database.sequelize);
  const providerCalls = [];
  const contextService = createContextService(database.sequelize, {
    async listTongjiSites(request) {
      providerCalls.push(request);
      return [
        { siteId: '23412673', domain: 'gato.com.cn', status: 'ACTIVE' },
        { siteId: '999', domain: 'paused.example', status: 'PAUSED' }
      ];
    }
  });
  const app = express();
  app.use(express.json());
  app.use('/api/admin/marketing/baidu', createBaiduBindingRouter({
    service: {},
    tongjiContextService: contextService,
    includeAccounts: false,
    includeBindings: false,
    adminRequired(req, _res, next) {
      req.user = { id: 1, role: 'admin' };
      next();
    }
  }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const invalid = await fetch(
    `${baseUrl}/api/admin/marketing/baidu/connections/connection-1/tongji-context`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userName: 'new-user',
        accessToken: 'must-be-rejected'
      })
    }
  );
  assert.equal(invalid.status, 400);
  assert.equal(
    (await invalid.json()).error.code,
    'TONGJI_CONTEXT_REQUEST_INVALID'
  );
  const emptyUserName = await fetch(
    `${baseUrl}/api/admin/marketing/baidu/connections/connection-1/tongji-context`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: '   ' })
    }
  );
  assert.equal(emptyUserName.status, 400);
  assert.equal(
    (await emptyUserName.json()).error.code,
    'TONGJI_CONTEXT_REQUEST_INVALID'
  );

  const response = await fetch(
    `${baseUrl}/api/admin/marketing/baidu/connections/connection-1/tongji-context`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: ' new-user ' })
    }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    userName: 'new-user',
    siteCount: 1,
    verifiedAt: '2026-08-05T10:00:00.000Z'
  });
  assert.deepEqual(providerCalls, [{
    accountName: 'new-user',
    accessToken: 'oauth-access-token'
  }]);

  const rows = await database.sequelize.query(
    `SELECT tongji_user_name, tongji_user_name_verified_at,
            tongji_access_state, tongji_observed_auth_generation,
            tongji_observed_token_version
     FROM baidu_marketing_connections
     WHERE id = 'connection-1'`,
    { type: QueryTypes.SELECT }
  );
  assert.equal(rows[0].tongji_user_name, 'new-user');
  assert.equal(
    rows[0].tongji_user_name_verified_at,
    '2026-08-05T10:00:00.000Z'
  );
  assert.equal(rows[0].tongji_access_state, 'VERIFIED');
  assert.equal(rows[0].tongji_observed_auth_generation, 0);
  assert.equal(rows[0].tongji_observed_token_version, 1);
  const [bindings] = await database.sequelize.query(
    `SELECT status, paused_reason, binding_version
     FROM baidu_project_bindings
     WHERE id = 'binding-1'`
  );
  assert.deepEqual(bindings[0], {
    status: 'PAUSED',
    paused_reason: 'TONGJI_CONTEXT_CHANGED',
    binding_version: 1
  });
});

test('userName verification uses version CAS and rejects a late result', async (t) => {
  const database = await createMarketingTestDatabase('tongji-context-cas-');
  t.after(database.close);
  await seedOAuthContext(database.sequelize, { userName: null, verifiedAt: null });
  const contextService = createContextService(database.sequelize, {
    async listTongjiSites() {
      await database.sequelize.query(
        `UPDATE baidu_marketing_connections
         SET token_version = token_version + 1,
             tongji_user_name_verified_at = NULL
         WHERE id = 'connection-1'`
      );
      return [{ siteId: '23412673', domain: 'gato.com.cn', status: 'ACTIVE' }];
    }
  });

  await assert.rejects(
    contextService.configure({
      connectionId: 'connection-1',
      userName: 'late-user'
    }),
    { code: 'TONGJI_CONTEXT_VERSION_CHANGED', status: 409 }
  );
  const [rows] = await database.sequelize.query(
    `SELECT tongji_user_name, tongji_user_name_verified_at
     FROM baidu_marketing_connections
     WHERE id = 'connection-1'`
  );
  assert.equal(rows[0].tongji_user_name, null);
  assert.equal(rows[0].tongji_user_name_verified_at, null);
});

test('bound context refreshes stale ownership once and rejects a changed domain', async (t) => {
  const database = await createMarketingTestDatabase('tongji-context-ttl-');
  t.after(database.close);
  await seedOAuthContext(database.sequelize, {
    verifiedAt: '2026-08-04T09:59:59.000Z'
  });
  let directoryCalls = 0;
  const contextService = createContextService(database.sequelize, {
    async listTongjiSites({ accountName, accessToken }) {
      directoryCalls += 1;
      assert.equal(accountName, 'old-user');
      assert.equal(accessToken, 'oauth-access-token');
      return [{ siteId: '23412673', domain: 'gato.com.cn', status: 'ACTIVE' }];
    }
  });
  const binding = {
    id: 'connection-1',
    binding_id: 'binding-1',
    binding_version: 0,
    tongji_site_id: '23412673',
    tongji_site_domain: 'gato.com.cn'
  };

  const first = await contextService.resolveBoundContext(binding);
  assert.equal(first.accountName, 'old-user');
  assert.equal(first.accessToken, 'oauth-access-token');
  assert.equal(first.site.domain, 'gato.com.cn');
  assert.equal(directoryCalls, 1);
  await contextService.resolveBoundContext(binding);
  assert.equal(directoryCalls, 1, '24 小时 TTL 内不得重复读取站点目录');
  await contextService.resolveBoundContext({
    ...binding,
    binding_version: 1
  });
  assert.equal(directoryCalls, 2, '绑定版本变化必须重新读取站点目录');

  await assert.rejects(
    contextService.resolveBoundContext({
      ...binding,
      tongji_site_domain: 'changed.example'
    }, { forceVerification: true }),
    { code: 'BAIDU_TONGJI_SITE_DOMAIN_CHANGED', status: 409 }
  );
  assert.equal(directoryCalls, 3);
});

test('OAuth failure returns the unified context error without alternate credentials', async (t) => {
  const database = await createMarketingTestDatabase('tongji-unified-error-');
  t.after(database.close);
  await seedOAuthContext(database.sequelize);
  await database.sequelize.query(
    `UPDATE baidu_marketing_connections
     SET access_token_ciphertext = 'not-a-valid-oauth-ciphertext'
     WHERE id = 'connection-1'`
  );
  let providerCalls = 0;
  const contextService = createContextService(database.sequelize, {
    async listTongjiSites() {
      providerCalls += 1;
      return [];
    }
  });

  await assert.rejects(
    contextService.resolveBoundContext({
      id: 'connection-1',
      binding_id: 'binding-1',
      binding_version: 0,
      tongji_site_id: '23412673',
      tongji_site_domain: 'gato.com.cn'
    })
  );
  assert.equal(providerCalls, 0);
});

test('context API stabilizes account mismatch and queue retry contracts', async (t) => {
  const database = await createMarketingTestDatabase('tongji-context-errors-');
  t.after(database.close);
  await seedOAuthContext(database.sequelize);
  let providerError = Object.assign(new Error('provider account mismatch'), {
    code: 'BAIDU_TONGJI_ACCOUNT_INVALID',
    status: 502
  });
  const contextService = createContextService(database.sequelize, {
    async listTongjiSites() {
      throw providerError;
    }
  });
  const app = express();
  app.use(express.json());
  app.use('/api/admin/marketing/baidu', createBaiduBindingRouter({
    service: {},
    tongjiContextService: contextService,
    includeAccounts: false,
    includeBindings: false,
    adminRequired(req, _res, next) {
      req.user = { id: 1, role: 'admin' };
      next();
    }
  }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const endpoint = (
    `http://127.0.0.1:${server.address().port}`
    + '/api/admin/marketing/baidu/connections/connection-1/tongji-context'
  );

  const mismatch = await fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: 'unavailable-user' })
  });
  assert.equal(mismatch.status, 422);
  assert.equal(
    (await mismatch.json()).error.code,
    'TONGJI_ACCOUNT_NOT_AVAILABLE'
  );

  providerError = Object.assign(new Error('authorization expired'), {
    code: 'BAIDU_REAUTHORIZATION_REQUIRED',
    status: 502
  });
  const reauthorization = await fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: 'reauthorize-user' })
  });
  assert.equal(reauthorization.status, 409);
  assert.equal(
    (await reauthorization.json()).error.code,
    'BAIDU_REAUTHORIZATION_REQUIRED'
  );

  providerError = Object.assign(new Error('queue full'), {
    code: 'BAIDU_TONGJI_QUEUE_FULL',
    status: 503,
    retryAfterSeconds: 2
  });
  const queued = await fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: 'queued-user' })
  });
  assert.equal(queued.status, 503);
  assert.equal(queued.headers.get('retry-after'), '2');
  assert.equal((await queued.json()).error.code, 'BAIDU_TONGJI_QUEUE_FULL');
});
