const test = require('node:test');
const assert = require('node:assert/strict');

const { createSeoSiteClient } = require('../services/SeoSiteClient');

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

test('rejects hostnames when DNS resolves to a private address', async () => {
  const client = createSeoSiteClient({
    resolveHostname: async () => [{ address: '10.0.0.8', family: 4 }],
    request: async () => ({ status: 200, headers: {}, data: '<html></html>' })
  });

  await assert.rejects(() => client.fetchPage('https://internal.example/'), { code: 'PRIVATE_NETWORK_URL' });
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
