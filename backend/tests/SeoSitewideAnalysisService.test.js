const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeSitewideEvidence,
  compareAuditIssues
} = require('../services/SeoSitewideAnalysisService');

function page(url, overrides = {}) {
  return {
    url,
    finalUrl: url,
    status: 'completed',
    statusCode: 200,
    indexable: true,
    title: `页面 ${url}`,
    description: `页面描述 ${url}`,
    canonicalUrls: [url],
    hreflang: [],
    links: [],
    redirectChain: [],
    ...overrides
  };
}

test('detects duplicate titles and descriptions across successful pages', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [
      page('https://example.com/', {
        title: '同一个标题',
        description: '同一个描述'
      }),
      page('https://example.com/a', {
        title: ' 同一个标题 ',
        description: '同一个描述'
      }),
      page('https://example.com/b')
    ],
    sitemapUrls: [],
    linkChecks: [],
    renderAnalysis: { status: 'unavailable', samples: [] }
  });

  assert.deepEqual(result.duplicate_titles, [{
    value: '同一个标题',
    pages: ['https://example.com/', 'https://example.com/a']
  }]);
  assert.deepEqual(result.duplicate_descriptions, [{
    value: '同一个描述',
    pages: ['https://example.com/', 'https://example.com/a']
  }]);
  assert.equal(result.checks.find((check) => check.id === 'duplicate-titles').status, 'failed');
  assert.equal(result.checks.find((check) => check.id === 'duplicate-descriptions').status, 'failed');
});

test('builds canonical clusters and detects multiple declarations, chains and loops', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [
      page('https://example.com/a', { canonicalUrls: ['https://example.com/b'] }),
      page('https://example.com/b', { canonicalUrls: ['https://example.com/c'] }),
      page('https://example.com/c', { canonicalUrls: ['https://example.com/a'] }),
      page('https://example.com/d', {
        canonicalUrls: ['https://example.com/d', 'https://example.com/e']
      }),
      page('https://example.com/e', { canonicalUrls: ['https://example.com/e'] }),
      page('https://example.com/variant', { canonicalUrls: ['https://example.com/e'] })
    ],
    sitemapUrls: [],
    linkChecks: [],
    renderAnalysis: { status: 'unavailable', samples: [] }
  });

  assert.deepEqual(
    result.canonical.clusters.find((cluster) => cluster.canonicalUrl === 'https://example.com/e'),
    {
      canonicalUrl: 'https://example.com/e',
      pages: ['https://example.com/d', 'https://example.com/e', 'https://example.com/variant']
    }
  );
  assert.equal(result.canonical.conflicts.some((conflict) => conflict.type === 'multiple'), true);
  assert.equal(result.canonical.conflicts.some((conflict) => conflict.type === 'chain'), true);
  assert.equal(result.canonical.conflicts.some((conflict) => conflict.type === 'loop'), true);
  assert.equal(result.checks.find((check) => check.id === 'canonical-conflicts').status, 'failed');
});

test('reports redirect chains and redirect loops separately', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [
      page('https://example.com/old', {
        finalUrl: 'https://example.com/new',
        redirectChain: [
          { from: 'https://example.com/old', statusCode: 301, to: 'https://example.com/middle' },
          { from: 'https://example.com/middle', statusCode: 302, to: 'https://example.com/new' }
        ]
      }),
      page('https://example.com/loop-a', {
        status: 'failed',
        statusCode: 0,
        errorCode: 'REDIRECT_LOOP',
        redirectChain: [
          { from: 'https://example.com/loop-a', statusCode: 301, to: 'https://example.com/loop-b' },
          { from: 'https://example.com/loop-b', statusCode: 301, to: 'https://example.com/loop-a' }
        ]
      })
    ],
    sitemapUrls: [],
    linkChecks: [],
    renderAnalysis: { status: 'unavailable', samples: [] }
  });

  assert.equal(result.redirects.chains.length, 1);
  assert.equal(result.redirects.loops.length, 1);
  assert.equal(result.checks.find((check) => check.id === 'redirects').status, 'failed');
});

test('separates broken internal and external links with their source pages', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [page('https://example.com/')],
    sitemapUrls: [],
    linkChecks: [
      {
        url: 'https://example.com/missing',
        internal: true,
        statusCode: 404,
        sourcePages: ['https://example.com/']
      },
      {
        url: 'https://outside.example/report',
        internal: false,
        statusCode: 503,
        sourcePages: ['https://example.com/']
      },
      {
        url: 'https://outside.example/ok',
        internal: false,
        statusCode: 200,
        sourcePages: ['https://example.com/']
      }
    ],
    renderAnalysis: { status: 'unavailable', samples: [] }
  });

  assert.deepEqual(result.broken_links.internal.map((link) => link.url), [
    'https://example.com/missing'
  ]);
  assert.deepEqual(result.broken_links.external.map((link) => link.url), [
    'https://outside.example/report'
  ]);
  assert.equal(result.checks.find((check) => check.id === 'broken-links').status, 'failed');
});

test('finds sitemap pages with no incoming internal links as orphan pages', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [
      page('https://example.com/', {
        links: [{ url: 'https://example.com/linked', internal: true }]
      }),
      page('https://example.com/linked'),
      page('https://example.com/orphan')
    ],
    sitemapUrls: [
      'https://example.com/',
      'https://example.com/linked',
      'https://example.com/orphan'
    ],
    linkChecks: [],
    renderAnalysis: { status: 'unavailable', samples: [] }
  });

  assert.deepEqual(result.orphan_pages, ['https://example.com/orphan']);
  assert.equal(result.checks.find((check) => check.id === 'orphan-pages').status, 'failed');
});

test('compares sitemap inventory with accessible and indexable crawled pages', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [
      page('https://example.com/'),
      page('https://example.com/live'),
      page('https://example.com/dead', { status: 'failed', statusCode: 404 }),
      page('https://example.com/noindex', { indexable: false }),
      page('https://example.com/redirected', {
        finalUrl: 'https://example.com/final',
        redirectChain: [{
          from: 'https://example.com/redirected',
          statusCode: 301,
          to: 'https://example.com/final'
        }]
      })
    ],
    sitemapUrls: [
      'https://example.com/',
      'https://example.com/dead',
      'https://example.com/noindex',
      'https://example.com/redirected'
    ],
    linkChecks: [],
    renderAnalysis: { status: 'unavailable', samples: [] }
  });

  assert.deepEqual(result.sitemap.missing_from_sitemap, [
    'https://example.com/live',
    'https://example.com/final'
  ]);
  assert.deepEqual(result.sitemap.invalid_entries.map((entry) => entry.url), [
    'https://example.com/dead',
    'https://example.com/noindex',
    'https://example.com/redirected'
  ]);
  assert.equal(result.checks.find((check) => check.id === 'sitemap-coverage').status, 'failed');
});

test('detects invalid, duplicate and non-reciprocal hreflang declarations', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [
      page('https://example.com/zh', {
        hreflang: [
          { language: 'en', url: 'https://example.com/en' },
          { language: 'en', url: 'https://example.com/en-alt' },
          { language: 'english', url: 'https://example.com/en' }
        ]
      }),
      page('https://example.com/en', { hreflang: [] }),
      page('https://example.com/en-alt', {
        hreflang: [{ language: 'zh-CN', url: 'https://example.com/zh' }]
      })
    ],
    sitemapUrls: [],
    linkChecks: [],
    renderAnalysis: { status: 'unavailable', samples: [] }
  });

  assert.equal(result.hreflang.errors.some((error) => error.type === 'invalid-language'), true);
  assert.equal(result.hreflang.errors.some((error) => error.type === 'duplicate-language'), true);
  assert.equal(result.hreflang.errors.some((error) => error.type === 'missing-return'), true);
  assert.equal(result.checks.find((check) => check.id === 'hreflang').status, 'failed');
});

test('reports material differences found by JavaScript rendering samples', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [page('https://example.com/app')],
    sitemapUrls: [],
    linkChecks: [],
    renderAnalysis: {
      status: 'completed',
      samples: [{
        url: 'https://example.com/app',
        source: {
          title: '',
          description: '',
          contentCharacters: 20,
          linkCount: 0
        },
        rendered: {
          title: '客户端渲染标题',
          description: '客户端渲染描述',
          contentCharacters: 800,
          linkCount: 12
        }
      }]
    }
  });

  assert.equal(result.rendering.differences.length, 1);
  assert.deepEqual(result.rendering.differences[0].fields, [
    'title',
    'description',
    'content',
    'links'
  ]);
  assert.equal(result.checks.find((check) => check.id === 'javascript-rendering').status, 'failed');
});

test('marks JavaScript rendering evidence unknown when no browser renderer is configured', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [page('https://example.com/')],
    sitemapUrls: [],
    linkChecks: [],
    renderAnalysis: {
      status: 'unavailable',
      reason: 'renderer_not_configured',
      samples: []
    }
  });

  const check = result.checks.find((item) => item.id === 'javascript-rendering');
  assert.equal(check.status, 'unknown');
  assert.equal(result.issues.some((issue) => issue.id === 'javascript-rendering'), false);
});

test('marks JavaScript rendering evidence unknown when only part of the sample completed', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [page('https://example.com/'), page('https://example.com/failed')],
    sitemapUrls: [],
    linkChecks: [],
    renderAnalysis: {
      status: 'partial',
      reason: 'some_samples_failed',
      samples: [
        {
          url: 'https://example.com/',
          source: { title: '首页', description: '', contentCharacters: 100, linkCount: 1 },
          rendered: { title: '首页', description: '', contentCharacters: 100, linkCount: 1 }
        },
        {
          url: 'https://example.com/failed',
          source: {},
          errorCode: 'renderer_timeout'
        }
      ]
    }
  });

  const check = result.checks.find((item) => item.id === 'javascript-rendering');
  assert.equal(check.status, 'unknown');
  assert.match(check.value, /1 个成功，1 个失败/);
  assert.deepEqual(result.rendering.failures, [{
    url: 'https://example.com/failed',
    errorCode: 'renderer_timeout'
  }]);
});

test('compares current issue occurrences with the previous site audit', () => {
  const previous = {
    auditId: 10,
    checkedAt: '2026-07-20T00:00:00.000Z',
    issues: [{
      id: 'title',
      title: '页面标题',
      affectedPages: ['https://example.com/a']
    }],
    sitewide: {
      issues: [{
        id: 'broken-links',
        title: '失效内链与外链',
        affectedPages: ['https://example.com/']
      }]
    }
  };
  const current = {
    issues: [{
      id: 'title',
      title: '页面标题',
      affectedPages: ['https://example.com/a']
    }],
    sitewide: {
      issues: [{
        id: 'duplicate-titles',
        title: '重复页面标题',
        affectedPages: ['https://example.com/a']
      }]
    }
  };

  const comparison = compareAuditIssues(current, previous);

  assert.equal(comparison.previous_audit_id, 10);
  assert.deepEqual(comparison.added.map((item) => item.id), ['duplicate-titles']);
  assert.deepEqual(comparison.resolved.map((item) => item.id), ['broken-links']);
  assert.deepEqual(comparison.persisting.map((item) => item.id), ['title']);
});
