const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { QueryTypes, Sequelize } = require('sequelize');

const {
  createMarketingMigrationRunner
} = require('../../modules/marketing/migrations/MarketingMigrationRunner');
const {
  createBaiduBindingRouter
} = require('../../modules/marketing/routes/baiduBindingRoutes');
const {
  BaiduBindingService
} = require('../../modules/marketing/services/BaiduBindingService');
const {
  createMarketingTestDatabase
} = require('./helpers/createMarketingTestDatabase');

let directory;
let sequelize;
let server;
let baseUrl;
let directoryCalls = 0;

test('PostgreSQL binding deletion locks the project before invalidating revisions', async () => {
  const statements = [];
  const transaction = { id: 'delete-binding-transaction' };
  const service = new BaiduBindingService({
    sequelize: {
      getDialect: () => 'postgres',
      transaction: (task) => task(transaction),
      async query(sql, options) {
        statements.push({ sql: String(sql), options });
        if (String(sql).includes('FROM brand_projects')) {
          return [{ id: 11, status: 'active' }];
        }
        if (String(sql).includes('FROM baidu_project_bindings')) {
          return [{
            id: 'binding-1',
            project_id: 11,
            connection_id: 'connection-1',
            external_account_id: 'account-1',
            external_account_name: '账户一',
            tongji_site_id: 'site-1',
            tongji_site_domain: 'example.test',
            status: 'ACTIVE',
            binding_version: 0,
            paused_reason: null
          }];
        }
        return [];
      }
    },
    accountDirectory: {},
    siteDirectory: {}
  });

  const deleted = await service.deleteBinding({
    projectId: 11,
    bindingId: 'binding-1'
  });
  assert.equal(deleted.deleted, true);
  assert.match(statements[0].sql, /FROM brand_projects[\s\S]*FOR UPDATE/u);
  assert.match(statements[1].sql, /FROM baidu_project_bindings/u);
  assert.match(statements[2].sql, /UPDATE baidu_marketing_refresh_runs/u);
  assert.match(statements[3].sql, /DELETE FROM baidu_project_bindings/u);
  assert.equal(statements.every(({ options }) => (
    options.transaction === transaction
  )), true);
});

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

test('a paused pre-site binding can be completed and resumed without deletion', async () => {
  const rows = await sequelize.query(
    `SELECT id FROM baidu_project_bindings
     WHERE project_id = 11
     LIMIT 1`,
    { type: QueryTypes.SELECT }
  );
  const bindingId = rows[0].id;
  await sequelize.query(
    `UPDATE baidu_project_bindings
     SET status = 'PAUSED',
         paused_reason = 'REAUTH',
         tongji_site_id = NULL,
         tongji_site_domain = NULL
     WHERE id = :bindingId`,
    { replacements: { bindingId } }
  );

  const response = await fetch(
    `${baseUrl}/api/marketing/projects/11/baidu-bindings/${bindingId}/resume`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tongjiSiteId: '23412673' })
    }
  );
  const binding = await response.json();
  assert.equal(response.status, 200, JSON.stringify(binding));
  assert.equal(binding.id, bindingId);
  assert.equal(binding.status, 'ACTIVE');
  assert.equal(binding.tongjiSiteId, '23412673');
  assert.equal(binding.tongjiSiteDomain, 'gato.com.cn');

  const mutation = await fetch(
    `${baseUrl}/api/marketing/projects/11/baidu-bindings/${bindingId}/resume`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tongjiSiteId: '99999999' })
    }
  );
  assert.equal(mutation.status, 409);
  assert.equal(
    (await mutation.json()).error.code,
    'TONGJI_SITE_BINDING_IMMUTABLE'
  );
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

test('binding creation rejects a Tongji context changed after directory validation', async (t) => {
  const database = await createMarketingTestDatabase('binding-context-fence-');
  t.after(database.close);
  const oldVerifiedAt = '2026-08-05T12:00:00.000Z';
  await database.sequelize.query(
    `INSERT INTO baidu_marketing_connections (
      id, status, authorized_principal_id,
      access_token_ciphertext, refresh_token_ciphertext,
      access_token_expires_at, auth_generation, token_version,
      refresh_claim_token, refresh_claim_until, created_by_user_id,
      tongji_user_name, tongji_user_name_verified_at,
      marketing_access_state, marketing_observed_auth_generation,
      marketing_observed_token_version, marketing_checked_at,
      tongji_access_state, tongji_observed_auth_generation,
      tongji_observed_token_version, tongji_checked_at,
      created_at, updated_at
    ) VALUES (
      'fenced-connection', 'CONNECTED', 'fenced-principal',
      'fixture-access', 'fixture-refresh',
      '2026-08-06T00:00:00.000Z', 2, 6,
      NULL, NULL, 1,
      'old-user', :oldVerifiedAt,
      'VERIFIED', 2, 6, :oldVerifiedAt,
      'VERIFIED', 2, 6, :oldVerifiedAt,
      :oldVerifiedAt, :oldVerifiedAt
    )`,
    { replacements: { oldVerifiedAt } }
  );
  const service = new BaiduBindingService({
    sequelize: database.sequelize,
    accountDirectory: {
      async listAccounts() {
        return {
          accounts: [{
            accountId: 'fenced-account',
            accountName: '旧上下文账户',
            product: 'SEARCH',
            readOnly: true
          }],
          validationContext: {
            authGeneration: 2,
            tokenVersion: 6,
            marketingVerified: true
          }
        };
      }
    },
    siteDirectory: {
      async listSites() {
        await database.sequelize.query(
          `UPDATE baidu_marketing_connections
           SET tongji_user_name = 'new-user',
               tongji_user_name_verified_at = '2026-08-05T12:01:00.000Z'
           WHERE id = 'fenced-connection'`
        );
        return {
          sites: [{
            siteId: '301',
            domain: 'old.example.test',
            status: 'ACTIVE'
          }],
          validationContext: {
            authGeneration: 2,
            tokenVersion: 6,
            tongjiUserName: 'old-user',
            tongjiUserNameVerifiedAt: oldVerifiedAt,
            tongjiVerified: true
          }
        };
      }
    }
  });

  await assert.rejects(
    service.createBinding({
      projectId: 11,
      adminId: 1,
      connectionId: 'fenced-connection',
      externalAccountId: 'fenced-account',
      tongjiSiteId: '301'
    }),
    { code: 'BINDING_VALIDATION_CONTEXT_CHANGED', status: 409 }
  );
  const [bindings] = await database.sequelize.query(
    `SELECT id FROM baidu_project_bindings
     WHERE connection_id = 'fenced-connection'`
  );
  assert.deepEqual(bindings, []);

  await database.sequelize.query(
    `UPDATE baidu_marketing_connections
     SET tongji_user_name = 'old-user',
         tongji_user_name_verified_at = :oldVerifiedAt
     WHERE id = 'fenced-connection'`,
    { replacements: { oldVerifiedAt } }
  );
  await database.sequelize.query(
    `INSERT INTO baidu_project_bindings (
      id, project_id, connection_id, external_account_id,
      external_account_name, tongji_site_id, tongji_site_domain,
      status, binding_version, paused_reason,
      created_by_user_id, created_at, updated_at
    ) VALUES (
      'fenced-binding', 11, 'fenced-connection', 'fenced-account',
      '旧上下文账户', '301', 'old.example.test',
      'PAUSED', 1, 'ADMIN', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`
  );
  await assert.rejects(
    service.resumeBinding({
      projectId: 11,
      bindingId: 'fenced-binding'
    }),
    { code: 'BINDING_VALIDATION_CONTEXT_CHANGED', status: 409 }
  );
  const [paused] = await database.sequelize.query(
    `SELECT status, binding_version
     FROM baidu_project_bindings
     WHERE id = 'fenced-binding'`
  );
  assert.deepEqual(paused[0], { status: 'PAUSED', binding_version: 1 });
});

test('SQLite binding transaction serializes a context change after its final check', async (t) => {
  const database = await createMarketingTestDatabase('binding-sqlite-fence-');
  t.after(database.close);
  await database.sequelize.query(
    `INSERT INTO baidu_marketing_connections (
      id, status, authorized_principal_id,
      access_token_ciphertext, refresh_token_ciphertext,
      access_token_expires_at, auth_generation, token_version,
      refresh_claim_token, refresh_claim_until, created_by_user_id,
      created_at, updated_at
    ) VALUES (
      'sqlite-fence', 'CONNECTED', 'sqlite-principal',
      'fixture-access', 'fixture-refresh', NULL, 0, 1,
      NULL, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`
  );
  const service = new BaiduBindingService({
    sequelize: database.sequelize,
    accountDirectory: {
      async listAccounts() {
        return [{
          accountId: 'sqlite-account',
          accountName: 'SQLite 账户',
          product: 'SEARCH',
          readOnly: true
        }];
      }
    },
    siteDirectory: {
      async listSites() {
        return [{
          siteId: '302',
          domain: 'sqlite.example.test',
          status: 'ACTIVE'
        }];
      }
    }
  });
  const originalAssert = service.assertValidationContextCurrent.bind(service);
  let markChecked;
  let releaseCheck;
  const checked = new Promise((resolve) => {
    markChecked = resolve;
  });
  const checkBlocked = new Promise((resolve) => {
    releaseCheck = resolve;
  });
  service.assertValidationContextCurrent = async (...args) => {
    const result = await originalAssert(...args);
    markChecked();
    await checkBlocked;
    return result;
  };

  const createPromise = service.createBinding({
    projectId: 11,
    adminId: 1,
    connectionId: 'sqlite-fence',
    externalAccountId: 'sqlite-account',
    tongjiSiteId: '302'
  });
  await checked;
  let markMutationStarted;
  const mutationStarted = new Promise((resolve) => {
    markMutationStarted = resolve;
  });
  const contextMutation = database.sequelize.transaction(async (transaction) => {
    markMutationStarted();
    await database.sequelize.query(
      `UPDATE baidu_marketing_connections
       SET auth_generation = auth_generation + 1,
           token_version = token_version + 1
       WHERE id = 'sqlite-fence'`,
      { transaction }
    );
    await database.sequelize.query(
      `UPDATE baidu_project_bindings
       SET status = 'PAUSED',
           binding_version = binding_version + 1,
           paused_reason = 'REAUTH'
       WHERE connection_id = 'sqlite-fence'
         AND status = 'ACTIVE'`,
      { transaction }
    );
  });
  await mutationStarted;
  await new Promise((resolve) => setTimeout(resolve, 50));
  releaseCheck();
  await createPromise;
  await contextMutation;
  const [rows] = await database.sequelize.query(
    `SELECT status, paused_reason
     FROM baidu_project_bindings
     WHERE connection_id = 'sqlite-fence'`
  );
  assert.deepEqual(rows[0], { status: 'PAUSED', paused_reason: 'REAUTH' });
});
