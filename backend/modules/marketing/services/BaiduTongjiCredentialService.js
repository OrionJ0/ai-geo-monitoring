const { QueryTypes } = require('sequelize');
const {
  decryptSecret,
  encryptSecret
} = require('../../../services/SecretEncryptionService');
const {
  normalizeTongjiSites
} = require('./BaiduBindingService');

class BaiduTongjiCredentialError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function normalizeCredentialInput({ accountName, accessToken }) {
  const normalizedAccountName = typeof accountName === 'string'
    ? accountName.trim()
    : '';
  const normalizedAccessToken = typeof accessToken === 'string'
    ? accessToken.trim()
    : '';
  if (!normalizedAccountName || normalizedAccountName.length > 255) {
    throw new BaiduTongjiCredentialError(
      '百度统计账户名无效',
      'TONGJI_ACCOUNT_NAME_INVALID'
    );
  }
  if (!normalizedAccessToken || normalizedAccessToken.length > 4096) {
    throw new BaiduTongjiCredentialError(
      '百度统计 Data API Token 无效',
      'TONGJI_ACCESS_TOKEN_INVALID'
    );
  }
  return {
    accountName: normalizedAccountName,
    accessToken: normalizedAccessToken
  };
}

class BaiduTongjiCredentialService {
  constructor({ sequelize, provider, encryptionKey, clock = () => Date.now() }) {
    this.sequelize = sequelize;
    this.provider = provider;
    this.encryptionKey = encryptionKey;
    this.clock = clock;
  }

  async readConnection(connectionId) {
    const rows = await this.sequelize.query(
      `SELECT id, status, tongji_account_name,
              tongji_access_token_ciphertext,
              tongji_credential_updated_at
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
      throw new BaiduTongjiCredentialError(
        '百度连接不存在',
        'CONNECTION_NOT_FOUND',
        404
      );
    }
    if (connection.status !== 'CONNECTED') {
      throw new BaiduTongjiCredentialError(
        '百度连接当前不可用',
        'CONNECTION_NOT_CONNECTED',
        409
      );
    }
    return connection;
  }

  async getCredential(connectionId) {
    const connection = await this.readConnection(connectionId);
    if (
      !connection.tongji_account_name
      || !connection.tongji_access_token_ciphertext
    ) {
      throw new BaiduTongjiCredentialError(
        '请先配置百度统计 Data API Token',
        'TONGJI_CREDENTIAL_MISSING',
        409
      );
    }
    return {
      accountName: connection.tongji_account_name,
      accessToken: decryptSecret(
        connection.tongji_access_token_ciphertext,
        this.encryptionKey
      )
    };
  }

  async listSites(connectionId) {
    const credential = await this.getCredential(connectionId);
    return normalizeTongjiSites(await this.provider.listTongjiSites(credential));
  }

  async configure({ connectionId, accountName, accessToken }) {
    await this.readConnection(connectionId);
    const credential = normalizeCredentialInput({ accountName, accessToken });
    const sites = normalizeTongjiSites(
      await this.provider.listTongjiSites(credential)
    );
    const updatedAt = new Date(this.clock()).toISOString();
    const [, affected] = await this.sequelize.query(
      `UPDATE baidu_marketing_connections
       SET tongji_account_name = :accountName,
           tongji_access_token_ciphertext = :accessTokenCiphertext,
           tongji_credential_updated_at = :updatedAt,
           updated_at = :updatedAt
       WHERE id = :connectionId
         AND status = 'CONNECTED'`,
      {
        replacements: {
          connectionId,
          accountName: credential.accountName,
          accessTokenCiphertext: encryptSecret(
            credential.accessToken,
            this.encryptionKey
          ),
          updatedAt
        },
        type: QueryTypes.UPDATE
      }
    );
    if (affected !== 1) {
      throw new BaiduTongjiCredentialError(
        '百度连接状态已变化，请重试',
        'CONNECTION_STATE_CHANGED',
        409
      );
    }
    return {
      connectionId,
      accountName: credential.accountName,
      configured: true,
      updatedAt,
      sites
    };
  }
}

module.exports = {
  BaiduTongjiCredentialError,
  BaiduTongjiCredentialService,
  normalizeCredentialInput
};
