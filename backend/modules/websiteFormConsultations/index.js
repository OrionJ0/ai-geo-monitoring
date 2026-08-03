const express = require('express');
const {
  loadWebsiteFormConsultationConfig
} = require('./config');
const {
  GatoWebsiteClient
} = require('./adapters/GatoWebsiteClient');
const {
  SequelizeWebsiteFormSnapshotRepository
} = require('./repositories/SequelizeWebsiteFormSnapshotRepository');
const {
  WebsiteFormConsultationService
} = require('./services/WebsiteFormConsultationService');
const {
  WebsiteFormProjectAccessService
} = require('./services/WebsiteFormProjectAccessService');
const {
  createWebsiteFormConsultationRouter
} = require('./routes/websiteFormConsultationRoutes');

function createDefaultMigrationAuditor(sequelize) {
  return {
    async audit() {
      if (!sequelize) return { ready: false };
      const {
        createWebsiteDataMigrationRunner
      } = require('./migrations/WebsiteDataMigrationRunner');
      return createWebsiteDataMigrationRunner({ sequelize }).audit();
    }
  };
}

function statusPayload(moduleState, errorCode) {
  return {
    moduleState,
    errorCode,
    sourceSystem: 'GATO_WEBSITE',
    consultationType: 'WEBSITE_FORM'
  };
}

function createWebsiteFormConsultationModule({
  env = process.env,
  sequelize = null,
  migrationAuditor = null,
  sourceClient = null,
  snapshotRepository = null
} = {}) {
  const config = loadWebsiteFormConsultationConfig(env);
  const schemaAuditor = migrationAuditor
    || createDefaultMigrationAuditor(sequelize);

  async function getStatus() {
    if (config.audit.moduleState === 'DISABLED') {
      return statusPayload('DISABLED', null);
    }
    if (config.audit.moduleState === 'MISCONFIGURED') {
      return statusPayload('MISCONFIGURED', config.audit.errorCode);
    }
    try {
      const schema = await schemaAuditor.audit();
      return schema.ready
        ? statusPayload('READY', null)
        : statusPayload('SCHEMA_MISSING', 'WEBSITE_DATA_SCHEMA_MISSING');
    } catch {
      return statusPayload(
        'SCHEMA_MISSING',
        'WEBSITE_DATA_SCHEMA_AUDIT_FAILED'
      );
    }
  }

  const router = express.Router();
  router.get('/status', async (_req, res) => res.json(await getStatus()));

  const requireReady = async (_req, res, next) => {
    const status = await getStatus();
    if (status.moduleState === 'READY') return next();
    return res.status(503).json({
      error: {
        code: status.errorCode || 'WEBSITE_FORM_MODULE_DISABLED',
        message: '官网表单咨询模块当前不可用'
      }
    });
  };

  let activeSourceClient = null;
  if (config.audit.moduleState === 'READY' && sequelize) {
    const client = sourceClient || new GatoWebsiteClient({
      baseUrl: config.baseUrl,
      username: config.username,
      password: config.password,
      timeoutMs: config.httpTimeoutMs
    });
    activeSourceClient = client;
    const repository = snapshotRepository
      || new SequelizeWebsiteFormSnapshotRepository({ sequelize });
    const consultationService = new WebsiteFormConsultationService({
      sourceClient: client,
      snapshotRepository: repository,
      configuredProjectId: config.projectId,
      cacheTtlMs: config.cacheTtlMs,
      maxStaleMs: config.maxStaleMs
    });
    const accessService = new WebsiteFormProjectAccessService({
      sequelize,
      configuredProjectId: config.projectId
    });
    router.use(requireReady);
    router.use(createWebsiteFormConsultationRouter({
      accessService,
      consultationService
    }));
  } else {
    router.use(requireReady);
  }

  return {
    configuredProjectId: config.audit.moduleState === 'READY'
      ? config.projectId
      : null,
    getStatus,
    router,
    sourceClient: activeSourceClient
  };
}

module.exports = { createWebsiteFormConsultationModule };
