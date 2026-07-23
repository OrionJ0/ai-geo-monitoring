const test = require('node:test');
const assert = require('node:assert/strict');

const { createSeoSiteAuditService } = require('../services/SeoSiteAuditService');
const { defaultSeoAuditRules } = require('../config/seoAuditRules');

function htmlPage(url, links = []) {
  return {
    requestedUrl: url,
    finalUrl: url,
    statusCode: 200,
    durationMs: 50,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    html: `<!doctype html><html lang="zh-CN"><head>
      <title>这是一个长度合理的全站检测页面标题</title>
      <meta name="description" content="这是一个用于验证全站 SEO 检测行为的完整页面描述，内容足够清晰并且满足当前配置的基础长度要求。">
      <meta name="keywords" content="技术 SEO,全站检测">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="canonical" href="${url}">
    </head><body><h1>页面标题</h1>${'<p>有效正文内容。</p>'.repeat(40)}
      ${links.map((href) => `<a href="${href}">链接</a>`).join('')}
    </body></html>`
  };
}

test('discovers and audits unique same-origin pages from links and recursive sitemaps', async () => {
  const pages = new Map([
    ['https://example.com/', htmlPage('https://example.com/', ['/about', '/about#team', 'https://outside.example/page', 'mailto:test@example.com'])],
    ['https://example.com/about', htmlPage('https://example.com/about', ['/contact'])],
    ['https://example.com/contact', htmlPage('https://example.com/contact')],
    ['https://example.com/sitemap-only', htmlPage('https://example.com/sitemap-only')],
    ['https://example.com/product', htmlPage('https://example.com/product')]
  ]);
  const siteClient = {
    async fetchPage(url) {
      if (!pages.has(url)) throw Object.assign(new Error('页面不存在'), { code: 'UPSTREAM_UNAVAILABLE', status: 502 });
      return pages.get(url);
    },
    async probe(url) {
      if (url === 'https://example.com/robots.txt') {
        return { statusCode: 200, body: 'User-agent: *\nAllow: /\nSitemap: https://example.com/custom-index.xml' };
      }
      if (url === 'https://example.com/sitemap.xml') {
        return { statusCode: 200, body: '<urlset><url><loc>https://example.com/sitemap-only</loc></url><url><loc>https://example.com/about</loc></url></urlset>' };
      }
      if (url === 'https://example.com/custom-index.xml') {
        return { statusCode: 200, body: '<sitemapindex><sitemap><loc>https://example.com/products.xml</loc></sitemap></sitemapindex>' };
      }
      if (url === 'https://example.com/products.xml') {
        return { statusCode: 200, body: '<urlset><url><loc>https://example.com/product</loc></url></urlset>' };
      }
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient }).audit('https://example.com/');

  assert.equal(report.mode, 'site');
  assert.equal(report.site.auditedPages, 5);
  assert.equal(report.site.failedPages, 0);
  assert.equal(report.site.truncated, false);
  assert.deepEqual(report.pages.map((page) => page.url).sort(), [
    'https://example.com/',
    'https://example.com/about',
    'https://example.com/contact',
    'https://example.com/product',
    'https://example.com/sitemap-only'
  ]);
});

test('continues after page failures and aggregates issues with affected URLs', async () => {
  const root = htmlPage('https://example.com/', ['/missing-title', '/unavailable']);
  const missingTitle = htmlPage('https://example.com/missing-title');
  missingTitle.html = missingTitle.html.replace(/<title>.*?<\/title>/, '');
  const pages = new Map([
    ['https://example.com/', root],
    ['https://example.com/missing-title', missingTitle]
  ]);
  const siteClient = {
    async fetchPage(url) {
      if (!pages.has(url)) throw Object.assign(new Error('连接失败'), { code: 'UPSTREAM_UNAVAILABLE', status: 502 });
      return pages.get(url);
    },
    async probe() {
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient }).audit('https://example.com/');

  assert.equal(report.site.auditedPages, 3);
  assert.equal(report.site.successfulPages, 2);
  assert.equal(report.site.failedPages, 1);
  assert.equal(report.pages.find((page) => page.url.endsWith('/unavailable')).status, 'failed');
  assert.deepEqual(report.issues.find((issue) => issue.id === 'title').affectedPages, [
    'https://example.com/missing-title'
  ]);
  assert.deepEqual(report.issues.find((issue) => issue.id === 'http-status').affectedPages, [
    'https://example.com/unavailable'
  ]);
});

test('respects page limit, reports truncation and emits crawl progress', async () => {
  const pages = new Map([
    ['https://example.com/', htmlPage('https://example.com/', ['/a', '/b', '/c'])],
    ['https://example.com/a', htmlPage('https://example.com/a')],
    ['https://example.com/b', htmlPage('https://example.com/b')],
    ['https://example.com/c', htmlPage('https://example.com/c')]
  ]);
  const progress = [];
  const calls = { pages: new Map(), probes: new Map() };
  const siteClient = {
    async fetchPage(url) {
      calls.pages.set(url, (calls.pages.get(url) || 0) + 1);
      return pages.get(url);
    },
    async probe(url) {
      calls.probes.set(url, (calls.probes.get(url) || 0) + 1);
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient }).audit('https://example.com/', {
    maxPages: 2,
    onProgress: (value) => progress.push(value)
  });

  assert.equal(report.site.discoveredPages, 4);
  assert.equal(report.site.auditedPages, 2);
  assert.equal(report.site.limit, 2);
  assert.equal(report.site.truncated, true);
  assert.equal(progress.at(-1).phase, 'completed');
  assert.equal(progress.at(-1).auditedPages, 2);
  assert.equal(calls.pages.get('https://example.com/'), 1);
  assert.equal(calls.probes.get('https://example.com/robots.txt'), 1);
  assert.equal(calls.probes.get('https://example.com/sitemap.xml'), 1);
});

test('rejects invalid crawl configuration before creating an audit', () => {
  assert.throws(() => createSeoSiteAuditService({
    siteClient: {},
    ruleConfig: {
      ...defaultSeoAuditRules,
      crawl: { ...defaultSeoAuditRules.crawl, pageLimit: 0 }
    }
  }), /SEO 抓取配置 pageLimit 必须是正整数/);
});
