const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const express = require('express');

const {
  createMarketingDashboardRouter
} = require('../../modules/marketing/routes/marketingDashboardRoutes');

test('dashboard HTTP contract preserves stale revisions and fails without a snapshot', async (t) => {
  let reads = 0;
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 7, role: 'admin' };
    next();
  });
  app.use('/api/marketing', createMarketingDashboardRouter({
    dashboardService: {
      async assertAccess() {},
      async read() {
        reads += 1;
        if (reads === 1) {
          return {
            projectId: '11',
            revision: 'previous-successful-run',
            states: {
              snapshotContentState: 'DATA',
              snapshotFreshnessState: 'STALE'
            },
            lastRun: {
              runId: 'failed-refresh-run',
              status: 'FAILED',
              failureCode: 'BAIDU_REPORT_SNAPSHOT_UNSTABLE'
            }
          };
        }
        throw Object.assign(new Error('provider detail must stay private'), {
          code: 'BAIDU_REPORT_FAILED',
          status: 502
        });
      }
    },
    refreshService: {}
  }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const stale = await fetch(`${baseUrl}/api/marketing/projects/11/dashboard`);
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get('cache-control'), 'private, no-store');
  const staleBody = await stale.json();
  assert.equal(staleBody.revision, 'previous-successful-run');
  assert.equal(staleBody.states.snapshotFreshnessState, 'STALE');
  assert.equal(
    staleBody.lastRun.failureCode,
    'BAIDU_REPORT_SNAPSHOT_UNSTABLE'
  );

  const unavailable = await fetch(
    `${baseUrl}/api/marketing/projects/11/dashboard`
  );
  assert.equal(unavailable.status, 502);
  assert.equal(unavailable.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await unavailable.json(), {
    error: {
      code: 'BAIDU_REPORT_FAILED',
      message: '营销看板暂时不可用'
    }
  });
});

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
      async readProjectSourceTrends(projectId, device, source) {
        calls.push(['sources', projectId, device, source]);
        return {
          projectId,
          source: 'BAIDU_TONGJI',
          sources: []
        };
      },
      async readProjectWebsiteTraffic(projectId, options) {
        calls.push(['overview', projectId, options]);
        if (options.metric === 'pageviews') {
          const error = new Error('upstream failed');
          error.code = 'TONGJI_UPSTREAM_FAILED';
          error.status = 502;
          throw error;
        }
        return { projectId, selectedMetric: options.metric };
      },
      async readProjectWebsitePages(projectId, options) {
        calls.push(['pages', projectId, options]);
        return { projectId, view: options.view };
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
    `http://127.0.0.1:${address.port}/api/marketing/projects/11/tongji-source-trends?device=mobile&source=DIRECT`
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projectId: '11',
    source: 'BAIDU_TONGJI',
    sources: []
  });
  assert.deepEqual(calls, [
    ['access', { projectId: '11', user: { id: 7, role: 'admin' } }],
    ['sources', '11', 'mobile', 'DIRECT']
  ]);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');

  const overviewResponse = await fetch(
    `http://127.0.0.1:${address.port}/api/marketing/projects/11/website-traffic-overview?device=all&from=2026-07-01&to=2026-07-30&source=ALL&metric=visits`
  );
  assert.equal(overviewResponse.status, 200);
  assert.deepEqual(await overviewResponse.json(), {
    projectId: '11',
    selectedMetric: 'visits'
  });
  assert.equal(overviewResponse.headers.get('cache-control'), 'private, max-age=60');

  const pagesResponse = await fetch(
    `http://127.0.0.1:${address.port}/api/marketing/projects/11/website-traffic-pages?device=pc&from=2026-07-01&to=2026-07-30&view=landing&page=2&pageSize=20&sortBy=visits&sortOrder=descend&query=%2Fproduct`
  );
  assert.equal(pagesResponse.status, 200);
  assert.deepEqual(await pagesResponse.json(), {
    projectId: '11',
    view: 'landing'
  });
  assert.equal(pagesResponse.headers.get('cache-control'), 'private, max-age=60');
  assert.deepEqual(calls.slice(2), [
    ['access', { projectId: '11', user: { id: 7, role: 'admin' } }],
    ['overview', '11', {
      device: 'all',
      from: '2026-07-01',
      to: '2026-07-30',
      source: 'ALL',
      metric: 'visits'
    }],
    ['access', { projectId: '11', user: { id: 7, role: 'admin' } }],
    ['pages', '11', {
      device: 'pc',
      from: '2026-07-01',
      to: '2026-07-30',
      view: 'landing',
      page: '2',
      pageSize: '20',
      sortBy: 'visits',
      sortOrder: 'descend',
      query: '/product'
    }]
  ]);

  const failedResponse = await fetch(
    `http://127.0.0.1:${address.port}/api/marketing/projects/11/website-traffic-overview?device=all&from=2026-07-01&to=2026-07-30&source=ALL&metric=pageviews`
  );
  assert.equal(failedResponse.status, 502);
  assert.equal(failedResponse.headers.get('cache-control'), 'private, no-store');
});
