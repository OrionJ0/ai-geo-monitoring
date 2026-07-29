const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Sequelize } = require('sequelize');

const GeoMetricSemanticsMigrationService = require('../services/GeoMetricSemanticsMigrationService');
const execFileAsync = promisify(execFile);

async function createLegacyDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-metric-semantics-'));
  const database = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(directory, 'legacy.sqlite'),
    logging: false
  });

  await database.query(`
    CREATE TABLE visibility_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      question_record_id INTEGER NOT NULL,
      share_of_voice FLOAT NOT NULL DEFAULT 0,
      analysis_method VARCHAR(40) NOT NULL DEFAULT 'legacy_rules_v1',
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    )
  `);
  await database.query(`
    CREATE TABLE question_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    )
  `);
  await database.query(`
    CREATE TABLE question_set_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      analysis_contract_version VARCHAR(40),
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    )
  `);
  await database.query(`
    CREATE TABLE report_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    )
  `);

  const now = new Date().toISOString();
  await database.query(
    `INSERT INTO question_records (id, project_id, created_at, updated_at)
     VALUES (1, 7, :now, :now), (2, NULL, :now, :now)`,
    { replacements: { now } }
  );
  await database.query(
    `INSERT INTO visibility_metrics (
       id, project_id, question_record_id, share_of_voice, analysis_method, created_at, updated_at
     ) VALUES (1, 7, 1, 37.5, 'ai_structured_v2', :now, :now)`,
    { replacements: { now } }
  );
  await database.query(
    `INSERT INTO question_set_runs (
       id, project_id, analysis_contract_version, created_at, updated_at
     ) VALUES (1, 7, 'ai_structured_v2', :now, :now)`,
    { replacements: { now } }
  );
  await database.query(
    `INSERT INTO report_snapshots (id, project_id, created_at, updated_at)
     VALUES (1, 7, :now, :now)`,
    { replacements: { now } }
  );

  return { database, directory };
}

test('migrates legacy metrics without changing their SOV values', async (t) => {
  const { database, directory } = await createLegacyDatabase();
  t.after(async () => {
    await database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const before = await GeoMetricSemanticsMigrationService.audit({ sequelize: database });
  assert.equal(before.migration_required, true);
  assert.equal(before.legacy_sov_count, 1);

  const result = await GeoMetricSemanticsMigrationService.apply({
    sequelize: database,
    backupReference: 'verified-test-backup'
  });
  assert.equal(
    result.postflight.migration_required,
    false,
    JSON.stringify(result.postflight, null, 2)
  );

  const [metrics] = await database.query(`
    SELECT share_of_voice, metric_semantics_version, answer_competitor_share
    FROM visibility_metrics
    WHERE id = 1
  `);
  assert.equal(metrics[0].share_of_voice, 37.5);
  assert.equal(metrics[0].metric_semantics_version, 'configured_competitor_sov_v1');
  assert.equal(metrics[0].answer_competitor_share, null);

  const [records] = await database.query(`
    SELECT id, analysis_contract_version, metric_semantics_version
    FROM question_records
    ORDER BY id
  `);
  assert.deepEqual(records.map((row) => ({
    id: row.id,
    analysis_contract_version: row.analysis_contract_version,
    metric_semantics_version: row.metric_semantics_version
  })), [
    {
      id: 1,
      analysis_contract_version: 'ai_structured_v2',
      metric_semantics_version: 'configured_competitor_sov_v1'
    },
    {
      id: 2,
      analysis_contract_version: null,
      metric_semantics_version: null
    }
  ]);
});

test('can safely run the metric semantics migration more than once', async (t) => {
  const { database, directory } = await createLegacyDatabase();
  t.after(async () => {
    await database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const first = await GeoMetricSemanticsMigrationService.apply({
    sequelize: database,
    backupReference: 'verified-test-backup'
  });
  const second = await GeoMetricSemanticsMigrationService.apply({
    sequelize: database,
    backupReference: 'verified-test-backup'
  });

  assert.equal(second.preflight.migration_required, false);
  assert.deepEqual(second.added_columns, []);
  assert.deepEqual(second.added_indexes, []);
  assert.equal(
    second.postflight.legacy_sov_checksum,
    first.postflight.legacy_sov_checksum
  );
});

test('CLI defaults to a read-only metric semantics audit', async (t) => {
  const { database, directory } = await createLegacyDatabase();
  const storage = database.options.storage;
  await database.close();
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    ['scripts/migrateGeoMetricSemantics.js'],
    {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        DB_STORAGE: storage,
        DATABASE_URL: ''
      }
    }
  );
  const audit = JSON.parse(stdout);
  assert.equal(audit.phase, 'preflight_audit');
  assert.equal(audit.migration_required, true);

  const verification = new Sequelize({
    dialect: 'sqlite',
    storage,
    logging: false
  });
  const description = await verification
    .getQueryInterface()
    .describeTable('visibility_metrics');
  await verification.close();
  assert.equal(description.metric_semantics_version, undefined);
});

test('application startup rejects an unmigrated legacy database before Sequelize sync', async (t) => {
  const { database, directory } = await createLegacyDatabase();
  const storage = database.options.storage;
  await database.close();
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await assert.rejects(
    execFileAsync(
      process.execPath,
      ['app.js'],
      {
        cwd: path.resolve(__dirname, '..'),
        env: {
          ...process.env,
          DB_STORAGE: storage,
          DATABASE_URL: '',
          NODE_ENV: 'test',
          JWT_SECRET: 'geo-metric-startup-test-secret'
        },
        timeout: 15_000
      }
    ),
    (error) => {
      const output = `${error?.stdout || ''}\n${error?.stderr || ''}`;
      assert.match(output, /GEO_METRIC_SEMANTICS_MIGRATION_REQUIRED/);
      assert.doesNotMatch(output, /no such column: metric_semantics_version/);
      return true;
    }
  );
});
