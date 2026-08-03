const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Sequelize } = require('sequelize');

const {
  createMarketingMigrationRunner
} = require('../../../modules/marketing/migrations/MarketingMigrationRunner');

async function createMarketingTestDatabase(prefix = 'marketing-domain-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(directory, 'test.sqlite'),
    logging: false
  });
  await sequelize.query(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      role TEXT NOT NULL,
      status TEXT NOT NULL
    )
  `);
  await sequelize.query(`
    CREATE TABLE brand_projects (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL
    )
  `);
  await sequelize.query(
    "INSERT INTO users (id, role, status) VALUES (1, 'admin', 'active'), (2, 'user', 'active')"
  );
  await sequelize.query(
    "INSERT INTO brand_projects (id, user_id, name, status) VALUES (11, 2, '甲项目', 'active'), (12, 2, '乙项目', 'active')"
  );
  await createMarketingMigrationRunner({ sequelize }).apply();

  async function close() {
    await sequelize.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }

  return { sequelize, close };
}

async function seedConnectionAndBinding(sequelize, {
  bindingId = 'binding-1',
  connectionId = 'connection-1',
  accountId = '0009007199254740993123',
  projectId = 11,
  tongjiSiteId = '301',
  tongjiSiteDomain = 'active.example.test'
} = {}) {
  await sequelize.query(
    `INSERT INTO baidu_marketing_connections (
      id, status, authorized_principal_id, authorized_principal_name,
      access_token_ciphertext, refresh_token_ciphertext,
      access_token_expires_at, auth_generation, token_version,
      refresh_claim_token, refresh_claim_until, created_by_user_id,
      last_error_code, created_at, updated_at
    ) VALUES (
      :connectionId, 'CONNECTED', :principalId, '主体',
      'v1:ciphertext', 'v1:refresh', NULL, 0, 1,
      NULL, NULL, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`,
    {
      replacements: {
        connectionId,
        principalId: `principal-${connectionId}`
      }
    }
  );
  await sequelize.query(
    `INSERT INTO baidu_project_bindings (
      id, project_id, connection_id, external_account_id,
      external_account_name, tongji_site_id, tongji_site_domain,
      status, binding_version, paused_reason,
      created_by_user_id, created_at, updated_at
    ) VALUES (
      :bindingId, :projectId, :connectionId, :accountId,
      :accountName, :tongjiSiteId, :tongjiSiteDomain,
      'ACTIVE', 0, NULL, 1,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`,
    {
      replacements: {
        bindingId,
        projectId,
        connectionId,
        accountId,
        accountName: `账户-${bindingId}`,
        tongjiSiteId,
        tongjiSiteDomain
      }
    }
  );
}

module.exports = {
  createMarketingTestDatabase,
  seedConnectionAndBinding
};
