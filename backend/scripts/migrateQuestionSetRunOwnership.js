const fs = require('node:fs');
const path = require('node:path');
const { sequelize } = require('../models');
const migrationService = require('../services/QuestionSetRunOwnershipMigrationService');

function argumentValue(name) {
  const prefix = `${name}=`;
  const entry = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length).trim() : '';
}

function publicAudit(audit) {
  const { details, ...summary } = audit;
  return {
    ...summary,
    runs: details.map((detail) => ({
      run_id: detail.runId,
      planned_record_count: detail.plannedRecordCount,
      integrity_status: detail.integrityStatus,
      missing_record_count: detail.missingRecordIds.length,
      duplicate_record_count: detail.duplicateRecordIds.length,
      ownership_conflict_count: detail.ownershipConflictIds.length
    }))
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const backupReference = argumentValue('--backup-reference');
  await sequelize.authenticate();

  const audit = await migrationService.audit({ sequelize });
  console.log(JSON.stringify({
    phase: 'preflight_audit',
    ...publicAudit(audit)
  }, null, 2));

  if (!apply) {
    console.log('只读审计完成；未传入 --apply，不会修改数据库。');
    return;
  }

  if (sequelize.getDialect() === 'sqlite') {
    const backupPath = path.resolve(backupReference);
    const backup = backupReference && fs.existsSync(backupPath)
      ? fs.statSync(backupPath)
      : null;
    if (!backup?.isFile() || backup.size <= 0) {
      const error = new Error('SQLite 迁移要求 --backup-reference 指向已存在的非空备份文件');
      error.code = 'BACKUP_FILE_REQUIRED';
      throw error;
    }
  }

  const result = await migrationService.apply({
    sequelize,
    backupReference
  });
  console.log(JSON.stringify({
    phase: 'migration_complete',
    backup_reference: result.backup_reference,
    updated_run_count: result.updated_run_count,
    updated_record_count: result.updated_record_count,
    legacy_column_dropped: result.legacy_column_dropped
  }, null, 2));
  const postflight = await migrationService.audit({ sequelize });
  console.log(JSON.stringify({
    phase: 'postflight_audit',
    ...publicAudit(postflight)
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      phase: 'migration_failed',
      error_code: error?.code || 'QUESTION_SET_RUN_OWNERSHIP_MIGRATION_FAILED',
      message: error?.message || '运行归属迁移失败'
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => {});
  });
