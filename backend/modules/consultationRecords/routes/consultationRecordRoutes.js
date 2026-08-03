const express = require('express');
const {
  ConsultationRecordError,
  normalizeListQuery
} = require('../contracts/consultationRecordContract');

function sendError(res, error) {
  const trusted = error instanceof ConsultationRecordError;
  const status = trusted && Number.isInteger(error.status)
    ? error.status
    : 502;
  const code = trusted && typeof error.code === 'string'
    ? error.code
    : 'CONSULTATION_RECORD_FAILED';
  const message = trusted && status < 500
    ? error.message
    : trusted && code.startsWith('CONSULTATION_DETAIL_AUDIT_')
      ? '咨询详情审计暂时不可用'
      : status === 503
        ? '咨询记录暂时不可用'
        : '咨询记录读取失败';
  return res.status(status).json({
    error: {
      code,
      message
    }
  });
}

function validRecordId(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function createConsultationRecordRouter({
  accessService,
  recordService,
  assertAuditReady
}) {
  if (
    !accessService
    || typeof accessService.assertAccess !== 'function'
    || !recordService
    || typeof recordService.list !== 'function'
    || typeof recordService.detail !== 'function'
    || typeof assertAuditReady !== 'function'
  ) throw new TypeError('咨询记录路由配置无效');

  const router = express.Router();
  router.get('/projects/:projectId/records', async (req, res) => {
    try {
      await accessService.assertAccess({
        projectId: req.params.projectId,
        user: req.user
      });
      const result = await recordService.list({
        projectId: req.params.projectId,
        query: normalizeListQuery(req.query)
      });
      res.set('Cache-Control', 'private, no-store');
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/projects/:projectId/records/:recordId', async (req, res) => {
    try {
      await accessService.assertAccess({
        projectId: req.params.projectId,
        user: req.user
      });
      if (!validRecordId(req.params.recordId)) {
        throw new ConsultationRecordError(
          '咨询记录不存在',
          'CONSULTATION_RECORD_NOT_FOUND',
          404
        );
      }
      await assertAuditReady();
      const result = await recordService.detail({
        projectId: req.params.projectId,
        recordId: req.params.recordId,
        userId: req.user?.id
      });
      res.set('Cache-Control', 'private, no-store');
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });
  return router;
}

module.exports = { createConsultationRecordRouter };
