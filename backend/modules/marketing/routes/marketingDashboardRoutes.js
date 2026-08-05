const express = require('express');

function sendError(res, error) {
  res.set('Cache-Control', 'private, no-store');
  if (Number.isSafeInteger(error?.retryAfterSeconds)) {
    res.set('Retry-After', String(error.retryAfterSeconds));
  }
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
  adResourceService = null,
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
      const result = await dashboardService.read({
        projectId: req.params.projectId,
        from: req.query.from,
        to: req.query.to
      });
      res.set('Cache-Control', 'private, no-store');
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  if (adResourceService) router.get(
    '/projects/:projectId/search-terms',
    async (req, res) => {
      try {
        await dashboardService.assertAccess({
          projectId: req.params.projectId,
          user: req.user
        });
        const result = await adResourceService.readSearchTerms({
          projectId: req.params.projectId,
          revision: req.query.revision,
          from: req.query.from,
          to: req.query.to,
          page: req.query.page,
          pageSize: req.query.pageSize,
          sortBy: req.query.sortBy,
          sortOrder: req.query.sortOrder,
          query: req.query.query,
          accountId: req.query.accountId,
          campaignId: req.query.campaignId,
          adGroupId: req.query.adGroupId,
          keywordName: req.query.keywordName,
          queryStatus: req.query.queryStatus,
          matchType: req.query.matchType
        });
        res.set('Cache-Control', 'private, max-age=60');
        return res.json(result);
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  if (adResourceService) router.get(
    '/projects/:projectId/keywords',
    async (req, res) => {
      try {
        await dashboardService.assertAccess({
          projectId: req.params.projectId,
          user: req.user
        });
        const result = await adResourceService.readKeywords({
          projectId: req.params.projectId,
          revision: req.query.revision,
          from: req.query.from,
          to: req.query.to,
          page: req.query.page,
          pageSize: req.query.pageSize,
          sortBy: req.query.sortBy,
          sortOrder: req.query.sortOrder,
          query: req.query.query,
          campaignId: req.query.campaignId,
          adGroupId: req.query.adGroupId
        });
        res.set('Cache-Control', 'private, max-age=60');
        return res.json(result);
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  if (tongjiService) router.get(
    '/projects/:projectId/website-traffic-overview',
    async (req, res) => {
      try {
        await dashboardService.assertAccess({
          projectId: req.params.projectId,
          user: req.user
        });
        const result = await tongjiService.readProjectWebsiteTraffic(
          req.params.projectId,
          {
            device: req.query.device,
            from: req.query.from,
            to: req.query.to,
            source: req.query.source,
            metric: req.query.metric,
            includeSourceComparison: req.query.includeSourceComparison
          }
        );
        res.set('Cache-Control', 'private, max-age=60');
        return res.json(result);
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  if (tongjiService) router.get(
    '/projects/:projectId/website-traffic-pages',
    async (req, res) => {
      try {
        await dashboardService.assertAccess({
          projectId: req.params.projectId,
          user: req.user
        });
        const result = await tongjiService.readProjectWebsitePages(
          req.params.projectId,
          {
            device: req.query.device,
            from: req.query.from,
            to: req.query.to,
            view: req.query.view,
            page: req.query.page,
            pageSize: req.query.pageSize,
            sortBy: req.query.sortBy,
            sortOrder: req.query.sortOrder,
            query: req.query.query
          }
        );
        res.set('Cache-Control', 'private, max-age=60');
        return res.json(result);
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
      || req.body.triggerType !== 'MANUAL'
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
