const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'baidu-auth-api-'));
process.env.DB_STORAGE = path.join(databaseDirectory, 'auth.sqlite');
process.env.DB_LOGGING = 'false';
process.env.CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
delete process.env.DATABASE_URL;

const { sequelize, User } = require('../../models');
const {
  createMarketingMigrationRunner
} = require('../../modules/marketing/migrations/MarketingMigrationRunner');
const {
  createBaiduAuthorizationRouter
} = require('../../modules/marketing/routes/baiduAuthorizationRoutes');
const {
  BaiduAuthorizationService
} = require('../../modules/marketing/services/BaiduAuthorizationService');

let server;
let baseUrl;
let admin;
let exchangeCalls = 0;
const callbackFixture = {
  appId: 'app-id-fixture',
  authCode: 'one-time-code',
  userId: '1234',
  timestamp: '1611216626171',
  signature: 'SIGNATURE-FIXTURE'
};

function cookieValue(setCookie, name) {
  const match = String(setCookie || '').match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
  assert.ok(match, `cookie ${name} should be set`);
  return `${name}=${match[1]}`;
}

test.before(async () => {
  await sequelize.sync({ force: true });
  await createMarketingMigrationRunner({ sequelize }).apply();
  admin = await User.create({
    username: 'marketing-admin',
    email: 'marketing-admin@example.com',
    password: 'unused',
    role: 'admin',
    status: 'active'
  });

  const provider = {
    buildAuthorizationUrl({ state }) {
      const url = new URL('https://provider.example.test/authorize');
      url.searchParams.set('state', state);
      return url.toString();
    },
    verifyCallbackSignature(parameters) {
      assert.deepEqual(parameters, {
        ...callbackFixture,
        state: parameters.state
      });
      return true;
    },
    async exchangeAuthorizationCode({ appId, authCode, userId }) {
      exchangeCalls += 1;
      assert.equal(appId, callbackFixture.appId);
      assert.equal(authCode, callbackFixture.authCode);
      assert.equal(userId, callbackFixture.userId);
      return {
        principalId: '0009007199254740993123',
        principalName: '脱敏账户',
        openId: 'open-id-fixture',
        accessToken: 'access-token-canary',
        refreshToken: 'refresh-token-canary',
        expiresInSeconds: 3600,
        refreshExpiresInSeconds: 2592000
      };
    }
  };
  const service = new BaiduAuthorizationService({
    sequelize,
    provider,
    encryptionKey: process.env.CONFIG_ENCRYPTION_KEY
  });
  const app = express();
  app.use(express.json());
  app.use(
    '/api/admin/marketing/baidu',
    createBaiduAuthorizationRouter({
      service,
      adminRequired(req, _res, next) {
        req.user = { id: admin.id, role: 'admin' };
        next();
      }
    })
  );
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await sequelize.close();
  fs.rmSync(databaseDirectory, { recursive: true, force: true });
});

test('administrator completes one-time authorization without exposing credentials', async () => {
  const createResponse = await fetch(
    `${baseUrl}/api/admin/marketing/baidu/authorization-attempts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'CONNECT', targetConnectionId: null })
    }
  );
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.deepEqual(Object.keys(created).sort(), ['expiresAt', 'launchUrl']);
  assert.equal(
    created.launchUrl,
    '/api/admin/marketing/baidu/authorization/launch'
  );
  assert.doesNotMatch(JSON.stringify(created), /ticket|state|provider\.example|token/iu);
  const launchCookie = cookieValue(
    createResponse.headers.get('set-cookie'),
    'marketing_launch'
  );

  const launchResponse = await fetch(`${baseUrl}${created.launchUrl}`, {
    headers: { Cookie: launchCookie },
    redirect: 'manual'
  });
  assert.equal(launchResponse.status, 303);
  assert.equal(launchResponse.headers.get('cache-control'), 'no-store');
  assert.equal(launchResponse.headers.get('referrer-policy'), 'no-referrer');
  assert.match(
    launchResponse.headers.get('set-cookie'),
    /marketing_launch=; Max-Age=0/u
  );
  const providerUrl = new URL(launchResponse.headers.get('location'));
  const state = providerUrl.searchParams.get('state');
  assert.ok(state);
  const callbackQuery = new URLSearchParams({
    ...callbackFixture,
    state
  });

  const callbackResponse = await fetch(
    `${baseUrl}/api/admin/marketing/baidu/oauth/callback?${callbackQuery}`,
    { redirect: 'manual' }
  );
  assert.equal(callbackResponse.status, 303);
  assert.equal(
    callbackResponse.headers.get('location'),
    '/admin/settings/marketing/baidu/result'
  );
  assert.doesNotMatch(callbackResponse.headers.get('location'), /code|state|token/iu);
  const resultCookie = cookieValue(
    callbackResponse.headers.get('set-cookie'),
    'marketing_result'
  );

  const resultResponse = await fetch(
    `${baseUrl}/api/admin/marketing/baidu/authorization-results/current`,
    { headers: { Cookie: resultCookie } }
  );
  assert.equal(resultResponse.status, 200);
  assert.match(
    resultResponse.headers.get('set-cookie'),
    /marketing_result=; Max-Age=0/u
  );
  const result = await resultResponse.json();
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.principalId, '0009007199254740993123');
  assert.doesNotMatch(JSON.stringify(result), /access-token|refresh-token/iu);

  const [connections] = await sequelize.query(
    `SELECT id, status, authorized_principal_id,
            authorized_open_id, access_token_ciphertext,
            refresh_token_ciphertext, refresh_token_expires_at
     FROM baidu_marketing_connections`
  );
  assert.equal(connections.length, 1);
  assert.equal(connections[0].status, 'CONNECTED');
  assert.equal(
    connections[0].authorized_principal_id,
    '0009007199254740993123'
  );
  assert.equal(connections[0].authorized_open_id, 'open-id-fixture');
  assert.match(connections[0].access_token_ciphertext, /^v1:/u);
  assert.match(connections[0].refresh_token_ciphertext, /^v1:/u);
  assert.ok(connections[0].refresh_token_expires_at);
  assert.doesNotMatch(JSON.stringify(connections), /access-token-canary|refresh-token-canary/iu);
  await sequelize.query(
    `UPDATE baidu_marketing_connections
     SET tongji_account_name = '统计账户',
         tongji_access_token_ciphertext = 'v1:encrypted-tongji-fixture',
         tongji_credential_updated_at = CURRENT_TIMESTAMP
     WHERE id = :connectionId`,
    { replacements: { connectionId: connections[0].id } }
  );

  const replay = await fetch(
    `${baseUrl}/api/admin/marketing/baidu/oauth/callback?${callbackQuery}`,
    { redirect: 'manual' }
  );
  assert.equal(replay.status, 409);
  assert.equal(exchangeCalls, 1);

  const disconnect = await fetch(
    `${baseUrl}/api/admin/marketing/baidu/connections/${connections[0].id}/disconnect`,
    { method: 'POST' }
  );
  assert.equal(disconnect.status, 200);
  assert.equal((await disconnect.json()).status, 'DISCONNECTED');
  const [disconnectedRows] = await sequelize.query(
    `SELECT status, access_token_ciphertext, refresh_token_ciphertext,
            tongji_account_name, tongji_access_token_ciphertext,
            auth_generation
     FROM baidu_marketing_connections`
  );
  assert.equal(disconnectedRows[0].status, 'DISCONNECTED');
  assert.equal(disconnectedRows[0].access_token_ciphertext, null);
  assert.equal(disconnectedRows[0].refresh_token_ciphertext, null);
  assert.equal(disconnectedRows[0].tongji_account_name, null);
  assert.equal(disconnectedRows[0].tongji_access_token_ciphertext, null);
  assert.equal(disconnectedRows[0].auth_generation, 1);
});

test('callback rejects duplicate security parameters before provider exchange', async () => {
  const before = exchangeCalls;
  const query = new URLSearchParams({
    ...callbackFixture,
    state: crypto.randomBytes(32).toString('base64url')
  });
  query.append('authCode', 'duplicate');
  const response = await fetch(
    `${baseUrl}/api/admin/marketing/baidu/oauth/callback?${query}`,
    { redirect: 'manual' }
  );

  assert.equal(response.status, 400);
  assert.equal(exchangeCalls, before);
  assert.equal((await response.json()).error.code, 'OAUTH_CALLBACK_INVALID');
});
