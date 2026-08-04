const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createWebsiteFormConsultationModule
} = require('../../modules/websiteFormConsultations');

const READY_ENV = Object.freeze({
  GATO_WEBSITE_FORM_ENABLED: 'true',
  GATO_WEBSITE_FORM_BASE_URL: 'https://gato.com.cn',
  GATO_WEBSITE_FORM_PROJECT_ID: '11',
  GATO_WEBSITE_FORM_USERNAME: 'website-reader',
  GATO_WEBSITE_FORM_PASSWORD: 'secret-from-env',
  GATO_WEBSITE_FORM_HTTP_TIMEOUT_MS: '10000',
  GATO_WEBSITE_FORM_CACHE_TTL_MS: '600000'
});

test('website-form module has an independent fail-closed lifecycle', async () => {
  const disabled = createWebsiteFormConsultationModule({ env: {} });
  assert.deepEqual(await disabled.getStatus(), {
    moduleState: 'DISABLED',
    errorCode: null,
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM'
  });

  const ready = createWebsiteFormConsultationModule({
    env: READY_ENV,
    sequelize: { query() {} },
    migrationAuditor: {
      async audit() {
        return { ready: true };
      }
    },
    sourceClient: { async readContactRecords() { return []; } },
    snapshotRepository: { async read() {}, async save() {} }
  });
  assert.deepEqual(await ready.getStatus(), {
    moduleState: 'READY',
    errorCode: null,
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM'
  });
});

test('website-form module reports its own schema state, not marketing state', async () => {
  const module = createWebsiteFormConsultationModule({
    env: READY_ENV,
    sequelize: { query() {} },
    migrationAuditor: {
      async audit() {
        return { ready: false };
      }
    },
    sourceClient: { async readContactRecords() { return []; } },
    snapshotRepository: { async read() {}, async save() {} }
  });

  assert.deepEqual(await module.getStatus(), {
    moduleState: 'SCHEMA_MISSING',
    errorCode: 'WEBSITE_DATA_SCHEMA_MISSING',
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM'
  });
});
