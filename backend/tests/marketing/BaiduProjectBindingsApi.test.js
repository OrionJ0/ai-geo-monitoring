const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Sequelize } = require('sequelize');

const {
  createMarketingMigrationRunner
} = require('../../modules/marketing/migrations/MarketingMigrationRunner');
const {
  createBaiduBindingRouter
} = require('../../modules/marketing/routes/baiduBindingRoutes');
const {
  BaiduBindingService
} = require('../../modules/marketing/services/BaiduBindingService');

let directory;
let sequelize;
let server;
let baseUrl;
let directoryCalls = 0;

test.before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'baidu-binding-api-'));
  sequelize = new Sequelize({
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
    "INSERT INTO brand_projects (id, user_id, name, status) VALUES (11, 2, '甲项目', 'active'), (12, 2, '乙项目', 'active'), (13, 2, '归档项目', 'archived')"
  );
  await createMarketingMigrationRunner({ sequelize }).apply();
  await sequelize.query(
    `INSERT INTO baidu_marketing_connections (
      id, status, authorized_principal_id, authorized_principal_name,
      access_token_ciphertext, refresh_token_ciphertext,
      access_token_expires_at, auth_generation, token_version,
      refresh_claim_token, refresh_claim_until, created_by_user_id,
      last_error_code, created_at, updated_at
    ) VALUES (
      'connection-1', 'CONNECTED', 'principal-1', '主体',
      'v1:ciphertext', NULL, NULL, 0, 1, NULL, NULL, 1,
      NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`
  );

  const service = new BaiduBindingService({
    sequelize,
    accountDirectory: {
      async listAccounts() {
        directoryCalls += 1;
        return [
          {
            accountId: '0009007199254740993123',
            accountName: '搜索账户甲',
            product: 'SEARCH',
            readOnly: true
          },
          {
            accountId: 'feed-account',
            accountName: '不应出现',
            product: 'UNSUPPORTED_PRODUCT',
            readOnly: true
          }
        ];
      }
    },
    siteDirectory: {
      async listSites() {
        return [
          { siteId: '23412673', domain: 'gato.com.cn', status: 'ACTIVE' },
          { siteId: '3519765', domain: 'paused.example', status: 'PAUSED' }
        ];
      }
    }
  });
  const app = express();
  app.use(express.json());
  app.use(
    '/api/marketing',
    createBaiduBindingRouter({
      service,
      adminRequired(req, _res, next) {
        req.user = { id: 1, role: 'admin' };
        next();
      }
    })
  );
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await sequelize.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('admin binds an exact opaque SEARCH account and can pause/resume it', async () => {
  const directoryResponse = await fetch(
    `${baseUrl}/api/marketing/admin/baidu/connections/connection-1/accounts`
  );
  assert.equal(directoryResponse.status, 200);
  assert.deepEqual(await directoryResponse.json(), [{
    accountId: '0009007199254740993123',
    accountName: '搜索账户甲'
  }]);

  const siteDirectoryResponse = await fetch(
    `${baseUrl}/api/marketing/admin/baidu/connections/connection-1/accounts/0009007199254740993123/tongji-sites`
  );
  assert.equal(siteDirectoryResponse.status, 200);
  assert.deepEqual(await siteDirectoryResponse.json(), [{
    siteId: '23412673',
    domain: 'gato.com.cn',
    status: 'ACTIVE'
  }]);

  const create = await fetch(
    `${baseUrl}/api/marketing/projects/11/baidu-bindings`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId: 'connection-1',
        externalAccountId: '0009007199254740993123',
        tongjiSiteId: '23412673'
      })
    }
  );
  assert.equal(create.status, 201);
  const binding = await create.json();
  assert.equal(binding.externalAccountId, '0009007199254740993123');
  assert.equal(binding.status, 'ACTIVE');
  assert.equal(binding.tongjiSiteId, '23412673');
  assert.equal(binding.tongjiSiteDomain, 'gato.com.cn');

  const duplicateProject = await fetch(
    `${baseUrl}/api/marketing/projects/12/baidu-bindings`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId: 'connection-1',
        externalAccountId: '0009007199254740993123',
        tongjiSiteId: '23412673'
      })
    }
  );
  assert.equal(duplicateProject.status, 409);
  await assert.rejects(
    sequelize.query(
      `INSERT INTO baidu_project_bindings (
        id, project_id, connection_id, external_account_id,
        external_account_name, status, binding_version, paused_reason,
        created_by_user_id, created_at, updated_at
      ) VALUES (
        'database-conflict', 12, 'connection-1',
        '0009007199254740993123', '数据库冲突',
        'ACTIVE', 0, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )`
    ),
    /unique|constraint/iu
  );

  const pause = await fetch(
    `${baseUrl}/api/marketing/projects/11/baidu-bindings/${binding.id}/pause`,
    { method: 'POST' }
  );
  assert.equal(pause.status, 200);
  assert.equal((await pause.json()).status, 'PAUSED');

  const resume = await fetch(
    `${baseUrl}/api/marketing/projects/11/baidu-bindings/${binding.id}/resume`,
    { method: 'POST' }
  );
  assert.equal(resume.status, 200);
  const resumed = await resume.json();
  assert.equal(resumed.status, 'ACTIVE');
  assert.equal(resumed.bindingVersion, 2);
  assert.ok(directoryCalls >= 3, '账户目录必须在创建和恢复时重新校验');
});

test('binding rejects forged accounts, unknown fields, and archived projects', async () => {
  const forged = await fetch(
    `${baseUrl}/api/marketing/projects/11/baidu-bindings`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId: 'connection-1',
        externalAccountId: 'forged',
        tongjiSiteId: '23412673'
      })
    }
  );
  assert.equal(forged.status, 422);

  const forgedSite = await fetch(
    `${baseUrl}/api/marketing/projects/12/baidu-bindings`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId: 'connection-1',
        externalAccountId: '0009007199254740993123',
        tongjiSiteId: '99999999'
      })
    }
  );
  assert.equal(forgedSite.status, 422);

  const extraScope = await fetch(
    `${baseUrl}/api/marketing/projects/11/baidu-bindings`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId: 'connection-1',
        externalAccountId: '0009007199254740993123',
        tongjiSiteId: '23412673',
        scopeType: 'campaign'
      })
    }
  );
  assert.equal(extraScope.status, 400);

  const archived = await fetch(
    `${baseUrl}/api/marketing/projects/13/baidu-bindings`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId: 'connection-1',
        externalAccountId: '0009007199254740993123',
        tongjiSiteId: '23412673'
      })
    }
  );
  assert.equal(archived.status, 409);
});

test('project allowlist rejects binding before any provider directory call', async () => {
  let providerCalls = 0;
  const service = new BaiduBindingService({
    sequelize,
    allowedProjectIds: '11',
    accountDirectory: {
      async listAccounts() {
        providerCalls += 1;
        return [];
      }
    },
    siteDirectory: {
      async listSites() {
        return [];
      }
    }
  });

  await assert.rejects(
    service.createBinding({
      projectId: 12,
      adminId: 1,
      connectionId: 'connection-1',
      externalAccountId: '0009007199254740993123',
      tongjiSiteId: '23412673'
    }),
    { code: 'MARKETING_PROJECT_NOT_ALLOWED', status: 403 }
  );
  assert.equal(providerCalls, 0);
});
