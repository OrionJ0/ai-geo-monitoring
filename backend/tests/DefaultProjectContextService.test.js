const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_PROJECT_SETTING_KEY,
  DefaultProjectContextError,
  DefaultProjectContextService
} = require('../services/DefaultProjectContextService');

function row(values) {
  return {
    ...values,
    toJSON() {
      return { ...values };
    }
  };
}

function createHarness({
  settingValue = '11',
  project = row({
    id: 11,
    user_id: 7,
    name: '广拓',
    website: 'https://www.gato.com.cn',
    status: 'active'
  }),
  settingReadError = null,
  projectReadError = null
} = {}) {
  const writes = [];
  const Setting = {
    async findOne({ where }) {
      assert.equal(where.key, DEFAULT_PROJECT_SETTING_KEY);
      if (settingReadError) throw settingReadError;
      return settingValue == null ? null : row({ key: where.key, value: settingValue });
    },
    async upsert(payload) {
      writes.push(payload);
      return [row(payload), true];
    }
  };
  const BrandProject = {
    async findByPk(id) {
      if (projectReadError) throw projectReadError;
      return project && String(project.id) === String(id) ? project : null;
    }
  };
  return {
    service: new DefaultProjectContextService({ Setting, BrandProject }),
    writes
  };
}

async function expectContextError(promise, { code, status }) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof DefaultProjectContextError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

test('authorized user resolves the explicit active default project without a fallback', async () => {
  const { service } = createHarness();

  const context = await service.getForUser({ id: 7, role: 'user' });

  assert.deepEqual(context, {
    project: {
      id: '11',
      name: '广拓',
      status: 'active',
      website: 'https://www.gato.com.cn',
      platforms: [],
      aliases: [],
      primary_keywords: []
    },
    source: 'SYSTEM_DEFAULT'
  });
});

test('administrator can configure an active project and identifiers remain strings', async () => {
  const { service, writes } = createHarness({ settingValue: null });

  const context = await service.setForUser({ id: 1, role: 'admin' }, '11');

  assert.equal(context.project.id, '11');
  assert.deepEqual(writes, [{
    key: DEFAULT_PROJECT_SETTING_KEY,
    value: '11'
  }]);
});

test('non-administrator cannot configure the default project', async () => {
  const { service, writes } = createHarness();

  await expectContextError(
    service.setForUser({ id: 7, role: 'user' }, '11'),
    { code: 'ADMIN_REQUIRED', status: 403 }
  );
  assert.deepEqual(writes, []);
});

test('administrator update distinguishes invalid, missing and archived targets', async () => {
  const invalid = createHarness();
  await expectContextError(
    invalid.service.setForUser({ id: 1, role: 'admin' }, 0),
    { code: 'DEFAULT_PROJECT_REQUEST_INVALID', status: 400 }
  );

  const missing = createHarness({ project: null });
  await expectContextError(
    missing.service.setForUser({ id: 1, role: 'admin' }, '11'),
    { code: 'PROJECT_NOT_FOUND', status: 404 }
  );

  const archived = createHarness({
    project: row({ id: 11, user_id: 7, name: '广拓', website: null, status: 'archived' })
  });
  await expectContextError(
    archived.service.setForUser({ id: 1, role: 'admin' }, '11'),
    { code: 'DEFAULT_PROJECT_ARCHIVED', status: 409 }
  );
});

test('missing default configuration has a stable error and never selects another project', async () => {
  const { service } = createHarness({ settingValue: null });

  await expectContextError(
    service.getForUser({ id: 7, role: 'user' }),
    { code: 'DEFAULT_PROJECT_NOT_CONFIGURED', status: 409 }
  );
});

test('archived default project is unavailable', async () => {
  const { service } = createHarness({
    project: row({ id: 11, user_id: 7, name: '广拓', website: null, status: 'archived' })
  });

  await expectContextError(
    service.getForUser({ id: 7, role: 'user' }),
    { code: 'DEFAULT_PROJECT_UNAVAILABLE', status: 409 }
  );
});

test('deleted default project is unavailable', async () => {
  const { service } = createHarness({ project: null });

  await expectContextError(
    service.getForUser({ id: 7, role: 'user' }),
    { code: 'DEFAULT_PROJECT_UNAVAILABLE', status: 409 }
  );
});

test('user without project access receives a stable forbidden state', async () => {
  const { service } = createHarness();

  await expectContextError(
    service.getForUser({ id: 99, role: 'user' }),
    { code: 'DEFAULT_PROJECT_FORBIDDEN', status: 403 }
  );
});

test('storage read failures are converted to a stable service error', async () => {
  const { service } = createHarness({ settingReadError: new Error('database secret') });

  await expectContextError(
    service.getForUser({ id: 7, role: 'user' }),
    { code: 'DEFAULT_PROJECT_READ_FAILED', status: 503 }
  );
});
