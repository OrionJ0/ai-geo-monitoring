const { auditMarketingConfig } = require('./config');
const {
  createMarketingStatusRouter
} = require('./routes/marketingStatusRoutes');

function createDefaultMigrationAuditor(sequelize) {
  return {
    async audit() {
      const {
        createMarketingMigrationRunner
      } = require('./migrations/MarketingMigrationRunner');
      return createMarketingMigrationRunner({ sequelize }).audit();
    }
  };
}

function createMarketingModule({
  env = process.env,
  sequelize = null,
  migrationAuditor = null
} = {}) {
  const configAudit = auditMarketingConfig(env);
  const schemaAuditor = migrationAuditor || createDefaultMigrationAuditor(sequelize);

  async function getStatus({ includeAdminDetails = false } = {}) {
    if (configAudit.moduleState === 'DISABLED') {
      return {
        moduleState: 'DISABLED',
        errorCode: null
      };
    }

    if (configAudit.moduleState === 'MISCONFIGURED') {
      return {
        moduleState: 'MISCONFIGURED',
        errorCode: configAudit.errorCode,
        ...(includeAdminDetails
          ? { missingKeys: [...configAudit.missingKeys] }
          : {})
      };
    }

    try {
      const schema = await schemaAuditor.audit();
      if (!schema.ready) {
        return {
          moduleState: 'SCHEMA_MISSING',
          errorCode: 'MARKETING_SCHEMA_MISSING'
        };
      }
      return {
        moduleState: 'READY',
        errorCode: null
      };
    } catch {
      return {
        moduleState: 'SCHEMA_MISSING',
        errorCode: 'MARKETING_SCHEMA_AUDIT_FAILED'
      };
    }
  }

  return {
    getStatus,
    router: createMarketingStatusRouter({ getStatus })
  };
}

module.exports = {
  createMarketingModule
};
