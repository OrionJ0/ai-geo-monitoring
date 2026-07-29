require('dotenv').config({ quiet: true });

const sequelize = require('../config/database');
const {
  auditMarketingConfig
} = require('../modules/marketing/config');
const {
  createMarketingMigrationRunner
} = require('../modules/marketing/migrations/MarketingMigrationRunner');

function commandError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const config = auditMarketingConfig(process.env);
  if (config.moduleState === 'MISCONFIGURED') {
    throw commandError('营销模块配置审计失败', config.errorCode);
  }

  const runner = createMarketingMigrationRunner({ sequelize });
  const migration = apply ? await runner.apply() : await runner.audit();
  if (!apply && !migration.ready) {
    throw commandError(
      '营销迁移结构未就绪，请先执行 migrate:marketing',
      'MARKETING_SCHEMA_MISSING'
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
      errorCode: error?.code || 'MARKETING_MIGRATION_FAILED',
      message: error?.message || '营销迁移失败'
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => {});
  });
