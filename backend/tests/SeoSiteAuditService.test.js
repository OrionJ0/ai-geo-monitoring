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

test('private site audits skip external probes and browser rendering without hiding the evidence gap', async () => {
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
    'unknown'
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
        return { statusCode: 200, body: 'User-agent: *\nDisallow: /private/' };
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
  const root = htmlPage('https://example.com/', ['/a', 'https://outside.example/missing']);
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

  assert.equal(report.sitewide.version, 'sitewide-audit-v3');
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
      '<body><nav><span class="cursor-pointer">解决方案</span><a href="#">占位链接</a></nav><main><a href="/content">正文入口</a></main><footer><a href="/footer-only">页脚入口</a></footer>'
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
