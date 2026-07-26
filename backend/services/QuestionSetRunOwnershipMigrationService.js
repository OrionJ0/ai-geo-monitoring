const { DataTypes, Op, QueryTypes } = require('sequelize');
const {
  sequelize,
  QuestionRecord,
  QuestionSetRun
} = require('../models');

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeLegacyIds(value) {
  return parseJsonArray(value)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function hasFinalizedSnapshot(run) {
  return Boolean(run.completed_at) && parseJsonArray(run.imported_rows).length > 0;
}

function migrationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

class QuestionSetRunOwnershipMigrationService {
  async ensureColumn(database, tableName, columnName, definition) {
    const queryInterface = database.getQueryInterface();
    const description = await queryInterface.describeTable(tableName);
    if (!description[columnName]) {
      await queryInterface.addColumn(tableName, columnName, definition);
      return true;
    }
    return false;
  }

  async ensureIndex(database, tableName, indexName, fields, options = {}) {
    const queryInterface = database.getQueryInterface();
    const indexes = await queryInterface.showIndex(tableName);
    const expectedFields = fields.join(',');
    const exists = indexes.some((index) => {
      const sameIndex = index.name === indexName
        || index.fields
          .map((field) => field.attribute || field.name)
          .join(',') === expectedFields;
      const matchingUniqueness = options.unique !== true || index.unique === true;
      return sameIndex && matchingUniqueness;
    });
    if (!exists) {
      await queryInterface.addIndex(tableName, fields, {
        name: indexName,
        ...options
      });
      return true;
    }
    return false;
  }

  async prepareOwnershipSchema(database) {
    const addedColumns = [];
    const addColumn = async (tableName, columnName, definition) => {
      if (await this.ensureColumn(database, tableName, columnName, definition)) {
        addedColumns.push(`${tableName}.${columnName}`);
      }
    };
    await addColumn('question_records', 'question_set_run_id', {
      type: DataTypes.INTEGER,
      allowNull: true
    });
    await addColumn('question_records', 'run_slot_index', {
      type: DataTypes.INTEGER,
      allowNull: true
    });
    await addColumn('question_records', 'execution_mode', {
      type: DataTypes.STRING(24),
      allowNull: false,
      defaultValue: 'full_monitoring'
    });
    await addColumn('question_records', 'retry_batch_id', {
      type: DataTypes.INTEGER,
      allowNull: true
    });
    await addColumn('question_records', 'lease_owner', {
      type: DataTypes.STRING(120),
      allowNull: true
    });
    await addColumn('question_records', 'lease_expires_at', {
      type: DataTypes.DATE,
      allowNull: true
    });
    await addColumn('question_set_runs', 'planned_record_count', {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    });
    await addColumn('question_set_runs', 'integrity_status', {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'complete'
    });
    await addColumn('question_set_runs', 'integrity_missing_record_count', {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    });
    await addColumn('question_set_runs', 'integrity_error_code', {
      type: DataTypes.STRING(80),
      allowNull: true
    });

    const addedIndexes = [];
    const addIndex = async (indexName, fields, indexOptions = {}) => {
      if (await this.ensureIndex(
        database,
        'question_records',
        indexName,
        fields,
        indexOptions
      )) {
        addedIndexes.push(indexName);
      }
    };
    await addIndex('question_records_question_set_run_id', ['question_set_run_id']);
    await addIndex(
      'question_records_run_slot_unique',
      ['question_set_run_id', 'run_slot_index'],
      { unique: true }
    );
    await addIndex(
      'question_records_run_status',
      ['question_set_run_id', 'status']
    );
    await addIndex(
      'question_records_lease_status',
      ['lease_expires_at', 'status']
    );
    await addIndex('question_records_retry_batch_id', ['retry_batch_id']);
    return { addedColumns, addedIndexes };
  }

  async hasLegacyColumn(database) {
    const description = await database.getQueryInterface().describeTable('question_set_runs');
    return Boolean(description.record_ids);
  }

  async hasOwnershipColumns(database) {
    const description = await database.getQueryInterface().describeTable('question_records');
    return Boolean(description.question_set_run_id && description.run_slot_index);
  }

  async dropLegacyColumn(database) {
    if (!await this.hasLegacyColumn(database)) return false;
    const queryGenerator = database.getQueryInterface().queryGenerator;
    const quotedTable = queryGenerator.quoteTable('question_set_runs');
    const quotedColumn = queryGenerator.quoteIdentifier('record_ids');
    await database.query(`ALTER TABLE ${quotedTable} DROP COLUMN ${quotedColumn}`);
    return true;
  }

  async loadLegacyRuns(database) {
    const quotedTable = database.getQueryInterface().queryGenerator.quoteTable('question_set_runs');
    return database.query(
      `SELECT id, project_id, source, record_ids, imported_rows, completed_at
       FROM ${quotedTable}
       ORDER BY id ASC`,
      { type: QueryTypes.SELECT }
    );
  }

  async auditCurrentOwnership(database) {
    const quotedRuns = database.getQueryInterface().queryGenerator.quoteTable('question_set_runs');
    const quotedRecords = database.getQueryInterface().queryGenerator.quoteTable('question_records');
    const runs = await database.query(
      `SELECT id, project_id, planned_record_count, integrity_status,
              imported_rows, completed_at, idempotency_key_hash
       FROM ${quotedRuns}
       WHERE source = 'native'
       ORDER BY id ASC`,
      { type: QueryTypes.SELECT }
    );
    const recordCounts = await database.query(
      `SELECT question_set_run_id AS run_id, COUNT(*) AS record_count
       FROM ${quotedRecords}
       WHERE question_set_run_id IS NOT NULL
       GROUP BY question_set_run_id`,
      { type: QueryTypes.SELECT }
    );
    const duplicateSlots = await database.query(
      `SELECT question_set_run_id AS run_id, run_slot_index, COUNT(*) AS slot_count
       FROM ${quotedRecords}
       WHERE question_set_run_id IS NOT NULL
         AND run_slot_index IS NOT NULL
       GROUP BY question_set_run_id, run_slot_index
       HAVING COUNT(*) > 1`,
      { type: QueryTypes.SELECT }
    );
    const danglingRecords = await database.query(
      `SELECT records.id, records.question_set_run_id, records.created_at
       FROM ${quotedRecords} AS records
       LEFT JOIN ${quotedRuns} AS runs ON runs.id = records.question_set_run_id
       WHERE records.question_set_run_id IS NOT NULL
         AND runs.id IS NULL`,
      { type: QueryTypes.SELECT }
    );
    const countByRunId = new Map(
      recordCounts.map((row) => [Number(row.run_id), Number(row.record_count) || 0])
    );
    const duplicateCountByRunId = new Map();
    duplicateSlots.forEach((row) => {
      const runId = Number(row.run_id);
      duplicateCountByRunId.set(
        runId,
        (duplicateCountByRunId.get(runId) || 0) + Math.max(0, Number(row.slot_count) - 1)
      );
    });
    const newRunStarts = runs
      .filter((run) => String(run.idempotency_key_hash || '').trim())
      .map((run) => Number(run.id));
    const firstNewRunId = newRunStarts.length ? Math.min(...newRunStarts) : null;

    const details = runs.map((run) => {
      const runId = Number(run.id);
      const plannedRecordCount = Number(run.planned_record_count) || 0;
      const actualRecordCount = countByRunId.get(runId) || 0;
      const missingRecordCount = Math.max(0, plannedRecordCount - actualRecordCount);
      const duplicateRecordCount = duplicateCountByRunId.get(runId) || 0;
      const cachedRows = parseJsonArray(run.imported_rows);
      const countMismatch = actualRecordCount !== plannedRecordCount || duplicateRecordCount > 0;
      const persistedStatus = run.integrity_status || 'complete';
      const integrityStatus = persistedStatus !== 'complete'
        ? persistedStatus
        : countMismatch
          ? (run.completed_at && cachedRows.length > 0 ? 'snapshot_only' : 'missing_records')
          : 'complete';
      return {
        runId,
        projectId: Number(run.project_id),
        plannedRecordCount,
        actualRecordCount,
        integrityStatus,
        persistedIntegrityStatus: persistedStatus,
        missingRecordCount,
        missingRecordIds: [],
        duplicateRecordCount,
        duplicateRecordIds: [],
        ownershipConflictIds: [],
        assignments: [],
        isNewRun: Boolean(String(run.idempotency_key_hash || '').trim())
      };
    });
    const newRunDanglingRecords = firstNewRunId === null
      ? []
      : danglingRecords.filter((record) => Number(record.question_set_run_id) >= firstNewRunId);

    return {
      legacy_column_present: false,
      ownership_columns_present: await this.hasOwnershipColumns(database),
      native_run_count: details.length,
      complete_run_count: details.filter((detail) => detail.integrityStatus === 'complete').length,
      snapshot_only_run_count: details.filter((detail) => detail.integrityStatus === 'snapshot_only').length,
      integrity_failed_run_count: details.filter((detail) => detail.integrityStatus === 'missing_records').length,
      missing_record_reference_count: details.reduce(
        (total, detail) => total + detail.missingRecordCount,
        0
      ),
      duplicate_record_reference_count: details.reduce(
        (total, detail) => total + detail.duplicateRecordCount,
        0
      ),
      ownership_conflict_count: 0,
      dangling_owned_record_count: danglingRecords.length,
      new_run_dangling_reference_count: newRunDanglingRecords.length,
      new_run_integrity_issue_count: details.filter(
        (detail) => detail.isNewRun && detail.integrityStatus !== 'complete'
      ).length,
      migration_required: false,
      details
    };
  }

  async audit(options = {}) {
    const Database = options.sequelize || sequelize;
    const legacyColumnPresent = await this.hasLegacyColumn(Database);
    if (!legacyColumnPresent) {
      return this.auditCurrentOwnership(Database);
    }

    const allRuns = await this.loadLegacyRuns(Database);
    const nativeRuns = allRuns.filter((run) => run.source === 'native');
    const allReferencedIds = Array.from(new Set(
      nativeRuns.flatMap((run) => normalizeLegacyIds(run.record_ids))
    ));
    const ownershipColumnsPresent = await this.hasOwnershipColumns(Database);
    const records = [];
    const quotedRecords = Database.getQueryInterface().queryGenerator.quoteTable('question_records');
    for (let offset = 0; offset < allReferencedIds.length; offset += 500) {
      const ids = allReferencedIds.slice(offset, offset + 500);
      const ownershipSelect = ownershipColumnsPresent
        ? 'question_set_run_id, run_slot_index'
        : 'NULL AS question_set_run_id, NULL AS run_slot_index';
      const chunk = await Database.query(
        `SELECT id, ${ownershipSelect}
         FROM ${quotedRecords}
         WHERE id IN (:recordIds)`,
        {
          replacements: { recordIds: ids },
          type: QueryTypes.SELECT
        }
      );
      records.push(...chunk);
    }
    const recordsById = new Map(records.map((record) => [Number(record.id), record]));
    const firstRunByRecordId = new Map();
    const crossRunConflicts = new Set();
    for (const run of nativeRuns) {
      for (const recordId of normalizeLegacyIds(run.record_ids)) {
        const firstRunId = firstRunByRecordId.get(recordId);
        if (firstRunId && firstRunId !== Number(run.id)) {
          crossRunConflicts.add(recordId);
        } else if (!firstRunId) {
          firstRunByRecordId.set(recordId, Number(run.id));
        }
      }
    }

    const details = nativeRuns.map((run) => {
      const recordIds = normalizeLegacyIds(run.record_ids);
      const seenIds = new Set();
      const duplicateRecordIds = [];
      const missingRecordIds = [];
      const ownershipConflictIds = [];
      const assignments = [];
      recordIds.forEach((recordId, runSlotIndex) => {
        if (seenIds.has(recordId)) duplicateRecordIds.push(recordId);
        seenIds.add(recordId);
        const record = recordsById.get(recordId);
        if (!record) {
          missingRecordIds.push(recordId);
          return;
        }
        const existingRunId = Number(record.question_set_run_id) || null;
        const existingSlot = record.run_slot_index == null
          ? null
          : Number(record.run_slot_index);
        if (
          crossRunConflicts.has(recordId)
          || (existingRunId && existingRunId !== Number(run.id))
          || (
            existingRunId === Number(run.id)
            && existingSlot !== null
            && existingSlot !== runSlotIndex
          )
        ) {
          ownershipConflictIds.push(recordId);
          return;
        }
        assignments.push({ recordId, runSlotIndex });
      });
      const damaged = (
        missingRecordIds.length > 0
        || duplicateRecordIds.length > 0
        || ownershipConflictIds.length > 0
      );
      const integrityStatus = !damaged
        ? 'complete'
        : (hasFinalizedSnapshot(run) ? 'snapshot_only' : 'missing_records');
      return {
        runId: Number(run.id),
        projectId: Number(run.project_id),
        plannedRecordCount: recordIds.length,
        integrityStatus,
        missingRecordIds,
        duplicateRecordIds,
        ownershipConflictIds: Array.from(new Set(ownershipConflictIds)),
        assignments
      };
    });

    return {
      legacy_column_present: true,
      ownership_columns_present: ownershipColumnsPresent,
      native_run_count: nativeRuns.length,
      complete_run_count: details.filter((detail) => detail.integrityStatus === 'complete').length,
      snapshot_only_run_count: details.filter((detail) => detail.integrityStatus === 'snapshot_only').length,
      integrity_failed_run_count: details.filter((detail) => detail.integrityStatus === 'missing_records').length,
      missing_record_reference_count: details.reduce(
        (total, detail) => total + detail.missingRecordIds.length,
        0
      ),
      duplicate_record_reference_count: details.reduce(
        (total, detail) => total + detail.duplicateRecordIds.length,
        0
      ),
      ownership_conflict_count: crossRunConflicts.size + details.reduce(
        (total, detail) => total + detail.ownershipConflictIds
          .filter((recordId) => !crossRunConflicts.has(recordId))
          .length,
        0
      ),
      migration_required: details.length > 0,
      details
    };
  }

  async apply(options = {}) {
    const backupReference = String(options.backupReference || '').trim();
    if (!backupReference) {
      throw migrationError(
        '应用运行归属迁移前必须确认数据库备份',
        'BACKUP_CONFIRMATION_REQUIRED'
      );
    }

    const Database = options.sequelize || sequelize;
    const RecordRepository = options.QuestionRecord || QuestionRecord;
    const RunRepository = options.QuestionSetRun || QuestionSetRun;
    let audit = await this.audit({
      sequelize: Database
    });
    if (
      audit.duplicate_record_reference_count > 0
      || audit.ownership_conflict_count > 0
    ) {
      throw migrationError(
        '检测到重复记录引用或已有归属冲突，迁移已安全中止',
        'OWNERSHIP_MIGRATION_CONFLICT'
      );
    }
    const schema = audit.ownership_columns_present
      ? { addedColumns: [], addedIndexes: [] }
      : await this.prepareOwnershipSchema(Database);
    if (!audit.ownership_columns_present) {
      audit = await this.audit({ sequelize: Database });
    }

    let updatedRecordCount = 0;
    let updatedRunCount = 0;
    await Database.transaction(async (transaction) => {
      for (const detail of audit.details) {
        for (const assignment of detail.assignments) {
          const [updated] = await RecordRepository.update(
            {
              question_set_run_id: detail.runId,
              run_slot_index: assignment.runSlotIndex
            },
            {
              where: {
                id: assignment.recordId,
                [Op.or]: [
                  { question_set_run_id: null },
                  { question_set_run_id: detail.runId }
                ]
              },
              transaction
            }
          );
          if (updated !== 1) {
            throw migrationError(
              `记录 ${assignment.recordId} 的归属在迁移期间发生变化`,
              'OWNERSHIP_MIGRATION_RACE'
            );
          }
          updatedRecordCount += 1;
        }

        const missingCount = detail.missingRecordIds.length;
        const runPayload = {
          planned_record_count: detail.plannedRecordCount,
          integrity_status: detail.integrityStatus,
          integrity_missing_record_count: missingCount,
          integrity_error_code: detail.integrityStatus === 'snapshot_only'
            ? 'question_set_run_snapshot_only'
            : (
                detail.integrityStatus === 'missing_records'
                  ? 'question_set_run_integrity_missing_records'
                  : null
              )
        };
        if (detail.integrityStatus === 'missing_records') {
          runPayload.completed_at = new Date();
          runPayload.paused_at = null;
        }
        const [updated] = await RunRepository.update(
          runPayload,
          {
            where: { id: detail.runId, project_id: detail.projectId },
            transaction
          }
        );
        if (updated !== 1) {
          throw migrationError(
            `运行 ${detail.runId} 在迁移期间发生变化`,
            'OWNERSHIP_MIGRATION_RACE'
          );
        }
        updatedRunCount += 1;
      }
    });
    const legacyColumnDropped = await this.dropLegacyColumn(Database);

    return {
      backup_reference: backupReference,
      updated_run_count: updatedRunCount,
      updated_record_count: updatedRecordCount,
      legacy_column_dropped: legacyColumnDropped,
      schema,
      audit
    };
  }
}

module.exports = new QuestionSetRunOwnershipMigrationService();
