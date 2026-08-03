const express = require('express');

function sendError(res, error) {
  return res.status(error?.status || 500).json({
    error: {
      code: error?.code || 'MARKETING_DASHBOARD_FAILED',
      message: error?.status && error.status < 500
        ? error.message
        : '营销看板暂时不可用'
    }
  });
}

function createMarketingDashboardRouter({
  dashboardService,
  refreshService,
  tongjiService = null,
  enqueue = (runId) => {
    setImmediate(() => {
      refreshService.executeRun(runId).catch(() => {});
    });
  }
}) {
  const router = express.Router();

  router.get('/projects/:projectId/dashboard', async (req, res) => {
    try {
      await dashboardService.assertAccess({
        projectId: req.params.projectId,
        user: req.user
      });
      return res.json(await dashboardService.read({
        projectId: req.params.projectId,
        from: req.query.from,
        to: req.query.to
      }));
    } catch (error) {
      return sendError(res, error);
    }
  });

  if (tongjiService) router.get(
    '/projects/:projectId/tongji-trend',
    async (req, res) => {
      try {
        await dashboardService.assertAccess({
          projectId: req.params.projectId,
          user: req.user
        });
        res.set('Cache-Control', 'private, no-store');
        return res.json(await tongjiService.readProjectTrend(
          req.params.projectId
        ));
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  if (tongjiService) router.get(
    '/projects/:projectId/tongji-source-trends',
    async (req, res) => {
      try {
        await dashboardService.assertAccess({
          projectId: req.params.projectId,
          user: req.user
        });
        res.set('Cache-Control', 'private, no-store');
        return res.json(await tongjiService.readProjectSourceTrends(
          req.params.projectId
        ));
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  router.post('/projects/:projectId/refresh-runs', async (req, res) => {
    if (
      !req.body
      || typeof req.body !== 'object'
      || Array.isArray(req.body)
      || Object.keys(req.body).length !== 1
      || !Object.hasOwn(req.body, 'triggerType')
    ) {
      return sendError(res, {
        status: 400,
        code: 'REFRESH_REQUEST_INVALID',
        message: '刷新请求字段无效'
      });
    }
    try {
      await dashboardService.assertAccess({
        projectId: req.params.projectId,
        user: req.user
      });
      const run = await refreshService.createRun({
        projectId: req.params.projectId,
        triggerType: req.body.triggerType,
        userId: req.user.id
      });
      const location = (
        `/api/marketing/projects/${req.params.projectId}`
        + `/refresh-runs/${run.runId}`
      );
      res.set('Location', location);
      res.set('Retry-After', '2');
      try {
        enqueue(run.runId);
      } catch (error) {
        await refreshService.rejectQueuedRun(
          run.runId,
          error?.code || 'MARKETING_EXECUTOR_REJECTED'
        );
        error.status = 503;
        throw error;
      }
      return res.status(202).json(run);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get(
    '/projects/:projectId/refresh-runs/:runId',
    async (req, res) => {
      try {
        await dashboardService.assertAccess({
          projectId: req.params.projectId,
          user: req.user
        });
        res.set('Retry-After', '2');
        return res.json(await refreshService.getRun(
          req.params.projectId,
          req.params.runId
        ));
      } catch (error) {
        return sendError(res, error);
      }
    }
  );
  return router;
}

module.exports = {
  createMarketingDashboardRouter
};
