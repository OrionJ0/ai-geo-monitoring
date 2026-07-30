const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Sequelize } = require('sequelize');

const {
  createMarketingMigrationRunner
} = require('../../modules/marketing/migrations/MarketingMigrationRunner');
const {
  BaiduAuthorizationService
} = require('../../modules/marketing/services/BaiduAuthorizationService');
const {
  decryptSecret
} = require('../../services/SecretEncryptionService');

function makeDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'baidu-auth-race-'));
  const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(directory, 'test.sqlite'),
    logging: false
  });
  return { directory, sequelize };
}

async function seedAdmin(sequelize) {
  await sequelize.query(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      role TEXT NOT NULL,
      status TEXT NOT NULL
    )
  `);
  await sequelize.query(
    "INSERT INTO users (id, role, status) VALUES (7, 'admin', 'active')"
  );
}

function callbackParameters(state, authCode) {
  return {
    appId: 'app-id-fixture',
    authCode,
    state,
    userId: '1234',
    timestamp: '1611216626171',
    signature: 'signature-fixture'
  };
}

test('concurrent callback exchanges an authorization code at most once', async (t) => {
  const { directory, sequelize } = makeDatabase();
  t.after(async () => {
    await sequelize.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await seedAdmin(sequelize);
  await createMarketingMigrationRunner({ sequelize }).apply();

  let exchangeCalls = 0;
  const provider = {
    buildAuthorizationUrl({ state }) {
      return `https://provider.invalid/?state=${state}`;
    },
    verifyCallbackSignature() { return true; },
    async exchangeAuthorizationCode() {
      exchangeCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        principalId: '0009007199254740993123',
        openId: 'open-id-race',
        accessToken: 'race-access-canary',
        refreshToken: 'race-refresh-canary',
        expiresInSeconds: 3600
      };
    }
  };
  const service = new BaiduAuthorizationService({
    sequelize,
    provider,
    encryptionKey: Buffer.alloc(32, 3).toString('base64')
  });
  const attempt = await service.createAttempt({
    adminId: 7,
    operation: 'CONNECT'
  });
  let state;
  provider.buildAuthorizationUrl = ({ state: value }) => {
    state = value;
    return 'https://provider.invalid/';
  };
  await service.consumeLaunch({ launchTicket: attempt.launchTicket });

  const settled = await Promise.allSettled([
    service.completeCallback(callbackParameters(state, 'same-code')),
    service.completeCallback(callbackParameters(state, 'same-code'))
  ]);
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((item) => item.status === 'rejected').length, 1);
  assert.equal(exchangeCalls, 1);
});

test('uncertain code exchange becomes a recoverable terminal result', async (t) => {
  const { directory, sequelize } = makeDatabase();
  t.after(async () => {
    await sequelize.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await seedAdmin(sequelize);
  await createMarketingMigrationRunner({ sequelize }).apply();

  let state;
  const service = new BaiduAuthorizationService({
    sequelize,
    provider: {
      buildAuthorizationUrl({ state: value }) {
        state = value;
        return 'https://provider.invalid/';
      },
      verifyCallbackSignature() { return true; },
      async exchangeAuthorizationCode() {
        const error = new Error('request timed out');
        error.code = 'OUTCOME_UNKNOWN';
        throw error;
      }
    },
    encryptionKey: Buffer.alloc(32, 4).toString('base64')
  });
  const attempt = await service.createAttempt({
    adminId: 7,
    operation: 'CONNECT'
  });
  await service.consumeLaunch({ launchTicket: attempt.launchTicket });
  const result = await service.completeCallback(
    callbackParameters(state, 'maybe-used')
  );
  const terminal = await service.consumeResult({
    resultTicket: result.resultTicket,
    adminId: 7
  });

  assert.equal(terminal.status, 'OUTCOME_UNKNOWN');
  assert.equal(terminal.failureCode, 'TOKEN_EXCHANGE_OUTCOME_UNKNOWN');
  const [connections] = await sequelize.query(
    'SELECT id FROM baidu_marketing_connections'
  );
  assert.equal(connections.length, 0);
});

test('reauthorization cannot replace a connection with another principal', async (t) => {
  const { directory, sequelize } = makeDatabase();
  t.after(async () => {
    await sequelize.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await seedAdmin(sequelize);
  await createMarketingMigrationRunner({ sequelize }).apply();
  await sequelize.query(
    `INSERT INTO baidu_marketing_connections (
      id, status, authorized_principal_id, authorized_principal_name,
      access_token_ciphertext, refresh_token_ciphertext,
      access_token_expires_at, auth_generation, token_version,
      refresh_claim_token, refresh_claim_until, created_by_user_id,
      last_error_code, created_at, updated_at
    ) VALUES (
      'connection-reauth', 'CONNECTED', 'principal-original', '原主体',
      'v1:old-ciphertext', NULL, NULL, 0, 1,
      NULL, NULL, 7, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`
  );
  let state;
  const service = new BaiduAuthorizationService({
    sequelize,
    provider: {
      buildAuthorizationUrl({ state: value }) {
        state = value;
        return 'https://provider.invalid/';
      },
      verifyCallbackSignature() { return true; },
      async exchangeAuthorizationCode() {
        return {
          principalId: 'principal-other',
          openId: 'open-id-other',
          accessToken: 'must-not-replace',
          expiresInSeconds: 3600
        };
      }
    },
    encryptionKey: Buffer.alloc(32, 8).toString('base64')
  });
  const attempt = await service.createAttempt({
    adminId: 7,
    operation: 'REAUTHORIZE',
    targetConnectionId: 'connection-reauth'
  });
  await service.consumeLaunch({ launchTicket: attempt.launchTicket });
  const callback = await service.completeCallback({
    ...callbackParameters(state, 'wrong-principal')
  });
  const result = await service.consumeResult({
    resultTicket: callback.resultTicket,
    adminId: 7
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.failureCode, 'AUTHORIZATION_GENERATION_CHANGED');
  const [connections] = await sequelize.query(
    `SELECT authorized_principal_id, access_token_ciphertext, status
     FROM baidu_marketing_connections`
  );
  assert.deepEqual(connections[0], {
    authorized_principal_id: 'principal-original',
    access_token_ciphertext: 'v1:old-ciphertext',
    status: 'REAUTH_REQUIRED'
  });
});

test('a newer reauthorization generation rejects an older callback', async (t) => {
  const { directory, sequelize } = makeDatabase();
  t.after(async () => {
    await sequelize.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await seedAdmin(sequelize);
  await createMarketingMigrationRunner({ sequelize }).apply();
  await sequelize.query(
    `INSERT INTO baidu_marketing_connections (
      id, status, authorized_principal_id, authorized_principal_name,
      access_token_ciphertext, refresh_token_ciphertext,
      access_token_expires_at, auth_generation, token_version,
      refresh_claim_token, refresh_claim_until, created_by_user_id,
      last_error_code, created_at, updated_at
    ) VALUES (
      'connection-generation', 'CONNECTED', 'principal-stable', '稳定主体',
      'v1:old-ciphertext', NULL, NULL, 0, 1,
      'stale-refresh-claim', '2099-01-01T00:00:00.000Z',
      7, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`
  );
  const encryptionKey = Buffer.alloc(32, 11).toString('base64');
  const service = new BaiduAuthorizationService({
    sequelize,
    provider: {
      buildAuthorizationUrl({ state }) {
        return `https://provider.invalid/?state=${state}`;
      },
      verifyCallbackSignature() { return true; },
      async exchangeAuthorizationCode({ authCode }) {
        return {
          principalId: 'principal-stable',
          openId: 'open-id-stable',
          accessToken: `access-${authCode}`,
          expiresInSeconds: 3600
        };
      }
    },
    encryptionKey
  });
  const older = await service.createAttempt({
    adminId: 7,
    operation: 'REAUTHORIZE',
    targetConnectionId: 'connection-generation'
  });
  const [afterInvalidation] = await sequelize.query(
    `SELECT refresh_claim_token, refresh_claim_until
     FROM baidu_marketing_connections
     WHERE id = 'connection-generation'`
  );
  assert.equal(afterInvalidation[0].refresh_claim_token, null);
  assert.equal(afterInvalidation[0].refresh_claim_until, null);
  const olderLaunch = await service.consumeLaunch({
    launchTicket: older.launchTicket
  });
  const newer = await service.createAttempt({
    adminId: 7,
    operation: 'REAUTHORIZE',
    targetConnectionId: 'connection-generation'
  });
  const newerLaunch = await service.consumeLaunch({
    launchTicket: newer.launchTicket
  });
  const olderState = new URL(olderLaunch.authorizationUrl).searchParams.get(
    'state'
  );
  const newerState = new URL(newerLaunch.authorizationUrl).searchParams.get(
    'state'
  );

  const oldCallback = await service.completeCallback({
    ...callbackParameters(olderState, 'older')
  });
  const oldResult = await service.consumeResult({
    resultTicket: oldCallback.resultTicket,
    adminId: 7
  });
  assert.equal(oldResult.status, 'FAILED');
  assert.equal(oldResult.failureCode, 'AUTHORIZATION_GENERATION_CHANGED');

  const newCallback = await service.completeCallback({
    ...callbackParameters(newerState, 'newer')
  });
  const newResult = await service.consumeResult({
    resultTicket: newCallback.resultTicket,
    adminId: 7
  });
  assert.equal(newResult.status, 'SUCCEEDED');
  const [connections] = await sequelize.query(
    `SELECT access_token_ciphertext, auth_generation
     FROM baidu_marketing_connections
     WHERE id = 'connection-generation'`
  );
  assert.equal(connections[0].auth_generation, 2);
  assert.equal(
    decryptSecret(connections[0].access_token_ciphertext, encryptionKey),
    'access-newer'
  );
});
