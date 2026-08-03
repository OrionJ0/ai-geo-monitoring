const express = require('express');
const {
  adminRequired: defaultAdminRequired
} = require('../../../middleware/auth');

function sendError(res, error) {
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
  adminRequired = defaultAdminRequired,
  includeAccounts = true,
  includeBindings = true,
  accountRoute = '/admin/baidu/connections/:connectionId/accounts',
  siteRoute = '/admin/baidu/connections/:connectionId/accounts/:accountId/tongji-sites'
}) {
  const router = express.Router();

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
      try {
        return res.json(await service.resumeBinding({
          projectId: req.params.projectId,
          bindingId: req.params.bindingId
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
