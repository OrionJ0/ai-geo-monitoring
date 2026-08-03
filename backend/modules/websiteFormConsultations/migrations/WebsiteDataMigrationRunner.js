const { Transaction } = require('sequelize');
const { loadWebsiteDataMigrations } = require('./index');

const LEDGER_TABLE = 'website_data_schema_migrations';

function migrationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeTableName(table) {
  if (typeof table === 'string') return table;
  return String(table?.tableName || table?.table_name || table?.name || '');
}

function createWebsiteDataMigrationRunner({
  sequelize,
  migrations = loadWebsiteDataMigrations()
} = {}) {
  if (!sequelize) {
    throw migrationError(
      '官网数据迁移缺少数据库连接',
      'WEBSITE_DATA_DATABASE_REQUIRED'
    );
  }
  const orderedMigrations = [...migrations].sort((a, b) => (
    a.version.localeCompare(b.version)
  ));
  const seen = new Set();
  for (const migration of orderedMigrations) {
    if (
      !/^\d{3}-[a-z0-9-]+$/u.test(String(migration?.version || ''))
      || !/^[a-f0-9]{64}$/u.test(String(migration?.checksum || ''))
      || typeof migration?.up !== 'function'
      || seen.has(migration.version)
    ) {
      throw migrationError(
        '官网数据迁移定义无效',
        'WEBSITE_DATA_MIGRATION_INVALID'
      );
    }
    seen.add(migration.version);
  }

  async function ledgerExists(options = {}) {
    const tables = await sequelize.getQueryInterface().showAllTables(options);
    return tables.some((table) => normalizeTableName(table) === LEDGER_TABLE);
  }

  async function readLedger(options = {}) {
    const [rows] = await sequelize.query(
      `SELECT version, checksum, applied_at
       FROM ${LEDGER_TABLE}
       ORDER BY version ASC`,
      options
    );
    return rows;
  }

  function snapshot(rows, present = true) {
    const appliedVersions = rows.map((row) => row.version);
    const applied = new Set(appliedVersions);
    return {
      ready: present && appliedVersions.length === orderedMigrations.length,
      ledgerPresent: present,
      appliedVersions,
      pendingVersions: orderedMigrations
        .map((migration) => migration.version)
        .filter((version) => !applied.has(version))
    };
  }

  function validateAppliedRows(rows) {
    const expected = new Map(
      orderedMigrations.map((migration) => [migration.version, migration])
    );
    for (const row of rows) {
      const migration = expected.get(row.version);
      if (!migration) {
        throw migrationError(
          `数据库包含未知的官网数据迁移: ${row.version}`,
          'WEBSITE_DATA_MIGRATION_UNKNOWN'
        );
      }
      if (row.checksum !== migration.checksum) {
        throw migrationError(
          `官网数据迁移 checksum 不一致: ${row.version}`,
          'WEBSITE_DATA_MIGRATION_CHECKSUM_MISMATCH'
        );
      }
    }
  }

  async function audit() {
    await sequelize.authenticate();
    if (!await ledgerExists()) return snapshot([], false);
    const description = await sequelize.getQueryInterface().describeTable(
      LEDGER_TABLE
    );
    if (!['version', 'checksum', 'applied_at'].every((key) => description[key])) {
      throw migrationError(
        '官网数据迁移账本结构不完整',
        'WEBSITE_DATA_MIGRATION_LEDGER_INVALID'
      );
    }
    const rows = await readLedger();
    validateAppliedRows(rows);
    return snapshot(rows);
  }

  async function applyWithinTransaction(transaction) {
    const checksumConstraint = sequelize.getDialect() === 'postgres'
      ? "checksum ~ '^[0-9a-f]{64}$'"
      : "length(checksum) = 64 AND checksum NOT GLOB '*[^0-9a-f]*'";
    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
        version TEXT PRIMARY KEY NOT NULL,
        checksum TEXT NOT NULL CHECK (${checksumConstraint}),
        applied_at TEXT NOT NULL
      )`,
      { transaction }
    );
    const rows = await readLedger({ transaction });
    validateAppliedRows(rows);
    const applied = new Set(rows.map((row) => row.version));
    for (const migration of orderedMigrations) {
      if (applied.has(migration.version)) continue;
      await migration.up({
        sequelize,
        queryInterface: sequelize.getQueryInterface(),
        transaction
      });
      await sequelize.query(
        `INSERT INTO ${LEDGER_TABLE} (version, checksum, applied_at)
         VALUES (:version, :checksum, :appliedAt)`,
        {
          replacements: {
            version: migration.version,
            checksum: migration.checksum,
            appliedAt: new Date().toISOString()
          },
          transaction
        }
      );
    }
  }

  async function apply() {
    await sequelize.authenticate();
    const dialect = sequelize.getDialect();
    if (!['sqlite', 'postgres'].includes(dialect)) {
      throw migrationError(
        '官网数据迁移不支持当前数据库方言',
        'WEBSITE_DATA_DATABASE_DIALECT_UNSUPPORTED'
      );
    }
    if (dialect === 'sqlite') {
      await sequelize.transaction(
        { type: Transaction.TYPES.EXCLUSIVE },
        applyWithinTransaction
      );
    } else {
      await sequelize.transaction(async (transaction) => {
        await sequelize.query(
          "SELECT pg_advisory_xact_lock(hashtext('ai_geo_website_data_schema_migrations'))",
          { transaction }
        );
        await applyWithinTransaction(transaction);
      });
    }
    return audit();
  }

  return { apply, audit };
}

module.exports = {
  LEDGER_TABLE,
  createWebsiteDataMigrationRunner
};
