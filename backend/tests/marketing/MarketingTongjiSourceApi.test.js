const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const express = require('express');

const {
  createMarketingDashboardRouter
} = require('../../modules/marketing/routes/marketingDashboardRoutes');

test('Tongji source API authorizes the project and returns source trends', async (t) => {
  const calls = [];
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 7, role: 'admin' };
    next();
  });
  app.use('/api/marketing', createMarketingDashboardRouter({
    dashboardService: {
      async assertAccess(input) {
        calls.push(['access', input]);
      }
    },
    refreshService: {},
    tongjiService: {
      async readProjectSourceTrends(projectId) {
        calls.push(['sources', projectId]);
        return {
          projectId,
          source: 'BAIDU_TONGJI',
          sources: []
        };
      }
    }
  }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    const rejectListen = (error) => reject(error);
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolve();
    });
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();

  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/marketing/projects/11/tongji-source-trends`
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projectId: '11',
    source: 'BAIDU_TONGJI',
    sources: []
  });
  assert.deepEqual(calls, [
    ['access', { projectId: '11', user: { id: 7, role: 'admin' } }],
    ['sources', '11']
  ]);
});
