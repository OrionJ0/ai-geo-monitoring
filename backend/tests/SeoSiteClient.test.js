const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  classifyResponse,
  createSeoSiteClient,
  createSeoAuditTargetPolicy
} = require('../services/SeoSiteClient');

function responseFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', 'seo-responses', name), 'utf8');
}

test('classifies responses by expected resource kind without mistaking a legitimate SPA for WAF', () => {
  const normal = {
    statusCode: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: responseFixture('normal.html')
  };
  const spa = {
    statusCode: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: responseFixture('spa.html')
  };
  const edgeone = {
    statusCode: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: responseFixture('edgeone-challenge.html')
  };
  const business403 = {
    statusCode: 403,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: responseFixture('business-403.html')
  };

  assert.equal(classifyResponse(normal, 'page').outcome, 'normal');
  assert.equal(classifyResponse(spa, 'page').outcome, 'normal');
  assert.equal(classifyResponse({
    statusCode: 200,
    headers: { 'content-type': 'text/html' },
    body: '<html><body><p>This article explains the EO-Bot-Js-Token field.</p></body></html>'
  }, 'page').outcome, 'normal');
  assert.equal(classifyResponse({
    statusCode: 200,
    headers: { 'content-type': 'text/html' },
    body: ''
  }, 'page').outcome, 'invalid_response');
  assert.deepEqual(classifyResponse(edgeone, 'page'), {
    outcome: 'waf_blocked',
    expectedKind: 'page',
    provider: 'edgeone',
    signals: ['edgeone_token'],
    retryAfterMs: null,
    retryAt: null
  });
  assert.equal(
    classifyResponse({ ...edgeone, statusCode: 403 }, 'page').outcome,
    'waf_blocked'
  );
  assert.equal(classifyResponse(business403, 'page').outcome, 'http_error');

  assert.deepEqual(classifyResponse({
    statusCode: 429,
    headers: { 'content-type': 'text/plain', 'retry-after': '120' },
    body: 'Too many requests'
  }, 'page'), {
    outcome: 'rate_limited',
    expectedKind: 'page',
    provider: null,
    signals: ['http_429'],
    retryAfterMs: 120000,
    retryAt: null
  });

  assert.deepEqual(classifyResponse({
    statusCode: 403,
    headers: {
      'content-type': 'text/html',
      'cf-ray': 'TEST-RAY-ID'
    },
    body: responseFixture('cloudflare-challenge.html')
  }, 'page'), {
    outcome: 'waf_blocked',
    expectedKind: 'page',
    provider: 'cloudflare',
    signals: ['cloudflare_challenge'],
    retryAfterMs: null,
    retryAt: null
  });

  assert.equal(classifyResponse({
    statusCode: 429,
    headers: { 'retry-after': 'Wed, 30 Jul 2026 10:00:00 GMT' },
    body: 'Too many requests'
  }, 'page').retryAt, '2026-07-30T10:00:00.000Z');

  for (const expectedKind of ['robots', 'sitemap']) {
    assert.equal(classifyResponse({
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: responseFixture('html-error.html')
    }, expectedKind).outcome, 'invalid_response');
  }
});

test('rejects loopback and credential-bearing URLs before making a request', async () => {
  let requestCount = 0;
  const client = createSeoSiteClient({
    request: async () => {
      requestCount += 1;
      return { status: 200, headers: {}, data: '<html></html>' };
    }
  });

  await assert.rejects(() => client.fetchPage('http://127.0.0.1/admin'), { code: 'PRIVATE_NETWORK_URL' });
  await assert.rejects(() => client.fetchPage('https://user:password@example.com/'), { code: 'URL_CREDENTIALS_NOT_ALLOWED' });
  assert.equal(requestCount, 0);
});

test('allows only the exact private origin granted to this SEO audit', async () => {
  const requestedUrls = [];
  const client = createSeoSiteClient({
    allowedPrivateOrigin: 'http://192.168.9.206:3003',
    request: async (config) => {
      requestedUrls.push(config.url);
      return {
        status: 200,
        headers: { 'content-type': 'text/html' },
        data: '<html><title>Local test site</title></html>'
      };
    }
  });

  const response = await client.fetchPage('http://192.168.9.206:3003/');

  assert.equal(response.statusCode, 200);
  assert.deepEqual(requestedUrls, ['http://192.168.9.206:3003/']);
  await assert.rejects(() => client.fetchPage('http://192.168.9.206:3004/'), {
    code: 'PRIVATE_TARGET_ORIGIN_CHANGED'
  });
});

test('never grants private audit access to link-local metadata addresses', () => {
  assert.throws(
    () => createSeoSiteClient({ allowedPrivateOrigin: 'http://169.254.169.254/' }),
    { code: 'PRIVATE_TARGET_NOT_ALLOWED' }
  );
});

test('requires localhost to resolve only to loopback addresses', async () => {
  let requestCount = 0;
  const client = createSeoSiteClient({
    allowedPrivateOrigin: 'http://localhost:3003',
    resolveHostname: async () => [{ address: '10.0.0.8', family: 4 }],
    request: async () => {
      requestCount += 1;
      return { status: 200, headers: { 'content-type': 'text/html' }, data: '<html></html>' };
    }
  });

  await assert.rejects(() => client.fetchPage('http://localhost:3003/'), {
    code: 'PRIVATE_NETWORK_URL'
  });
  assert.equal(requestCount, 0);
});

test('keeps private SEO targets disabled until the deployment opts in', () => {
  assert.throws(
    () => createSeoAuditTargetPolicy('http://192.168.9.206:3003/', {
      allowPrivateTargets: false
    }),
    { code: 'PRIVATE_TARGETS_DISABLED', status: 403 }
  );
});

test('recognizes only localhost, loopback and RFC1918 literals as private audit targets', () => {
  const allowedTargets = [
    'http://localhost:3001/',
    'http://127.255.255.254:3001/',
    'http://10.0.0.1:3001/',
    'http://172.16.0.1:3001/',
    'http://172.31.255.254:3001/',
    'http://192.168.255.254:3001/',
    'http://[::1]:3001/'
  ];

  allowedTargets.forEach((url) => {
    const policy = createSeoAuditTargetPolicy(url, { allowPrivateTargets: true });
    assert.equal(policy.networkScope, 'private');
    assert.equal(policy.allowedPrivateOrigin, new URL(url).origin);
  });

  [
    'http://169.254.169.254/',
    'http://100.64.0.1/',
    'http://[fc00::1]/',
    'http://[fec0::1]/',
    'http://[64:ff9b:1::c0a8:101]/',
    'http://[::ffff:0:c0a8:101]/',
    'http://[2002:c0a8:101::]/',
    'http://[3fff::1]/'
  ].forEach((url) => {
    assert.throws(
      () => createSeoAuditTargetPolicy(url, { allowPrivateTargets: true }),
      { code: 'PRIVATE_NETWORK_URL' }
    );
  });
});

test('rejects public hostnames that resolve through non-global IPv6 ranges', async () => {
  for (const address of [
    'fec0::1',
    '64:ff9b:1::c0a8:101',
    '::ffff:0:c0a8:101',
    '2002:c0a8:101::',
    '3fff::1'
  ]) {
    let requestCount = 0;
    const client = createSeoSiteClient({
      resolveHostname: async () => [{ address, family: 6 }],
      request: async () => {
        requestCount += 1;
        return { status: 200, headers: {}, data: '<html></html>' };
      }
    });

    await assert.rejects(
      () => client.fetchPage('https://example.com/'),
      { code: 'PRIVATE_NETWORK_URL' }
    );
    assert.equal(requestCount, 0);
  }
});

test('allows globally routable IPv6 literals and DNS results', async () => {
  const literalPolicy = createSeoAuditTargetPolicy('https://[2606:4700:4700::1111]/', {
    allowPrivateTargets: false
  });
  assert.equal(literalPolicy.networkScope, 'public');

  let requestCount = 0;
  const client = createSeoSiteClient({
    resolveHostname: async () => [{ address: '2606:4700:4700::1111', family: 6 }],
    request: async () => {
      requestCount += 1;
      return {
        status: 200,
        headers: { 'content-type': 'text/html' },
        data: '<html></html>'
      };
    }
  });

  const response = await client.fetchPage('https://example.com/');
  assert.equal(response.statusCode, 200);
  assert.equal(requestCount, 1);
});

test('blocks a private redirect when its exact origin changes', async () => {
  let requestCount = 0;
  const client = createSeoSiteClient({
    allowedPrivateOrigin: 'http://192.168.9.206:3003',
    request: async () => {
      requestCount += 1;
      return {
        status: 302,
        headers: { location: 'http://192.168.9.207:3003/secret' },
        data: ''
      };
    }
  });

  await assert.rejects(
    () => client.fetchPage('http://192.168.9.206:3003/'),
    { code: 'PRIVATE_TARGET_ORIGIN_CHANGED' }
  );
  assert.equal(requestCount, 1);
});

test('reports a refused LAN connection with an actionable error', async () => {
  const client = createSeoSiteClient({
    allowedPrivateOrigin: 'http://192.168.9.206:3003',
    request: async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    }
  });

  await assert.rejects(
    () => client.fetchPage('http://192.168.9.206:3003/'),
    {
      code: 'TARGET_CONNECTION_REFUSED',
      status: 502
    }
  );
});

test('keeps the existing public connection error contract', async () => {
  const client = createSeoSiteClient({
    resolveHostname: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    }
  });

  await assert.rejects(
    () => client.fetchPage('https://example.com/'),
    {
      code: 'UPSTREAM_UNAVAILABLE',
      status: 502
    }
  );
});

test('rejects hostnames when DNS resolves to a private address', async () => {
  const client = createSeoSiteClient({
    resolveHostname: async () => [{ address: '10.0.0.8', family: 4 }],
    request: async () => ({ status: 200, headers: {}, data: '<html></html>' })
  });

  await assert.rejects(() => client.fetchPage('https://internal.example/'), { code: 'PRIVATE_NETWORK_URL' });
  await assert.rejects(() => client.assertPublicUrl('https://internal.example/script.js'), {
    code: 'PRIVATE_NETWORK_URL'
  });
});

test('revalidates every redirect and blocks redirects into the private network', async () => {
  let requestCount = 0;
  const client = createSeoSiteClient({
    resolveHostname: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => {
      requestCount += 1;
      return {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        data: ''
      };
    }
  });

  await assert.rejects(() => client.fetchPage('https://example.com/'), { code: 'PRIVATE_NETWORK_URL' });
  assert.equal(requestCount, 1);
});

test('returns a bounded HTML response after resolving a public address', async () => {
  const client = createSeoSiteClient({
    resolveHostname: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (config) => {
      assert.equal(config.maxRedirects, 0);
      assert.equal(config.proxy, false);
      assert.equal(typeof config.httpAgent.options.lookup, 'function');
      return {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        data: '<!doctype html><html><title>Example</title></html>'
      };
    }
  });

  const response = await client.fetchPage('https://example.com/');

  assert.equal(response.statusCode, 200);
  assert.equal(response.finalUrl, 'https://example.com/');
  assert.match(response.html, /Example/);
  assert.equal(response.durationMs >= 0, true);
});

test('returns every redirect hop for sitewide chain analysis', async () => {
  const responses = [
    { status: 301, headers: { location: '/middle' }, data: '' },
    { status: 302, headers: { location: '/final' }, data: '' },
    { status: 200, headers: { 'content-type': 'text/html' }, data: '<html></html>' }
  ];
  const client = createSeoSiteClient({
    resolveHostname: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => responses.shift()
  });

  const response = await client.fetchPage('https://example.com/old');

  assert.deepEqual(response.redirectChain, [
    {
      from: 'https://example.com/old',
      statusCode: 301,
      to: 'https://example.com/middle'
    },
    {
      from: 'https://example.com/middle',
      statusCode: 302,
      to: 'https://example.com/final'
    }
  ]);
});

test('paces and counts every real request in a redirect chain', async () => {
  let currentTime = 1000;
  const requestStartedAt = [];
  const responses = [
    { status: 301, headers: { location: '/hop-1' }, data: '' },
    { status: 302, headers: { location: '/hop-2' }, data: '' },
    { status: 307, headers: { location: '/hop-3' }, data: '' },
    { status: 308, headers: { location: '/hop-4' }, data: '' },
    { status: 301, headers: { location: '/final' }, data: '' },
    { status: 200, headers: { 'content-type': 'text/html' }, data: '<html></html>' }
  ];
  const client = createSeoSiteClient({
    minOriginIntervalMs: 500,
    now: () => currentTime,
    wait: async (delayMs) => {
      currentTime += delayMs;
    },
    resolveHostname: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => {
      requestStartedAt.push(currentTime);
      return responses.shift();
    }
  });

  await client.fetchPage('https://example.com/old');

  assert.deepEqual(requestStartedAt, [1000, 1500, 2000, 2500, 3000, 3500]);
  assert.deepEqual(client.getRequestDiagnostics(), {
    networkRequests: {
      total: 6,
      byKind: {
        page: 6,
        robots: 0,
        sitemap: 0,
        link_probe: 0
      },
      redirectHops: 5
    },
    renderAttempts: 0,
    stopReason: null
  });
});

test('opens a task-local circuit after rate limiting and blocks later requests before Axios', async () => {
  let requestCount = 0;
  const client = createSeoSiteClient({
    minOriginIntervalMs: 0,
    resolveHostname: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => {
      requestCount += 1;
      return {
        status: 429,
        headers: { 'content-type': 'text/plain', 'retry-after': '60' },
        data: 'Too many requests'
      };
    }
  });

  const first = await client.probe('https://example.com/robots.txt', {
    expectedKind: 'robots',
    requestKind: 'robots'
  });
  assert.equal(first.classification.outcome, 'rate_limited');

  await assert.rejects(
    () => client.fetchPage('https://example.com/'),
    {
      code: 'SEO_AUDIT_RATE_LIMITED',
      stopReason: 'rate_limited'
    }
  );
  assert.equal(requestCount, 1);
  assert.deepEqual(client.getRequestDiagnostics().networkRequests.byKind, {
    page: 0,
    robots: 1,
    sitemap: 0,
    link_probe: 0
  });
});

test('stops redirect loops with a dedicated error and preserves observed hops', async () => {
  const client = createSeoSiteClient({
    resolveHostname: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (config) => ({
      status: 301,
      headers: { location: config.url.endsWith('/a') ? '/b' : '/a' },
      data: ''
    })
  });

  await assert.rejects(
    () => client.fetchPage('https://example.com/a'),
    (error) => (
      error?.code === 'REDIRECT_LOOP'
      && Array.isArray(error.redirectChain)
      && error.redirectChain.length === 2
    )
  );
});
