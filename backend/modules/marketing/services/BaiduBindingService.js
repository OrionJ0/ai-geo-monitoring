const crypto = require('node:crypto');
const { QueryTypes } = require('sequelize');
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
              auth_generation
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
    return normalizeSearchAccounts(
      await this.accountDirectory.listAccounts({ connection })
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
    const accounts = normalizeSearchAccounts(
      await this.accountDirectory.listAccounts({ connection })
    );
    const account = accounts.find((item) => item.accountId === accountId);
    if (!account) {
      throw new MarketingBindingError(
        '账户不属于当前连接或没有搜索只读权限',
        'ACCOUNT_NOT_AVAILABLE',
        422
      );
    }
    return { connection, account };
  }

  async listTongjiSites(connectionId, accountId) {
    const context = await this.getAccountContext(connectionId, accountId);
    return normalizeTongjiSites(
      await this.siteDirectory.listSites(context)
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
    const sites = normalizeTongjiSites(
      await this.siteDirectory.listSites(context)
    );
    const site = sites.find((item) => item.siteId === siteId);
    if (!site) {
      throw new MarketingBindingError(
        '百度统计站点不属于所选账户或当前不可用',
        'TONGJI_SITE_NOT_AVAILABLE',
        422
      );
    }
    return site;
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
    const site = await this.validateTongjiSite(context, tongjiSiteId);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    try {
      await this.sequelize.transaction(async (transaction) => {
        await this.requireActiveProject(projectId, transaction);
        await this.getConnectedConnection(connectionId, transaction);
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

  async resumeBinding({ projectId, bindingId }) {
    await this.requireActiveProject(projectId);
    const binding = await this.findBinding(projectId, bindingId);
    if (!binding.tongjiSiteId) {
      throw new MarketingBindingError(
        '绑定缺少百度统计站点，请重新创建绑定',
        'TONGJI_SITE_BINDING_MISSING',
        409
      );
    }
    const context = await this.getAccountContext(
      binding.connectionId,
      binding.externalAccountId
    );
    const account = context.account;
    const site = await this.validateTongjiSite(
      context,
      binding.tongjiSiteId
    );
    try {
      return await this.sequelize.transaction(async (transaction) => {
        await this.requireActiveProject(projectId, transaction);
        await this.getConnectedConnection(binding.connectionId, transaction);
        const current = await this.findBinding(
          projectId,
          bindingId,
          transaction
        );
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
