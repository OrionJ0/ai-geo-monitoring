const fs = require('node:fs');
const path = require('node:path');
const sequelize = require('../config/database');
const migrationService = require('../services/GeoMetricSemanticsMigrationService');

function argumentValue(name) {
  const prefix = `${name}=`;
  const entry = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length).trim() : '';
}

async function main() {
  const apply = process.argv.includes('--apply');
  const backupReference = argumentValue('--backup-reference');
  await sequelize.authenticate();

  const preflight = await migrationService.audit({ sequelize });
  if (!apply) {
    process.stdout.write(JSON.stringify({
      phase: 'preflight_audit',
      ...preflight
    }));
    return;
  }

  if (sequelize.getDialect() === 'sqlite') {
    const backupPath = backupReference ? path.resolve(backupReference) : '';
    const backup = backupPath && fs.existsSync(backupPath)
      ? fs.statSync(backupPath)
      : null;
    if (!backup?.isFile() || backup.size <= 0) {
      const error = new Error(
        'SQLite 迁移要求 --backup-reference 指向已存在的非空备份文件'
      );
      error.code = 'BACKUP_FILE_REQUIRED';
      throw error;
    }
  }

  const result = await migrationService.apply({
    sequelize,
    backupReference
  });
  process.stdout.write(JSON.stringify({
    phase: 'migration_complete',
    ...result
  }));
}

main()
  .catch((error) => {
    process.stderr.write(JSON.stringify({
      phase: 'migration_failed',
      error_code: error?.code || 'GEO_METRIC_SEMANTICS_MIGRATION_FAILED',
      message: error?.message || 'GEO 指标语义迁移失败'
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => {});
  });
