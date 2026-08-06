const test = require('node:test');
const assert = require('node:assert/strict');

const { createApplicationShutdown } = require('../services/ApplicationShutdownService');

test('application shutdown drains scheduler, project runs and Web session before database', async () => {
  const events = [];
  let releaseScheduler;
  let releaseProjectRuns;
  const schedulerDrained = new Promise((resolve) => { releaseScheduler = resolve; });
  const projectRunsDrained = new Promise((resolve) => { releaseProjectRuns = resolve; });
  const shutdown = createApplicationShutdown({
    getServer: () => ({
      close(callback) {
        events.push('http');
        callback();
      },
      closeAllConnections() {
        events.push('connections');
      }
    }),
    schedulerService: {
      async stop() {
        events.push('scheduler');
        await schedulerDrained;
      }
    },
    projectRunService: {
      beginShutdown() {
        events.push('project-stop');
      },
      async drain() {
        events.push('project-drain');
        await projectRunsDrained;
      }
    },
    analysisExecutionCoordinator: {
      beginShutdown() {
        events.push('analysis-stop');
      },
      async drain() {
        events.push('analysis-drain');
      }
    },
    webPlatformRegistry: {
      async shutdown() {
        events.push('web');
      }
    },
    sequelize: {
      async close() {
        events.push('database');
      }
    }
  });

  const first = shutdown('SIGTERM');
  const second = shutdown('SIGINT');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(first, second);
  assert.deepEqual(events, [
    'analysis-stop',
    'project-stop',
    'http',
    'scheduler',
    'web',
    'project-drain',
    'analysis-drain'
  ]);
  assert.equal(events.includes('database'), false);

  releaseScheduler();
  releaseProjectRuns();
  await first;

  assert.equal(events.at(-1), 'database');
});
