const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createPageAuditRuntime,
  createSiteAuditRuntime
} = require('../services/SeoAuditRuntimeService');

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', 'seo-responses', name), 'utf8');
}

function clientOptions(request) {
  return {
    minOriginIntervalMs: 0,
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
      clientOptions: clientOptions(async () => {
        requestCount += 1;
        return scenario;
      })
    });

    await assert.rejects(
      () => runtime.service.audit(runtime.requestedUrl),
      { code: scenario.code }
    );
    assert.equal(requestCount, 1);
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
  assert.deepEqual(requestedPaths, ['/', '/robots.txt']);
});

test('the public site runtime reports the resolved entry and real request baseline', async () => {
  const runtime = createSiteAuditRuntime('https://example.com/cn', {
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
});
