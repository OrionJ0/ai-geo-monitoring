const express = require('express');
const { auditMarketingConfig } = require('./config');
const {
  loadBaiduContract
} = require('./contracts/baidu/loadBaiduContract');
const {
  createMarketingStatusRouter
} = require('./routes/marketingStatusRoutes');
const {
  createBaiduAuthorizationRouter
} = require('./routes/baiduAuthorizationRoutes');
const {
  createBaiduBindingRouter
} = require('./routes/baiduBindingRoutes');
const {
  createMarketingDashboardRouter
} = require('./routes/marketingDashboardRoutes');
const {
  BaiduMarketingClient
} = require('./adapters/BaiduMarketingClient');
const {
  BaiduAuthorizationService
} = require('./services/BaiduAuthorizationService');
const {
  BaiduConnectionService
} = require('./services/BaiduConnectionService');
const {
  BaiduBindingService
} = require('./services/BaiduBindingService');
const {
  MarketingDashboardService
} = require('./services/MarketingDashboardService');
const {
  MarketingRefreshService
} = require('./services/MarketingRefreshService');
const {
  MarketingExecutor
} = require('./services/MarketingExecutor');

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
  migrationAuditor = null,
  contractLoader = loadBaiduContract,
  provider = null
} = {}) {
  const configAudit = auditMarketingConfig(
    env,
    { contractLoader }
  );
  const schemaAuditor = migrationAuditor || createDefaultMigrationAuditor(sequelize);
  let runtimeErrorCode = null;
  let executor = null;

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

    if (runtimeErrorCode) {
      return {
        moduleState: 'RECOVERY_FAILED',
        errorCode: runtimeErrorCode
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

  const router = express.Router();
  router.use(createMarketingStatusRouter({ getStatus }));
  const authorizationRouter = express.Router();
  const requireReady = async (_req, res, next) => {
    const status = await getStatus();
    if (status.moduleState === 'READY') return next();
    return res.status(503).json({
      error: {
        code: status.errorCode || 'MARKETING_MODULE_DISABLED',
        message: '营销模块当前不可用'
      }
    });
  };

  if (configAudit.moduleState === 'READY' && sequelize) {
    const manifest = contractLoader(env.BAIDU_MARKETING_CONTRACT_VERSION);
    const baiduProvider = provider || new BaiduMarketingClient({ manifest });
    const connectionService = new BaiduConnectionService({
      sequelize,
      provider: baiduProvider,
      encryptionKey: env.CONFIG_ENCRYPTION_KEY
    });
    const accountDirectory = {
      async listAccounts({ connection }) {
        return baiduProvider.listAccounts({
          connection,
          accessToken: await connectionService.getAccessToken(connection.id)
        });
      }
    };
    const reportProvider = {
      async fetchSearchReport(request) {
        return baiduProvider.fetchSearchReport({
          ...request,
          accessToken: await connectionService.getAccessToken(
            request.connection.id
          )
        });
      }
    };
    const authorizationService = new BaiduAuthorizationService({
      sequelize,
      provider: baiduProvider,
      encryptionKey: env.CONFIG_ENCRYPTION_KEY
    });
    const bindingService = new BaiduBindingService({
      sequelize,
      accountDirectory,
      allowedProjectIds: env.MARKETING_MONITORING_ALLOWED_PROJECT_IDS
    });
    const dashboardService = new MarketingDashboardService({
      sequelize,
      allowedProjectIds: env.MARKETING_MONITORING_ALLOWED_PROJECT_IDS
    });
    const refreshService = new MarketingRefreshService({
      sequelize,
      reportProvider,
      contractVersion: manifest.contractVersion,
      currencyCode: manifest.money?.currencyCode,
      costScale: manifest.money?.costScale
    });
    executor = new MarketingExecutor({
      sequelize,
      refreshService
    });
    authorizationRouter.use(requireReady);
    authorizationRouter.use(createBaiduAuthorizationRouter({
      service: authorizationService
    }));
    authorizationRouter.use(createBaiduBindingRouter({
      service: bindingService,
      includeBindings: false,
      accountRoute: '/connections/:connectionId/accounts'
    }));
    router.use(requireReady);
    router.use(createBaiduBindingRouter({
      service: bindingService,
      includeAccounts: false
    }));
    router.use(createMarketingDashboardRouter({
      dashboardService,
      refreshService,
      enqueue: (runId) => executor.enqueue(runId)
    }));
  } else {
    authorizationRouter.use((_req, res) => res.status(503).json({
      error: {
        code: configAudit.errorCode || 'MARKETING_MODULE_DISABLED',
        message: '营销模块当前不可用'
      }
    }));
  }

  async function start() {
    const status = await getStatus();
    if (status.moduleState !== 'READY' || !executor) return status;
    try {
      await executor.start();
      return getStatus();
    } catch (error) {
      runtimeErrorCode = error?.code || 'MARKETING_RECOVERY_FAILED';
      return getStatus();
    }
  }

  async function shutdown() {
    await executor?.stop();
  }

  return {
    getStatus,
    router,
    authorizationRouter,
    start,
    shutdown
  };
}

module.exports = {
  createMarketingModule
};
