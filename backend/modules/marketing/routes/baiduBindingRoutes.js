const express = require('express');
const {
  adminRequired: defaultAdminRequired
} = require('../../../middleware/auth');

function sendError(res, error) {
  if (Number.isSafeInteger(error?.retryAfterSeconds)) {
    res.set('Retry-After', String(error.retryAfterSeconds));
  }
  return res.status(error?.status || 500).json({
    error: {
      code: error?.code || 'MARKETING_BINDING_FAILED',
      message: error?.status && error.status < 500
        ? error.message
        : '营销绑定暂时不可用'
    }
  });
}

function exactBody(body, keys) {
  return (
    body
    && typeof body === 'object'
    && !Array.isArray(body)
    && Object.keys(body).length === keys.length
    && keys.every((key) => Object.hasOwn(body, key))
  );
}

function createBaiduBindingRouter({
  service,
  tongjiContextService = null,
  adminRequired = defaultAdminRequired,
  includeAccounts = true,
  includeBindings = true,
  accountRoute = '/admin/baidu/connections/:connectionId/accounts',
  siteRoute = '/admin/baidu/connections/:connectionId/accounts/:accountId/tongji-sites'
}) {
  const router = express.Router();

  if (tongjiContextService) router.put(
    '/connections/:connectionId/tongji-context',
    adminRequired,
    async (req, res) => {
      if (!exactBody(req.body, ['userName'])) {
        return sendError(res, {
          status: 400,
          code: 'TONGJI_CONTEXT_REQUEST_INVALID',
          message: '百度统计用户名请求字段无效'
        });
      }
      try {
        res.set('Cache-Control', 'no-store');
        return res.json(await tongjiContextService.configure({
          connectionId: req.params.connectionId,
          userName: req.body.userName
        }));
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  if (includeAccounts) router.get(
    accountRoute,
    adminRequired,
    async (req, res) => {
      try {
        res.set('Cache-Control', 'no-store');
        return res.json(await service.listAccounts(req.params.connectionId));
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  if (includeAccounts) router.get(
    siteRoute,
    adminRequired,
    async (req, res) => {
      try {
        res.set('Cache-Control', 'no-store');
        return res.json(await service.listTongjiSites(
          req.params.connectionId,
          req.params.accountId
        ));
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  if (includeBindings) router.get(
    '/projects/:projectId/baidu-bindings',
    adminRequired,
    async (req, res) => {
      try {
        return res.json(await service.listBindings(req.params.projectId));
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  if (includeBindings) router.post(
    '/projects/:projectId/baidu-bindings',
    adminRequired,
    async (req, res) => {
      if (!exactBody(
        req.body,
        ['connectionId', 'externalAccountId', 'tongjiSiteId']
      )) {
        return sendError(res, {
          status: 400,
          code: 'BINDING_REQUEST_INVALID',
          message: '绑定请求字段无效'
        });
      }
      try {
        return res.status(201).json(await service.createBinding({
          projectId: req.params.projectId,
          adminId: req.user.id,
          connectionId: req.body.connectionId,
          externalAccountId: req.body.externalAccountId,
          tongjiSiteId: req.body.tongjiSiteId
        }));
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  if (includeBindings) router.post(
    '/projects/:projectId/baidu-bindings/:bindingId/pause',
    adminRequired,
    async (req, res) => {
      try {
        return res.json(await service.pauseBinding({
          projectId: req.params.projectId,
          bindingId: req.params.bindingId
        }));
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  if (includeBindings) router.post(
    '/projects/:projectId/baidu-bindings/:bindingId/resume',
    adminRequired,
    async (req, res) => {
      const emptyResumeBody = req.body == null || (
        typeof req.body === 'object'
        && !Array.isArray(req.body)
        && Object.keys(req.body).length === 0
      );
      if (
        !emptyResumeBody
        && !exactBody(req.body, ['tongjiSiteId'])
      ) {
        return sendError(res, {
          status: 400,
          code: 'BINDING_RESUME_REQUEST_INVALID',
          message: '恢复绑定请求字段无效'
        });
      }
      try {
        return res.json(await service.resumeBinding({
          projectId: req.params.projectId,
          bindingId: req.params.bindingId,
          tongjiSiteId: req.body?.tongjiSiteId || null
        }));
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  if (includeBindings) router.delete(
    '/projects/:projectId/baidu-bindings/:bindingId',
    adminRequired,
    async (req, res) => {
      try {
        return res.json(await service.deleteBinding({
          projectId: req.params.projectId,
          bindingId: req.params.bindingId
        }));
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  return router;
}

module.exports = {
  createBaiduBindingRouter
};
