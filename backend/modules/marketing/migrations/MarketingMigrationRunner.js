const { Transaction } = require('sequelize');
const { loadMarketingMigrations } = require('./index');

const LEDGER_TABLE = 'marketing_schema_migrations';
const REQUIRED_LEDGER_COLUMNS = Object.freeze([
  'version',
  'checksum',
  'applied_at'
]);

function migrationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeTableName(table) {
  if (typeof table === 'string') return table;
  return String(table?.tableName || table?.table_name || table?.name || '');
}

function assertUniqueMigrations(migrations) {
  const seen = new Set();
  for (const migration of migrations) {
    if (
      !/^\d{3}-[a-z0-9-]+$/u.test(String(migration?.version || ''))
      || !/^[a-f0-9]{64}$/u.test(String(migration?.checksum || ''))
      || typeof migration?.up !== 'function'
    ) {
      throw migrationError(
        '营销迁移定义无效',
        'MARKETING_MIGRATION_INVALID'
      );
    }
    if (seen.has(migration.version)) {
      throw migrationError(
        `营销迁移版本重复: ${migration.version}`,
        'MARKETING_MIGRATION_DUPLICATE'
      );
    }
    seen.add(migration.version);
  }
}

function ledgerChecksumConstraint(dialect) {
  return dialect === 'postgres'
    ? "checksum ~ '^[0-9a-f]{64}$'"
    : (
        "length(checksum) = 64 "
        + "AND checksum NOT GLOB '*[^0-9a-f]*'"
      );
}

function createMarketingMigrationRunner({
  sequelize,
  migrations = loadMarketingMigrations()
} = {}) {
  if (!sequelize) {
    throw migrationError('缺少数据库连接', 'MARKETING_DATABASE_REQUIRED');
  }
  const orderedMigrations = [...migrations].sort((a, b) => (
    a.version.localeCompare(b.version)
  ));
  assertUniqueMigrations(orderedMigrations);

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

  function validateAppliedRows(rows) {
    const expected = new Map(
      orderedMigrations.map((migration) => [migration.version, migration])
    );
    for (const [index, row] of rows.entries()) {
      const migration = expected.get(row.version);
      if (!migration) {
        throw migrationError(
          `数据库包含当前代码未知的营销迁移: ${row.version}`,
          'MARKETING_MIGRATION_UNKNOWN'
        );
      }
      if (row.checksum !== migration.checksum) {
        throw migrationError(
          `已应用营销迁移 checksum 不一致: ${row.version}`,
          'MARKETING_MIGRATION_CHECKSUM_MISMATCH'
        );
      }
      if (orderedMigrations[index]?.version !== row.version) {
        throw migrationError(
          `营销迁移历史不是当前仓库的连续前缀: ${row.version}`,
          'MARKETING_MIGRATION_HISTORY_GAP'
        );
      }
    }
  }

  function assertExpectedLatest(expectedLatest) {
    if (expectedLatest === undefined || expectedLatest === null) return;
    const expected = String(expectedLatest).trim();
    const actual = orderedMigrations.at(-1)?.version || null;
    if (!expected || expected !== actual) {
      throw migrationError(
        '营销迁移仓库边界与预期最高版本不一致',
        'MARKETING_MIGRATION_EXPECTED_LATEST_MISMATCH'
      );
    }
  }

  function snapshot(rows, present = true) {
    const appliedVersions = rows.map((row) => row.version);
    const applied = new Set(appliedVersions);
    const pendingVersions = orderedMigrations
      .map((migration) => migration.version)
      .filter((version) => !applied.has(version));
    return {
      ready: present && pendingVersions.length === 0,
      ledgerPresent: present,
      appliedVersions,
      pendingVersions
    };
  }

  async function audit() {
    await sequelize.authenticate();
    if (!await ledgerExists()) {
      return snapshot([], false);
    }

    const description = await sequelize.getQueryInterface().describeTable(
      LEDGER_TABLE
    );
    if (!REQUIRED_LEDGER_COLUMNS.every((column) => description[column])) {
      throw migrationError(
        '营销迁移 ledger 结构不完整',
        'MARKETING_MIGRATION_LEDGER_INVALID'
      );
    }

    const rows = await readLedger();
    validateAppliedRows(rows);
    return snapshot(rows);
  }

  async function applyWithinTransaction(transaction) {
    const checksumConstraint = ledgerChecksumConstraint(
      sequelize.getDialect()
    );
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

  async function apply({ expectedLatest } = {}) {
    assertExpectedLatest(expectedLatest);
    await sequelize.authenticate();
    const dialect = sequelize.getDialect();
    if (!['sqlite', 'postgres'].includes(dialect)) {
      throw migrationError(
        '营销迁移不支持当前数据库方言',
        'MARKETING_DATABASE_DIALECT_UNSUPPORTED'
      );
    }

    if (expectedLatest !== undefined && expectedLatest !== null) {
      await audit();
    }

    if (dialect === 'sqlite') {
      await sequelize.transaction(
        { type: Transaction.TYPES.EXCLUSIVE },
        applyWithinTransaction
      );
    } else {
      await sequelize.transaction(async (transaction) => {
        await sequelize.query(
          "SELECT pg_advisory_xact_lock(hashtext('ai_geo_marketing_schema_migrations'))",
          { transaction }
        );
        await applyWithinTransaction(transaction);
      });
    }
    return audit();
  }

  return {
    apply,
    audit
  };
}

module.exports = {
  LEDGER_TABLE,
  createMarketingMigrationRunner,
  ledgerChecksumConstraint
};
