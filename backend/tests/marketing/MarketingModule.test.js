const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createMarketingModule
} = require('../../modules/marketing');

function enabledConfig(overrides = {}) {
  return {
    NODE_ENV: 'production',
    MARKETING_MONITORING_ENABLED: 'true',
    MARKETING_MONITORING_ALLOWED_PROJECT_IDS: 'project-1',
    BAIDU_MARKETING_CLIENT_ID: 'client-id-canary',
    BAIDU_MARKETING_CLIENT_SECRET: 'module-secret-canary',
    BAIDU_MARKETING_REDIRECT_URI: 'https://marketing.example.test/api/admin/marketing/baidu/oauth/callback',
    BAIDU_MARKETING_CONTRACT_VERSION: 'baidu-search-test-v1',
    BAIDU_MARKETING_HTTP_TIMEOUT_MS: '10000',
    ...overrides
  };
}

async function callStatusRoute(module, role) {
  const layer = module.router.stack.find((item) => (
    item.route?.path === '/status' && item.route.methods?.get
  ));
  assert.ok(layer, 'GET /status route should exist');

  const req = { user: { id: 1, role } };
  const response = {
    statusCode: 200,
    payload: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
  await layer.route.stack[0].handle(req, response);
  return response;
}

test('disabled module never audits marketing schema', async () => {
  let auditCalls = 0;
  const module = createMarketingModule({
    env: {},
    migrationAuditor: {
      async audit() {
        auditCalls += 1;
        throw new Error('disabled module must not inspect marketing schema');
      }
    }
  });

  assert.deepEqual(await module.getStatus(), {
    moduleState: 'DISABLED',
    errorCode: null
  });
  assert.equal(auditCalls, 0);
});

test('status route reveals missing config key names only to administrators', async () => {
  const module = createMarketingModule({
    env: {
      MARKETING_MONITORING_ENABLED: 'true',
      BAIDU_MARKETING_CLIENT_SECRET: 'module-secret-canary'
    }
  });

  const userResponse = await callStatusRoute(module, 'user');
  const adminResponse = await callStatusRoute(module, 'admin');

  assert.equal(userResponse.statusCode, 200);
  assert.deepEqual(userResponse.payload, {
    moduleState: 'MISCONFIGURED',
    errorCode: 'MARKETING_CONFIG_INCOMPLETE'
  });
  assert.ok(adminResponse.payload.missingKeys.length > 0);
  assert.doesNotMatch(JSON.stringify(userResponse.payload), /module-secret-canary/);
  assert.doesNotMatch(JSON.stringify(adminResponse.payload), /module-secret-canary/);
  assert.equal(userResponse.headers['cache-control'], 'private, no-store');
});

test('enabled module distinguishes missing schema from a ready migration ledger', async () => {
  const missing = createMarketingModule({
    env: enabledConfig(),
    migrationAuditor: {
      async audit() {
        return { ready: false };
      }
    }
  });
  const ready = createMarketingModule({
    env: enabledConfig(),
    migrationAuditor: {
      async audit() {
        return { ready: true };
      }
    }
  });

  assert.deepEqual(await missing.getStatus(), {
    moduleState: 'SCHEMA_MISSING',
    errorCode: 'MARKETING_SCHEMA_MISSING'
  });
  assert.deepEqual(await ready.getStatus(), {
    moduleState: 'READY',
    errorCode: null
  });
});

test('the application mounts marketing through its facade without changing global readiness inputs', () => {
  const appSource = fs.readFileSync(
    path.resolve(__dirname, '../../app.js'),
    'utf8'
  );

  assert.match(appSource, /createMarketingModule/);
  assert.match(
    appSource,
    /app\.use\('\/api\/marketing',\s*authRequired,\s*marketingModule\.router\)/
  );
  assert.match(
    appSource,
    /const ready = database\.status === 'ready' && scheduler\.started === true/
  );
  assert.doesNotMatch(
    appSource,
    /const ready = [^\n]*marketing/
  );
});
