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
  MarketingOnDemandDashboardService
} = require('./services/MarketingOnDemandDashboardService');
const {
  BaiduTongjiService
} = require('./services/BaiduTongjiService');
const {
  BaiduTongjiCredentialService
} = require('./services/BaiduTongjiCredentialService');

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
    const tongjiCredentialService = new BaiduTongjiCredentialService({
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
      async listSites({ connection }) {
        return tongjiCredentialService.listSites(connection.id);
      }
    };
    const reportProvider = {
      async fetchSearchReports(request) {
        return baiduProvider.fetchSearchReports({
          ...request,
          accessToken: await connectionService.getAccessToken(
            request.connection.id
          )
        });
      }
    };
    const resolveTongjiSite = async (connection) => {
      const credential = await tongjiCredentialService.getCredential(
        connection.id
      );
      const sites = await baiduProvider.listTongjiSites({
        accountName: credential.accountName,
        accessToken: credential.accessToken
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
        accountName: credential.accountName,
        accessToken: credential.accessToken,
        site
      };
    };
    const readBoundTongjiContext = async (connection) => {
      const credential = await tongjiCredentialService.getCredential(
        connection.id
      );
      return {
        accountName: credential.accountName,
        accessToken: credential.accessToken,
        site: {
          siteId: connection.tongji_site_id,
          domain: connection.tongji_site_domain,
          status: 'ACTIVE'
        }
      };
    };
    const tongjiProvider = {
      async readTrafficSnapshot({
        connection,
        coverage,
        device,
        includeQuality = false,
        includeSources = false
      }) {
        const context = await resolveTongjiSite(connection);
        const common = {
          accountName: context.accountName,
          accessToken: context.accessToken,
          siteId: context.site.siteId,
          coverage,
          device
        };
        const [
          allTrend,
          quality,
          sourceSummaries,
          engineSummaries
        ] = await Promise.all([
          baiduProvider.fetchTongjiTrend(common),
          includeQuality
            && manifest.tongji?.qualityMetrics?.runtimeEnabled === true
            ? baiduProvider.fetchTongjiQualityTrend(common)
            : Promise.resolve(null),
          includeSources
            && manifest.tongji?.sourceReports?.runtimeEnabled === true
            ? baiduProvider.fetchTongjiSourceSummary({
                ...common,
                reportKey: 'ALL'
              })
            : Promise.resolve([]),
          includeSources
            && manifest.tongji?.sourceReports?.runtimeEnabled === true
            ? baiduProvider.fetchTongjiSourceSummary({
                ...common,
                reportKey: 'ENGINE'
              })
            : Promise.resolve([])
        ]);
        return {
          site: context.site,
          allTrend,
          quality,
          sourceReportsIncluded: includeSources,
          sourceSummaries,
          engineSummaries
        };
      },
      async readSourceTrend({
        connection,
        coverage,
        device,
        sourceKey,
        selectors
      }) {
        const context = await readBoundTongjiContext(connection);
        const common = {
          accountName: context.accountName,
          accessToken: context.accessToken,
          siteId: context.site.siteId,
          coverage,
          device
        };
        const read = (key) => baiduProvider.fetchTongjiTrend({
          ...common,
          sourceKey: key
        });
        const dates = [];
        const coverageEnd = Date.parse(`${coverage.to}T00:00:00.000Z`);
        for (
          let timestamp = Date.parse(`${coverage.from}T00:00:00.000Z`);
          timestamp <= coverageEnd;
          timestamp += 86_400_000
        ) {
          dates.push(new Date(timestamp).toISOString().slice(0, 10));
        }
        const sumRows = (series) => {
          const maps = series.map((rows) => new Map(
            rows.map((row) => [row.date, row])
          ));
          const sumMetric = (date, metric) => {
            const values = maps.map((rows) => rows.get(date)?.[metric] ?? null);
            if (values.some((value) => value == null)) return null;
            return values.reduce(
              (total, value) => total + BigInt(value),
              0n
            ).toString();
          };
          return dates.map((date) => ({
            date,
            pageviews: sumMetric(date, 'pageviews'),
            visits: sumMetric(date, 'visits'),
            visitors: sumMetric(date, 'visitors')
          }));
        };
        const missingRows = () => dates.map((date) => ({
          date,
          pageviews: null,
          visits: null,
          visitors: null
        }));
        let rows;
        if (sourceKey === 'BAIDU_SEARCH') {
          rows = await read('BAIDU_NATURAL');
        } else if (sourceKey === 'DIRECT') {
          rows = await read('DIRECT');
        } else if (sourceKey === 'BING_SEARCH') {
          const bingSeries = await Promise.all(
            (selectors?.bingEngineIds || []).map((id) => read(`ENGINE:${id}`))
          );
          rows = bingSeries.length ? sumRows(bingSeries) : missingRows();
        } else if (sourceKey === 'OTHER') {
          const [otherSearch, external, ...bingSeries] = await Promise.all([
            read('OTHER_SEARCH'),
            read('EXTERNAL'),
            ...(selectors?.bingEngineIds || []).map((id) => read(`ENGINE:${id}`))
          ]);
          const bing = bingSeries.length
            ? sumRows(bingSeries)
            : missingRows();
          const otherByDate = new Map(otherSearch.map((row) => [row.date, row]));
          const externalByDate = new Map(external.map((row) => [row.date, row]));
          const bingByDate = new Map(bing.map((row) => [row.date, row]));
          rows = dates.map((date) => {
            const subtractBing = (metric) => {
              const values = [
                otherByDate.get(date)?.[metric],
                externalByDate.get(date)?.[metric],
                bingByDate.get(date)?.[metric]
              ];
              if (values.some((value) => value == null)) return null;
              return BigInt(values[0]) + BigInt(values[1]) - BigInt(values[2]);
            };
            const pageviews = subtractBing('pageviews');
            const visits = subtractBing('visits');
            if (pageviews < 0n || visits < 0n) {
              throw new BaiduMarketingError(
                '百度统计来源拆分结果无效',
                'BAIDU_TONGJI_RESPONSE_INVALID',
                502
              );
            }
            return {
              date,
              pageviews: pageviews?.toString() ?? null,
              visits: visits?.toString() ?? null,
              visitors: null
            };
          });
        } else {
          throw new BaiduMarketingError(
            '百度统计来源筛选无效',
            'BAIDU_TONGJI_SOURCE_INVALID',
            400
          );
        }
        return { site: context.site, sourceKey, rows };
      },
      async readPageReport({ connection, coverage, device, view }) {
        const context = await readBoundTongjiContext(connection);
        return baiduProvider.fetchTongjiPageReport({
          accountName: context.accountName,
          accessToken: context.accessToken,
          siteId: context.site.siteId,
          coverage,
          device,
          view
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
      siteDirectory,
      allowedProjectIds: env.MARKETING_MONITORING_ALLOWED_PROJECT_IDS
    });
    authorizationRouter.use(requireReady);
    authorizationRouter.use(createBaiduAuthorizationRouter({
      service: authorizationService
    }));
    authorizationRouter.use(createBaiduBindingRouter({
      service: bindingService,
      tongjiCredentialService,
      includeBindings: false,
      accountRoute: '/connections/:connectionId/accounts',
      siteRoute: '/connections/:connectionId/accounts/:accountId/tongji-sites'
    }));
    if ([
      'READY',
      'PILOT_DATA_READY'
    ].includes(configuredOperationalState)) {
      const dashboardReader = new MarketingDashboardService({
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
        allowedProjectIds: env.MARKETING_MONITORING_ALLOWED_PROJECT_IDS,
        capabilities: {
          sourceTraffic: manifest.tongji?.sourceReports?.runtimeEnabled === true,
          qualityMetrics: manifest.tongji?.qualityMetrics?.runtimeEnabled === true,
          pageReports: manifest.tongji?.pageReports?.runtimeEnabled === true
        }
      });
      executor = new MarketingExecutor({
        sequelize,
        refreshService
      });
      const dashboardService = new MarketingOnDemandDashboardService({
        dashboardService: dashboardReader,
        refreshService,
        executeRefresh: async (runId) => {
          const outcome = await executor.enqueue(runId);
          if (!outcome?.ok) throw outcome?.error;
          return outcome.value;
        }
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
