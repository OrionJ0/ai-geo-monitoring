const { DataTypes } = require('sequelize');

function migrationError(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

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
    const queryInterface = database.getQueryInterface();
    let tableNames;
    try {
      tableNames = await queryInterface.showAllTables();
    } catch (error) {
      throw migrationError(
        '数据库表清单读取失败',
        'V5_SNAPSHOT_DATABASE_AUDIT_FAILED',
        error
      );
    }
    const existingTables = new Set(tableNames.map((entry) => (
      typeof entry === 'string'
        ? entry
        : entry?.tableName || entry?.table_name || entry?.name
    )));
    const descriptions = {};
    for (const tableName of Object.keys(this.expectedColumns())) {
      if (!existingTables.has(tableName)) {
        throw migrationError(
          `缺少必须的现有数据表：${tableName}`,
          'V5_SNAPSHOT_REQUIRED_TABLE_MISSING'
        );
      }
      try {
        descriptions[tableName] = await queryInterface.describeTable(tableName);
      } catch (error) {
        throw migrationError(
          `数据表结构读取失败：${tableName}`,
          'V5_SNAPSHOT_DATABASE_AUDIT_FAILED',
          error
        );
      }
    }
    return descriptions;
  }

  columnMismatches(tableName, columnName, actual) {
    if (!actual) return [];
    const qualifiedName = `${tableName}.${columnName}`;
    const type = String(actual.type || '').trim().toUpperCase();
    const mismatches = [];
    if (type !== 'JSON' && type !== 'JSONB') {
      mismatches.push(`${qualifiedName}:type`);
    }
    if (actual.allowNull !== true) {
      mismatches.push(`${qualifiedName}:nullable`);
    }
    if (actual.defaultValue !== null && actual.defaultValue !== undefined) {
      mismatches.push(`${qualifiedName}:default`);
    }
    return mismatches;
  }

  async audit(options = {}) {
    const database = options.sequelize;
    if (!database) {
      throw migrationError('缺少数据库连接', 'DATABASE_REQUIRED');
    }
    const descriptions = await this.describe(database);
    const missingColumns = [];
    const schemaMismatches = [];
    for (const [tableName, columns] of Object.entries(this.expectedColumns())) {
      for (const columnName of Object.keys(columns)) {
        if (!descriptions[tableName][columnName]) {
          missingColumns.push(`${tableName}.${columnName}`);
          continue;
        }
        schemaMismatches.push(...this.columnMismatches(
          tableName,
          columnName,
          descriptions[tableName][columnName]
        ));
      }
    }
    return {
      dialect: database.getDialect(),
      missing_columns: missingColumns,
      schema_mismatches: schemaMismatches,
      migration_required: missingColumns.length > 0,
      ready: missingColumns.length === 0 && schemaMismatches.length === 0
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
      for (const [columnName, column] of Object.entries(columns)) {
        if (descriptions[tableName][columnName]) continue;
        await database.getQueryInterface().addColumn(
          tableName,
          columnName,
          { type: column.type, allowNull: column.allowNull }
        );
        applied.push(`${tableName}.${columnName}`);
      }
    }
    const audit = await this.audit({ sequelize: database });
    if (!audit.ready) {
      const error = migrationError(
        'v5 快照字段迁移后复审未通过',
        'V5_SNAPSHOT_MIGRATION_INCOMPLETE'
      );
      error.missing_columns = audit.missing_columns;
      error.schema_mismatches = audit.schema_mismatches;
      throw error;
    }
    return {
      dialect: audit.dialect,
      applied_columns: applied,
      missing_columns: audit.missing_columns,
      schema_mismatches: audit.schema_mismatches,
      migration_required: audit.migration_required,
      ready: audit.ready
    };
  }
}

module.exports = new V5SnapshotMigrationService();
module.exports.V5SnapshotMigrationService = V5SnapshotMigrationService;
