const { DataTypes } = require('sequelize');

function migrationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function quote(database, identifier) {
  return database.getQueryInterface().queryGenerator.quoteIdentifier(identifier);
}

function quoteTable(database, tableName) {
  return database.getQueryInterface().queryGenerator.quoteTable(tableName);
}

/**
 * v5 候选分析的 additive 迁移：为 question_records 增加 competitor_snapshot
 * 列。只新增列，不改写已存在的行；SQLite 与 Postgres 均使用
 * `ALTER TABLE ADD COLUMN`，历史数据保持原样。
 */
class V5SnapshotMigrationService {
  expectedColumns() {
    return {
      question_records: {
        competitor_snapshot: {
          type: DataTypes.JSON,
          allowNull: true
        }
      }
    };
  }

  async describe(database) {
    const descriptions = {};
    for (const tableName of Object.keys(this.expectedColumns())) {
      descriptions[tableName] = await database
        .getQueryInterface()
        .describeTable(tableName);
    }
    return descriptions;
  }

  async audit(options = {}) {
    const database = options.sequelize;
    if (!database) {
      throw migrationError('缺少数据库连接', 'DATABASE_REQUIRED');
    }
    const descriptions = await this.describe(database);
    const missingColumns = [];
    for (const [tableName, columns] of Object.entries(this.expectedColumns())) {
      for (const columnName of Object.keys(columns)) {
        if (!descriptions[tableName][columnName]) {
          missingColumns.push(`${tableName}.${columnName}`);
        }
      }
    }
    return {
      dialect: database.getDialect(),
      missing_columns: missingColumns,
      migration_required: missingColumns.length > 0
    };
  }

  async apply(options = {}) {
    const database = options.sequelize;
    if (!database) {
      throw migrationError('缺少数据库连接', 'DATABASE_REQUIRED');
    }
    const descriptions = await this.describe(database);
    const applied = [];
    for (const [tableName, columns] of Object.entries(this.expectedColumns())) {
      for (const columnName of Object.keys(columns)) {
        if (descriptions[tableName][columnName]) continue;
        const column = columns[columnName];
        await database.getQueryInterface().addColumn(
          tableName,
          columnName,
          { type: column.type, allowNull: column.allowNull }
        );
        applied.push(`${tableName}.${columnName}`);
      }
    }
    const audit = await this.audit({ sequelize: database });
    return {
      applied_columns: applied,
      migration_required: audit.migration_required
    };
  }
}

module.exports = new V5SnapshotMigrationService();
module.exports.V5SnapshotMigrationService = V5SnapshotMigrationService;
