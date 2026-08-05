const crypto = require('node:crypto');
const { QueryTypes } = require('sequelize');
const {
  encryptSecret
} = require('../../../services/SecretEncryptionService');

class MarketingAuthorizationError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function randomTicket() {
  return crypto.randomBytes(32).toString('base64url');
}

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function plusMilliseconds(clock, milliseconds) {
  return new Date(clock() + milliseconds).toISOString();
}

const PRODUCT_ACCESS_STATES = Object.freeze(new Set([
  'UNKNOWN',
  'VERIFIED',
  'REAUTH_REQUIRED',
  'ACCOUNT_MISMATCH',
  'UPSTREAM_ERROR'
]));

function publicProductState(row, product) {
  const observedAuthGeneration = row[`${product}ObservedAuthGeneration`];
  const observedTokenVersion = row[`${product}ObservedTokenVersion`];
  const current = (
    row.status === 'CONNECTED'
    && observedAuthGeneration !== null
    && observedAuthGeneration !== undefined
    && observedTokenVersion !== null
    && observedTokenVersion !== undefined
    && Number(observedAuthGeneration) === Number(row.authGeneration)
    && Number(observedTokenVersion) === Number(row.tokenVersion)
    && PRODUCT_ACCESS_STATES.has(row[`${product}AccessState`])
  );
  if (!current) {
    return {
      state: 'UNKNOWN',
      checkedAt: null,
      lastErrorCode: null
    };
  }
  return {
    state: row[`${product}AccessState`],
    checkedAt: row[`${product}CheckedAt`] || null,
    lastErrorCode: row[`${product}LastErrorCode`] || null
  };
}

class BaiduAuthorizationService {
  constructor({
    sequelize,
    provider,
    encryptionKey,
    clock = () => Date.now(),
    attemptTtlMs = 10 * 60 * 1000
  }) {
    this.sequelize = sequelize;
    this.provider = provider;
    this.encryptionKey = encryptionKey;
    this.clock = clock;
    this.attemptTtlMs = attemptTtlMs;
  }

  async requireActiveAdmin(userId, transaction) {
    const rows = await this.sequelize.query(
      `SELECT id, role, status
       FROM users
       WHERE id = :userId
       LIMIT 1`,
      {
        replacements: { userId },
        type: QueryTypes.SELECT,
        transaction
      }
    );
    const user = rows[0];
    if (!user || user.role !== 'admin' || user.status !== 'active') {
      throw new MarketingAuthorizationError(
        '管理员账户无效',
        'ADMIN_NOT_ACTIVE',
        401
      );
    }
    return user;
  }

  async createAttempt({ adminId, operation, targetConnectionId = null }) {
    if (!['CONNECT', 'REAUTHORIZE'].includes(operation)) {
      throw new MarketingAuthorizationError(
        '授权操作无效',
        'AUTHORIZATION_OPERATION_INVALID'
      );
    }
    if (
      (operation === 'CONNECT' && targetConnectionId)
      || (operation === 'REAUTHORIZE' && !targetConnectionId)
    ) {
      throw new MarketingAuthorizationError(
        '授权目标无效',
        'AUTHORIZATION_TARGET_INVALID'
      );
    }

    const launchTicket = randomTicket();
    const attemptId = crypto.randomUUID();
    const createdAt = nowIso(this.clock);
    const expiresAt = plusMilliseconds(this.clock, this.attemptTtlMs);
    let expectedGeneration = 0;

    await this.sequelize.transaction(async (transaction) => {
      await this.requireActiveAdmin(adminId, transaction);
      if (operation === 'REAUTHORIZE') {
        const [rows] = await this.sequelize.query(
          `SELECT id, auth_generation
           FROM baidu_marketing_connections
           WHERE id = :connectionId`,
          {
            replacements: { connectionId: targetConnectionId },
            transaction
          }
        );
        if (!rows[0]) {
          throw new MarketingAuthorizationError(
            '连接不存在',
            'CONNECTION_NOT_FOUND',
            404
          );
        }
        const currentGeneration = Number(rows[0].auth_generation);
        expectedGeneration = currentGeneration + 1;
        const [, affected] = await this.sequelize.query(
          `UPDATE baidu_marketing_connections
           SET status = 'REAUTH_REQUIRED',
               auth_generation = :expectedGeneration,
               refresh_claim_token = NULL,
               refresh_claim_until = NULL,
               tongji_user_name_verified_at = NULL,
               marketing_access_state = 'UNKNOWN',
               marketing_observed_auth_generation = NULL,
               marketing_observed_token_version = NULL,
               marketing_checked_at = NULL,
               marketing_last_error_code = NULL,
               tongji_access_state = 'UNKNOWN',
               tongji_observed_auth_generation = NULL,
               tongji_observed_token_version = NULL,
               tongji_checked_at = NULL,
               tongji_last_error_code = NULL,
               last_error_code = 'REAUTHORIZATION_PENDING',
               updated_at = :updatedAt
           WHERE id = :connectionId
             AND auth_generation = :currentGeneration`,
          {
            replacements: {
              connectionId: targetConnectionId,
              currentGeneration,
              expectedGeneration,
              updatedAt: createdAt
            },
            transaction,
            type: QueryTypes.UPDATE
          }
        );
        if (affected !== 1) {
          throw new MarketingAuthorizationError(
            '连接授权代次已变化，请重试',
            'AUTHORIZATION_GENERATION_CHANGED',
            409
          );
        }
        await this.sequelize.query(
          `UPDATE baidu_project_bindings
           SET status = 'PAUSED',
               binding_version = binding_version + 1,
               paused_reason = 'REAUTH',
               updated_at = :updatedAt
           WHERE connection_id = :connectionId
             AND status = 'ACTIVE'`,
          {
            replacements: {
              connectionId: targetConnectionId,
              updatedAt: createdAt
            },
            transaction
          }
        );
      }
      await this.sequelize.query(
        `INSERT INTO baidu_authorization_attempts (
          id, launch_ticket_hash, provider_state_hash, result_ticket_hash,
          operation, initiated_by_user_id, target_connection_id,
          expected_auth_generation, status, launch_consumed_at,
          result_consumed_at, expires_at, completed_at, failure_code,
          created_at, updated_at
        ) VALUES (
          :id, :launchHash, NULL, NULL,
          :operation, :adminId, :targetConnectionId,
          :expectedGeneration, 'PENDING', NULL,
          NULL, :expiresAt, NULL, NULL,
          :createdAt, :createdAt
        )`,
        {
          replacements: {
            id: attemptId,
            launchHash: hashSecret(launchTicket),
            operation,
            adminId,
            targetConnectionId,
            expectedGeneration,
            expiresAt,
            createdAt
          },
          transaction
        }
      );
    });

    return {
      attemptId,
      launchTicket,
      expiresAt
    };
  }

  async consumeLaunch({ launchTicket }) {
    const providerState = randomTicket();
    const consumedAt = nowIso(this.clock);
    let attempt;
    await this.sequelize.transaction(async (transaction) => {
      const rows = await this.sequelize.query(
        `SELECT *
         FROM baidu_authorization_attempts
         WHERE launch_ticket_hash = :launchHash
         LIMIT 1`,
        {
          replacements: { launchHash: hashSecret(launchTicket) },
          type: QueryTypes.SELECT,
          transaction
        }
      );
      attempt = rows[0];
      if (
        !attempt
        || attempt.status !== 'PENDING'
        || attempt.launch_consumed_at
        || new Date(attempt.expires_at).getTime() <= this.clock()
      ) {
        throw new MarketingAuthorizationError(
          '授权启动票据无效或已过期',
          'AUTHORIZATION_LAUNCH_INVALID',
          409
        );
      }
      await this.requireActiveAdmin(attempt.initiated_by_user_id, transaction);
      const [, affectedRows] = await this.sequelize.query(
        `UPDATE baidu_authorization_attempts
         SET launch_consumed_at = :consumedAt,
             provider_state_hash = :stateHash,
             updated_at = :consumedAt
         WHERE id = :id
           AND status = 'PENDING'
           AND launch_consumed_at IS NULL`,
        {
          replacements: {
            id: attempt.id,
            consumedAt,
            stateHash: hashSecret(providerState)
          },
          transaction,
          type: QueryTypes.UPDATE
        }
      );
      if (affectedRows !== 1) {
        throw new MarketingAuthorizationError(
          '授权启动票据已使用',
          'AUTHORIZATION_LAUNCH_REPLAYED',
          409
        );
      }
    });

    return {
      authorizationUrl: this.provider.buildAuthorizationUrl({
        state: providerState,
        operation: attempt.operation
      })
    };
  }

  async markAttemptTerminal(attemptId, status, failureCode = null) {
    const resultTicket = randomTicket();
    const completedAt = nowIso(this.clock);
    await this.sequelize.query(
      `UPDATE baidu_authorization_attempts
       SET status = :status,
           result_ticket_hash = :resultHash,
           completed_at = :completedAt,
           failure_code = :failureCode,
           updated_at = :completedAt
       WHERE id = :attemptId
         AND status = 'PROCESSING'`,
      {
        replacements: {
          attemptId,
          status,
          resultHash: hashSecret(resultTicket),
          completedAt,
          failureCode
        }
      }
    );
    return resultTicket;
  }

  validateProviderResult(result) {
    const principalId = result?.principalId;
    const openId = result?.openId;
    const accessToken = result?.accessToken;
    const expiresInSeconds = Number(result?.expiresInSeconds);
    const refreshExpiresInSeconds = result?.refreshExpiresInSeconds == null
      ? null
      : Number(result.refreshExpiresInSeconds);
    if (
      typeof principalId !== 'string'
      || !principalId
      || typeof openId !== 'string'
      || !openId
      || typeof accessToken !== 'string'
      || !accessToken
      || !Number.isInteger(expiresInSeconds)
      || expiresInSeconds <= 0
      || (
        refreshExpiresInSeconds !== null
        && (
          !Number.isInteger(refreshExpiresInSeconds)
          || refreshExpiresInSeconds <= 0
        )
      )
      || (
        result?.refreshToken !== undefined
        && result?.refreshToken !== null
        && (
          typeof result.refreshToken !== 'string'
          || !result.refreshToken
        )
      )
    ) {
      throw new MarketingAuthorizationError(
        '百度授权响应无效',
        'PROVIDER_TOKEN_RESPONSE_INVALID',
        502
      );
    }
    return {
      principalId,
      principalName: result?.principalName
        ? String(result.principalName).slice(0, 255)
        : null,
      accessToken,
      refreshToken: result?.refreshToken || null,
      openId,
      expiresInSeconds,
      refreshExpiresInSeconds
    };
  }

  async completeCallback({
    appId,
    authCode,
    state,
    userId,
    timestamp,
    signature
  }) {
    const callback = {
      appId,
      authCode,
      state,
      userId,
      timestamp,
      signature
    };
    let signatureValid = false;
    try {
      signatureValid = this.provider.verifyCallbackSignature(callback) === true;
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      throw new MarketingAuthorizationError(
        '百度授权回调签名无效',
        'BAIDU_CALLBACK_SIGNATURE_INVALID',
        400
      );
    }
    const processingAt = nowIso(this.clock);
    const rows = await this.sequelize.query(
      `SELECT *
       FROM baidu_authorization_attempts
       WHERE provider_state_hash = :stateHash
       LIMIT 1`,
      {
        replacements: { stateHash: hashSecret(state) },
        type: QueryTypes.SELECT
      }
    );
    const attempt = rows[0];
    if (
      !attempt
      || attempt.status !== 'PENDING'
      || !attempt.launch_consumed_at
      || new Date(attempt.expires_at).getTime() <= this.clock()
    ) {
      throw new MarketingAuthorizationError(
        '授权回调无效、已过期或已处理',
        'AUTHORIZATION_CALLBACK_REJECTED',
        409
      );
    }
    const [, affectedRows] = await this.sequelize.query(
      `UPDATE baidu_authorization_attempts
       SET status = 'PROCESSING', updated_at = :processingAt
       WHERE id = :id AND status = 'PENDING'`,
      {
        replacements: { id: attempt.id, processingAt },
        type: QueryTypes.UPDATE
      }
    );
    if (affectedRows !== 1) {
      throw new MarketingAuthorizationError(
        '授权回调已处理',
        'AUTHORIZATION_CALLBACK_REPLAYED',
        409
      );
    }

    let providerResult;
    try {
      providerResult = this.validateProviderResult(
        await this.provider.exchangeAuthorizationCode({
          appId,
          authCode,
          userId
        })
      );
    } catch (error) {
      const outcomeUnknown = error?.code === 'OUTCOME_UNKNOWN';
      const resultTicket = await this.markAttemptTerminal(
        attempt.id,
        outcomeUnknown ? 'OUTCOME_UNKNOWN' : 'FAILED',
        outcomeUnknown
          ? 'TOKEN_EXCHANGE_OUTCOME_UNKNOWN'
          : (error?.code || 'TOKEN_EXCHANGE_FAILED')
      );
      return { resultTicket };
    }

    const connectionId = attempt.operation === 'CONNECT'
      ? crypto.randomUUID()
      : attempt.target_connection_id;
    const completedAt = nowIso(this.clock);
    const accessTokenExpiresAt = plusMilliseconds(
      this.clock,
      providerResult.expiresInSeconds * 1000
    );
    const refreshTokenExpiresAt = providerResult.refreshExpiresInSeconds
      ? plusMilliseconds(
        this.clock,
        providerResult.refreshExpiresInSeconds * 1000
      )
      : null;
    const resultTicket = randomTicket();
    try {
      await this.sequelize.transaction(async (transaction) => {
        await this.requireActiveAdmin(
          attempt.initiated_by_user_id,
          transaction
        );
        if (attempt.operation === 'CONNECT') {
          await this.sequelize.query(
          `INSERT INTO baidu_marketing_connections (
            id, status, authorized_principal_id, authorized_principal_name,
            authorized_open_id,
            access_token_ciphertext, refresh_token_ciphertext,
            access_token_expires_at, refresh_token_expires_at,
            auth_generation, token_version,
            refresh_claim_token, refresh_claim_until, created_by_user_id,
            last_error_code, created_at, updated_at
          ) VALUES (
            :id, 'CONNECTED', :principalId, :principalName,
            :openId,
            :accessCiphertext, :refreshCiphertext,
            :expiresAt, :refreshExpiresAt, 0, 1,
            NULL, NULL, :adminId,
            NULL, :completedAt, :completedAt
          )`,
          {
            replacements: {
              id: connectionId,
              principalId: providerResult.principalId,
              principalName: providerResult.principalName,
              openId: providerResult.openId,
              accessCiphertext: encryptSecret(
                providerResult.accessToken,
                this.encryptionKey
              ),
              refreshCiphertext: providerResult.refreshToken
                ? encryptSecret(providerResult.refreshToken, this.encryptionKey)
                : null,
              expiresAt: accessTokenExpiresAt,
              refreshExpiresAt: refreshTokenExpiresAt,
              adminId: attempt.initiated_by_user_id,
              completedAt
            },
            transaction
          }
          );
        } else {
          const [, updateAffectedRows] = await this.sequelize.query(
          `UPDATE baidu_marketing_connections
           SET status = 'CONNECTED',
               authorized_principal_id = :principalId,
               authorized_principal_name = :principalName,
               authorized_open_id = :openId,
               access_token_ciphertext = :accessCiphertext,
               refresh_token_ciphertext = :refreshCiphertext,
               access_token_expires_at = :expiresAt,
               refresh_token_expires_at = :refreshExpiresAt,
               token_version = token_version + 1,
               refresh_claim_token = NULL,
               refresh_claim_until = NULL,
               tongji_user_name_verified_at = NULL,
               marketing_access_state = 'UNKNOWN',
               marketing_observed_auth_generation = NULL,
               marketing_observed_token_version = NULL,
               marketing_checked_at = NULL,
               marketing_last_error_code = NULL,
               tongji_access_state = 'UNKNOWN',
               tongji_observed_auth_generation = NULL,
               tongji_observed_token_version = NULL,
               tongji_checked_at = NULL,
               tongji_last_error_code = NULL,
               last_error_code = NULL,
               updated_at = :completedAt
           WHERE id = :id
             AND auth_generation = :expectedGeneration
             AND authorized_principal_id = :principalId`,
          {
            replacements: {
              id: connectionId,
              expectedGeneration: attempt.expected_auth_generation,
              principalId: providerResult.principalId,
              principalName: providerResult.principalName,
              openId: providerResult.openId,
              accessCiphertext: encryptSecret(
                providerResult.accessToken,
                this.encryptionKey
              ),
              refreshCiphertext: providerResult.refreshToken
                ? encryptSecret(providerResult.refreshToken, this.encryptionKey)
                : null,
              expiresAt: accessTokenExpiresAt,
              refreshExpiresAt: refreshTokenExpiresAt,
              completedAt
            },
            transaction,
            type: QueryTypes.UPDATE
          }
          );
          if (updateAffectedRows !== 1) {
            throw new MarketingAuthorizationError(
              '连接授权代次或授权主体已变化',
              'AUTHORIZATION_GENERATION_CHANGED',
              409
            );
          }
        }
        const [, affected] = await this.sequelize.query(
        `UPDATE baidu_authorization_attempts
         SET status = 'SUCCEEDED',
             target_connection_id = :connectionId,
             result_ticket_hash = :resultHash,
             completed_at = :completedAt,
             failure_code = NULL,
             updated_at = :completedAt
         WHERE id = :attemptId
           AND status = 'PROCESSING'`,
        {
          replacements: {
            attemptId: attempt.id,
            connectionId,
            resultHash: hashSecret(resultTicket),
            completedAt
          },
          transaction,
          type: QueryTypes.UPDATE
        }
        );
        if (affected !== 1) {
          throw new MarketingAuthorizationError(
            '授权尝试终态写入被拒绝',
            'AUTHORIZATION_ATTEMPT_FINALIZE_REJECTED',
            409
          );
        }
      });
    } catch (error) {
      return {
        resultTicket: await this.markAttemptTerminal(
          attempt.id,
          'FAILED',
          error?.code || 'AUTHORIZATION_FINALIZE_FAILED'
        )
      };
    }
    return { resultTicket };
  }

  async consumeResult({ resultTicket, adminId }) {
    return this.sequelize.transaction(async (transaction) => {
      const rows = await this.sequelize.query(
        `SELECT a.id, a.status, a.failure_code, a.target_connection_id,
                c.authorized_principal_id
         FROM baidu_authorization_attempts a
         LEFT JOIN baidu_marketing_connections c
           ON c.id = a.target_connection_id
         WHERE a.result_ticket_hash = :resultHash
           AND a.initiated_by_user_id = :adminId
           AND a.result_consumed_at IS NULL
         LIMIT 1`,
        {
          replacements: {
            resultHash: hashSecret(resultTicket),
            adminId
          },
          type: QueryTypes.SELECT,
          transaction
        }
      );
      const row = rows[0];
      if (!row) {
        throw new MarketingAuthorizationError(
          '授权结果不存在或已读取',
          'AUTHORIZATION_RESULT_NOT_FOUND',
          404
        );
      }
      await this.requireActiveAdmin(adminId, transaction);
      const [, affected] = await this.sequelize.query(
        `UPDATE baidu_authorization_attempts
         SET result_consumed_at = :consumedAt,
             updated_at = :consumedAt
         WHERE id = :id AND result_consumed_at IS NULL`,
        {
          replacements: {
            id: row.id,
            consumedAt: nowIso(this.clock)
          },
          transaction,
          type: QueryTypes.UPDATE
        }
      );
      if (affected !== 1) {
        throw new MarketingAuthorizationError(
          '授权结果不存在或已读取',
          'AUTHORIZATION_RESULT_NOT_FOUND',
          404
        );
      }
      return {
        status: row.status,
        failureCode: row.failure_code || null,
        connectionId: row.target_connection_id || null,
        principalId: row.authorized_principal_id || null
      };
    });
  }

  async listConnections() {
    const rows = await this.sequelize.query(
      `SELECT id, status, authorized_principal_id AS principalId,
              authorized_principal_name AS principalName,
              access_token_expires_at AS accessTokenExpiresAt,
              tongji_user_name AS "tongjiUserName",
              auth_generation AS authGeneration,
              token_version AS tokenVersion,
              marketing_access_state AS "marketingAccessState",
              marketing_observed_auth_generation AS "marketingObservedAuthGeneration",
              marketing_observed_token_version AS "marketingObservedTokenVersion",
              marketing_checked_at AS "marketingCheckedAt",
              marketing_last_error_code AS "marketingLastErrorCode",
              tongji_access_state AS "tongjiAccessState",
              tongji_observed_auth_generation AS "tongjiObservedAuthGeneration",
              tongji_observed_token_version AS "tongjiObservedTokenVersion",
              tongji_checked_at AS "tongjiCheckedAt",
              tongji_last_error_code AS "tongjiLastErrorCode",
              last_error_code AS lastErrorCode,
              created_at AS createdAt,
              updated_at AS updatedAt
       FROM baidu_marketing_connections
       ORDER BY created_at DESC`,
      { type: QueryTypes.SELECT }
    );
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      principalId: row.principalId,
      principalName: row.principalName,
      accessTokenExpiresAt: row.accessTokenExpiresAt,
      tongjiUserName: row.tongjiUserName || null,
      products: {
        marketing: publicProductState(row, 'marketing'),
        tongji: publicProductState(row, 'tongji')
      },
      lastErrorCode: row.lastErrorCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  async disconnect({ connectionId }) {
    const disconnectedAt = nowIso(this.clock);
    return this.sequelize.transaction(async (transaction) => {
      const rows = await this.sequelize.query(
        `SELECT id, status
         FROM baidu_marketing_connections
         WHERE id = :connectionId
         LIMIT 1`,
        {
          replacements: { connectionId },
          type: QueryTypes.SELECT,
          transaction
        }
      );
      if (!rows[0]) {
        throw new MarketingAuthorizationError(
          '连接不存在',
          'CONNECTION_NOT_FOUND',
          404
        );
      }
      if (rows[0].status !== 'DISCONNECTED') {
        await this.sequelize.query(
          `UPDATE baidu_marketing_connections
           SET status = 'DISCONNECTED',
               access_token_ciphertext = NULL,
               refresh_token_ciphertext = NULL,
               access_token_expires_at = NULL,
               tongji_user_name = NULL,
               tongji_user_name_verified_at = NULL,
               refresh_claim_token = NULL,
               refresh_claim_until = NULL,
               auth_generation = auth_generation + 1,
               token_version = token_version + 1,
               marketing_access_state = 'UNKNOWN',
               marketing_observed_auth_generation = NULL,
               marketing_observed_token_version = NULL,
               marketing_checked_at = NULL,
               marketing_last_error_code = NULL,
               tongji_access_state = 'UNKNOWN',
               tongji_observed_auth_generation = NULL,
               tongji_observed_token_version = NULL,
               tongji_checked_at = NULL,
               tongji_last_error_code = NULL,
               last_error_code = 'PROVIDER_REVOCATION_UNVERIFIED',
               updated_at = :disconnectedAt
           WHERE id = :connectionId`,
          {
            replacements: { connectionId, disconnectedAt },
            transaction
          }
        );
        await this.sequelize.query(
          `UPDATE baidu_project_bindings
           SET status = 'PAUSED',
               binding_version = binding_version + 1,
               paused_reason = 'DISCONNECTED',
               updated_at = :disconnectedAt
           WHERE connection_id = :connectionId
             AND status = 'ACTIVE'`,
          {
            replacements: { connectionId, disconnectedAt },
            transaction
          }
        );
      }
      return {
        id: connectionId,
        status: 'DISCONNECTED',
        providerRevocation: 'MANUAL_REQUIRED'
      };
    });
  }
}

module.exports = {
  BaiduAuthorizationService,
  MarketingAuthorizationError,
  hashSecret
};
