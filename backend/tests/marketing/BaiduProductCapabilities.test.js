const assert = require('node:assert/strict');
const test = require('node:test');

const {
  encryptSecret
} = require('../../services/SecretEncryptionService');
const {
  BaiduAuthorizationService
} = require('../../modules/marketing/services/BaiduAuthorizationService');
const {
  BaiduConnectionService
} = require('../../modules/marketing/services/BaiduConnectionService');
const {
  createMarketingTestDatabase,
  seedConnectionAndBinding
} = require('./helpers/createMarketingTestDatabase');

const encryptionKey = Buffer.alloc(32, 13).toString('base64');
const now = Date.parse('2026-08-05T08:00:00.000Z');

async function seedVersionedConnection(sequelize) {
  await seedConnectionAndBinding(sequelize);
  await sequelize.query(
    `UPDATE baidu_marketing_connections
     SET access_token_ciphertext = :accessToken,
         access_token_expires_at = '2026-08-05T09:00:00.000Z',
         auth_generation = 3,
         token_version = 7,
         tongji_user_name = 'verified-user',
         tongji_user_name_verified_at = '2026-08-05T07:30:00.000Z'
     WHERE id = 'connection-1'`,
    {
      replacements: {
        accessToken: encryptSecret('access-version-7', encryptionKey)
      }
    }
  );
}

async function markBothVerified(sequelize, {
  authGeneration = 3,
  tokenVersion = 7
} = {}) {
  await sequelize.query(
    `UPDATE baidu_marketing_connections
     SET marketing_access_state = 'VERIFIED',
         marketing_observed_auth_generation = :authGeneration,
         marketing_observed_token_version = :tokenVersion,
         marketing_checked_at = '2026-08-05T07:40:00.000Z',
         marketing_last_error_code = NULL,
         tongji_access_state = 'VERIFIED',
         tongji_observed_auth_generation = :authGeneration,
         tongji_observed_token_version = :tokenVersion,
         tongji_checked_at = '2026-08-05T07:41:00.000Z',
         tongji_last_error_code = NULL
     WHERE id = 'connection-1'`,
    { replacements: { authGeneration, tokenVersion } }
  );
}

function makeConnectionService(sequelize, provider = {}) {
  return new BaiduConnectionService({
    sequelize,
    provider,
    encryptionKey,
    clock: () => now,
    wait: async () => {}
  });
}

test('Access Context returns the committed token version and old getter is a wrapper', async (t) => {
  const database = await createMarketingTestDatabase('baidu-access-context-');
  t.after(database.close);
  await seedVersionedConnection(database.sequelize);

  const service = makeConnectionService(database.sequelize);
  assert.deepEqual(await service.getAccessContext('connection-1'), {
    accessToken: 'access-version-7',
    authGeneration: 3,
    tokenVersion: 7
  });
  assert.equal(
    await service.getAccessToken('connection-1'),
    'access-version-7'
  );
});

test('refresh returns the new Access Context and atomically invalidates capabilities', async (t) => {
  const database = await createMarketingTestDatabase('baidu-refresh-context-');
  t.after(database.close);
  await seedVersionedConnection(database.sequelize);
  await markBothVerified(database.sequelize);
  await database.sequelize.query(
    `UPDATE baidu_marketing_connections
     SET refresh_token_ciphertext = :refreshToken,
         access_token_expires_at = '2026-08-05T07:00:00.000Z'
     WHERE id = 'connection-1'`,
    {
      replacements: {
        refreshToken: encryptSecret('refresh-version-7', encryptionKey)
      }
    }
  );

  const service = makeConnectionService(database.sequelize, {
    async refreshAccessToken() {
      return {
        accessToken: 'access-version-8',
        expiresInSeconds: 3600
      };
    }
  });
  assert.deepEqual(await service.getAccessContext('connection-1'), {
    accessToken: 'access-version-8',
    authGeneration: 3,
    tokenVersion: 8
  });

  const [rows] = await database.sequelize.query(
    `SELECT token_version, tongji_user_name,
            tongji_user_name_verified_at,
            marketing_access_state, marketing_observed_token_version,
            marketing_checked_at, marketing_last_error_code,
            tongji_access_state, tongji_observed_token_version,
            tongji_checked_at, tongji_last_error_code
     FROM baidu_marketing_connections
     WHERE id = 'connection-1'`
  );
  assert.deepEqual(rows[0], {
    token_version: 8,
    tongji_user_name: 'verified-user',
    tongji_user_name_verified_at: null,
    marketing_access_state: 'UNKNOWN',
    marketing_observed_token_version: null,
    marketing_checked_at: null,
    marketing_last_error_code: null,
    tongji_access_state: 'UNKNOWN',
    tongji_observed_token_version: null,
    tongji_checked_at: null,
    tongji_last_error_code: null
  });
});

test('capability CAS rejects stale results and connection API hides internal versions', async (t) => {
  const database = await createMarketingTestDatabase('baidu-capability-cas-');
  t.after(database.close);
  await seedVersionedConnection(database.sequelize);
  const connectionService = makeConnectionService(database.sequelize);

  assert.equal(await connectionService.recordProductAccess({
    connectionId: 'connection-1',
    product: 'marketing',
    state: 'VERIFIED',
    authGeneration: 3,
    tokenVersion: 7,
    checkedAt: '2026-08-05T07:45:00.000Z'
  }), true);
  assert.equal(await connectionService.recordProductAccess({
    connectionId: 'connection-1',
    product: 'tongji',
    state: 'ACCOUNT_MISMATCH',
    authGeneration: 2,
    tokenVersion: 6,
    checkedAt: '2026-08-05T07:46:00.000Z',
    lastErrorCode: 'TONGJI_ACCOUNT_NOT_AVAILABLE'
  }), false);

  await database.sequelize.query(
    `UPDATE baidu_marketing_connections
     SET tongji_access_state = 'VERIFIED',
         tongji_observed_auth_generation = 3,
         tongji_observed_token_version = 6,
         tongji_checked_at = '2026-08-05T07:44:00.000Z'
     WHERE id = 'connection-1'`
  );
  const authorizationService = new BaiduAuthorizationService({
    sequelize: database.sequelize,
    provider: {},
    encryptionKey,
    clock: () => now
  });
  const connections = await authorizationService.listConnections();

  assert.equal(Array.isArray(connections), true);
  assert.deepEqual(connections[0].products, {
    marketing: {
      state: 'VERIFIED',
      checkedAt: '2026-08-05T07:45:00.000Z',
      lastErrorCode: null
    },
    tongji: {
      state: 'UNKNOWN',
      checkedAt: null,
      lastErrorCode: null
    }
  });
  assert.equal(connections[0].tongjiUserName, 'verified-user');
  assert.equal('authGeneration' in connections[0], false);
  assert.equal('tokenVersion' in connections[0], false);
  assert.equal('tongjiCredentialConfigured' in connections[0], false);
  assert.equal('tongjiAccountName' in connections[0], false);
});

test('capability evidence keeps permission, account, upstream and no-data outcomes distinct', async (t) => {
  const database = await createMarketingTestDatabase('baidu-capability-state-');
  t.after(database.close);
  await seedVersionedConnection(database.sequelize);
  const connectionService = makeConnectionService(database.sequelize);
  const authorizationService = new BaiduAuthorizationService({
    sequelize: database.sequelize,
    provider: {},
    encryptionKey,
    clock: () => now
  });
  const cases = [
    ['REAUTH_REQUIRED', 'BAIDU_PERMISSION_REQUIRED'],
    ['ACCOUNT_MISMATCH', 'TONGJI_ACCOUNT_NOT_AVAILABLE'],
    ['UPSTREAM_ERROR', 'BAIDU_UPSTREAM_UNAVAILABLE'],
    ['VERIFIED', null]
  ];

  for (const [state, lastErrorCode] of cases) {
    assert.equal(await connectionService.recordProductAccess({
      connectionId: 'connection-1',
      product: 'tongji',
      state,
      authGeneration: 3,
      tokenVersion: 7,
      checkedAt: '2026-08-05T07:55:00.000Z',
      lastErrorCode
    }), true);
    const [connection] = await authorizationService.listConnections();
    assert.equal(connection.products.tongji.state, state);
    assert.equal(
      connection.products.tongji.lastErrorCode,
      state === 'VERIFIED' ? null : lastErrorCode
    );
  }
  await assert.rejects(
    connectionService.recordProductAccess({
      connectionId: 'connection-1',
      product: 'tongji',
      state: 'UPSTREAM_ERROR',
      authGeneration: 3,
      tokenVersion: 7,
      checkedAt: '2026-08-05T07:55:00.000Z',
      lastErrorCode: 'raw provider response must not persist'
    }),
    { code: 'PRODUCT_ACCESS_EVIDENCE_INVALID' }
  );
});

test('reauthorization start, callback and disconnect atomically invalidate products', async (t) => {
  const database = await createMarketingTestDatabase('baidu-capability-life-');
  t.after(database.close);
  await seedVersionedConnection(database.sequelize);
  await markBothVerified(database.sequelize);

  let providerState;
  const service = new BaiduAuthorizationService({
    sequelize: database.sequelize,
    provider: {
      buildAuthorizationUrl({ state }) {
        providerState = state;
        return `https://provider.invalid/?state=${state}`;
      },
      verifyCallbackSignature() { return true; },
      async exchangeAuthorizationCode() {
        return {
          principalId: 'principal-connection-1',
          openId: 'open-id-reauthorized',
          accessToken: 'reauthorized-access',
          expiresInSeconds: 3600
        };
      }
    },
    encryptionKey,
    clock: () => now
  });

  const attempt = await service.createAttempt({
    adminId: 1,
    operation: 'REAUTHORIZE',
    targetConnectionId: 'connection-1'
  });
  const [afterStart] = await database.sequelize.query(
    `SELECT tongji_user_name, tongji_user_name_verified_at,
            marketing_access_state, tongji_access_state
     FROM baidu_marketing_connections
     WHERE id = 'connection-1'`
  );
  assert.deepEqual(afterStart[0], {
    tongji_user_name: 'verified-user',
    tongji_user_name_verified_at: null,
    marketing_access_state: 'UNKNOWN',
    tongji_access_state: 'UNKNOWN'
  });

  await service.consumeLaunch({ launchTicket: attempt.launchTicket });
  await database.sequelize.query(
    `UPDATE baidu_marketing_connections
     SET marketing_access_state = 'VERIFIED',
         marketing_observed_auth_generation = auth_generation,
         marketing_observed_token_version = token_version,
         tongji_access_state = 'VERIFIED',
         tongji_observed_auth_generation = auth_generation,
         tongji_observed_token_version = token_version,
         tongji_user_name_verified_at = '2026-08-05T07:50:00.000Z'
     WHERE id = 'connection-1'`
  );
  const callback = await service.completeCallback({
    appId: 'app-id-fixture',
    authCode: 'callback-code',
    state: providerState,
    userId: '1234',
    timestamp: '1611216626171',
    signature: 'signature-fixture'
  });
  const callbackResult = await service.consumeResult({
    resultTicket: callback.resultTicket,
    adminId: 1
  });
  assert.equal(callbackResult.status, 'SUCCEEDED');
  const [afterCallback] = await database.sequelize.query(
    `SELECT tongji_user_name_verified_at,
            marketing_access_state, tongji_access_state
     FROM baidu_marketing_connections
     WHERE id = 'connection-1'`
  );
  assert.deepEqual(afterCallback[0], {
    tongji_user_name_verified_at: null,
    marketing_access_state: 'UNKNOWN',
    tongji_access_state: 'UNKNOWN'
  });

  await markBothVerified(database.sequelize, {
    authGeneration: 4,
    tokenVersion: 8
  });
  await service.disconnect({ connectionId: 'connection-1' });
  const [afterDisconnect] = await database.sequelize.query(
    `SELECT tongji_user_name, tongji_user_name_verified_at,
            marketing_access_state, tongji_access_state
     FROM baidu_marketing_connections
     WHERE id = 'connection-1'`
  );
  assert.deepEqual(afterDisconnect[0], {
    tongji_user_name: null,
    tongji_user_name_verified_at: null,
    marketing_access_state: 'UNKNOWN',
    tongji_access_state: 'UNKNOWN'
  });
});
