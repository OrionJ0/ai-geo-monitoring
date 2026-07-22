const test = require('node:test');
const assert = require('node:assert/strict');

const { createSeoAuditService } = require('../services/SeoAuditService');

function createSiteClient() {
  return {
    async fetchPage(url) {
      return {
        requestedUrl: url,
        finalUrl: 'https://example.com/',
        statusCode: 200,
        durationMs: 320,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        html: `<!doctype html>
          <html lang="zh-CN">
            <head>
              <title>短标题</title>
              <meta name="viewport" content="width=device-width, initial-scale=1">
            </head>
            <body>
              <h2>产品介绍</h2>
              <p>这是一段很短的页面内容。</p>
              <img src="/product.jpg">
              <a href="/about">关于我们</a>
            </body>
          </html>`
      };
    },
    async probe(url) {
      if (url.endsWith('/robots.txt')) {
        return { statusCode: 200, body: 'User-agent: *\nAllow: /' };
      }
      return { statusCode: 404, body: '' };
    }
  };
}

test('returns a prioritized, categorized SEO report for a public page', async () => {
  const service = createSeoAuditService({ siteClient: createSiteClient() });

  const report = await service.audit('example.com');

  assert.equal(report.requestedUrl, 'https://example.com/');
  assert.equal(report.finalUrl, 'https://example.com/');
  assert.equal(report.statusCode, 200);
  assert.equal(report.page.title, '短标题');
  assert.equal(report.page.description, '');
  assert.equal(report.page.h1Count, 0);
  assert.deepEqual(report.categories.map((category) => category.key), [
    'crawlability',
    'metadata',
    'content',
    'experience',
    'structured',
    'performance'
  ]);

  assert.equal(report.summary.total, report.summary.passed + report.summary.issues);
  assert.equal(report.summary.high > 0, true);
  assert.equal(report.score >= 0 && report.score <= 100, true);
  assert.equal(report.priorities[0].severity, 'high');
  assert.equal(report.priorities.some((item) => item.id === 'meta-description'), true);
  assert.equal(report.priorities.some((item) => item.id === 'h1'), true);
  assert.equal(report.priorities.some((item) => item.id === 'sitemap'), true);
  assert.equal(report.priorities.every((item) => item.status === 'failed'), true);
});
