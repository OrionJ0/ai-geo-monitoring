const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Sequelize } = require('sequelize');

const {
  loadWebsiteDataMigrations
} = require('../../modules/websiteFormConsultations/migrations');
const {
  createWebsiteDataMigrationRunner
} = require('../../modules/websiteFormConsultations/migrations/WebsiteDataMigrationRunner');

test('website data owns an independent migration ledger and aggregate table', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'website-data-'));
  const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(directory, 'test.sqlite'),
    logging: false
  });
  t.after(async () => {
    await sequelize.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await sequelize.query(`
    CREATE TABLE brand_projects (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL
    )
  `);

  assert.deepEqual(
    loadWebsiteDataMigrations().map((migration) => migration.version),
    [
      '001-form-consultation-snapshots',
      '002-versioned-form-consultation-snapshots',
      '003-snapshot-pruning-index'
    ]
  );
  const runner = createWebsiteDataMigrationRunner({ sequelize });
  assert.deepEqual(await runner.audit(), {
    ready: false,
    ledgerPresent: false,
    appliedVersions: [],
    pendingVersions: [
      '001-form-consultation-snapshots',
      '002-versioned-form-consultation-snapshots',
      '003-snapshot-pruning-index'
    ]
  });

  const result = await runner.apply();
  assert.equal(result.ready, true);
  const tables = await sequelize.getQueryInterface().showAllTables();
  assert.equal(tables.includes('website_data_schema_migrations'), true);
  assert.equal(tables.includes('website_form_consultation_snapshots'), true);
  assert.equal(tables.includes('website_form_consultation_snapshots_v2'), true);
  assert.equal(tables.includes('marketing_schema_migrations'), false);
  assert.equal(tables.some((name) => /^baidu_/u.test(String(name))), false);
});
