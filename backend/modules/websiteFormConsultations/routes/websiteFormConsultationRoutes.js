const express = require('express');
const {
  GatoWebsiteError
} = require('../adapters/GatoWebsiteClient');
const {
  WebsiteFormConsultationError
} = require('../services/WebsiteFormConsultationService');

function sendError(res, error) {
  const trusted = error instanceof WebsiteFormConsultationError
    || error instanceof GatoWebsiteError;
  const status = trusted && Number.isInteger(error.status)
    ? error.status
    : 500;
  return res.status(status).json({
    error: {
      code: trusted && typeof error.code === 'string'
        ? error.code
        : 'WEBSITE_FORM_CONSULTATION_FAILED',
      message: trusted && status < 500
        ? error.message
        : '官网表单咨询暂时不可用'
    }
  });
}

function createWebsiteFormConsultationRouter({
  accessService,
  consultationService
}) {
  if (
    !accessService
    || typeof accessService.assertAccess !== 'function'
    || !consultationService
    || typeof consultationService.read !== 'function'
    || typeof consultationService.readDaily !== 'function'
  ) {
    throw new TypeError('官网表单咨询路由配置无效');
  }
  const router = express.Router();
  router.get(
    '/projects/:projectId/form-consultations',
    async (req, res) => {
      try {
        await accessService.assertAccess({
          projectId: req.params.projectId,
          user: req.user
        });
        const result = await consultationService.read({
          projectId: req.params.projectId,
          from: req.query.from,
          to: req.query.to
        });
        res.set('Cache-Control', 'private, max-age=60');
        return res.json(result);
      } catch (error) {
        return sendError(res, error);
      }
    }
  );
  router.get(
    '/projects/:projectId/form-consultation-days',
    async (req, res) => {
      try {
        await accessService.assertAccess({
          projectId: req.params.projectId,
          user: req.user
        });
        const result = await consultationService.readDaily({
          projectId: req.params.projectId,
          from: req.query.from,
          to: req.query.to
        });
        res.set('Cache-Control', 'private, max-age=60');
        return res.json(result);
      } catch (error) {
        return sendError(res, error);
      }
    }
  );
  return router;
}

module.exports = { createWebsiteFormConsultationRouter };
