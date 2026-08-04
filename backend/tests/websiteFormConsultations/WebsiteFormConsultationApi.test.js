const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const express = require('express');

const {
  createWebsiteFormConsultationRouter
} = require('../../modules/websiteFormConsultations/routes/websiteFormConsultationRoutes');
const {
  GatoWebsiteError
} = require('../../modules/websiteFormConsultations/adapters/GatoWebsiteClient');

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

test('website-form API is independent and authorizes before reading aggregates', async (t) => {
  const calls = [];
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 7, role: 'user' };
    next();
  });
  app.use('/api/website-data', createWebsiteFormConsultationRouter({
    accessService: {
      async assertAccess(input) {
        calls.push(['access', input]);
      }
    },
    consultationService: {
      async readDaily() {},
      async read(input) {
        calls.push(['read', input]);
        return {
          sourceSystem: 'GATO_WEBSITE',
          consultationType: 'WEBSITE_FORM',
          summary: { formConsultationRecords: '3' }
        };
      }
    }
  }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}`
      + '/api/website-data/projects/11/form-consultations'
      + '?from=2026-07-01&to=2026-07-31'
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM',
    summary: { formConsultationRecords: '3' }
  });
  assert.equal(response.headers.get('cache-control'), 'private, max-age=60');
  assert.deepEqual(calls, [
    ['access', {
      projectId: '11',
      user: { id: 7, role: 'user' }
    }],
    ['read', {
      projectId: '11',
      from: '2026-07-01',
      to: '2026-07-31'
    }]
  ]);
});

test('website-form API exposes stable errors without upstream details', async (t) => {
  const app = express();
  app.use('/api/website-data', createWebsiteFormConsultationRouter({
    accessService: { async assertAccess() {} },
    consultationService: {
      async readDaily() {},
      async read() {
        throw new GatoWebsiteError(
          'upstream included a secret',
          'GATO_WEBSITE_FORM_UPSTREAM_UNAVAILABLE',
          502
        );
      }
    }
  }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}`
      + '/api/website-data/projects/11/form-consultations'
      + '?from=2026-07-01&to=2026-07-31'
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'GATO_WEBSITE_FORM_UPSTREAM_UNAVAILABLE',
      message: '官网表单咨询暂时不可用'
    }
  });
});

test('website-form API does not reflect untrusted 4xx errors', async (t) => {
  const app = express();
  app.use('/api/website-data', createWebsiteFormConsultationRouter({
    accessService: { async assertAccess() {} },
    consultationService: {
      async readDaily() {},
      async read() {
        const error = new Error('Authorization: Bearer upstream-secret');
        error.code = 'UPSTREAM_PRIVATE_CODE';
        error.status = 429;
        throw error;
      }
    }
  }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}`
      + '/api/website-data/projects/11/form-consultations'
      + '?from=2026-07-01&to=2026-07-31'
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'WEBSITE_FORM_CONSULTATION_FAILED',
      message: '官网表单咨询暂时不可用'
    }
  });
});

test('website-form daily API stays in the website namespace and authorizes first', async (t) => {
  const calls = [];
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 7, role: 'user' };
    next();
  });
  app.use('/api/website-data', createWebsiteFormConsultationRouter({
    accessService: {
      async assertAccess(input) { calls.push(['access', input]); }
    },
    consultationService: {
      async read() { assert.fail('daily route must not use range summary'); },
      async readDaily(input) {
        calls.push(['readDaily', input]);
        return {
          sourceSystem: 'GATO_WEBSITE',
          consultationType: 'WEBSITE_FORM',
          days: [{
            date: '2026-08-01',
            formConsultationRecords: '1'
          }]
        };
      }
    }
  }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}`
      + '/api/website-data/projects/11/form-consultation-days'
      + '?from=2026-08-01&to=2026-08-01'
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).days[0].date, '2026-08-01');
  assert.deepEqual(calls.map(([operation]) => operation), [
    'access',
    'readDaily'
  ]);
});
