const crypto = require('node:crypto');
const { QueryTypes, Transaction } = require('sequelize');
const {
  parseProjectAllowlist,
  projectAllowed
} = require('../domain/projectAllowlist');

class MarketingBindingError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function normalizeSearchAccounts(accounts) {
  if (!Array.isArray(accounts)) {
    throw new MarketingBindingError(
      '百度账户目录响应无效',
      'ACCOUNT_DIRECTORY_INVALID',
      502
    );
  }
  const normalized = [];
  const seen = new Set();
  for (const account of accounts) {
    if (
      typeof account?.accountId !== 'string'
      || !account.accountId
      || account.accountId.length > 512
      || typeof account?.accountName !== 'string'
    ) {
      throw new MarketingBindingError(
        '百度账户目录响应无效',
        'ACCOUNT_DIRECTORY_INVALID',
        502
      );
    }
    if (account.product !== 'SEARCH' || account.readOnly !== true) continue;
    if (seen.has(account.accountId)) {
      throw new MarketingBindingError(
        '百度账户目录包含重复账户',
        'ACCOUNT_DIRECTORY_INVALID',
        502
      );
    }
    seen.add(account.accountId);
    normalized.push({
      accountId: account.accountId,
      accountName: account.accountName.slice(0, 255)
    });
  }
  return normalized;
}

function normalizeTongjiSites(sites) {
  if (!Array.isArray(sites)) {
    throw new MarketingBindingError(
      '百度统计站点目录响应无效',
      'TONGJI_SITE_DIRECTORY_INVALID',
      502
    );
  }
  const normalized = [];
  const seen = new Set();
  for (const site of sites) {
    if (
      typeof site?.siteId !== 'string'
      || !/^\d+$/u.test(site.siteId)
      || site.siteId.length > 32
      || typeof site?.domain !== 'string'
      || !site.domain
      || site.domain.length > 255
      || !['ACTIVE', 'PAUSED'].includes(site.status)
      || seen.has(site.siteId)
    ) {
      throw new MarketingBindingError(
        '百度统计站点目录响应无效',
        'TONGJI_SITE_DIRECTORY_INVALID',
        502
      );
    }
    seen.add(site.siteId);
    if (site.status === 'ACTIVE') {
      normalized.push({
        siteId: site.siteId,
        domain: site.domain,
        status: site.status
      });
    }
  }
  return normalized;
}

function publicBinding(row) {
  return {
    id: row.id,
    projectId: String(row.project_id),
    connectionId: row.connection_id,
    externalAccountId: row.external_account_id,
    externalAccountName: row.external_account_name,
    tongjiSiteId: row.tongji_site_id || null,
    tongjiSiteDomain: row.tongji_site_domain || null,
    status: row.status,
    bindingVersion: Number(row.binding_version),
    pausedReason: row.paused_reason || null
  };
}

function isUniqueConstraintError(error) {
  return (
    error?.name === 'SequelizeUniqueConstraintError'
    || error?.original?.code === '23505'
    || error?.original?.code === 'SQLITE_CONSTRAINT'
  );
}

function connectionValidationContext(connection) {
  return {
    authGeneration: Number(connection.auth_generation),
    tokenVersion: Number(connection.token_version),
    tongjiUserName: connection.tongji_user_name || null,
    tongjiUserNameVerifiedAt: connection.tongji_user_name_verified_at || null,
    marketingVerified: false,
    tongjiVerified: false
  };
}

function normalizeDirectoryResult(result, key, fallbackContext) {
  if (Array.isArray(result)) {
    return { items: result, validationContext: fallbackContext };
  }
  if (
    !result
    || typeof result !== 'object'
    || !Array.isArray(result[key])
    || !result.validationContext
    || typeof result.validationContext !== 'object'
  ) {
    return { items: result, validationContext: fallbackContext };
  }
  return {
    items: result[key],
    validationContext: result.validationContext
  };
}

function comparableTimestamp(value) {
  if (value == null) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : String(value);
}

class BaiduBindingService {
  constructor({
    sequelize,
    accountDirectory,
    siteDirectory,
    allowedProjectIds = '*'
  }) {
    this.sequelize = sequelize;
    this.accountDirectory = accountDirectory;
    this.siteDirectory = siteDirectory;
    this.projectAllowlist = parseProjectAllowlist(allowedProjectIds);
  }

  bindingMutationTransaction(task) {
    if (this.sequelize.getDialect() === 'sqlite') {
      return this.sequelize.transaction(
        { type: Transaction.TYPES.IMMEDIATE },
        task
      );
    }
    return this.sequelize.transaction(task);
  }

  assertProjectAllowed(projectId) {
    if (!projectAllowed(this.projectAllowlist, projectId)) {
      throw new MarketingBindingError(
        '项目不在营销监控试点范围',
        'MARKETING_PROJECT_NOT_ALLOWED',
        403
      );
    }
  }

  async requireActiveProject(projectId, transaction) {
    this.assertProjectAllowed(projectId);
    const rows = await this.sequelize.query(
      `SELECT id, status
       FROM brand_projects
       WHERE id = :projectId
       LIMIT 1`,
      {
        replacements: { projectId },
        type: QueryTypes.SELECT,
        transaction
      }
    );
    if (!rows[0]) {
      throw new MarketingBindingError(
        '项目不存在',
        'PROJECT_NOT_FOUND',
        404
      );
    }
    if (rows[0].status !== 'active') {
      throw new MarketingBindingError(
        '归档项目不能修改营销绑定',
        'PROJECT_ARCHIVED',
        409
      );
    }
    return rows[0];
  }

  async getConnectedConnection(connectionId, transaction) {
    const rows = await this.sequelize.query(
      `SELECT id, status, authorized_principal_id, authorized_open_id,
              auth_generation, token_version,
              tongji_user_name, tongji_user_name_verified_at,
              marketing_access_state, marketing_observed_auth_generation,
              marketing_observed_token_version,
              tongji_access_state, tongji_observed_auth_generation,
              tongji_observed_token_version
       FROM baidu_marketing_connections
       WHERE id = :connectionId
       LIMIT 1${
         transaction && this.sequelize.getDialect() === 'postgres'
           ? ' FOR UPDATE'
           : ''
       }`,
      {
        replacements: { connectionId },
        type: QueryTypes.SELECT,
        transaction
      }
    );
    if (!rows[0]) {
      throw new MarketingBindingError(
        '百度连接不存在',
        'CONNECTION_NOT_FOUND',
        404
      );
    }
    if (rows[0].status !== 'CONNECTED') {
      throw new MarketingBindingError(
        '百度连接当前不可用',
        'CONNECTION_NOT_CONNECTED',
        409
      );
    }
    return rows[0];
  }

  async listAccounts(connectionId) {
    const connection = await this.getConnectedConnection(connectionId);
    const directory = normalizeDirectoryResult(
      await this.accountDirectory.listAccounts({ connection }),
      'accounts',
      connectionValidationContext(connection)
    );
    return normalizeSearchAccounts(
      directory.items
    );
  }

  async getAccountContext(connectionId, accountId) {
    if (typeof accountId !== 'string' || !accountId || accountId.length > 512) {
      throw new MarketingBindingError(
        '账户标识无效',
        'EXTERNAL_ACCOUNT_ID_INVALID',
        400
      );
    }
    const connection = await this.getConnectedConnection(connectionId);
    const directory = normalizeDirectoryResult(
      await this.accountDirectory.listAccounts({ connection }),
      'accounts',
      connectionValidationContext(connection)
    );
    const accounts = normalizeSearchAccounts(directory.items);
    const account = accounts.find((item) => item.accountId === accountId);
    if (!account) {
      throw new MarketingBindingError(
        '账户不属于当前连接或没有搜索只读权限',
        'ACCOUNT_NOT_AVAILABLE',
        422
      );
    }
    return {
      connection,
      account,
      validationContext: directory.validationContext
    };
  }

  async listTongjiSites(connectionId, accountId) {
    const context = await this.getAccountContext(connectionId, accountId);
    const directory = normalizeDirectoryResult(
      await this.siteDirectory.listSites(context),
      'sites',
      context.validationContext
    );
    return normalizeTongjiSites(
      directory.items
    );
  }

  async validateTongjiSite(context, siteId) {
    if (typeof siteId !== 'string' || !/^\d+$/u.test(siteId)) {
      throw new MarketingBindingError(
        '百度统计站点标识无效',
        'TONGJI_SITE_ID_INVALID',
        400
      );
    }
    const directory = normalizeDirectoryResult(
      await this.siteDirectory.listSites(context),
      'sites',
      context.validationContext
    );
    const sites = normalizeTongjiSites(directory.items);
    const site = sites.find((item) => item.siteId === siteId);
    if (!site) {
      throw new MarketingBindingError(
        '百度统计站点不属于所选账户或当前不可用',
        'TONGJI_SITE_NOT_AVAILABLE',
        422
      );
    }
    const accountContext = context.validationContext;
    const siteContext = directory.validationContext;
    if (
      Number(accountContext.authGeneration) !== Number(siteContext.authGeneration)
      || Number(accountContext.tokenVersion) !== Number(siteContext.tokenVersion)
    ) {
      throw new MarketingBindingError(
        '百度目录验证上下文已变化，请刷新后重试',
        'BINDING_VALIDATION_CONTEXT_CHANGED',
        409
      );
    }
    return {
      site,
      validationContext: {
        ...siteContext,
        marketingVerified: accountContext.marketingVerified === true,
        tongjiVerified: siteContext.tongjiVerified === true
      }
    };
  }

  async assertValidationContextCurrent(
    connectionId,
    expected,
    transaction
  ) {
    const current = await this.getConnectedConnection(
      connectionId,
      transaction
    );
    const unchanged = (
      Number(current.auth_generation) === Number(expected.authGeneration)
      && Number(current.token_version) === Number(expected.tokenVersion)
      && (
        !Object.hasOwn(expected, 'tongjiUserName')
        || (current.tongji_user_name || null)
          === (expected.tongjiUserName || null)
      )
      && (
        !Object.hasOwn(expected, 'tongjiUserNameVerifiedAt')
        || comparableTimestamp(current.tongji_user_name_verified_at)
          === comparableTimestamp(expected.tongjiUserNameVerifiedAt)
      )
      && (
        expected.marketingVerified !== true
        || (
          current.marketing_access_state === 'VERIFIED'
          && Number(current.marketing_observed_auth_generation)
            === Number(expected.authGeneration)
          && Number(current.marketing_observed_token_version)
            === Number(expected.tokenVersion)
        )
      )
      && (
        expected.tongjiVerified !== true
        || (
          current.tongji_access_state === 'VERIFIED'
          && Number(current.tongji_observed_auth_generation)
            === Number(expected.authGeneration)
          && Number(current.tongji_observed_token_version)
            === Number(expected.tokenVersion)
        )
      )
    );
    if (!unchanged) {
      throw new MarketingBindingError(
        '百度目录验证上下文已变化，请刷新后重试',
        'BINDING_VALIDATION_CONTEXT_CHANGED',
        409
      );
    }
    return current;
  }

  async listBindings(projectId) {
    this.assertProjectAllowed(projectId);
    return (await this.sequelize.query(
      `SELECT *
       FROM baidu_project_bindings
       WHERE project_id = :projectId
       ORDER BY created_at ASC`,
      {
        replacements: { projectId },
        type: QueryTypes.SELECT
      }
    )).map(publicBinding);
  }

  async createBinding({
    projectId,
    adminId,
    connectionId,
    externalAccountId,
    tongjiSiteId
  }) {
    await this.requireActiveProject(projectId);
    const context = await this.getAccountContext(
      connectionId,
      externalAccountId
    );
    const account = context.account;
    const validatedSite = await this.validateTongjiSite(
      context,
      tongjiSiteId
    );
    const site = validatedSite.site;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    try {
      await this.bindingMutationTransaction(async (transaction) => {
        await this.requireActiveProject(projectId, transaction);
        await this.assertValidationContextCurrent(
          connectionId,
          validatedSite.validationContext,
          transaction
        );
        const conflicts = await this.sequelize.query(
          `SELECT id, project_id
           FROM baidu_project_bindings
           WHERE connection_id = :connectionId
             AND external_account_id = :accountId
             AND status = 'ACTIVE'
           LIMIT 1`,
          {
            replacements: {
              connectionId,
              accountId: account.accountId
            },
            type: QueryTypes.SELECT,
            transaction
          }
        );
        if (conflicts[0]) {
          throw new MarketingBindingError(
            '该账户已绑定活动项目',
            'ACCOUNT_ALREADY_BOUND',
            409
          );
        }
        await this.sequelize.query(
          `INSERT INTO baidu_project_bindings (
            id, project_id, connection_id, external_account_id,
            external_account_name, tongji_site_id, tongji_site_domain,
            status, binding_version, paused_reason,
            created_by_user_id, created_at, updated_at
          ) VALUES (
            :id, :projectId, :connectionId, :accountId,
            :accountName, :tongjiSiteId, :tongjiSiteDomain,
            'ACTIVE', 0, NULL,
            :adminId, :now, :now
          )`,
          {
            replacements: {
              id,
              projectId,
              connectionId,
              accountId: account.accountId,
              accountName: account.accountName,
              tongjiSiteId: site.siteId,
              tongjiSiteDomain: site.domain,
              adminId,
              now
            },
            transaction
          }
        );
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new MarketingBindingError(
          '该账户已绑定活动项目',
          'ACCOUNT_ALREADY_BOUND',
          409
        );
      }
      throw error;
    }
    return (await this.findBinding(projectId, id));
  }

  async findBinding(projectId, bindingId, transaction) {
    const rows = await this.sequelize.query(
      `SELECT *
       FROM baidu_project_bindings
       WHERE project_id = :projectId AND id = :bindingId
       LIMIT 1`,
      {
        replacements: { projectId, bindingId },
        type: QueryTypes.SELECT,
        transaction
      }
    );
    if (!rows[0]) {
      throw new MarketingBindingError(
        '绑定不存在',
        'BINDING_NOT_FOUND',
        404
      );
    }
    return publicBinding(rows[0]);
  }

  async pauseBinding({ projectId, bindingId, reason = 'ADMIN' }) {
    return this.sequelize.transaction(async (transaction) => {
      await this.requireActiveProject(projectId, transaction);
      const binding = await this.findBinding(projectId, bindingId, transaction);
      if (binding.status === 'PAUSED') return binding;
      const now = new Date().toISOString();
      await this.sequelize.query(
        `UPDATE baidu_project_bindings
         SET status = 'PAUSED',
             binding_version = binding_version + 1,
             paused_reason = :reason,
             updated_at = :now
         WHERE project_id = :projectId AND id = :bindingId`,
        {
          replacements: { projectId, bindingId, reason, now },
          transaction
        }
      );
      return this.findBinding(projectId, bindingId, transaction);
    });
  }

  async resumeBinding({ projectId, bindingId, tongjiSiteId = null }) {
    await this.requireActiveProject(projectId);
    const binding = await this.findBinding(projectId, bindingId);
    if (
      binding.tongjiSiteId
      && tongjiSiteId
      && binding.tongjiSiteId !== tongjiSiteId
    ) {
      throw new MarketingBindingError(
        '已绑定的百度统计站点不能在恢复时更换',
        'TONGJI_SITE_BINDING_IMMUTABLE',
        409
      );
    }
    const selectedSiteId = binding.tongjiSiteId || tongjiSiteId;
    if (!selectedSiteId) {
      throw new MarketingBindingError(
        '绑定缺少百度统计站点，请先选择站点',
        'TONGJI_SITE_BINDING_MISSING',
        409
      );
    }
    const context = await this.getAccountContext(
      binding.connectionId,
      binding.externalAccountId
    );
    const account = context.account;
    const validatedSite = await this.validateTongjiSite(
      context,
      selectedSiteId
    );
    const site = validatedSite.site;
    try {
      return await this.bindingMutationTransaction(async (transaction) => {
        await this.requireActiveProject(projectId, transaction);
        await this.assertValidationContextCurrent(
          binding.connectionId,
          validatedSite.validationContext,
          transaction
        );
        const current = await this.findBinding(
          projectId,
          bindingId,
          transaction
        );
        if (
          current.tongjiSiteId
          && current.tongjiSiteId !== selectedSiteId
        ) {
          throw new MarketingBindingError(
            '绑定的百度统计站点已变化，请刷新后重试',
            'TONGJI_SITE_BINDING_CHANGED',
            409
          );
        }
        if (current.status === 'ACTIVE') return current;
        const conflicts = await this.sequelize.query(
          `SELECT id
           FROM baidu_project_bindings
           WHERE connection_id = :connectionId
             AND external_account_id = :accountId
             AND status = 'ACTIVE'
             AND id <> :bindingId
           LIMIT 1`,
          {
            replacements: {
              connectionId: binding.connectionId,
              accountId: account.accountId,
              bindingId
            },
            type: QueryTypes.SELECT,
            transaction
          }
        );
        if (conflicts[0]) {
          throw new MarketingBindingError(
            '该账户已绑定活动项目',
            'ACCOUNT_ALREADY_BOUND',
            409
          );
        }
        const now = new Date().toISOString();
        await this.sequelize.query(
          `UPDATE baidu_project_bindings
           SET status = 'ACTIVE',
               external_account_name = :accountName,
               tongji_site_id = :tongjiSiteId,
               tongji_site_domain = :tongjiSiteDomain,
               binding_version = binding_version + 1,
               paused_reason = NULL,
               updated_at = :now
           WHERE project_id = :projectId AND id = :bindingId`,
          {
            replacements: {
              projectId,
              bindingId,
              accountName: account.accountName,
              tongjiSiteId: site.siteId,
              tongjiSiteDomain: site.domain,
              now
            },
            transaction
          }
        );
        return this.findBinding(projectId, bindingId, transaction);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new MarketingBindingError(
          '该账户已绑定活动项目',
          'ACCOUNT_ALREADY_BOUND',
          409
        );
      }
      throw error;
    }
  }

  async deleteBinding({ projectId, bindingId }) {
    return this.sequelize.transaction(async (transaction) => {
      await this.requireActiveProject(projectId, transaction);
      const binding = await this.findBinding(projectId, bindingId, transaction);
      await this.sequelize.query(
        `DELETE FROM baidu_project_bindings
         WHERE project_id = :projectId AND id = :bindingId`,
        {
          replacements: { projectId, bindingId },
          transaction
        }
      );
      return { ...binding, deleted: true };
    });
  }
}

module.exports = {
  BaiduBindingService,
  MarketingBindingError,
  normalizeSearchAccounts,
  normalizeTongjiSites
};
