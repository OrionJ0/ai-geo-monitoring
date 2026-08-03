const express = require('express');
const { WebsiteFormRecordAdapter } = require('./adapters/WebsiteFormRecordAdapter');
const { Kf53ConversationAdapter } = require('./adapters/Kf53ConversationAdapter');
const {
  createConsultationRecordRouter
} = require('./routes/consultationRecordRoutes');
const {
  SequelizeConsultationAccessLogRepository
} = require('./repositories/SequelizeConsultationAccessLogRepository');
const {
  ConsultationProjectAccessService
} = require('./services/ConsultationProjectAccessService');
const {
  ConsultationRecordService
} = require('./services/ConsultationRecordService');
const {
  createConsultationRecordMigrationRunner
} = require('./migrations/ConsultationRecordMigrationRunner');
const {
  ConsultationRecordError
} = require('./contracts/consultationRecordContract');

function createDefaultAuditor(sequelize) {
  return {
    async audit() {
      if (!sequelize) return { ready: false };
      return createConsultationRecordMigrationRunner({ sequelize }).audit();
    }
  };
}

function createConsultationRecordModule({
  sequelize,
  adapters = null,
  websiteProjectId = null,
  websiteSourceClient = null,
  migrationAuditor = null,
  auditRepository = null,
  accessService = null
} = {}) {
  if (!sequelize || typeof sequelize.query !== 'function') {
    throw new TypeError('咨询记录模块缺少数据库连接');
  }
  const sourceAdapters = adapters || [
    new WebsiteFormRecordAdapter({
      configuredProjectId: websiteProjectId,
      sourceClient: websiteSourceClient
    }),
    new Kf53ConversationAdapter()
  ];
  const schemaAuditor = migrationAuditor || createDefaultAuditor(sequelize);
  const auditLogRepository = auditRepository
    || new SequelizeConsultationAccessLogRepository({ sequelize });
  const projectAccessService = accessService
    || new ConsultationProjectAccessService({ sequelize });
  const recordService = new ConsultationRecordService({
    adapters: sourceAdapters,
    auditRepository: auditLogRepository
  });

  async function getStatus() {
    const sources = await recordService.readSourceStatuses();
    let detailAuditState = 'SCHEMA_MISSING';
    try {
      const schema = await schemaAuditor.audit();
      if (schema.ready) detailAuditState = 'READY';
    } catch {
      detailAuditState = 'SCHEMA_MISSING';
    }
    return {
      moduleState: 'PARTIAL',
      detailAuditState,
      sources
    };
  }

  async function assertAuditReady() {
    try {
      const schema = await schemaAuditor.audit();
      if (schema.ready) return;
    } catch {
      // The stable fail-closed error below intentionally hides DB details.
    }
    throw new ConsultationRecordError(
      '咨询详情审计暂时不可用',
      'CONSULTATION_DETAIL_AUDIT_SCHEMA_MISSING',
      503
    );
  }

  const router = express.Router();
  router.get('/status', async (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    return res.json(await getStatus());
  });
  router.use(createConsultationRecordRouter({
    accessService: projectAccessService,
    recordService,
    assertAuditReady
  }));
  return { getStatus, router };
}

module.exports = { createConsultationRecordModule };
