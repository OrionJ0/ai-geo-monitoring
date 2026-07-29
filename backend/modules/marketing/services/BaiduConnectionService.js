const crypto = require('node:crypto');
const { QueryTypes } = require('sequelize');
const {
  decryptSecret,
  encryptSecret
} = require('../../../services/SecretEncryptionService');
const {
  MarketingAuthorizationError
} = require('./BaiduAuthorizationService');

class BaiduConnectionService {
  constructor({
    sequelize,
    provider,
    encryptionKey,
    clock = () => Date.now(),
    wait = () => new Promise((resolve) => setTimeout(resolve, 25)),
    claimTtlMs = 30_000,
    maxClaimWaits = 100
  }) {
    this.sequelize = sequelize;
    this.provider = provider;
    this.encryptionKey = encryptionKey;
    this.clock = clock;
    this.wait = wait;
    this.claimTtlMs = claimTtlMs;
    this.maxClaimWaits = maxClaimWaits;
  }

  async readConnection(connectionId) {
    const rows = await this.sequelize.query(
      `SELECT *
       FROM baidu_marketing_connections
       WHERE id = :connectionId
       LIMIT 1`,
      {
        replacements: { connectionId },
        type: QueryTypes.SELECT
      }
    );
    const connection = rows[0];
    if (!connection) {
      throw new MarketingAuthorizationError(
        '连接不存在',
        'CONNECTION_NOT_FOUND',
        404
      );
    }
    if (connection.status !== 'CONNECTED') {
      throw new MarketingAuthorizationError(
        '连接需要重新授权',
        'CONNECTION_NOT_CONNECTED',
        409
      );
    }
    return connection;
  }

  accessTokenStillValid(connection) {
    return (
      connection.access_token_ciphertext
      && connection.access_token_expires_at
      && new Date(connection.access_token_expires_at).getTime() > this.clock()
    );
  }

  async claim(connection) {
    const claimToken = crypto.randomBytes(32).toString('hex');
    const claimUntil = new Date(this.clock() + this.claimTtlMs).toISOString();
    const now = new Date(this.clock()).toISOString();
    const [, affected] = await this.sequelize.query(
      `UPDATE baidu_marketing_connections
       SET refresh_claim_token = :claimToken,
           refresh_claim_until = :claimUntil,
           updated_at = :now
       WHERE id = :connectionId
         AND status = 'CONNECTED'
         AND auth_generation = :authGeneration
         AND token_version = :tokenVersion
         AND (
           refresh_claim_token IS NULL
           OR refresh_claim_until IS NULL
           OR refresh_claim_until <= :now
         )`,
      {
        replacements: {
          connectionId: connection.id,
          authGeneration: connection.auth_generation,
          tokenVersion: connection.token_version,
          claimToken,
          claimUntil,
          now
        },
        type: QueryTypes.UPDATE
      }
    );
    return affected === 1 ? claimToken : null;
  }

  validateRefreshResponse(response) {
    if (
      typeof response?.accessToken !== 'string'
      || !response.accessToken
      || !Number.isInteger(response.expiresInSeconds)
      || response.expiresInSeconds <= 0
      || (
        response.refreshToken !== undefined
        && (
          typeof response.refreshToken !== 'string'
          || !response.refreshToken
        )
      )
    ) {
      throw new MarketingAuthorizationError(
        'Token 刷新响应无效',
        'REFRESH_RESPONSE_INVALID',
        502
      );
    }
    return response;
  }

  async requireReauthorization(connection, claimToken, code) {
    const now = new Date(this.clock()).toISOString();
    return this.sequelize.transaction(async (transaction) => {
      const [, affected] = await this.sequelize.query(
        `UPDATE baidu_marketing_connections
         SET status = 'REAUTH_REQUIRED',
             refresh_claim_token = NULL,
             refresh_claim_until = NULL,
             auth_generation = auth_generation + 1,
             last_error_code = :code,
             updated_at = :now
         WHERE id = :connectionId
           AND auth_generation = :authGeneration
           AND token_version = :tokenVersion
           AND refresh_claim_token = :claimToken`,
        {
          replacements: {
            connectionId: connection.id,
            authGeneration: connection.auth_generation,
            tokenVersion: connection.token_version,
            claimToken,
            code,
            now
          },
          transaction
        }
      );
      if (affected !== 1) return false;
      await this.sequelize.query(
        `UPDATE baidu_project_bindings
         SET status = 'PAUSED',
             binding_version = binding_version + 1,
             paused_reason = 'REAUTH',
             updated_at = :now
         WHERE connection_id = :connectionId
           AND status = 'ACTIVE'`,
        {
          replacements: { connectionId: connection.id, now },
          transaction
        }
      );
      return true;
    });
  }

  async refreshClaimed(connection, claimToken) {
    const oldRefreshToken = connection.refresh_token_ciphertext
      ? decryptSecret(
          connection.refresh_token_ciphertext,
          this.encryptionKey
        )
      : null;
    if (!oldRefreshToken) {
      const changed = await this.requireReauthorization(
        connection,
        claimToken,
        'REFRESH_TOKEN_MISSING'
      );
      throw new MarketingAuthorizationError(
        changed ? '连接缺少 Refresh Token' : '晚到的 Token 刷新结果已拒绝',
        changed ? 'REFRESH_TOKEN_MISSING' : 'REFRESH_CAS_REJECTED',
        409
      );
    }

    let response;
    try {
      response = this.validateRefreshResponse(
        await this.provider.refreshAccessToken({
          refreshToken: oldRefreshToken
        })
      );
    } catch (error) {
      const code = error?.code === 'OUTCOME_UNKNOWN'
        ? 'REFRESH_OUTCOME_UNKNOWN'
        : (error?.code || 'REFRESH_FAILED');
      const changed = await this.requireReauthorization(
        connection,
        claimToken,
        code
      );
      throw new MarketingAuthorizationError(
        changed ? '百度连接需要重新授权' : '晚到的 Token 刷新结果已拒绝',
        changed ? code : 'REFRESH_CAS_REJECTED',
        409
      );
    }

    const nextRefreshCiphertext = (
      !response.refreshToken
      || response.refreshToken === oldRefreshToken
    )
      ? connection.refresh_token_ciphertext
      : encryptSecret(response.refreshToken, this.encryptionKey);
    const expiresAt = new Date(
      this.clock() + (response.expiresInSeconds * 1000)
    ).toISOString();
    const now = new Date(this.clock()).toISOString();
    const [, affected] = await this.sequelize.query(
      `UPDATE baidu_marketing_connections
       SET access_token_ciphertext = :accessCiphertext,
           refresh_token_ciphertext = :refreshCiphertext,
           access_token_expires_at = :expiresAt,
           token_version = token_version + 1,
           refresh_claim_token = NULL,
           refresh_claim_until = NULL,
           last_error_code = NULL,
           updated_at = :now
       WHERE id = :connectionId
         AND status = 'CONNECTED'
         AND auth_generation = :authGeneration
         AND token_version = :tokenVersion
         AND refresh_claim_token = :claimToken`,
      {
        replacements: {
          connectionId: connection.id,
          authGeneration: connection.auth_generation,
          tokenVersion: connection.token_version,
          claimToken,
          accessCiphertext: encryptSecret(
            response.accessToken,
            this.encryptionKey
          ),
          refreshCiphertext: nextRefreshCiphertext,
          expiresAt,
          now
        },
        type: QueryTypes.UPDATE
      }
    );
    if (affected !== 1) {
      throw new MarketingAuthorizationError(
        '晚到的 Token 刷新结果已拒绝',
        'REFRESH_CAS_REJECTED',
        409
      );
    }
    return response.accessToken;
  }

  async getAccessToken(connectionId) {
    for (let attempt = 0; attempt <= this.maxClaimWaits; attempt += 1) {
      const connection = await this.readConnection(connectionId);
      if (this.accessTokenStillValid(connection)) {
        return decryptSecret(
          connection.access_token_ciphertext,
          this.encryptionKey
        );
      }
      const claimToken = await this.claim(connection);
      if (claimToken) {
        return this.refreshClaimed(connection, claimToken);
      }
      if (attempt === this.maxClaimWaits) break;
      await this.wait();
    }
    throw new MarketingAuthorizationError(
      '等待 Token 刷新超时',
      'REFRESH_CLAIM_TIMEOUT',
      503
    );
  }
}

module.exports = {
  BaiduConnectionService
};
