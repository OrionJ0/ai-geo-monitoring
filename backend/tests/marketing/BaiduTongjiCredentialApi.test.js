const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { QueryTypes } = require('sequelize');

const {
  createBaiduBindingRouter
} = require('../../modules/marketing/routes/baiduBindingRoutes');
const {
  BaiduTongjiCredentialService
} = require('../../modules/marketing/services/BaiduTongjiCredentialService');
const {
  decryptSecret
} = require('../../services/SecretEncryptionService');
const {
  createMarketingTestDatabase,
  seedConnectionAndBinding
} = require('./helpers/createMarketingTestDatabase');

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

test('admin validates and stores a separate encrypted Tongji credential', async (t) => {
  const database = await createMarketingTestDatabase('tongji-credential-api-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  const providerCalls = [];
  const credentialService = new BaiduTongjiCredentialService({
    sequelize: database.sequelize,
    encryptionKey: ENCRYPTION_KEY,
    clock: () => Date.parse('2026-08-03T10:00:00.000Z'),
    provider: {
      async listTongjiSites(credential) {
        providerCalls.push(credential);
        return [
          { siteId: '23412673', domain: 'gato.com.cn', status: 'ACTIVE' },
          { siteId: '999', domain: 'paused.example', status: 'PAUSED' }
        ];
      }
    }
  });
  const app = express();
  app.use(express.json());
  app.use('/api/admin/marketing/baidu', createBaiduBindingRouter({
    service: {},
    tongjiCredentialService: credentialService,
    includeAccounts: false,
    includeBindings: false,
    adminRequired(req, _res, next) {
      req.user = { id: 1, role: 'admin' };
      next();
    }
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(
    `${baseUrl}/api/admin/marketing/baidu/connections/connection-1/tongji-credential`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountName: ' shb-广拓信息 ',
        accessToken: 'tongji-token-test'
      })
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body, {
    connectionId: 'connection-1',
    accountName: 'shb-广拓信息',
    configured: true,
    updatedAt: '2026-08-03T10:00:00.000Z',
    sites: [{ siteId: '23412673', domain: 'gato.com.cn', status: 'ACTIVE' }]
  });
  assert.doesNotMatch(JSON.stringify(body), /tongji-token-test/u);
  assert.deepEqual(providerCalls, [{
    accountName: 'shb-广拓信息',
    accessToken: 'tongji-token-test'
  }]);

  const rows = await database.sequelize.query(
    `SELECT tongji_account_name, tongji_access_token_ciphertext,
            tongji_credential_updated_at
     FROM baidu_marketing_connections
     WHERE id = 'connection-1'`,
    { type: QueryTypes.SELECT }
  );
  assert.equal(rows[0].tongji_account_name, 'shb-广拓信息');
  assert.match(rows[0].tongji_access_token_ciphertext, /^v1:/u);
  assert.equal(
    decryptSecret(rows[0].tongji_access_token_ciphertext, ENCRYPTION_KEY),
    'tongji-token-test'
  );
  assert.deepEqual(await credentialService.listSites('connection-1'), [
    { siteId: '23412673', domain: 'gato.com.cn', status: 'ACTIVE' }
  ]);
  assert.equal(providerCalls.length, 2);
});

test('invalid or provider-rejected Tongji credentials are never stored', async (t) => {
  const database = await createMarketingTestDatabase('tongji-credential-fail-');
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  const credentialService = new BaiduTongjiCredentialService({
    sequelize: database.sequelize,
    encryptionKey: ENCRYPTION_KEY,
    provider: {
      async listTongjiSites() {
        const error = new Error('provider rejected token');
        error.code = 'BAIDU_TONGJI_ERROR';
        error.status = 502;
        throw error;
      }
    }
  });

  await assert.rejects(
    credentialService.configure({
      connectionId: 'connection-1',
      accountName: 'shb-广拓信息',
      accessToken: 'rejected-token'
    }),
    { code: 'BAIDU_TONGJI_ERROR' }
  );
  const rows = await database.sequelize.query(
    `SELECT tongji_access_token_ciphertext
     FROM baidu_marketing_connections
     WHERE id = 'connection-1'`,
    { type: QueryTypes.SELECT }
  );
  assert.equal(rows[0].tongji_access_token_ciphertext, null);
  await assert.rejects(
    credentialService.getCredential('connection-1'),
    { code: 'TONGJI_CREDENTIAL_MISSING', status: 409 }
  );
});
