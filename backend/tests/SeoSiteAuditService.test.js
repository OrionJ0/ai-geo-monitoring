const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSeoSiteAuditService,
  normalizeSameOriginUrl
} = require('../services/SeoSiteAuditService');
const { createSeoSiteClient } = require('../services/SeoSiteClient');
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

test('does not rewrite localhost Sitemap declarations for a public audit origin', () => {
  const rewrites = [];
  const normalized = normalizeSameOriginUrl(
    'http://localhost:3003/sitemap.xml',
    'https://example.com/',
    'https://example.com',
    {
      allowLocalhostRewrite: false,
      onLocalhostRewrite: (entry) => rewrites.push(entry)
    }
  );

  assert.equal(normalized, null);
  assert.deepEqual(rewrites, []);
});

test('rewrites localhost Sitemap declarations only for a private audit origin', () => {
  const rewrites = [];
  const normalized = normalizeSameOriginUrl(
    'http://localhost:3003/sitemap.xml',
    'http://192.168.9.206:3003/',
    'http://192.168.9.206:3003',
    {
      allowLocalhostRewrite: true,
      onLocalhostRewrite: (entry) => rewrites.push(entry)
    }
  );

  assert.equal(normalized, 'http://192.168.9.206:3003/sitemap.xml');
  assert.deepEqual(rewrites, [{
    originalHost: 'localhost:3003',
    rewritten: 'http://192.168.9.206:3003/sitemap.xml'
  }]);
});

test('runs a bounded entry, robots and default sitemap preflight before discovery work', async () => {
  const calls = [];
  const siteClient = {
    async fetchPage(url) {
      calls.push(['page', url]);
      return htmlPage(url);
    },
    async probe(url, options) {
      calls.push(['probe', url, options]);
      if (url.endsWith('/robots.txt')) {
        return {
          statusCode: 200,
          headers: { 'content-type': 'text/plain' },
          body: 'User-agent: *\nAllow: /\nSitemap: https://example.com/custom.xml'
        };
      }
      return {
        statusCode: 429,
        headers: { 'content-type': 'text/plain', 'retry-after': '60' },
        body: 'Too many requests'
      };
    }
  };

  await assert.rejects(
    () => createSeoSiteAuditService({ siteClient }).audit('https://example.com/'),
    {
      code: 'SEO_AUDIT_RATE_LIMITED',
      stopReason: 'rate_limited'
    }
  );
  assert.deepEqual(calls, [
    ['page', 'https://example.com/'],
    ['probe', 'https://example.com/robots.txt', {
      expectedKind: 'robots',
      requestKind: 'robots'
    }],
    ['probe', 'https://example.com/sitemap.xml', {
      expectedKind: 'sitemap',
      requestKind: 'sitemap'
    }]
  ]);
});

test('fails an unavailable entry but keeps ordinary child HTTP failures as page evidence', async () => {
  const entryClient = {
    async fetchPage(url) {
      return {
        requestedUrl: url,
        finalUrl: url,
        statusCode: 403,
        headers: { 'content-type': 'text/html' },
        html: '<html><body>Forbidden</body></html>'
      };
    },
    async probe() {
      throw new Error('preflight must not continue');
    }
  };
  await assert.rejects(
    () => createSeoSiteAuditService({ siteClient: entryClient }).audit('https://example.com/'),
    { code: 'UPSTREAM_HTTP_ERROR' }
  );

  const pages = new Map([
    ['https://example.com/', htmlPage('https://example.com/', ['/forbidden'])],
    ['https://example.com/forbidden', {
      ...htmlPage('https://example.com/forbidden'),
      statusCode: 403
    }]
  ]);
  const siteClient = {
    async fetchPage(url) {
      return pages.get(url);
    },
    async probe() {
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient }).audit('https://example.com/');
  const child = report.pages.find((page) => page.url.endsWith('/forbidden'));
  assert.equal(child.status, 'failed');
  assert.equal(child.errorCode, 'UPSTREAM_HTTP_ERROR');
});

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
  assert.equal(report.scoreVersion, '2026-07-23-v4');
  assert.equal(report.scoreModel, 'technical-health-v4');
  assert.equal(report.score, report.health.score);
  assert.equal(report.grade, report.health.status);
  assert.equal(report.health.stages.reduce((sum, stage) => sum + stage.budget, 0), 100);
  assert.deepEqual(report.pages.map((page) => page.url).sort(), [
    'https://example.com/',
    'https://example.com/about',
    'https://example.com/contact',
    'https://example.com/product',
    'https://example.com/sitemap-only'
  ]);
  assert.equal(report.pages.every((page) => !Object.hasOwn(page, 'links')), true);
});

test('private site audits skip external probes and report the browser-rendering evidence gap', async () => {
  const origin = 'http://192.168.9.206:3003';
  const pages = new Map([
    [`${origin}/`, htmlPage(`${origin}/`, ['/about', 'http://192.168.9.207:4000/secret'])],
    [`${origin}/about`, htmlPage(`${origin}/about`)]
  ]);
  const probed = [];
  const siteClient = {
    async fetchPage(url) {
      if (!pages.has(url)) throw Object.assign(new Error('页面不存在'), { code: 'UPSTREAM_UNAVAILABLE', status: 502 });
      return pages.get(url);
    },
    async probe(url) {
      probed.push(url);
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoSiteAuditService({
    siteClient,
    networkScope: 'private'
  }).audit(`${origin}/`);

  assert.equal(probed.includes('http://192.168.9.207:4000/secret'), false);
  assert.equal(
    report.sitewide.checks.find((check) => check.id === 'broken-links').status,
    'passed'
  );
  assert.equal(
    report.sitewide.checks.find((check) => check.id === 'javascript-rendering').value,
    'private_target_not_rendered'
  );
});

test('continues link discovery when the first homepage link points back to the homepage', async () => {
  const pages = new Map([
    ['https://example.com/', htmlPage('https://example.com/', ['/', '/news', '/products/item'])],
    ['https://example.com/news', htmlPage('https://example.com/news')],
    ['https://example.com/products/item', htmlPage('https://example.com/products/item')]
  ]);
  const siteClient = {
    async fetchPage(url) {
      return pages.get(url);
    },
    async probe() {
      return { statusCode: 200, body: '<urlset></urlset>' };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient }).audit('https://example.com/');

  assert.deepEqual(report.pages.map((page) => page.url), [
    'https://example.com/',
    'https://example.com/news',
    'https://example.com/products/item'
  ]);
});

test('keeps sitemap-dependent sitewide checks unknown when no valid page inventory exists', async () => {
  const pages = new Map([
    ['https://example.com/', htmlPage('https://example.com/', ['/products'])],
    ['https://example.com/products', htmlPage('https://example.com/products')]
  ]);
  const siteClient = {
    async fetchPage(url) {
      return pages.get(url);
    },
    async probe(url) {
      if (url.endsWith('/robots.txt')) {
        return { statusCode: 200, body: 'User-agent: *\nAllow: /' };
      }
      return { statusCode: 200, body: '<urlset></urlset>' };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient }).audit('https://example.com/');
  const checks = new Map(report.sitewide.checks.map((check) => [check.id, check]));
  const sitemapAvailability = report.issues.find((issue) => issue.id === 'sitemap');

  assert.equal(sitemapAvailability.finding, 'Sitemap 中没有有效页面地址');
  assert.equal(checks.get('sitemap-coverage').status, 'unknown');
  assert.equal(checks.get('orphan-pages').status, 'unknown');
  assert.equal(checks.get('internal-link-quality').status, 'unknown');
  assert.equal(checks.get('sitemap-coverage').finding, '暂时无法检查');
  assert.equal(checks.get('orphan-pages').finding, '暂时无法检查');
});

test('full-site audit always includes the homepage when started from a subpage', async () => {
  const pages = new Map([
    ['https://example.com/', htmlPage('https://example.com/')],
    ['https://example.com/product', htmlPage('https://example.com/product')]
  ]);
  const siteClient = {
    async fetchPage(url) {
      return pages.get(url);
    },
    async probe() {
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient }).audit('https://example.com/product');

  assert.deepEqual(report.pages.map((page) => page.url), [
    'https://example.com/product',
    'https://example.com/'
  ]);
  assert.equal(report.pages.find((page) => page.url === 'https://example.com/').isHomepage, true);
});

test('uses the resolved entry URL as page identity and preserves the requested alias', async () => {
  const calls = new Map();
  const siteClient = {
    async fetchPage(url) {
      calls.set(url, (calls.get(url) || 0) + 1);
      if (url === 'https://example.com/cn') {
        return {
          ...htmlPage('https://example.com/cn/'),
          requestedUrl: url,
          finalUrl: 'https://example.com/cn/',
          redirectChain: [{
            from: url,
            statusCode: 301,
            to: 'https://example.com/cn/'
          }]
        };
      }
      if (url === 'https://example.com/') return htmlPage(url);
      if (url === 'https://example.com/cn/') return htmlPage(url);
      throw new Error(`unexpected page ${url}`);
    },
    async probe(url) {
      if (url.endsWith('/sitemap.xml')) {
        return {
          statusCode: 200,
          body: '<urlset><url><loc>https://example.com/cn</loc></url><url><loc>https://example.com/cn/</loc></url></urlset>'
        };
      }
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient }).audit('https://example.com/cn');

  assert.equal(report.requestedUrl, 'https://example.com/cn');
  assert.equal(report.finalUrl, 'https://example.com/cn/');
  assert.equal(report.pages.filter((page) => page.finalUrl === 'https://example.com/cn/').length, 1);
  assert.deepEqual(
    report.pages.find((page) => page.finalUrl === 'https://example.com/cn/').aliases,
    ['https://example.com/cn']
  );
  assert.deepEqual(report.site.redirectAliases, [{
    requestedUrl: 'https://example.com/cn',
    resolvedUrl: 'https://example.com/cn/',
    redirectChain: [{
      from: 'https://example.com/cn',
      statusCode: 301,
      to: 'https://example.com/cn/'
    }]
  }]);
  assert.equal(calls.get('https://example.com/cn'), 1);
  assert.equal(calls.get('https://example.com/cn/') || 0, 0);
});

test('merges concurrently fetched aliases before creating page checks or scores', async () => {
  const root = htmlPage('https://example.com/', ['/legacy-a', '/legacy-b']);
  const redirected = htmlPage('https://example.com/target');
  redirected.html = redirected.html.replace(/<title>.*?<\/title>/, '');
  const siteClient = {
    async fetchPage(url) {
      if (url === 'https://example.com/') return root;
      if (['https://example.com/legacy-a', 'https://example.com/legacy-b'].includes(url)) {
        return {
          ...redirected,
          requestedUrl: url,
          finalUrl: 'https://example.com/target',
          redirectChain: [{
            from: url,
            statusCode: 301,
            to: 'https://example.com/target'
          }]
        };
      }
      throw new Error(`unexpected page ${url}`);
    },
    async probe() {
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient }).audit('https://example.com/');
  const targetPages = report.pages.filter((page) => page.finalUrl === 'https://example.com/target');
  const titleIssue = report.issues.find((issue) => issue.id === 'title');

  assert.equal(targetPages.length, 1);
  assert.deepEqual(targetPages[0].aliases, [
    'https://example.com/legacy-a',
    'https://example.com/legacy-b'
  ]);
  assert.deepEqual(titleIssue.affectedPages, ['https://example.com/target']);
  assert.equal(titleIssue.count, 1);
});

test('uses the final entry origin after a cross-origin homepage redirect', async () => {
  const pages = new Map([
    ['https://example.com/', {
      ...htmlPage('https://www.example.com/', ['/about']),
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://www.example.com/',
      redirectChain: [{
        from: 'https://example.com/',
        statusCode: 301,
        to: 'https://www.example.com/'
      }]
    }],
    ['https://www.example.com/about', htmlPage('https://www.example.com/about')]
  ]);
  const siteClient = {
    async fetchPage(url) {
      if (!pages.has(url)) throw new Error(`unexpected page ${url}`);
      return pages.get(url);
    },
    async probe() {
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient }).audit('https://example.com/');

  assert.equal(report.site.origin, 'https://www.example.com');
  assert.deepEqual(report.pages.map((page) => page.finalUrl), [
    'https://www.example.com/',
    'https://www.example.com/about'
  ]);
});

test('records a child redirect to another origin without scoring the external body', async () => {
  const siteClient = {
    async fetchPage(url) {
      if (url === 'https://example.com/') {
        return htmlPage(url, ['/leave']);
      }
      if (url === 'https://example.com/leave') {
        return {
          ...htmlPage('https://outside.example/secret'),
          requestedUrl: url,
          finalUrl: 'https://outside.example/secret',
          html: '<html><head><title>不应进入本站报告的外域标题</title></head><body><h1>外域正文</h1></body></html>',
          redirectChain: [{
            from: url,
            statusCode: 302,
            to: 'https://outside.example/secret'
          }]
        };
      }
      throw new Error(`unexpected page ${url}`);
    },
    async probe() {
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient }).audit('https://example.com/');
  const redirectedPage = report.pages.find((page) => page.url === 'https://example.com/leave');

  assert.equal(redirectedPage.status, 'redirected_external');
  assert.equal(redirectedPage.finalUrl, 'https://outside.example/secret');
  assert.equal(Object.hasOwn(redirectedPage, 'title'), false);
  assert.equal(report.site.failedPages, 0);
  assert.equal(
    report.issues.some((issue) => issue.affectedPages?.includes('https://outside.example/secret')),
    false
  );
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
  assert.equal(report.issues.find((issue) => issue.id === 'title').coverage, 0.25);
  assert.equal(report.issues.find((issue) => issue.id === 'http-status').coverage, 0.2);
  assert.equal(report.priorities[0].stage, 'access');
  const sitemapIssue = report.issues.find((issue) => issue.id === 'sitemap');
  assert.equal(sitemapIssue.coverage, 1);
  assert.equal(sitemapIssue.applicablePages, 3);
  assert.equal(sitemapIssue.affectedPages.length, 3);
});

test('evaluates crawler permissions per path and aggregates only affected pages', async () => {
  const pages = new Map([
    ['https://example.com/', htmlPage('https://example.com/', ['/private/page'])],
    ['https://example.com/private/page', htmlPage('https://example.com/private/page')]
  ]);
  const siteClient = {
    async fetchPage(url) {
      return pages.get(url);
    },
    async probe(url) {
      if (url === 'https://example.com/robots.txt') {
        return {
          statusCode: 200,
          body: [
            'User-agent: *',
            'Disallow: /private/',
            '',
            'User-agent: GoodieAI-SEO-Audit',
            'Allow: /'
          ].join('\n')
        };
      }
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient }).audit('https://example.com/');
  const crawlerIssue = report.issues.find((issue) => issue.id === 'crawler-access');
  const rootPage = report.pages.find((page) => page.url === 'https://example.com/');
  const privatePage = report.pages.find((page) => page.url === 'https://example.com/private/page');

  assert.deepEqual(crawlerIssue.affectedPages, ['https://example.com/private/page']);
  assert.equal(rootPage.crawlerAccess.crawlers.find((crawler) => crawler.key === 'googlebot').status, 'allowed');
  assert.equal(privatePage.crawlerAccess.crawlers.find((crawler) => crawler.key === 'googlebot').status, 'blocked');
  assert.equal(report.crawlerAccess.targetPath, '/');
});

test('skips pages disallowed for GoodieAI without fetching or probing them', async () => {
  const pages = new Map([
    ['https://example.com/', htmlPage('https://example.com/', [
      '/public',
      '/private/account',
      '/private/public/help'
    ])],
    ['https://example.com/public', htmlPage('https://example.com/public')],
    ['https://example.com/private/public/help', htmlPage('https://example.com/private/public/help')]
  ]);
  const fetched = [];
  const probed = [];
  const siteClient = {
    async fetchPage(url) {
      fetched.push(url);
      if (!pages.has(url)) throw new Error(`unexpected page fetch: ${url}`);
      return pages.get(url);
    },
    async probe(url, options) {
      probed.push({ url, kind: options?.requestKind });
      if (url.endsWith('/robots.txt')) {
        return {
          statusCode: 200,
          body: [
            'User-agent: *',
            'Allow: /',
            '',
            'User-agent: GoodieAI-SEO-Audit',
            'Disallow: /private/',
            'Allow: /private/public/'
          ].join('\n')
        };
      }
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient }).audit('https://example.com/');

  assert.equal(fetched.includes('https://example.com/private/account'), false);
  assert.equal(
    probed.some(({ url, kind }) => (
      url === 'https://example.com/private/account' && kind === 'link_probe'
    )),
    false
  );
  assert.deepEqual(report.site.robotsPolicy, {
    userAgent: 'GoodieAI-SEO-Audit',
    sourceStatus: 'valid',
    skippedCount: 1,
    skippedPages: [{
      url: 'https://example.com/private/account',
      matchedRule: 'Disallow: /private/'
    }]
  });
  assert.deepEqual(report.pages.map((page) => page.url).sort(), [
    'https://example.com/',
    'https://example.com/private/public/help',
    'https://example.com/public'
  ]);
});

test('stops a site audit when robots explicitly disallows the submitted entry', async () => {
  const calls = [];
  const siteClient = {
    async fetchPage(url) {
      calls.push(['page', url]);
      return htmlPage(url);
    },
    async probe(url, options) {
      calls.push(['probe', url, options?.requestKind]);
      if (url.endsWith('/robots.txt')) {
        return {
          statusCode: 200,
          body: 'User-agent: GoodieAI-SEO-Audit\nDisallow: /private/'
        };
      }
      throw new Error('default sitemap must not be fetched after robots denies the entry');
    }
  };

  await assert.rejects(
    () => createSeoSiteAuditService({ siteClient }).audit('https://example.com/private/'),
    {
      code: 'SEO_AUDIT_ROBOTS_DISALLOWED',
      status: 422,
      stopReason: 'robots_disallowed'
    }
  );
  assert.deepEqual(calls, [
    ['page', 'https://example.com/private/'],
    ['probe', 'https://example.com/robots.txt', 'robots']
  ]);
});

test('uses weighted site coverage and caps widespread noindex without averaging page scores', async () => {
  const pages = new Map([
    ['https://example.com/', htmlPage('https://example.com/', ['/a', '/b', '/c', '/d'])],
    ['https://example.com/a', htmlPage('https://example.com/a')],
    ['https://example.com/b', htmlPage('https://example.com/b')],
    ['https://example.com/c', htmlPage('https://example.com/c')],
    ['https://example.com/d', htmlPage('https://example.com/d')]
  ]);
  ['/a', '/b', '/c', '/d'].forEach((path) => {
    const page = pages.get(`https://example.com${path}`);
    page.html = page.html.replace('<head>', '<head><meta name="robots" content="noindex">');
  });
  const siteClient = {
    async fetchPage(url) {
      return pages.get(url);
    },
    async probe(url) {
      if (url.endsWith('/robots.txt')) return { statusCode: 200, body: 'User-agent: *\nAllow: /' };
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient }).audit('https://example.com/');

  assert.equal(report.health.blockers.some((blocker) => blocker.id === 'widespread-noindex'), true);
  assert.equal(report.health.blockers.find((blocker) => blocker.id === 'widespread-noindex').coverage, 0.5714);
  assert.equal(report.score, 39);
  assert.equal(report.pages.reduce((sum, page) => sum + page.score, 0) / report.pages.length > report.score, true);
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
  const diagnostics = {
    networkRequests: {
      total: 7,
      byKind: { page: 4, robots: 1, sitemap: 1, link_probe: 1 },
      redirectHops: 0
    },
    renderAttempts: 0,
    stopReason: null
  };
  const siteClient = {
    async fetchPage(url) {
      calls.pages.set(url, (calls.pages.get(url) || 0) + 1);
      return pages.get(url);
    },
    async probe(url) {
      calls.probes.set(url, (calls.probes.get(url) || 0) + 1);
      return { statusCode: 404, body: '' };
    },
    recordRenderAttempts(count) {
      diagnostics.renderAttempts += count;
    },
    setStopReason(stopReason) {
      diagnostics.stopReason = stopReason;
    },
    getRequestDiagnostics() {
      return structuredClone(diagnostics);
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
  assert.deepEqual(report.site.crawlDiagnostics, {
    networkRequests: {
      total: 7,
      byKind: { page: 4, robots: 1, sitemap: 1, link_probe: 1 },
      redirectHops: 0
    },
    renderAttempts: 2,
    stopReason: 'page_limit'
  });
});

test('bounds auxiliary discovery work to the requested page scope', async () => {
  const internalLinks = Array.from({ length: 30 }, (_, index) => `/internal-${index + 1}`);
  const externalLinks = Array.from(
    { length: 30 },
    (_, index) => `https://outside-${index + 1}.example/page`
  );
  const probes = [];
  const siteClient = {
    async fetchPage(url) {
      return htmlPage(url, [...externalLinks, ...internalLinks]);
    },
    async probe(url, options) {
      probes.push({ url, kind: options?.requestKind });
      if (url.endsWith('/robots.txt')) {
        return {
          statusCode: 200,
          headers: { 'content-type': 'text/plain' },
          body: 'User-agent: *\nAllow: /\nSitemap: https://example.com/declared-index.xml'
        };
      }
      if (url.endsWith('/sitemap.xml')) {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/xml' },
          body: '<urlset><url><loc>https://example.com/from-sitemap</loc></url></urlset>'
        };
      }
      if (url.endsWith('/declared-index.xml')) {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/xml' },
          body: '<sitemapindex><sitemap><loc>https://example.com/child.xml</loc></sitemap></sitemapindex>'
        };
      }
      return {
        statusCode: 200,
        finalUrl: url,
        headers: { 'content-type': 'text/html' },
        body: ''
      };
    }
  };

  const report = await createSeoSiteAuditService({
    siteClient,
    renderService: {
      async sample() {
        return { status: 'unavailable', reason: 'test', samples: [] };
      }
    }
  }).audit('https://example.com/', { maxPages: 1 });

  const linkProbes = probes.filter((entry) => entry.kind === 'link_probe');
  assert.equal(
    probes.some((entry) => entry.url === 'https://example.com/declared-index.xml'),
    false
  );
  assert.equal(linkProbes.length, 10);
  assert.equal(linkProbes.every((entry) => entry.url.startsWith('https://example.com/')), true);
  assert.deepEqual(report.sitewide.broken_links.coverage, {
    checked_targets: 10,
    complete: false
  });
  assert.equal(
    report.sitewide.checks.find((check) => check.id === 'broken-links').status,
    'unknown'
  );
});

test('does not let external link availability delay the full-site audit', async () => {
  const externalLinks = Array.from(
    { length: 30 },
    (_, index) => `https://outside-${index + 1}.example/page`
  );
  const linkProbes = [];
  const siteClient = {
    async fetchPage(url) {
      return htmlPage(url, externalLinks);
    },
    async probe(url, options) {
      if (options?.requestKind === 'link_probe') linkProbes.push(url);
      if (url.endsWith('/robots.txt')) {
        return {
          statusCode: 200,
          headers: { 'content-type': 'text/plain' },
          body: 'User-agent: *\nAllow: /'
        };
      }
      if (url.endsWith('/sitemap.xml')) {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/xml' },
          body: '<urlset><url><loc>https://example.com/</loc></url></urlset>'
        };
      }
      return { statusCode: 200, finalUrl: url, body: '' };
    }
  };

  const report = await createSeoSiteAuditService({
    siteClient,
    renderService: {
      async sample() {
        return { status: 'unavailable', reason: 'test', samples: [] };
      }
    }
  }).audit('https://example.com/', { maxPages: 1 });

  assert.deepEqual(linkProbes, []);
  assert.deepEqual(report.sitewide.broken_links.coverage, {
    checked_targets: 0,
    complete: true
  });
  assert.equal(
    report.sitewide.checks.find((check) => check.id === 'broken-links').status,
    'passed'
  );
});

test('probes internal link targets outside the audited page limit', async () => {
  const pages = new Map([
    ['https://example.com/', htmlPage('https://example.com/', ['/a', '/missing'])],
    ['https://example.com/a', htmlPage('https://example.com/a')]
  ]);
  const probed = [];
  const siteClient = {
    async fetchPage(url) {
      return pages.get(url);
    },
    async probe(url) {
      probed.push(url);
      if (url === 'https://example.com/missing') return { statusCode: 404, finalUrl: url };
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient }).audit('https://example.com/', {
    maxPages: 1
  });

  assert.equal(probed.includes('https://example.com/missing'), true);
  assert.equal(
    report.sitewide.broken_links.internal.some((link) => link.url === 'https://example.com/missing'),
    true
  );
});

test('keeps external WAF links out of the full-site request path', async () => {
  let externalRequests = 0;
  const siteClient = createSeoSiteClient({
    minOriginIntervalMs: 0,
    resolveHostname: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async ({ url }) => {
      const parsed = new URL(url);
      if (parsed.origin === 'https://outside.example') {
        externalRequests += 1;
        return {
          status: 403,
          headers: { 'content-type': 'text/html' },
          data: '<html><meta name="EO-Bot-Js-Token" content="REDACTED_TEST_VALUE"><script>window.__EDGEONE_TEST_CHALLENGE__ = true;</script></html>'
        };
      }
      if (parsed.pathname === '/') {
        return {
          status: 200,
          headers: { 'content-type': 'text/html' },
          data: htmlPage('https://example.com/', [
            'https://outside.example/a',
            'https://outside.example/b'
          ]).html
        };
      }
      return { status: 404, headers: { 'content-type': 'text/plain' }, data: '' };
    }
  });
  const ruleConfig = {
    ...defaultSeoAuditRules,
    crawl: { ...defaultSeoAuditRules.crawl, concurrency: 1 }
  };

  const report = await createSeoSiteAuditService({
    siteClient,
    ruleConfig,
    renderService: {
      async sample() {
        return { status: 'unavailable', reason: 'test', samples: [] };
      }
    }
  }).audit('https://example.com/');

  assert.equal(report.site.successfulPages, 1);
  assert.equal(report.site.crawlDiagnostics.stopReason, 'completed');
  assert.equal(externalRequests, 0);
  assert.equal(
    report.sitewide.checks.find((check) => check.id === 'broken-links').status,
    'passed'
  );
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

test('adds cross-page SEO evidence and JavaScript render sampling to the formal site report', async () => {
  const root = htmlPage('https://example.com/', ['/a', '/missing']);
  root.html = root.html
    .replace('href="https://example.com/"', 'href="https://example.com/a"')
    .replace('</head>', '<link rel="alternate" hreflang="en" href="/a"></head>');
  const pageA = htmlPage('https://example.com/a');
  pageA.html = pageA.html.replace('href="https://example.com/a"', 'href="https://example.com/"');
  const orphan = htmlPage('https://example.com/orphan');
  const pages = new Map([
    ['https://example.com/', root],
    ['https://example.com/a', pageA],
    ['https://example.com/orphan', orphan]
  ]);
  const siteClient = {
    async fetchPage(url) {
      if (!pages.has(url)) {
        throw Object.assign(new Error('页面不存在'), { code: 'UPSTREAM_UNAVAILABLE', status: 502 });
      }
      return pages.get(url);
    },
    async probe(url) {
      if (url === 'https://example.com/sitemap.xml') {
        return {
          statusCode: 200,
          body: [
            '<urlset>',
            '<url><loc>https://example.com/</loc></url>',
            '<url><loc>https://example.com/a</loc></url>',
            '<url><loc>https://example.com/orphan</loc></url>',
            '<url><loc>https://example.com/dead</loc></url>',
            '</urlset>'
          ].join('')
        };
      }
      return { statusCode: 404, body: '' };
    }
  };
  const renderService = {
    async sample(entries) {
      return {
        status: 'completed',
        samples: [{
          url: entries[0].url,
          source: entries[0].source,
          rendered: {
            ...entries[0].source,
            title: '浏览器渲染后的标题'
          }
        }]
      };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient, renderService })
    .audit('https://example.com/');

  assert.equal(report.sitewide.version, 'sitewide-audit-v4');
  assert.equal(report.sitewide.checks.find((check) => check.id === 'duplicate-titles').status, 'failed');
  assert.equal(report.sitewide.checks.find((check) => check.id === 'canonical-conflicts').status, 'failed');
  assert.equal(report.sitewide.checks.find((check) => check.id === 'broken-links').status, 'failed');
  assert.deepEqual(report.sitewide.orphan_pages, ['https://example.com/orphan']);
  assert.equal(report.sitewide.checks.find((check) => check.id === 'hreflang').status, 'failed');
  assert.equal(report.sitewide.checks.find((check) => check.id === 'sitemap-coverage').status, 'failed');
  assert.equal(report.sitewide.checks.find((check) => check.id === 'javascript-rendering').status, 'failed');
  assert.equal(report.summary.sitewideIssues, report.sitewide.issues.length);
});

test('collects navigation semantics, link regions and URL consistency evidence', async () => {
  const root = htmlPage('https://example.com/');
  root.html = root.html
    .replace(
      '<body>',
      '<body><nav><span class="cursor-pointer">解决方案</span><div onclick="window.location.href=\'/news\'">新闻中心</div><a href="#">占位链接</a></nav><main><a href="/content">正文入口</a></main><footer><a href="/footer-only">页脚入口</a></footer>'
    )
    .replace(
      '<link rel="canonical" href="https://example.com/">',
      '<link rel="canonical" href="https://wrong.example/"><meta property="og:url" content="https://wrong.example/">'
    );
  const pages = new Map([
    ['https://example.com/', root],
    ['https://example.com/content', htmlPage('https://example.com/content')],
    ['https://example.com/footer-only', htmlPage('https://example.com/footer-only')]
  ]);
  const siteClient = {
    async fetchPage(url) {
      return pages.get(url);
    },
    async probe(url) {
      if (url === 'https://example.com/robots.txt') {
        return {
          statusCode: 200,
          body: 'User-agent: *\nAllow: /\nSitemap: https://wrong.example/sitemap.xml'
        };
      }
      if (url === 'https://example.com/sitemap.xml') {
        return {
          statusCode: 200,
          body: [
            '<urlset>',
            '<url><loc>https://example.com/</loc></url>',
            '<url><loc>https://example.com/content</loc></url>',
            '<url><loc>https://example.com/footer-only</loc></url>',
            '<url><loc>https://wrong.example/external</loc></url>',
            '</urlset>'
          ].join('')
        };
      }
      return { statusCode: 404, body: '' };
    }
  };

  const report = await createSeoSiteAuditService({ siteClient }).audit('https://example.com/');

  assert.equal(
    report.sitewide.checks.find((check) => check.id === 'navigation-crawlability').status,
    'failed'
  );
  assert.equal(
    report.sitewide.navigation_crawlability.static_issues.some((issue) => (
      issue.tag === 'span' && issue.text === '解决方案'
    )),
    false
  );
  assert.equal(
    report.sitewide.navigation_crawlability.static_issues.some((issue) => (
      issue.tag === 'div' && issue.text === '新闻中心'
    )),
    true
  );
  assert.equal(
    report.sitewide.navigation_crawlability.static_issues.some((issue) => (
      issue.type === 'invalid-anchor' && issue.reason === 'fragment_placeholder'
    )),
    true
  );
  assert.deepEqual(report.sitewide.internal_link_quality.footer_only_pages, [
    'https://example.com/footer-only'
  ]);
  assert.deepEqual(
    new Set(report.sitewide.url_consistency.issues.map((issue) => issue.type)),
    new Set([
      'robots-sitemap-origin',
      'sitemap-entry-origin',
      'canonical-origin',
      'open-graph-origin'
    ])
  );
});
