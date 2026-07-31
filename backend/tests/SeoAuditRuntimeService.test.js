const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createPageAuditRuntime,
  createSiteAuditRuntime
} = require('../services/SeoAuditRuntimeService');
const {
  createSeoAuditOriginCoordinator
} = require('../services/SeoAuditCrawlerPolicy');

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', 'seo-responses', name), 'utf8');
}

function clientOptions(request, { isolated = true } = {}) {
  return {
    minOriginIntervalMs: 0,
    ...(isolated ? { originCoordinator: createSeoAuditOriginCoordinator() } : {}),
    resolveHostname: async () => [{ address: '93.184.216.34', family: 4 }],
    request
  };
}

test('creates an isolated request-control client for every public audit runtime', () => {
  const firstPageRuntime = createPageAuditRuntime('https://example.com/');
  const secondPageRuntime = createPageAuditRuntime('https://example.com/');
  const siteRuntime = createSiteAuditRuntime('https://example.com/');

  assert.equal(typeof firstPageRuntime.siteClient?.getRequestDiagnostics, 'function');
  assert.equal(typeof siteRuntime.siteClient?.getRequestDiagnostics, 'function');
  assert.notEqual(firstPageRuntime.siteClient, secondPageRuntime.siteClient);
  assert.notEqual(firstPageRuntime.siteClient, siteRuntime.siteClient);

  firstPageRuntime.siteClient.setStopReason('waf_blocked');
  assert.equal(firstPageRuntime.siteClient.getRequestDiagnostics().stopReason, 'waf_blocked');
  assert.equal(secondPageRuntime.siteClient.getRequestDiagnostics().stopReason, null);
});

test('formal public runtimes share an active origin circuit', async () => {
  let secondRequestCount = 0;
  const limitedRuntime = createPageAuditRuntime('https://shared.example/', {
    clientOptions: clientOptions(async () => ({
      status: 429,
      headers: { 'content-type': 'text/plain', 'retry-after': '60' },
      data: 'Too many requests'
    }), { isolated: false })
  });
  const waitingRuntime = createPageAuditRuntime('https://shared.example/', {
    clientOptions: clientOptions(async () => {
      secondRequestCount += 1;
      return {
        status: 200,
        headers: { 'content-type': 'text/html' },
        data: fixture('normal.html')
      };
    }, { isolated: false })
  });

  const limited = await limitedRuntime.siteClient.probe('https://shared.example/robots.txt', {
    expectedKind: 'robots',
    requestKind: 'robots'
  });
  assert.equal(limited.classification.outcome, 'rate_limited');
  await assert.rejects(
    () => waitingRuntime.siteClient.fetchPage('https://shared.example/'),
    { code: 'SEO_AUDIT_RATE_LIMITED' }
  );
  assert.equal(secondRequestCount, 0);
  limitedRuntime.siteClient.close();
  waitingRuntime.siteClient.close();
});

test('the public page runtime rejects WAF and 429 entries before probes or history-ready reports', async () => {
  for (const scenario of [
    {
      status: 200,
      headers: { 'content-type': 'text/html' },
      data: fixture('edgeone-challenge.html'),
      code: 'SEO_AUDIT_BLOCKED_BY_WAF'
    },
    {
      status: 429,
      headers: { 'content-type': 'text/plain', 'retry-after': '60' },
      data: 'Too many requests',
      code: 'SEO_AUDIT_RATE_LIMITED'
    }
  ]) {
    let requestCount = 0;
    const runtime = createPageAuditRuntime('https://example.com/', {
      clientOptions: clientOptions(async ({ url }) => {
        requestCount += 1;
        if (new URL(url).pathname === '/robots.txt') {
          return {
            status: 200,
            headers: { 'content-type': 'text/plain' },
            data: 'User-agent: GoodieAI-SEO-Audit\nAllow: /'
          };
        }
        return scenario;
      })
    });

    await assert.rejects(
      () => runtime.service.audit(runtime.requestedUrl),
      { code: scenario.code }
    );
    assert.equal(requestCount, 2);
  }
});

test('the public site runtime stops after a robots WAF in the formal preflight chain', async () => {
  const requestedPaths = [];
  const runtime = createSiteAuditRuntime('https://example.com/', {
    clientOptions: clientOptions(async ({ url }) => {
      const pathname = new URL(url).pathname;
      requestedPaths.push(pathname);
      if (pathname === '/') {
        return {
          status: 200,
          headers: { 'content-type': 'text/html' },
          data: fixture('normal.html')
        };
      }
      return {
        status: 403,
        headers: { 'content-type': 'text/html' },
        data: fixture('edgeone-challenge.html')
      };
    }),
    renderService: {
      async sample() {
        throw new Error('WAF preflight must not render');
      }
    }
  });

  await assert.rejects(
    () => runtime.service.audit(runtime.requestedUrl),
    { code: 'SEO_AUDIT_BLOCKED_BY_WAF' }
  );
  assert.deepEqual(requestedPaths, ['/robots.txt']);
});

test('the public site runtime stops before sitemap discovery when robots denies GoodieAI', async () => {
  const requestedPaths = [];
  const runtime = createSiteAuditRuntime('https://example.com/private/', {
    clientOptions: clientOptions(async ({ url }) => {
      const pathname = new URL(url).pathname;
      requestedPaths.push(pathname);
      if (pathname === '/private/') {
        return {
          status: 200,
          headers: { 'content-type': 'text/html' },
          data: fixture('normal.html')
        };
      }
      if (pathname === '/robots.txt') {
        return {
          status: 200,
          headers: { 'content-type': 'text/plain' },
          data: 'User-agent: GoodieAI-SEO-Audit\nDisallow: /private/'
        };
      }
      throw new Error(`unexpected request: ${pathname}`);
    }),
    renderService: {
      async sample() {
        throw new Error('robots-disallowed entry must not render');
      }
    }
  });

  await assert.rejects(
    () => runtime.service.audit(runtime.requestedUrl),
    {
      code: 'SEO_AUDIT_ROBOTS_DISALLOWED',
      stopReason: 'robots_disallowed'
    }
  );
  assert.deepEqual(requestedPaths, ['/robots.txt']);
  assert.equal(
    runtime.siteClient.getRequestDiagnostics().stopReason,
    'robots_disallowed'
  );
});

test('the public site runtime does not follow a redirect into a robots-disallowed page', async () => {
  const requestedPaths = [];
  const runtime = createSiteAuditRuntime('https://example.com/', {
    clientOptions: clientOptions(async ({ url }) => {
      const pathname = new URL(url).pathname;
      requestedPaths.push(pathname);
      if (pathname === '/') {
        return {
          status: 200,
          headers: { 'content-type': 'text/html' },
          data: fixture('normal.html').replace('</body>', '<a href="/go">go</a></body>')
        };
      }
      if (pathname === '/robots.txt') {
        return {
          status: 200,
          headers: { 'content-type': 'text/plain' },
          data: 'User-agent: GoodieAI-SEO-Audit\nDisallow: /private/'
        };
      }
      if (pathname === '/sitemap.xml') {
        return {
          status: 404,
          headers: { 'content-type': 'text/plain' },
          data: ''
        };
      }
      if (pathname === '/go') {
        return {
          status: 302,
          headers: { location: '/private/account' },
          data: ''
        };
      }
      throw new Error(`robots-disallowed redirect target was requested: ${pathname}`);
    }),
    renderService: {
      async sample() {
        return { status: 'unavailable', reason: 'test', samples: [] };
      }
    }
  });

  const report = await runtime.service.audit(runtime.requestedUrl);

  assert.equal(requestedPaths.includes('/private/account'), false);
  assert.equal(requestedPaths.filter((path) => path === '/go').length, 1);
  assert.deepEqual(report.site.robotsPolicy.skippedPages, [{
    url: 'https://example.com/private/account',
    matchedRule: 'Disallow: /private/'
  }]);
});

test('the public site runtime checks destination robots before a cross-origin entry redirect', async () => {
  const requestedUrls = [];
  const runtime = createSiteAuditRuntime('https://example.com/start', {
    clientOptions: clientOptions(async ({ url }) => {
      requestedUrls.push(url);
      const parsed = new URL(url);
      if (parsed.origin === 'https://example.com' && parsed.pathname === '/robots.txt') {
        return {
          status: 200,
          headers: { 'content-type': 'text/plain' },
          data: 'User-agent: GoodieAI-SEO-Audit\nAllow: /'
        };
      }
      if (parsed.origin === 'https://example.com' && parsed.pathname === '/start') {
        return {
          status: 302,
          headers: { location: 'https://blocked.example/private' },
          data: ''
        };
      }
      if (parsed.origin === 'https://blocked.example' && parsed.pathname === '/robots.txt') {
        return {
          status: 200,
          headers: { 'content-type': 'text/plain' },
          data: 'User-agent: GoodieAI-SEO-Audit\nDisallow: /private'
        };
      }
      throw new Error(`robots-disallowed redirect target was requested: ${url}`);
    }),
    renderService: {
      async sample() {
        throw new Error('robots-disallowed entry must not render');
      }
    }
  });

  await assert.rejects(
    () => runtime.service.audit(runtime.requestedUrl),
    {
      code: 'SEO_AUDIT_ROBOTS_DISALLOWED',
      stopReason: 'robots_disallowed'
    }
  );
  assert.deepEqual(requestedUrls, [
    'https://example.com/robots.txt',
    'https://example.com/start',
    'https://blocked.example/robots.txt'
  ]);
});

test('the public site runtime reports the resolved entry and real request baseline', async () => {
  const runtime = createSiteAuditRuntime('https://example.com/cn', {
    ownedOrigins: ['https://example.com'],
    clientOptions: clientOptions(async ({ url }) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/cn') {
        return { status: 301, headers: { location: '/cn/' }, data: '' };
      }
      if (pathname === '/cn/' || pathname === '/') {
        return {
          status: 200,
          headers: { 'content-type': 'text/html' },
          data: fixture('normal.html')
        };
      }
      return { status: 404, headers: { 'content-type': 'text/plain' }, data: '' };
    }),
    renderService: {
      async sample() {
        return { status: 'unavailable', reason: 'test', samples: [] };
      }
    }
  });

  const report = await runtime.service.audit(runtime.requestedUrl);

  assert.equal(report.finalUrl, 'https://example.com/cn/');
  assert.equal(report.site.crawlDiagnostics.stopReason, 'completed');
  assert.deepEqual(report.site.crawlDiagnostics.networkRequests, {
    total: 5,
    byKind: {
      page: 3,
      robots: 1,
      sitemap: 1,
      link_probe: 0
    },
    redirectHops: 1
  });
  assert.equal(report.site.crawlDiagnostics.renderAttempts, 2);
  assert.deepEqual(report.site.crawlProfile, {
    key: 'owned_fast',
    concurrency: 8,
    minOriginIntervalMs: 100
  });
});
