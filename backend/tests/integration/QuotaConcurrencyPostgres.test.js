const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DataTypes, Sequelize } = require('sequelize');
const {
  assertDisposablePostgresUrl
} = require('../../scripts/runMarketingPostgresTests');

const postgresTestUrl = assertDisposablePostgresUrl(
  process.env.POSTGRES_TEST_URL,
  process.env.DATABASE_URL
);
const schema = `quota_test_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new Sequelize(postgresTestUrl, {
  dialect: 'postgres',
  logging: false,
  pool: { min: 0, max: 1 }
});
const scopedUrl = new URL(postgresTestUrl);
scopedUrl.searchParams.set('options', `-c search_path=${schema}`);

const database = new Sequelize(scopedUrl.toString(), {
  dialect: 'postgres',
  logging: false,
  schema,
  define: { schema },
  pool: { min: 0, max: 10 }
});
const UsageCounter = database.define('QuotaConcurrencyPostgresCounter', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  feature: { type: DataTypes.STRING(30), allowNull: false },
  period: { type: DataTypes.STRING(30), allowNull: false },
  used_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  period_start: { type: DataTypes.DATE, allowNull: false }
}, {
  tableName: 'quota_concurrency_postgres_counters',
  timestamps: false,
  indexes: [{ unique: true, fields: ['user_id', 'feature', 'period'] }]
});
const {
  atomicConsumeQuotaCounter,
  ensureQuotaCounter
} = require('../../middleware/quota');

test.before(async () => {
  await admin.authenticate();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await database.authenticate();
  await UsageCounter.sync();
});

test.after(async () => {
  await database.close();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.close();
});

test('real PostgreSQL concurrent quota updates never exceed the limit', async () => {
  const counter = await UsageCounter.create({
    user_id: 1,
    feature: 'detection',
    period: 'daily',
    used_count: 0,
    period_start: new Date('2026-08-06T00:00:00.000Z')
  });
  const results = await Promise.all(Array.from({ length: 20 }, () => (
    atomicConsumeQuotaCounter({
      model: UsageCounter,
      counterId: counter.id,
      requestedAmount: 1,
      limit: 7
    })
  )));
  await counter.reload();

  assert.equal(results.filter((result) => result.consumed).length, 7);
  assert.equal(counter.used_count, 7);
});

test('real PostgreSQL concurrent first use creates one counter and consumes once', async () => {
  const periodStart = new Date('2026-08-06T00:00:00.000Z');
  const consume = async () => database.transaction(async (transaction) => {
    const counter = await ensureQuotaCounter({
      model: UsageCounter,
      userId: 2,
      feature: 'detection',
      period: 'daily',
      periodStart,
      transaction
    });
    return atomicConsumeQuotaCounter({
      model: UsageCounter,
      counterId: counter.id,
      requestedAmount: 1,
      limit: 1,
      queryOptions: { transaction }
    });
  });
  const results = await Promise.all([consume(), consume()]);
  const rows = await UsageCounter.findAll({ where: { user_id: 2 } });

  assert.equal(results.filter((result) => result.consumed).length, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].used_count, 1);
  const [uniqueIndexes] = await database.query(`
    SELECT indexrelid::regclass::text AS index_name
    FROM pg_index
    WHERE indrelid = '"${schema}"."quota_concurrency_postgres_counters"'::regclass
      AND indisunique = TRUE
      AND pg_get_indexdef(indexrelid) LIKE '%(user_id, feature, period)%'
  `);
  assert.equal(uniqueIndexes.length, 1);
});
