const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const {
  createConsultationRecordRouter
} = require('../../modules/consultationRecords/routes/consultationRecordRoutes');
const {
  ConsultationRecordError
} = require('../../modules/consultationRecords/contracts/consultationRecordContract');

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

test('authorizes list access before reading records and preserves pagination query', async (t) => {
  const calls = [];
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 7, role: 'user' };
    next();
  });
  app.use('/api/consultations', createConsultationRecordRouter({
    accessService: {
      async assertAccess(value) { calls.push(['access', value]); }
    },
    recordService: {
      async list(value) {
        calls.push(['list', value]);
        return { items: [], pagination: { totalItems: 0 } };
      },
      async detail() {}
    },
    async assertAuditReady() {}
  }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}`
      + '/api/consultations/projects/11/records'
      + '?from=2026-08-01&to=2026-08-03&page=2&pageSize=20'
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(calls.map(([operation]) => operation), ['access', 'list']);
  assert.equal(calls[1][1].query.page, 2);
  assert.equal(calls[1][1].query.pageSize, 20);
});

test('checks project permission and audit readiness before reading a detail', async (t) => {
  const calls = [];
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 7, role: 'user' };
    next();
  });
  app.use('/api/consultations', createConsultationRecordRouter({
    accessService: {
      async assertAccess() { calls.push('access'); }
    },
    recordService: {
      async list() {},
      async detail() {
        calls.push('detail');
        return { detail: { id: 'website:record_redacted_001' } };
      }
    },
    async assertAuditReady() { calls.push('audit'); }
  }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}`
      + '/api/consultations/projects/11/records/website:record_redacted_001'
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['access', 'audit', 'detail']);
});

test('does not expose internal detail errors', async (t) => {
  const app = express();
  app.use('/api/consultations', createConsultationRecordRouter({
    accessService: { async assertAccess() {} },
    recordService: {
      async list() {},
      async detail() {
        const error = new Error('raw third-party body with secret');
        error.code = 'CONSULTATION_SOURCE_FAILED';
        error.status = 502;
        throw error;
      }
    },
    async assertAuditReady() {}
  }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}`
      + '/api/consultations/projects/11/records/website:redacted'
  );
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'CONSULTATION_RECORD_FAILED',
      message: '咨询记录读取失败'
    }
  });
});

test('never reflects an untrusted third-party 4xx message or code', async (t) => {
  const app = express();
  app.use('/api/consultations', createConsultationRecordRouter({
    accessService: { async assertAccess() {} },
    recordService: {
      async list() {
        const error = new Error('Authorization: Bearer secret-from-upstream');
        error.code = 'UPSTREAM_RATE_LIMIT';
        error.status = 429;
        throw error;
      },
      async detail() {}
    },
    async assertAuditReady() {}
  }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}`
      + '/api/consultations/projects/11/records'
      + '?from=2026-08-01&to=2026-08-03'
  );
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.deepEqual(body, {
    error: {
      code: 'CONSULTATION_RECORD_FAILED',
      message: '咨询记录读取失败'
    }
  });
  assert.doesNotMatch(JSON.stringify(body), /secret-from-upstream|UPSTREAM_RATE_LIMIT/u);
});

test('returns 404 before reading records for another or missing project', async (t) => {
  let listCalled = false;
  const app = express();
  app.use('/api/consultations', createConsultationRecordRouter({
    accessService: {
      async assertAccess() {
        throw new ConsultationRecordError('项目不存在', 'PROJECT_NOT_FOUND', 404);
      }
    },
    recordService: {
      async list() { listCalled = true; },
      async detail() {}
    },
    async assertAuditReady() {}
  }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}`
      + '/api/consultations/projects/12/records'
      + '?from=2026-08-01&to=2026-08-03'
  );
  assert.equal(response.status, 404);
  assert.equal(listCalled, false);
  assert.deepEqual(await response.json(), {
    error: { code: 'PROJECT_NOT_FOUND', message: '项目不存在' }
  });
});

test('fails closed before detail loading when the audit schema is unavailable', async (t) => {
  let detailCalled = false;
  const app = express();
  app.use('/api/consultations', createConsultationRecordRouter({
    accessService: { async assertAccess() {} },
    recordService: {
      async list() {},
      async detail() { detailCalled = true; }
    },
    async assertAuditReady() {
      throw new ConsultationRecordError(
        'internal schema name',
        'CONSULTATION_DETAIL_AUDIT_SCHEMA_MISSING',
        503
      );
    }
  }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}`
      + '/api/consultations/projects/11/records/website:redacted'
  );
  assert.equal(response.status, 503);
  assert.equal(detailCalled, false);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'CONSULTATION_DETAIL_AUDIT_SCHEMA_MISSING',
      message: '咨询详情审计暂时不可用'
    }
  });
});

test('returns a stable 422 response for invalid list filters', async (t) => {
  let listCalled = false;
  const app = express();
  app.use('/api/consultations', createConsultationRecordRouter({
    accessService: { async assertAccess() {} },
    recordService: {
      async list() { listCalled = true; },
      async detail() {}
    },
    async assertAuditReady() {}
  }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}`
      + '/api/consultations/projects/11/records'
      + '?from=2026-08-03&to=2026-08-01'
  );
  assert.equal(response.status, 422);
  assert.equal(listCalled, false);
  assert.equal((await response.json()).error.code, 'CONSULTATION_RECORD_DATE_RANGE_INVALID');
});
