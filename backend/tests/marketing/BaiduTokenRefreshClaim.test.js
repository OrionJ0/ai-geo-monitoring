const assert = require('node:assert/strict');
const test = require('node:test');

const {
  encryptSecret,
  decryptSecret
} = require('../../services/SecretEncryptionService');
const {
  BaiduConnectionService
} = require('../../modules/marketing/services/BaiduConnectionService');
const {
  createMarketingTestDatabase,
  seedConnectionAndBinding
} = require('./helpers/createMarketingTestDatabase');

const encryptionKey = Buffer.alloc(32, 6).toString('base64');

async function expireConnection(sequelize, refreshToken = 'refresh-old') {
  await sequelize.query(
    `UPDATE baidu_marketing_connections
     SET access_token_ciphertext = :accessToken,
         refresh_token_ciphertext = :refreshToken,
         access_token_expires_at = '2026-07-29T03:00:00.000Z'
     WHERE id = 'connection-1'`,
    {
      replacements: {
        accessToken: encryptSecret('access-old', encryptionKey),
        refreshToken: encryptSecret(refreshToken, encryptionKey)
      }
    }
  );
}

test('concurrent expiry performs one refresh grant and both callers use its token', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  await expireConnection(database.sequelize);
  let refreshCalls = 0;
  const service = new BaiduConnectionService({
    sequelize: database.sequelize,
    encryptionKey,
    provider: {
      async refreshAccessToken({ refreshToken, userId }) {
        refreshCalls += 1;
        assert.equal(refreshToken, 'refresh-old');
        assert.equal(userId, 'principal-connection-1');
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          accessToken: 'access-new',
          expiresInSeconds: 3600
        };
      }
    },
    clock: () => Date.parse('2026-07-29T04:00:00.000Z'),
    wait: () => new Promise((resolve) => setTimeout(resolve, 5))
  });
  const tokens = await Promise.all([
    service.getAccessToken('connection-1'),
    service.getAccessToken('connection-1')
  ]);
  assert.deepEqual(tokens, ['access-new', 'access-new']);
  assert.equal(refreshCalls, 1);
});

test('missing or same refresh token preserves old ciphertext; new value rotates it', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  await expireConnection(database.sequelize);

  const responses = [
    { accessToken: 'access-1', expiresInSeconds: 1 },
    {
      accessToken: 'access-2',
      refreshToken: 'refresh-old',
      expiresInSeconds: 1
    },
    {
      accessToken: 'access-3',
      refreshToken: 'refresh-rotated',
      expiresInSeconds: 3600
    }
  ];
  let now = Date.parse('2026-07-29T04:00:00.000Z');
  const service = new BaiduConnectionService({
    sequelize: database.sequelize,
    encryptionKey,
    provider: {
      async refreshAccessToken() {
        return responses.shift();
      }
    },
    clock: () => now,
    wait: async () => {}
  });
  const [before] = await database.sequelize.query(
    `SELECT refresh_token_ciphertext
     FROM baidu_marketing_connections
     WHERE id = 'connection-1'`
  );
  await service.getAccessToken('connection-1');
  now += 2000;
  await service.getAccessToken('connection-1');
  const [sameRows] = await database.sequelize.query(
    `SELECT refresh_token_ciphertext
     FROM baidu_marketing_connections
     WHERE id = 'connection-1'`
  );
  assert.equal(
    sameRows[0].refresh_token_ciphertext,
    before[0].refresh_token_ciphertext
  );
  now += 2000;
  await service.getAccessToken('connection-1');
  const [rotatedRows] = await database.sequelize.query(
    `SELECT refresh_token_ciphertext, refresh_token_expires_at, token_version
     FROM baidu_marketing_connections
     WHERE id = 'connection-1'`
  );
  assert.equal(
    decryptSecret(rotatedRows[0].refresh_token_ciphertext, encryptionKey),
    'refresh-rotated'
  );
  assert.equal(rotatedRows[0].refresh_token_expires_at, null);
  assert.equal(rotatedRows[0].token_version, 4);
});

test('refresh stores the documented refresh-token lifetime', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  await expireConnection(database.sequelize);
  const service = new BaiduConnectionService({
    sequelize: database.sequelize,
    encryptionKey,
    provider: {
      async refreshAccessToken() {
        return {
          principalId: 'principal-connection-1',
          accessToken: 'access-new',
          refreshToken: 'refresh-new',
          expiresInSeconds: 86400,
          refreshExpiresInSeconds: 2592000
        };
      }
    },
    clock: () => Date.parse('2026-07-29T04:00:00.000Z'),
    wait: async () => {}
  });

  await service.getAccessToken('connection-1');
  const [rows] = await database.sequelize.query(
    `SELECT refresh_token_expires_at
     FROM baidu_marketing_connections
     WHERE id = 'connection-1'`
  );
  assert.equal(
    new Date(rows[0].refresh_token_expires_at).toISOString(),
    '2026-08-28T04:00:00.000Z'
  );
});

test('a late refresh failure cannot pause a newer authorization generation', async (t) => {
  const database = await createMarketingTestDatabase();
  t.after(database.close);
  await seedConnectionAndBinding(database.sequelize);
  await expireConnection(database.sequelize);
  let rejectRefresh;
  let providerStarted;
  const started = new Promise((resolve) => {
    providerStarted = resolve;
  });
  const service = new BaiduConnectionService({
    sequelize: database.sequelize,
    encryptionKey,
    provider: {
      async refreshAccessToken() {
        providerStarted();
        return new Promise((_resolve, reject) => {
          rejectRefresh = reject;
        });
      }
    },
    clock: () => Date.parse('2026-07-29T04:00:00.000Z'),
    wait: async () => {}
  });
  const pending = service.getAccessToken('connection-1');
  await started;
  await database.sequelize.query(
    `UPDATE baidu_marketing_connections
     SET auth_generation = auth_generation + 1,
         token_version = token_version + 1,
         refresh_claim_token = NULL,
         refresh_claim_until = NULL,
         access_token_ciphertext = :accessToken,
         access_token_expires_at = '2026-07-29T05:00:00.000Z'
     WHERE id = 'connection-1'`,
    {
      replacements: {
        accessToken: encryptSecret('access-new-generation', encryptionKey)
      }
    }
  );
  rejectRefresh(Object.assign(new Error('provider timeout'), {
    code: 'OUTCOME_UNKNOWN'
  }));

  await assert.rejects(pending, { code: 'REFRESH_CAS_REJECTED' });
  const [connections] = await database.sequelize.query(
    `SELECT status, auth_generation
     FROM baidu_marketing_connections
     WHERE id = 'connection-1'`
  );
  const [bindings] = await database.sequelize.query(
    `SELECT status
     FROM baidu_project_bindings
     WHERE id = 'binding-1'`
  );
  assert.deepEqual(connections[0], {
    status: 'CONNECTED',
    auth_generation: 1
  });
  assert.equal(bindings[0].status, 'ACTIVE');
});
