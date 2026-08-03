const express = require('express');
const { auditMarketingConfig } = require('./config');
const {
  loadBaiduContract
} = require('./contracts/baidu/loadBaiduContract');
const {
  withMarketingCapabilities
} = require('./marketingCapabilities');
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
  BaiduMarketingClient,
  BaiduMarketingError
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
const {
  BaiduTongjiService
} = require('./services/BaiduTongjiService');

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
  const configuredOperationalState = [
    'READY',
    'PILOT_READY',
    'PILOT_DATA_READY'
  ].includes(configAudit.moduleState)
    ? configAudit.moduleState
    : null;
  const schemaAuditor = migrationAuditor || createDefaultMigrationAuditor(sequelize);
  let runtimeErrorCode = null;
  let executor = null;

  async function getStatus({ includeAdminDetails = false } = {}) {
    if (configAudit.moduleState === 'DISABLED') {
      return withMarketingCapabilities({
        moduleState: 'DISABLED',
        errorCode: null
      });
    }

    if (configAudit.moduleState === 'MISCONFIGURED') {
      return withMarketingCapabilities({
        moduleState: 'MISCONFIGURED',
        errorCode: configAudit.errorCode,
        ...(includeAdminDetails
          ? { missingKeys: [...configAudit.missingKeys] }
          : {})
      });
    }

    if (runtimeErrorCode) {
      return withMarketingCapabilities({
        moduleState: 'RECOVERY_FAILED',
        errorCode: runtimeErrorCode
      });
    }

    try {
      const schema = await schemaAuditor.audit();
      if (!schema.ready) {
        return withMarketingCapabilities({
          moduleState: 'SCHEMA_MISSING',
          errorCode: 'MARKETING_SCHEMA_MISSING'
        });
      }
      return withMarketingCapabilities({
        moduleState: configuredOperationalState,
        errorCode: null
      });
    } catch {
      return withMarketingCapabilities({
        moduleState: 'SCHEMA_MISSING',
        errorCode: 'MARKETING_SCHEMA_AUDIT_FAILED'
      });
    }
  }

  const router = express.Router();
  router.use(createMarketingStatusRouter({ getStatus }));
  const authorizationRouter = express.Router();
  const requireReady = async (_req, res, next) => {
    const status = await getStatus();
    if ([
      'READY',
      'PILOT_READY',
      'PILOT_DATA_READY'
    ].includes(status.moduleState)) return next();
    return res.status(503).json({
      error: {
        code: status.errorCode || 'MARKETING_MODULE_DISABLED',
        message: '营销模块当前不可用'
      }
    });
  };

  if (configuredOperationalState && sequelize) {
    const manifest = contractLoader(env.BAIDU_MARKETING_CONTRACT_VERSION);
    const baiduProvider = provider || new BaiduMarketingClient({
      manifest,
      appId: env.BAIDU_MARKETING_APP_ID,
      secretKey: env.BAIDU_MARKETING_SECRET_KEY,
      scope: env.BAIDU_MARKETING_SCOPE,
      redirectUri: env.BAIDU_MARKETING_REDIRECT_URI,
      timeoutMs: Number(env.BAIDU_MARKETING_HTTP_TIMEOUT_MS)
    });
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
    const siteDirectory = {
      async listSites({ connection, account }) {
        return baiduProvider.listTongjiSites({
          accountName: account.accountName,
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
    const resolveTongjiSite = async (connection) => {
      const accessToken = await connectionService.getAccessToken(
        connection.id
      );
      const accounts = await baiduProvider.listAccounts({
        connection,
        accessToken
      });
      const account = accounts.find((item) => (
        item.accountId === String(connection.external_account_id)
      ));
      if (!account) {
        throw new BaiduMarketingError(
          '百度统计授权主体不在账户目录中',
          'BAIDU_TONGJI_ACCOUNT_INVALID',
          502
        );
      }
      const sites = await baiduProvider.listTongjiSites({
        accountName: account.accountName,
        accessToken
      });
      const site = sites.find((item) => (
        item.siteId === connection.tongji_site_id
      ));
      if (!site || site.status !== 'ACTIVE') {
        throw new BaiduMarketingError(
          '项目绑定的百度统计站点当前不可用',
          'BAIDU_TONGJI_SITE_NOT_AVAILABLE',
          409
        );
      }
      if (site.domain !== connection.tongji_site_domain) {
        throw new BaiduMarketingError(
          '项目绑定的百度统计站点域名已变化',
          'BAIDU_TONGJI_SITE_DOMAIN_CHANGED',
          409
        );
      }
      return {
        accountName: account.accountName,
        accessToken,
        site
      };
    };
    const tongjiProvider = {
      async readTrend({ connection, coverage }) {
        const context = await resolveTongjiSite(connection);
        return {
          site: context.site,
          rows: await baiduProvider.fetchTongjiTrend({
            accountName: context.accountName,
            accessToken: context.accessToken,
            siteId: context.site.siteId,
            coverage
          })
        };
      },
      async readSourceTrends({ connection, coverage, sourceKeys }) {
        const context = await resolveTongjiSite(connection);
        const sources = [];
        for (const sourceKey of sourceKeys) {
          sources.push({
            sourceKey,
            rows: await baiduProvider.fetchTongjiTrend({
              accountName: context.accountName,
              accessToken: context.accessToken,
              siteId: context.site.siteId,
              coverage,
              sourceKey
            })
          });
        }
        return {
          site: context.site,
          sources
        };
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
      siteDirectory,
      allowedProjectIds: env.MARKETING_MONITORING_ALLOWED_PROJECT_IDS
    });
    authorizationRouter.use(requireReady);
    authorizationRouter.use(createBaiduAuthorizationRouter({
      service: authorizationService
    }));
    authorizationRouter.use(createBaiduBindingRouter({
      service: bindingService,
      includeBindings: false,
      accountRoute: '/connections/:connectionId/accounts',
      siteRoute: '/connections/:connectionId/accounts/:accountId/tongji-sites'
    }));
    if ([
      'READY',
      'PILOT_DATA_READY'
    ].includes(configuredOperationalState)) {
      const dashboardService = new MarketingDashboardService({
        sequelize,
        allowedProjectIds: env.MARKETING_MONITORING_ALLOWED_PROJECT_IDS,
        moduleState: configuredOperationalState
      });
      const refreshService = new MarketingRefreshService({
        sequelize,
        reportProvider,
        contractVersion: manifest.contractVersion,
        currencyCode: manifest.money?.currencyCode,
        costScale: manifest.money?.costScale
      });
      const tongjiService = new BaiduTongjiService({
        sequelize,
        provider: tongjiProvider,
        allowedProjectIds: env.MARKETING_MONITORING_ALLOWED_PROJECT_IDS
      });
      executor = new MarketingExecutor({
        sequelize,
        refreshService
      });
      router.use(requireReady);
      router.use(createBaiduBindingRouter({
        service: bindingService,
        includeAccounts: false
      }));
      router.use(createMarketingDashboardRouter({
        dashboardService,
        refreshService,
        tongjiService,
        enqueue: (runId) => executor.enqueue(runId)
      }));
    } else {
      router.use((_req, res) => res.status(503).json({
        error: {
          code: 'MARKETING_PILOT_AUTH_ONLY',
          message: '试点模式仅开放百度授权与账户检查'
        }
      }));
    }
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
    if (
      !['READY', 'PILOT_DATA_READY'].includes(status.moduleState)
      || !executor
    ) return status;
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
