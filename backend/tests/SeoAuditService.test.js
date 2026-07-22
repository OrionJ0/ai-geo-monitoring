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

test('does not treat empty robots and sitemap responses as healthy', async () => {
  const siteClient = {
    async fetchPage(url) {
      return {
        requestedUrl: url,
        finalUrl: 'https://example.com/',
        statusCode: 200,
        durationMs: 120,
        headers: { 'content-type': 'text/html' },
        html: '<html lang="zh-CN"><head><title>这是一个长度合理的示例页面标题</title></head><body><h1>示例页面</h1></body></html>'
      };
    },
    async probe() {
      return { statusCode: 200, body: '' };
    }
  };

  const report = await createSeoAuditService({ siteClient }).audit('https://example.com/');
  const checks = report.categories.flatMap((category) => category.checks);
  const robots = checks.find((check) => check.id === 'robots-txt');
  const sitemap = checks.find((check) => check.id === 'sitemap');

  assert.equal(robots.status, 'failed');
  assert.equal(robots.finding, 'robots.txt 内容为空');
  assert.equal(sitemap.status, 'failed');
  assert.equal(sitemap.finding, 'Sitemap 内容为空');
});

test('validates a sitemap declared in robots.txt instead of trusting the declaration alone', async () => {
  const siteClient = {
    async fetchPage(url) {
      return {
        requestedUrl: url,
        finalUrl: 'https://example.com/',
        statusCode: 200,
        durationMs: 120,
        headers: { 'content-type': 'text/html' },
        html: '<html><head><title>这是一个长度合理的示例页面标题</title></head><body><h1>示例页面</h1></body></html>'
      };
    },
    async probe(url) {
      if (url.endsWith('/robots.txt')) {
        return { statusCode: 200, body: 'User-agent: *\nAllow: /\nSitemap: https://example.com/custom-map.xml' };
      }
      if (url.endsWith('/custom-map.xml')) {
        return {
          statusCode: 200,
          body: '<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/about</loc></url></urlset>'
        };
      }
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoAuditService({ siteClient }).audit('https://example.com/');
  const sitemap = report.categories.flatMap((category) => category.checks).find((check) => check.id === 'sitemap');

  assert.equal(sitemap.status, 'passed');
  assert.equal(sitemap.finding, 'Sitemap 内容有效');
  assert.match(sitemap.value, /2 个 URL/);
});

test('reports present but empty SEO tags as specific issues', async () => {
  const siteClient = {
    async fetchPage(url) {
      return {
        requestedUrl: url,
        finalUrl: 'https://example.com/',
        statusCode: 200,
        durationMs: 120,
        headers: { 'content-type': 'text/html' },
        html: `<!doctype html><html lang="zh-CN"><head>
          <title> </title>
          <meta name="description" content=" ">
          <link rel="canonical" href=" ">
          <script type="application/ld+json"> </script>
          <meta property="og:title" content=" ">
          <meta property="og:description" content=" ">
          <meta property="og:image" content=" ">
        </head><body><h1> </h1><img src="/empty-alt.png" alt=" "></body></html>`
      };
    },
    async probe(url) {
      if (url.endsWith('/robots.txt')) return { statusCode: 200, body: 'User-agent: *\nAllow: /' };
      return {
        statusCode: 200,
        body: '<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc></url></urlset>'
      };
    }
  };

  const report = await createSeoAuditService({ siteClient }).audit('https://example.com/');
  const checks = new Map(report.categories.flatMap((category) => category.checks).map((check) => [check.id, check]));

  assert.equal(checks.get('title').finding, '页面标题为空');
  assert.equal(checks.get('meta-description').finding, 'Meta 描述为空');
  assert.equal(checks.get('canonical').finding, 'Canonical 链接为空');
  assert.equal(checks.get('h1').finding, 'H1 内容为空');
  assert.equal(checks.get('structured-data').finding, 'JSON-LD 内容为空');
  assert.equal(checks.get('open-graph').finding, 'Open Graph 标签内容为空');
  assert.equal(checks.get('image-alt').finding, '1 张图片缺少有效 Alt');
  assert.equal([...checks.values()].filter((check) => check.id in {
    title: true,
    'meta-description': true,
    canonical: true,
    h1: true,
    'structured-data': true,
    'open-graph': true,
    'image-alt': true
  }).every((check) => check.status === 'failed'), true);
});

test('reports non-empty search engine verification tags as page evidence only', async () => {
  const siteClient = {
    async fetchPage(url) {
      return {
        requestedUrl: url,
        finalUrl: 'https://example.com/',
        statusCode: 200,
        durationMs: 120,
        headers: { 'content-type': 'text/html' },
        html: `<!doctype html><html><head>
          <title>这是一个长度合理的示例页面标题</title>
          <meta name="google-site-verification" content="google-token">
          <meta name="msvalidate.01" content="bing-token">
        </head><body><h1>示例页面</h1></body></html>`
      };
    },
    async probe(url) {
      if (url.endsWith('/robots.txt')) return { statusCode: 200, body: 'User-agent: *\nAllow: /' };
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoAuditService({ siteClient }).audit('https://example.com/');
  const verification = report.categories
    .flatMap((category) => category.checks)
    .find((check) => check.id === 'search-verification');

  assert.equal(verification.status, 'passed');
  assert.equal(verification.finding, '发现 2 个搜索平台验证标签');
  assert.match(verification.value, /Google Search Console/);
  assert.match(verification.value, /Bing Webmaster Tools/);
  assert.match(verification.description, /不能证明平台后台当前已验证/);
});

test('gives every failed check a concrete finding distinct from its recommendation', async () => {
  const report = await createSeoAuditService({ siteClient: createSiteClient() }).audit('https://example.com/');
  const failedChecks = report.categories
    .flatMap((category) => category.checks)
    .filter((check) => check.status === 'failed');

  assert.equal(failedChecks.length > 0, true);
  assert.equal(failedChecks.every((check) => (
    check.finding
    && check.finding !== check.title
    && check.finding !== check.recommendation
  )), true);
});
