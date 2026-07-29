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

function publicBinding(row) {
  return {
    id: row.id,
    projectId: String(row.project_id),
    connectionId: row.connection_id,
    externalAccountId: row.external_account_id,
    externalAccountName: row.external_account_name,
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
    allowedProjectIds = '*'
  }) {
    this.sequelize = sequelize;
    this.accountDirectory = accountDirectory;
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
      `SELECT id, status, authorized_principal_id, auth_generation
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

  async validateAccount(connectionId, accountId) {
    if (typeof accountId !== 'string' || !accountId || accountId.length > 512) {
      throw new MarketingBindingError(
        '账户标识无效',
        'EXTERNAL_ACCOUNT_ID_INVALID',
        400
      );
    }
    const accounts = await this.listAccounts(connectionId);
    const account = accounts.find((item) => item.accountId === accountId);
    if (!account) {
      throw new MarketingBindingError(
        '账户不属于当前连接或没有搜索只读权限',
        'ACCOUNT_NOT_AVAILABLE',
        422
      );
    }
    return account;
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
    externalAccountId
  }) {
    await this.requireActiveProject(projectId);
    const account = await this.validateAccount(
      connectionId,
      externalAccountId
    );
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
            external_account_name, status, binding_version, paused_reason,
            created_by_user_id, created_at, updated_at
          ) VALUES (
            :id, :projectId, :connectionId, :accountId,
            :accountName, 'ACTIVE', 0, NULL,
            :adminId, :now, :now
          )`,
          {
            replacements: {
              id,
              projectId,
              connectionId,
              accountId: account.accountId,
              accountName: account.accountName,
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
    const account = await this.validateAccount(
      binding.connectionId,
      binding.externalAccountId
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
               binding_version = binding_version + 1,
               paused_reason = NULL,
               updated_at = :now
           WHERE project_id = :projectId AND id = :bindingId`,
          {
            replacements: {
              projectId,
              bindingId,
              accountName: account.accountName,
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
  normalizeSearchAccounts
};
