const test = require('node:test');
const assert = require('node:assert/strict');

const { createSeoAuditCrawlerPolicy } = require('../services/SeoAuditCrawlerPolicy');
const {
  resolveSiteCrawlProfile
} = require('../services/SeoAuditRuntimeService');

test('selects the fast profile only for an exact configured owned origin', () => {
  const ownedOrigins = ['https://gato.com.cn'];

  assert.deepEqual(
    resolveSiteCrawlProfile('https://gato.com.cn/about', ownedOrigins),
    {
      key: 'owned_fast',
      concurrency: 8,
      minOriginIntervalMs: 100
    }
  );
  assert.deepEqual(
    resolveSiteCrawlProfile('https://www.gato.com.cn/', ownedOrigins),
    {
      key: 'standard',
      concurrency: 4,
      minOriginIntervalMs: 250
    }
  );
});

test('keeps standard pacing when an owned entry redirects to an unconfigured origin', async () => {
  let currentTime = 0;
  const waits = [];
  const policy = createSeoAuditCrawlerPolicy({
    minOriginIntervalMs: 250,
    originIntervalOverrides: {
      'https://gato.com.cn': 100
    },
    now: () => currentTime,
    wait: async (delayMs) => {
      waits.push(delayMs);
      currentTime += delayMs;
    }
  });

  await policy.beforeRequest({ url: 'https://gato.com.cn/' });
  await policy.beforeRequest({ url: 'https://gato.com.cn/about' });
  await policy.beforeRequest({ url: 'https://external.example/' });
  await policy.beforeRequest({ url: 'https://external.example/about' });

  assert.deepEqual(waits, [100, 250]);
});
