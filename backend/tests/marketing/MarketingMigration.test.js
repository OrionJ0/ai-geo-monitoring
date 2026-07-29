const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Sequelize } = require('sequelize');

const {
  createMarketingMigrationRunner
} = require('../../modules/marketing/migrations/MarketingMigrationRunner');
const {
  loadMarketingMigrations
} = require('../../modules/marketing/migrations');

function createDatabase(storage) {
  return new Sequelize({
    dialect: 'sqlite',
    storage,
    logging: false,
    pool: {
      max: 5,
      min: 0,
      idle: 1000
    }
  });
}

test('root sequelize sync never registers or creates marketing domain tables', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-root-sync-'));
  const databasePath = path.join(directory, 'root.sqlite');
  const script = `
    process.env.DB_STORAGE = ${JSON.stringify(databasePath)};
    process.env.DB_LOGGING = 'false';
    delete process.env.DATABASE_URL;
    const { sequelize } = require('./models');
    (async () => {
      await sequelize.sync({ force: true });
      console.log(JSON.stringify(await sequelize.getQueryInterface().showAllTables()));
      await sequelize.close();
    })().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `;

  try {
    const execution = spawnSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf8'
    });
    assert.equal(execution.status, 0, execution.stderr);
    const tables = JSON.parse(execution.stdout.trim());
    assert.equal(tables.some((name) => /^baidu_/u.test(String(name))), false);
    assert.equal(tables.includes('marketing_schema_migrations'), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('foundation ships no placeholder domain migration', () => {
  assert.deepEqual(loadMarketingMigrations(), []);
});

test('marketing migration audit is read-only and apply creates only an idempotent ledger', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-ledger-'));
  const database = createDatabase(path.join(directory, 'ledger.sqlite'));
  t.after(async () => {
    await database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const runner = createMarketingMigrationRunner({ sequelize: database });

  assert.deepEqual(await runner.audit(), {
    ready: false,
    ledgerPresent: false,
    appliedVersions: [],
    pendingVersions: []
  });
  assert.deepEqual(await database.getQueryInterface().showAllTables(), []);

  const first = await runner.apply();
  const second = await runner.apply();
  const tables = await database.getQueryInterface().showAllTables();

  assert.equal(first.ready, true);
  assert.deepEqual(second, first);
  assert.deepEqual(tables, ['marketing_schema_migrations']);
});

test('concurrent SQLite runners serialize and apply a migration once', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-lock-'));
  const databasePath = path.join(directory, 'locked.sqlite');
  const migrationDirectory = path.join(directory, 'migrations');
  fs.mkdirSync(migrationDirectory);
  fs.writeFileSync(
    path.join(migrationDirectory, '001-lock-probe.js'),
    [
      'module.exports = {',
      '  async up({ sequelize, transaction }) {',
      "    await sequelize.query('CREATE TABLE marketing_lock_probe (id TEXT PRIMARY KEY)', { transaction });",
      '  }',
      '};',
      ''
    ].join('\n')
  );

  const firstDatabase = createDatabase(databasePath);
  const secondDatabase = createDatabase(databasePath);
  t.after(async () => {
    await Promise.all([
      firstDatabase.close(),
      secondDatabase.close()
    ]);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await Promise.all([
    firstDatabase.query('PRAGMA busy_timeout=5000'),
    secondDatabase.query('PRAGMA busy_timeout=5000')
  ]);

  const migrations = loadMarketingMigrations({ directory: migrationDirectory });
  const firstRunner = createMarketingMigrationRunner({
    sequelize: firstDatabase,
    migrations
  });
  const secondRunner = createMarketingMigrationRunner({
    sequelize: secondDatabase,
    migrations
  });

  const [first, second] = await Promise.all([
    firstRunner.apply(),
    secondRunner.apply()
  ]);
  const [rows] = await firstDatabase.query(
    'SELECT version FROM marketing_schema_migrations'
  );

  assert.equal(first.ready, true);
  assert.equal(second.ready, true);
  assert.deepEqual(rows.map((row) => row.version), ['001-lock-probe']);
});

test('audit rejects an edited migration after its checksum was recorded', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketing-checksum-'));
  const migrationDirectory = path.join(directory, 'migrations');
  const migrationPath = path.join(migrationDirectory, '001-checksum-probe.js');
  fs.mkdirSync(migrationDirectory);
  fs.writeFileSync(
    migrationPath,
    [
      'module.exports = {',
      '  async up({ sequelize, transaction }) {',
      "    await sequelize.query('CREATE TABLE marketing_checksum_probe (id TEXT PRIMARY KEY)', { transaction });",
      '  }',
      '};',
      ''
    ].join('\n')
  );

  const database = createDatabase(path.join(directory, 'checksum.sqlite'));
  t.after(async () => {
    await database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await createMarketingMigrationRunner({
    sequelize: database,
    migrations: loadMarketingMigrations({ directory: migrationDirectory })
  }).apply();

  fs.appendFileSync(migrationPath, '// edited after apply\n');
  const editedRunner = createMarketingMigrationRunner({
    sequelize: database,
    migrations: loadMarketingMigrations({ directory: migrationDirectory })
  });

  await assert.rejects(
    editedRunner.audit(),
    (error) => error.code === 'MARKETING_MIGRATION_CHECKSUM_MISMATCH'
  );
});
