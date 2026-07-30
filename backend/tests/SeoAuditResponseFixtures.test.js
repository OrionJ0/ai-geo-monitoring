const test = require('node:test');
const assert = require('node:assert/strict');

const {
  startSeoAuditMockServer
} = require('./helpers/createSeoAuditMockServer');

test('serves the offline SEO response matrix and records five redirect hops', async (t) => {
  const server = await startSeoAuditMockServer();
  t.after(() => server.close());

  const request = (path, options = {}) => fetch(`${server.origin}${path}`, {
    headers: { 'User-Agent': 'GoodieAI-SEO-Audit/1.0 (+https://gato.com.cn/)' },
    ...options
  });

  const normal = await request('/normal.html');
  assert.equal(normal.status, 200);
  assert.match(await normal.text(), /Normal SEO fixture/);

  const spa = await request('/spa.html');
  assert.equal(spa.status, 200);
  assert.match(await spa.text(), /window\.__APP_BOOTSTRAP__/);

  const challenge200 = await request('/challenge-200');
  assert.equal(challenge200.status, 200);
  assert.match(await challenge200.text(), /EO-Bot-Js-Token/);

  const business403 = await request('/business-403');
  assert.equal(business403.status, 403);
  assert.doesNotMatch(await business403.text(), /EO-Bot-Js-Token/);

  const waf403 = await request('/waf-403');
  assert.equal(waf403.status, 403);
  assert.match(await waf403.text(), /EO-Bot-Js-Token/);

  const limited = await request('/rate-limited');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '120');

  const htmlRobots = await request('/robots-html');
  assert.match(htmlRobots.headers.get('content-type'), /^text\/html/);
  assert.match(await htmlRobots.text(), /Temporary error/);

  const htmlSitemap = await request('/sitemap-html');
  assert.match(htmlSitemap.headers.get('content-type'), /^text\/html/);
  assert.match(await htmlSitemap.text(), /Temporary error/);

  const robots = await request('/robots.txt');
  assert.match(robots.headers.get('content-type'), /^text\/plain/);
  assert.match(await robots.text(), /^User-agent:/);

  const sitemap = await request('/sitemap.xml');
  assert.match(sitemap.headers.get('content-type'), /xml/);
  assert.match(await sitemap.text(), /<urlset/);

  const beforeRedirect = server.requests.length;
  const redirected = await request('/redirect/0');
  assert.equal(redirected.status, 200);
  assert.match(await redirected.text(), /Normal SEO fixture/);

  const redirectRequests = server.requests.slice(beforeRedirect);
  assert.deepEqual(
    redirectRequests.map((entry) => entry.path),
    [
      '/redirect/0',
      '/redirect/1',
      '/redirect/2',
      '/redirect/3',
      '/redirect/4',
      '/redirect/final'
    ]
  );
  assert.equal(
    redirectRequests.every((entry) => (
      entry.method === 'GET'
      && entry.userAgent === 'GoodieAI-SEO-Audit/1.0 (+https://gato.com.cn/)'
      && Number.isFinite(entry.receivedAt)
    )),
    true
  );
});
