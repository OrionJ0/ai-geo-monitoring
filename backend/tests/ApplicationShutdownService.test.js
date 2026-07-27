const test = require('node:test');
const assert = require('node:assert/strict');

const { createApplicationShutdown } = require('../services/ApplicationShutdownService');

test('application shutdown is idempotent and closes HTTP, scheduler, Web session and database', async () => {
  const events = [];
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
      }
    },
    webPlatformService: {
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

  await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

  assert.deepEqual(events, ['http', 'scheduler', 'web', 'database']);
});
