require('dotenv').config({ quiet: true });

const sequelize = require('../config/database');
const {
  auditWebsiteFormConsultationConfig
} = require('../modules/websiteFormConsultations/config');
const {
  createWebsiteDataMigrationRunner
} = require('../modules/websiteFormConsultations/migrations/WebsiteDataMigrationRunner');

function commandError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const config = auditWebsiteFormConsultationConfig(process.env);
  if (config.moduleState === 'MISCONFIGURED') {
    throw commandError('官网表单模块配置审计失败', config.errorCode);
  }
  const runner = createWebsiteDataMigrationRunner({ sequelize });
  const migration = apply ? await runner.apply() : await runner.audit();
  if (!apply && !migration.ready) {
    throw commandError(
      '官网数据迁移结构未就绪，请先执行 migrate:website-data',
      'WEBSITE_DATA_SCHEMA_MISSING'
    );
  }
  process.stdout.write(JSON.stringify({
    phase: apply ? 'migration_complete' : 'migration_audit',
    configState: config.moduleState,
    ...migration
  }));
}

main()
  .catch((error) => {
    process.stderr.write(JSON.stringify({
      phase: 'migration_failed',
      errorCode: error?.code || 'WEBSITE_DATA_MIGRATION_FAILED',
      message: error?.message || '官网数据迁移失败'
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => {});
  });
