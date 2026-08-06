const { QueryTypes } = require('sequelize');
const {
  normalizeTongjiSites
} = require('./BaiduBindingService');

const DEFAULT_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

class BaiduTongjiContextError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function normalizeUserName(value, {
  code = 'TONGJI_CONTEXT_REQUEST_INVALID',
  status = 400
} = {}) {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.trim().length > 255
  ) {
    throw new BaiduTongjiContextError(
      '百度统计用户名无效',
      code,
      status
    );
  }
  return value.trim();
}

function productFailure(error) {
  if (error?.code === 'BAIDU_REAUTHORIZATION_REQUIRED') {
    return { state: 'REAUTH_REQUIRED', code: error.code };
  }
  if (error?.code === 'BAIDU_TONGJI_ACCOUNT_INVALID') {
    return { state: 'ACCOUNT_MISMATCH', code: error.code };
  }
  return {
    state: 'UPSTREAM_ERROR',
    code: typeof error?.code === 'string'
      ? error.code
      : 'BAIDU_TONGJI_FAILED'
  };
}

class BaiduTongjiContextService {
  constructor({
    sequelize,
    provider,
    connectionService,
    runTongjiRequest,
    clock = () => Date.now(),
    verificationTtlMs = DEFAULT_VERIFICATION_TTL_MS
  }) {
    this.sequelize = sequelize;
    this.provider = provider;
    this.connectionService = connectionService;
    this.runTongjiRequest = runTongjiRequest;
    this.clock = clock;
    this.verificationTtlMs = verificationTtlMs;
    this.verifiedBindingVersions = new Map();
  }

  async readStoredContext(connectionId) {
    const rows = await this.sequelize.query(
      `SELECT id, status, auth_generation, token_version,
              tongji_user_name, tongji_user_name_verified_at,
              tongji_access_state,
              tongji_observed_auth_generation,
              tongji_observed_token_version
       FROM baidu_marketing_connections
       WHERE id = :connectionId
       LIMIT 1`,
      {
        replacements: { connectionId },
        type: QueryTypes.SELECT
      }
    );
    if (!rows[0]) {
      throw new BaiduTongjiContextError(
        '连接不存在',
        'CONNECTION_NOT_FOUND',
        404
      );
    }
    if (rows[0].status !== 'CONNECTED') {
      throw new BaiduTongjiContextError(
        '连接需要重新授权',
        'CONNECTION_NOT_CONNECTED',
        409
      );
    }
    return rows[0];
  }

  async recordFailure(connectionId, accessContext, error) {
    const failure = productFailure(error);
    await this.connectionService.recordProductAccess({
      connectionId,
      product: 'tongji',
      state: failure.state,
      authGeneration: accessContext.authGeneration,
      tokenVersion: accessContext.tokenVersion,
      lastErrorCode: failure.code
    });
  }

  async readDirectory({ connectionId, userName, accessContext }) {
    try {
      return normalizeTongjiSites(await this.runTongjiRequest(() => (
        this.provider.listTongjiSites({
          accountName: userName,
          accessToken: accessContext.accessToken
        })
      )));
    } catch (error) {
      await this.recordFailure(connectionId, accessContext, error);
      if (error?.code === 'BAIDU_TONGJI_ACCOUNT_INVALID') {
        throw new BaiduTongjiContextError(
          '用户名不能由当前 OAuth Token 访问',
          'TONGJI_ACCOUNT_NOT_AVAILABLE',
          422
        );
      }
      if (error?.code === 'BAIDU_REAUTHORIZATION_REQUIRED') {
        throw new BaiduTongjiContextError(
          '百度连接需要重新授权',
          'BAIDU_REAUTHORIZATION_REQUIRED',
          409
        );
      }
      throw error;
    }
  }

  async persistVerification({
    connectionId,
    userName,
    accessContext,
    pauseOnChange
  }) {
    const now = new Date(this.clock()).toISOString();
    const current = await this.readStoredContext(connectionId);
    if (
      Number(current.auth_generation) !== accessContext.authGeneration
      || Number(current.token_version) !== accessContext.tokenVersion
    ) {
      throw new BaiduTongjiContextError(
        '百度统计用户名验证结果已过期',
        'TONGJI_CONTEXT_VERSION_CHANGED',
        409
      );
    }
    const previousUserName = current.tongji_user_name || null;
    const changed = Boolean(previousUserName && previousUserName !== userName);
    return this.sequelize.transaction(async (transaction) => {
      const [, affected] = await this.sequelize.query(
        `UPDATE baidu_marketing_connections
         SET tongji_user_name = :userName,
             tongji_user_name_verified_at = :now,
             tongji_access_state = 'VERIFIED',
             tongji_observed_auth_generation = :authGeneration,
             tongji_observed_token_version = :tokenVersion,
             tongji_checked_at = :now,
             tongji_last_error_code = NULL,
             updated_at = :now
         WHERE id = :connectionId
           AND status = 'CONNECTED'
           AND auth_generation = :authGeneration
           AND token_version = :tokenVersion
           AND (
             (tongji_user_name IS NULL AND :previousUserName IS NULL)
             OR tongji_user_name = :previousUserName
           )`,
        {
          replacements: {
            connectionId,
            userName,
            authGeneration: accessContext.authGeneration,
            tokenVersion: accessContext.tokenVersion,
            previousUserName,
            now
          },
          type: QueryTypes.UPDATE,
          transaction
        }
      );
      if (affected !== 1) {
        throw new BaiduTongjiContextError(
          '百度统计用户名验证结果已过期',
          'TONGJI_CONTEXT_VERSION_CHANGED',
          409
        );
      }
      if (pauseOnChange && changed) {
        await this.sequelize.query(
          `UPDATE baidu_project_bindings
           SET status = 'PAUSED',
               binding_version = binding_version + 1,
               paused_reason = 'TONGJI_CONTEXT_CHANGED',
               updated_at = :now
           WHERE connection_id = :connectionId
             AND status = 'ACTIVE'`,
          {
            replacements: { connectionId, now },
            transaction
          }
        );
      }
      return now;
    });
  }

  async verify({ connectionId, userName, pauseOnChange }) {
    const accessContext = await this.connectionService.getAccessContext(
      connectionId
    );
    const sites = await this.readDirectory({
      connectionId,
      userName,
      accessContext
    });
    const verifiedAt = await this.persistVerification({
      connectionId,
      userName,
      accessContext,
      pauseOnChange
    });
    return { accessContext, sites, verifiedAt };
  }

  async configure({ connectionId, userName }) {
    const normalizedUserName = normalizeUserName(userName);
    const result = await this.verify({
      connectionId,
      userName: normalizedUserName,
      pauseOnChange: true
    });
    return {
      userName: normalizedUserName,
      siteCount: result.sites.length,
      verifiedAt: result.verifiedAt
    };
  }

  async listSites(connectionId) {
    return (await this.listSitesWithContext(connectionId)).sites;
  }

  async listSitesWithContext(connectionId) {
    const stored = await this.readStoredContext(connectionId);
    const userName = normalizeUserName(stored.tongji_user_name, {
      code: 'TONGJI_ACCOUNT_NOT_AVAILABLE',
      status: 422
    });
    const result = await this.verify({
      connectionId,
      userName,
      pauseOnChange: false
    });
    return {
      sites: result.sites,
      validationContext: {
        authGeneration: result.accessContext.authGeneration,
        tokenVersion: result.accessContext.tokenVersion,
        tongjiUserName: userName,
        tongjiUserNameVerifiedAt: result.verifiedAt,
        tongjiVerified: true
      }
    };
  }

  verificationFresh(value) {
    const verifiedAt = new Date(value).getTime();
    const age = this.clock() - verifiedAt;
    return Number.isFinite(verifiedAt)
      && age >= 0
      && age <= this.verificationTtlMs;
  }

  async resolveBoundContext(connection, { forceVerification = false } = {}) {
    const accessContext = await this.connectionService.getAccessContext(
      connection.id
    );
    const stored = await this.readStoredContext(connection.id);
    const userName = normalizeUserName(stored.tongji_user_name, {
      code: 'TONGJI_ACCOUNT_NOT_AVAILABLE',
      status: 422
    });
    let site = {
      siteId: connection.tongji_site_id,
      domain: connection.tongji_site_domain,
      status: 'ACTIVE'
    };
    const bindingKey = typeof connection.binding_id === 'string'
      ? connection.binding_id
      : null;
    const bindingVersion = Number(connection.binding_version);
    const bindingChanged = bindingKey !== null && (
      !Number.isInteger(bindingVersion)
      || this.verifiedBindingVersions.get(bindingKey) !== bindingVersion
    );
    if (
      forceVerification
      || bindingChanged
      || !this.verificationFresh(stored.tongji_user_name_verified_at)
      || stored.tongji_access_state !== 'VERIFIED'
      || Number(stored.tongji_observed_auth_generation)
        !== accessContext.authGeneration
      || Number(stored.tongji_observed_token_version)
        !== accessContext.tokenVersion
    ) {
      const sites = await this.readDirectory({
        connectionId: connection.id,
        userName,
        accessContext
      });
      site = sites.find((item) => item.siteId === connection.tongji_site_id);
      if (!site) {
        throw new BaiduTongjiContextError(
          '项目绑定的百度统计站点当前不可用',
          'BAIDU_TONGJI_SITE_NOT_AVAILABLE',
          409
        );
      }
      if (site.domain !== connection.tongji_site_domain) {
        throw new BaiduTongjiContextError(
          '项目绑定的百度统计站点域名已变化',
          'BAIDU_TONGJI_SITE_DOMAIN_CHANGED',
          409
        );
      }
      await this.persistVerification({
        connectionId: connection.id,
        userName,
        accessContext,
        pauseOnChange: false
      });
      if (bindingKey !== null && Number.isInteger(bindingVersion)) {
        this.verifiedBindingVersions.set(bindingKey, bindingVersion);
      }
    }
    return {
      accountName: userName,
      accessToken: accessContext.accessToken,
      authGeneration: accessContext.authGeneration,
      tokenVersion: accessContext.tokenVersion,
      site
    };
  }

  async withBoundContext(connection, task) {
    const context = await this.resolveBoundContext(connection);
    try {
      return await task(context);
    } catch (error) {
      if (error?.code === 'BAIDU_REAUTHORIZATION_REQUIRED') {
        await this.recordFailure(connection.id, context, error);
      }
      if (new Set([
        'BAIDU_TONGJI_ACCOUNT_INVALID',
        'BAIDU_TONGJI_SITE_NOT_AVAILABLE',
        'BAIDU_TONGJI_SITE_DOMAIN_CHANGED'
      ]).has(error?.code)) {
        await this.resolveBoundContext(connection, { forceVerification: true });
      }
      throw error;
    }
  }
}

module.exports = {
  BaiduTongjiContextError,
  BaiduTongjiContextService,
  DEFAULT_VERIFICATION_TTL_MS,
  normalizeUserName
};
