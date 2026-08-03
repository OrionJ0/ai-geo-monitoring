const { sequelize } = require('../models');
const {
  createConsultationRecordMigrationRunner
} = require('../modules/consultationRecords/migrations/ConsultationRecordMigrationRunner');

async function main() {
  const apply = process.argv.includes('--apply');
  const runner = createConsultationRecordMigrationRunner({ sequelize });
  const migration = apply ? await runner.apply() : await runner.audit();
  console.log(JSON.stringify({
    phase: apply ? 'migration_complete' : 'migration_audit',
    ...migration
  }, null, 2));
  if (!migration.ready) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      phase: 'migration_failed',
      code: error?.code || 'CONSULTATION_RECORD_MIGRATION_FAILED',
      message: error?.message || '咨询记录迁移失败'
    }));
    process.exitCode = 1;
  })
  .finally(async () => sequelize.close());
