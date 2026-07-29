const test = require('node:test');
const assert = require('node:assert/strict');
const { Sequelize } = require('sequelize');
const GeoMetricSemanticsMigrationService = require(
  '../../services/GeoMetricSemanticsMigrationService'
);

const postgresTestUrl = process.env.POSTGRES_TEST_URL;
if (!postgresTestUrl) {
  throw new Error(
    'POSTGRES_TEST_URL is required for the GEO metric PostgreSQL integration test'
  );
}

const database = new Sequelize(postgresTestUrl, {
  dialect: 'postgres',
  logging: false
});

test.before(async () => {
  await database.authenticate();
  await database.query('DROP TABLE IF EXISTS report_snapshots');
  await database.query('DROP TABLE IF EXISTS visibility_metrics');
  await database.query('DROP TABLE IF EXISTS question_set_runs');
  await database.query('DROP TABLE IF EXISTS question_records');
  await database.query(`
    CREATE TABLE visibility_metrics (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL,
      question_record_id INTEGER NOT NULL,
      platform VARCHAR(50) NOT NULL,
      share_of_voice DOUBLE PRECISION NOT NULL DEFAULT 0,
      analysis_method VARCHAR(40) NOT NULL DEFAULT 'legacy_rules_v1',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);
  await database.query(`
    CREATE TABLE question_records (
      id SERIAL PRIMARY KEY,
      project_id INTEGER,
      platform VARCHAR(50) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);
  await database.query(`
    CREATE TABLE question_set_runs (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL,
      analysis_contract_version VARCHAR(40),
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);
  await database.query(`
    CREATE TABLE report_snapshots (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);
  await database.query(`
    INSERT INTO question_records (
      id, project_id, platform, created_at, updated_at
    ) VALUES (1, 9, 'deepseek', NOW(), NOW())
  `);
  await database.query(`
    INSERT INTO visibility_metrics (
      id, project_id, question_record_id, platform, share_of_voice,
      analysis_method, created_at, updated_at
    ) VALUES (
      1, 9, 1, 'deepseek', 62.5, 'ai_structured_v2', NOW(), NOW()
    )
  `);
});

test.after(async () => {
  await database.query('DROP TABLE IF EXISTS report_snapshots');
  await database.query('DROP TABLE IF EXISTS visibility_metrics');
  await database.query('DROP TABLE IF EXISTS question_set_runs');
  await database.query('DROP TABLE IF EXISTS question_records');
  await database.close();
});

test('preserves legacy SOV while migrating a real PostgreSQL schema', async () => {
  const result = await GeoMetricSemanticsMigrationService.apply({
    sequelize: database,
    backupReference: 'disposable-postgres-test-database'
  });
  assert.equal(result.postflight.migration_required, false);
  assert.equal(result.postflight.legacy_sov_count, 1);

  const [rows] = await database.query(`
    SELECT share_of_voice, metric_semantics_version, answer_competitor_share
    FROM visibility_metrics
    WHERE id = 1
  `);
  assert.equal(rows[0].share_of_voice, 62.5);
  assert.equal(
    rows[0].metric_semantics_version,
    'configured_competitor_sov_v1'
  );
  assert.equal(rows[0].answer_competitor_share, null);
});
