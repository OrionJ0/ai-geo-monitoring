const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_STORAGE = ':memory:';

const { sequelize, Setting } = require('../models');
const {
  SeoAuditSettingsService
} = require('../services/SeoAuditSettingsService');

test.before(async () => {
  await sequelize.sync({ force: true });
});

test.after(async () => {
  await sequelize.close();
});

function createSettingModel(initialValue = null) {
  let row = initialValue === null
    ? null
    : {
        value: initialValue,
        async update(patch) {
          this.value = patch.value;
          return this;
        }
      };

  return {
    async findOne({ where }) {
      return where.key === 'seo_audit_owned_origins' ? row : null;
    },
    async create({ value }) {
      row = {
        value,
        async update(patch) {
          this.value = patch.value;
          return this;
        }
      };
      return row;
    },
    value() {
      return row?.value ?? null;
    }
  };
}

test('stores owned sites as normalized exact HTTP origins', async () => {
  const model = createSettingModel();
  const service = new SeoAuditSettingsService({ model });

  const saved = await service.setOwnedOrigins([
    'gato.com.cn',
    'https://GATO.com.cn/',
    'http://insight.guangtuo.com:8080/'
  ]);

  assert.deepEqual(saved.ownedOrigins, [
    'https://gato.com.cn',
    'http://insight.guangtuo.com:8080'
  ]);
  assert.equal(
    model.value(),
    '["https://gato.com.cn","http://insight.guangtuo.com:8080"]'
  );
});

test('uses gato.com.cn as the default owned site while keeping explicit empty settings', async () => {
  const missing = new SeoAuditSettingsService({ model: createSettingModel() });
  const explicitlyEmpty = new SeoAuditSettingsService({ model: createSettingModel('[]') });
  const corrupt = new SeoAuditSettingsService({ model: createSettingModel('{bad-json') });

  assert.deepEqual(await missing.getSettings(), {
    ownedOrigins: ['https://gato.com.cn']
  });
  assert.deepEqual(await explicitlyEmpty.getSettings(), { ownedOrigins: [] });
  assert.deepEqual(await corrupt.getSettings(), { ownedOrigins: [] });
});

test('rejects paths, credentials, wildcards and oversized owned-site settings', async () => {
  const service = new SeoAuditSettingsService({ model: createSettingModel() });

  for (const value of [
    'https://example.com/path',
    'https://user:secret@example.com',
    'https://*.example.com'
  ]) {
    await assert.rejects(
      () => service.setOwnedOrigins([value]),
      { code: 'INVALID_SEO_AUDIT_OWNED_ORIGIN', status: 400 }
    );
  }

  await assert.rejects(
    () => service.setOwnedOrigins(
      Array.from({ length: 11 }, (_, index) => `https://site-${index}.example.com`)
    ),
    { code: 'TOO_MANY_SEO_AUDIT_OWNED_ORIGINS', status: 400 }
  );
});

test('matches only the exact configured scheme, host and port', async () => {
  const service = new SeoAuditSettingsService({
    model: createSettingModel('["https://gato.com.cn","http://localhost:3000"]')
  });

  assert.equal(await service.isOwnedOrigin('https://gato.com.cn/about'), true);
  assert.equal(await service.isOwnedOrigin('http://gato.com.cn/'), false);
  assert.equal(await service.isOwnedOrigin('https://www.gato.com.cn/'), false);
  assert.equal(await service.isOwnedOrigin('http://localhost:3001/'), false);
});

test('persists owned origins through the real settings table contract', async () => {
  const service = new SeoAuditSettingsService({ model: Setting });

  await service.setOwnedOrigins(['https://insight.guangtuo.com']);

  assert.deepEqual(await service.getSettings(), {
    ownedOrigins: ['https://insight.guangtuo.com']
  });
  const row = await Setting.findOne({ where: { key: 'seo_audit_owned_origins' } });
  assert.equal(row.value, '["https://insight.guangtuo.com"]');
});
