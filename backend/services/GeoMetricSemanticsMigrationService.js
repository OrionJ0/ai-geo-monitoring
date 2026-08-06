const crypto = require('node:crypto');
const { DataTypes, QueryTypes } = require('sequelize');
const {
  LEGACY_METRIC_SEMANTICS
} = require('./GeoMetricSemanticsService');

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

function hasNonNullDefault(column = {}) {
  if (column.defaultValue === undefined || column.defaultValue === null) return false;
  return String(column.defaultValue).trim().toUpperCase() !== 'NULL';
}

class GeoMetricSemanticsMigrationService {
  expectedColumns() {
    return {
      visibility_metrics: {
        metric_semantics_version: {
          type: DataTypes.STRING(50),
          allowNull: true
        },
        answer_competitor_share: {
          type: DataTypes.FLOAT,
          allowNull: true
        },
        sov_numerator: {
          type: DataTypes.INTEGER,
          allowNull: true
        },
        sov_denominator: {
          type: DataTypes.INTEGER,
          allowNull: true
        },
        competition_entities: {
          type: DataTypes.JSON,
          allowNull: false,
          defaultValue: []
        }
      },
      question_records: {
        analysis_contract_version: {
          type: DataTypes.STRING(40),
          allowNull: true
        },
        metric_semantics_version: {
          type: DataTypes.STRING(50),
          allowNull: true
        }
      },
      question_set_runs: {
        metric_semantics_version: {
          type: DataTypes.STRING(50),
          allowNull: true
        }
      },
      report_snapshots: {
        metric_semantics_version: {
          type: DataTypes.STRING(50),
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

  async count(database, tableName, whereSql = '') {
    const rows = await database.query(
      `SELECT COUNT(*) AS count FROM ${quoteTable(database, tableName)} ${whereSql}`,
      { type: QueryTypes.SELECT }
    );
    return Number(rows[0]?.count) || 0;
  }

  async legacySovSnapshot(database) {
    const table = quoteTable(database, 'visibility_metrics');
    const rows = await database.query(
      `SELECT ${quote(database, 'id')} AS id,
              ${quote(database, 'share_of_voice')} AS share_of_voice
       FROM ${table}
       WHERE ${quote(database, 'share_of_voice')} IS NOT NULL
       ORDER BY ${quote(database, 'id')} ASC`,
      { type: QueryTypes.SELECT }
    );
    const serialized = rows.map((row) => [
      Number(row.id),
      Number(row.share_of_voice)
    ]);
    return {
      count: serialized.length,
      checksum: crypto
        .createHash('sha256')
        .update(JSON.stringify(serialized))
        .digest('hex')
    };
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

    const metricVersionColumn = descriptions.visibility_metrics.metric_semantics_version;
    const recordVersionColumn = descriptions.question_records.metric_semantics_version;
    const recordContractColumn = descriptions.question_records.analysis_contract_version;
    const runVersionColumn = descriptions.question_set_runs.metric_semantics_version;
    const snapshotVersionColumn = descriptions.report_snapshots.metric_semantics_version;
    const unversioned = {
      visibility_metrics: metricVersionColumn
        ? await this.count(
            database,
            'visibility_metrics',
            `WHERE ${quote(database, 'metric_semantics_version')} IS NULL
               OR TRIM(${quote(database, 'metric_semantics_version')}) = ''`
          )
        : await this.count(database, 'visibility_metrics'),
      question_records: recordVersionColumn && recordContractColumn
        ? await this.count(
            database,
            'question_records',
            `WHERE ${quote(database, 'project_id')} IS NOT NULL
               AND (
                 ${quote(database, 'metric_semantics_version')} IS NULL
                 OR TRIM(${quote(database, 'metric_semantics_version')}) = ''
                 OR ${quote(database, 'analysis_contract_version')} IS NULL
                 OR TRIM(${quote(database, 'analysis_contract_version')}) = ''
               )`
          )
        : await this.count(
            database,
            'question_records',
            `WHERE ${quote(database, 'project_id')} IS NOT NULL`
          ),
      question_set_runs: runVersionColumn
        ? await this.count(
            database,
            'question_set_runs',
            `WHERE ${quote(database, 'project_id')} IS NOT NULL
               AND (
                 ${quote(database, 'metric_semantics_version')} IS NULL
                 OR TRIM(${quote(database, 'metric_semantics_version')}) = ''
               )`
          )
        : await this.count(database, 'question_set_runs'),
      report_snapshots: snapshotVersionColumn
        ? await this.count(
            database,
            'report_snapshots',
            `WHERE ${quote(database, 'project_id')} IS NOT NULL
               AND (
                 ${quote(database, 'metric_semantics_version')} IS NULL
                 OR TRIM(${quote(database, 'metric_semantics_version')}) = ''
               )`
          )
        : await this.count(database, 'report_snapshots')
    };
    const legacySov = await this.legacySovSnapshot(database);
    const shareOfVoice = descriptions.visibility_metrics.share_of_voice || {};
    const shareNeedsChange = shareOfVoice.allowNull === false
      || hasNonNullDefault(shareOfVoice);

    return {
      dialect: database.getDialect(),
      missing_columns: missingColumns,
      unversioned,
      legacy_sov_count: legacySov.count,
      legacy_sov_checksum: legacySov.checksum,
      share_of_voice_nullable: shareOfVoice.allowNull !== false,
      migration_required: (
        missingColumns.length > 0
        || Object.values(unversioned).some((count) => count > 0)
        || shareNeedsChange
      )
    };
  }

  async assertRuntimeReady(options = {}) {
    let audit;
    try {
      audit = await this.audit(options);
    } catch (error) {
      throw migrationError(
        `[GEO_METRIC_SEMANTICS_MIGRATION_REQUIRED] 无法确认数据库指标结构，请先执行 npm run audit:geo-metric-semantics 并完成迁移：${error?.message || error}`,
        'GEO_METRIC_SEMANTICS_MIGRATION_REQUIRED'
      );
    }
    if (audit.migration_required) {
      throw migrationError(
        '[GEO_METRIC_SEMANTICS_MIGRATION_REQUIRED] 数据库尚未完成 GEO 指标语义迁移，请先备份并执行 npm run migrate:geo-metric-semantics',
        'GEO_METRIC_SEMANTICS_MIGRATION_REQUIRED'
      );
    }
    return audit;
  }

  async ensureSchema(database) {
    const queryInterface = database.getQueryInterface();
    const descriptions = await this.describe(database);
    const addedColumns = [];
    for (const [tableName, columns] of Object.entries(this.expectedColumns())) {
      for (const [columnName, definition] of Object.entries(columns)) {
        if (!descriptions[tableName][columnName]) {
          await queryInterface.addColumn(tableName, columnName, definition);
          addedColumns.push(`${tableName}.${columnName}`);
        }
      }
    }
    return addedColumns;
  }

  async backfillVersions(database) {
    const legacy = LEGACY_METRIC_SEMANTICS;
    const metrics = quoteTable(database, 'visibility_metrics');
    const records = quoteTable(database, 'question_records');
    const runs = quoteTable(database, 'question_set_runs');
    const snapshots = quoteTable(database, 'report_snapshots');

    await database.query(
      `UPDATE ${metrics}
       SET ${quote(database, 'metric_semantics_version')} = :legacy
       WHERE ${quote(database, 'metric_semantics_version')} IS NULL
          OR TRIM(${quote(database, 'metric_semantics_version')}) = ''`,
      { replacements: { legacy } }
    );
    await database.query(
      `UPDATE ${records}
       SET ${quote(database, 'metric_semantics_version')} = :legacy
       WHERE ${quote(database, 'project_id')} IS NOT NULL
         AND (
           ${quote(database, 'metric_semantics_version')} IS NULL
           OR TRIM(${quote(database, 'metric_semantics_version')}) = ''
         )`,
      { replacements: { legacy } }
    );
    await database.query(
      `UPDATE ${records}
       SET ${quote(database, 'analysis_contract_version')} = COALESCE(
         (
           SELECT ${quote(database, 'analysis_method')}
           FROM ${metrics}
           WHERE ${metrics}.${quote(database, 'question_record_id')}
             = ${records}.${quote(database, 'id')}
           ORDER BY ${metrics}.${quote(database, 'id')} ASC
           LIMIT 1
         ),
         'legacy_unknown'
       )
       WHERE ${quote(database, 'project_id')} IS NOT NULL
         AND (
           ${quote(database, 'analysis_contract_version')} IS NULL
           OR TRIM(${quote(database, 'analysis_contract_version')}) = ''
         )`
    );
    await database.query(
      `UPDATE ${runs}
       SET ${quote(database, 'metric_semantics_version')} = :legacy,
           ${quote(database, 'analysis_contract_version')} = COALESCE(
             NULLIF(TRIM(${quote(database, 'analysis_contract_version')}), ''),
             'legacy_unknown'
           )
       WHERE ${quote(database, 'project_id')} IS NOT NULL
         AND (
           ${quote(database, 'metric_semantics_version')} IS NULL
           OR TRIM(${quote(database, 'metric_semantics_version')}) = ''
         )`,
      { replacements: { legacy } }
    );
    await database.query(
      `UPDATE ${snapshots}
       SET ${quote(database, 'metric_semantics_version')} = :legacy
       WHERE ${quote(database, 'project_id')} IS NOT NULL
         AND (
           ${quote(database, 'metric_semantics_version')} IS NULL
           OR TRIM(${quote(database, 'metric_semantics_version')}) = ''
         )`,
      { replacements: { legacy } }
    );
  }

  async finalizeSchema(database) {
    const queryInterface = database.getQueryInterface();
    const description = await queryInterface.describeTable('visibility_metrics');
    const shareOfVoice = description.share_of_voice || {};
    if (
      shareOfVoice.allowNull === false
      || hasNonNullDefault(shareOfVoice)
    ) {
      await queryInterface.changeColumn('visibility_metrics', 'share_of_voice', {
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: null
      });
    }
    const refreshed = await queryInterface.describeTable('visibility_metrics');
    if (refreshed.metric_semantics_version?.allowNull !== false) {
      await queryInterface.changeColumn(
        'visibility_metrics',
        'metric_semantics_version',
        {
          type: DataTypes.STRING(50),
          allowNull: false
        }
      );
    }
  }

  async ensureIndexes(database) {
    const queryInterface = database.getQueryInterface();
    const definitions = [
      {
        table: 'visibility_metrics',
        name: 'visibility_metrics_project_semantics_created_platform',
        fields: ['project_id', 'metric_semantics_version', 'created_at', 'platform']
      },
      {
        table: 'question_records',
        name: 'question_records_project_semantics_created_platform',
        fields: ['project_id', 'metric_semantics_version', 'created_at', 'platform']
      }
    ];
    const added = [];
    for (const definition of definitions) {
      const description = await queryInterface.describeTable(definition.table);
      if (!definition.fields.every((field) => Boolean(description[field]))) continue;
      const indexes = await queryInterface.showIndex(definition.table);
      if (!indexes.some((index) => index.name === definition.name)) {
        await queryInterface.addIndex(definition.table, definition.fields, {
          name: definition.name
        });
        added.push(definition.name);
      }
    }
    return added;
  }

  async quickCheck(database) {
    if (database.getDialect() !== 'sqlite') return null;
    const rows = await database.query('PRAGMA quick_check', {
      type: QueryTypes.SELECT
    });
    const value = Object.values(rows[0] || {})[0];
    if (value !== 'ok') {
      throw migrationError('SQLite quick_check 未通过', 'SQLITE_QUICK_CHECK_FAILED');
    }
    return value;
  }

  async apply(options = {}) {
    const database = options.sequelize;
    const backupReference = String(options.backupReference || '').trim();
    if (!database) {
      throw migrationError('缺少数据库连接', 'DATABASE_REQUIRED');
    }
    if (!backupReference) {
      throw migrationError(
        '应用 GEO 指标语义迁移前必须确认数据库备份',
        'BACKUP_CONFIRMATION_REQUIRED'
      );
    }

    const preflight = await this.audit({ sequelize: database });
    const addedColumns = await this.ensureSchema(database);
    await this.backfillVersions(database);
    await this.finalizeSchema(database);
    const addedIndexes = await this.ensureIndexes(database);
    const quickCheck = await this.quickCheck(database);
    const postflight = await this.audit({ sequelize: database });

    if (postflight.migration_required) {
      throw migrationError(
        'GEO 指标语义迁移后复审仍未就绪',
        'GEO_METRIC_SEMANTICS_MIGRATION_INCOMPLETE'
      );
    }

    if (
      preflight.legacy_sov_count !== postflight.legacy_sov_count
      || preflight.legacy_sov_checksum !== postflight.legacy_sov_checksum
    ) {
      throw migrationError(
        '迁移前后历史 SOV 不一致',
        'LEGACY_SOV_CHANGED'
      );
    }

    return {
      backup_reference: backupReference,
      added_columns: addedColumns,
      added_indexes: addedIndexes,
      quick_check: quickCheck,
      preflight,
      postflight
    };
  }
}

module.exports = new GeoMetricSemanticsMigrationService();
module.exports.LEGACY_METRIC_SEMANTICS = LEGACY_METRIC_SEMANTICS;
