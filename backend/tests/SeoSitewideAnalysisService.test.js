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

test('classifies sitemap pages by internal link source quality', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [
      page('https://example.com/', {
        links: [
          {
            url: 'https://example.com/footer-only',
            internal: true,
            region: 'footer',
            text: '页脚入口'
          },
          {
            url: 'https://example.com/structural',
            internal: true,
            region: 'content',
            text: '正文入口'
          }
        ]
      }),
      page('https://example.com/footer-only'),
      page('https://example.com/structural'),
      page('https://example.com/orphan')
    ],
    sitemapUrls: [
      'https://example.com/',
      'https://example.com/footer-only',
      'https://example.com/structural',
      'https://example.com/orphan'
    ],
    linkChecks: [],
    renderAnalysis: { status: 'unavailable', samples: [] }
  });

  assert.deepEqual(result.internal_link_quality.footer_only_pages, [
    'https://example.com/footer-only'
  ]);
  assert.deepEqual(result.internal_link_quality.orphan_pages, [
    'https://example.com/orphan'
  ]);
  assert.deepEqual(
    result.internal_link_quality.pages.find((entry) => (
      entry.url === 'https://example.com/structural'
    )),
    {
      url: 'https://example.com/structural',
      inbound_count: 1,
      source_page_count: 1,
      regions: { header: 0, navigation: 0, content: 1, footer: 0, other: 0 },
      classification: 'structural',
      sources: [{
        source_url: 'https://example.com/',
        region: 'content',
        text: '正文入口'
      }]
    }
  );
  assert.equal(
    result.checks.find((check) => check.id === 'internal-link-quality').status,
    'failed'
  );
});

test('reports non-semantic navigation controls and interaction-dependent links', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [
      page('https://example.com/', {
        navigationIssues: [{
          type: 'non-semantic-navigation-control',
          tag: 'span',
          text: '解决方案',
          region: 'navigation',
          reason: 'clickable_non_link'
        }]
      })
    ],
    sitemapUrls: ['https://example.com/'],
    linkChecks: [],
    renderAnalysis: {
      status: 'completed',
      samples: [{
        url: 'https://example.com/',
        source: {
          title: '首页',
          description: '',
          contentCharacters: 100,
          linkCount: 1
        },
        rendered: {
          title: '首页',
          description: '',
          contentCharacters: 100,
          linkCount: 1,
          navigation: {
            nonSemanticControls: [{
              tag: 'span',
              text: '解决方案',
              reason: 'clickable_non_link'
            }],
            interactionDependentLinks: [{
              triggerText: '解决方案',
              links: [{
                url: 'https://example.com/solutions/energy',
                text: '能源'
              }]
            }]
          }
        }
      }]
    }
  });

  assert.equal(
    result.checks.find((check) => check.id === 'navigation-crawlability').status,
    'failed'
  );
  assert.equal(
    result.checks.find((check) => check.id === 'navigation-crawlability').finding,
    '1 个导航项无法直接读取地址；另有 1 组链接仅在交互后出现'
  );
  assert.equal(
    result.checks.find((check) => check.id === 'navigation-crawlability').value,
    '1 类 div/span 跳转'
  );
  assert.deepEqual(result.navigation_crawlability.static_issues, [{
    type: 'non-semantic-navigation-control',
    tag: 'span',
    text: '解决方案',
    region: 'navigation',
    reason: 'clickable_non_link',
    sourcePageCount: 1,
    sourcePages: ['https://example.com/']
  }]);
  assert.equal(result.navigation_crawlability.interaction_dependent_links.length, 1);
  assert.deepEqual(
    result.navigation_crawlability.interaction_dependent_links[0].links,
    [{
      url: 'https://example.com/solutions/energy',
      text: '能源'
    }]
  );
});

test('describes interaction-only navigation issues without empty or zero-valued copy', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [page('https://example.com/')],
    sitemapUrls: ['https://example.com/'],
    linkChecks: [],
    renderAnalysis: {
      status: 'completed',
      samples: [{
        url: 'https://example.com/',
        source: {},
        rendered: {
          navigation: {
            nonSemanticControls: [],
            interactionDependentLinks: [{
              triggerText: '产品中心',
              links: [{ url: 'https://example.com/products', text: '全部产品' }]
            }]
          }
        }
      }]
    }
  });

  const navigation = result.checks.find((check) => check.id === 'navigation-crawlability');

  assert.equal(navigation.status, 'failed');
  assert.equal(navigation.finding, '1 组链接仅在交互后出现');
  assert.equal(navigation.value, '1 组交互后链接');
  assert.doesNotMatch(`${navigation.finding}${navigation.value}`, /\b0\b/);
});

test('bounds repeated navigation source-page evidence while retaining the total count', () => {
  const pages = Array.from({ length: 60 }, (_, index) => page(
    `https://example.com/page-${index}`,
    {
      navigationIssues: [{
        type: 'non-semantic-navigation-control',
        tag: 'span',
        text: '产品中心',
        region: 'header',
        reason: 'clickable_non_link'
      }]
    }
  ));
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages,
    sitemapUrls: pages.map((entry) => entry.url),
    linkChecks: [],
    renderAnalysis: { status: 'unavailable', samples: [] }
  });
  const [issue] = result.navigation_crawlability.static_issues;

  assert.equal(issue.sourcePageCount, 60);
  assert.equal(issue.sourcePages.length, 50);
});

test('reports cross-origin and non-public SEO URL declarations', () => {
  const result = analyzeSitewideEvidence({
    origin: 'http://localhost:3003',
    pages: [
      page('http://localhost:3003/', {
        canonicalUrls: ['https://www.example.com/'],
        openGraphUrl: 'https://www.example.com/'
      })
    ],
    sitemapUrls: ['http://localhost:3003/'],
    declaredSitemaps: ['https://www.example.com/sitemap.xml'],
    sitemapReferences: [{
      source: 'http://localhost:3003/sitemap.xml',
      url: 'https://www.example.com/product',
      kind: 'url'
    }],
    linkChecks: [],
    renderAnalysis: { status: 'unavailable', samples: [] }
  });

  const check = result.checks.find((item) => item.id === 'url-consistency');
  assert.equal(check.status, 'failed');
  assert.deepEqual(
    new Set(result.url_consistency.issues.map((issue) => issue.type)),
    new Set([
      'non-public-origin',
      'robots-sitemap-origin',
      'sitemap-entry-origin',
      'canonical-origin',
      'open-graph-origin'
    ])
  );
  assert.equal(result.url_consistency.expected_origin, 'http://localhost:3003');
});

test('does not claim orphan or hreflang health when a page crawl failed', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [
      page('https://example.com/'),
      page('https://example.com/source', { status: 'failed' }),
      page('https://example.com/target')
    ],
    sitemapUrls: [
      'https://example.com/',
      'https://example.com/source',
      'https://example.com/target'
    ],
    linkChecks: [],
    renderAnalysis: { status: 'unavailable', samples: [] }
  });

  assert.equal(result.checks.find((check) => check.id === 'orphan-pages').status, 'unknown');
  assert.equal(result.checks.find((check) => check.id === 'hreflang').status, 'unknown');
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

test('does not calculate sitemap coverage without a usable sitemap page inventory', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [
      page('https://example.com/'),
      page('https://example.com/products')
    ],
    sitemapUrls: [],
    sitemapInventoryComplete: true,
    linkChecks: [],
    renderAnalysis: { status: 'unavailable', samples: [] }
  });

  const coverage = result.checks.find((check) => check.id === 'sitemap-coverage');

  assert.equal(coverage.status, 'unknown');
  assert.equal(coverage.finding, '暂时无法检查');
  assert.equal(coverage.value, '未获得有效 Sitemap 页面清单');
  assert.doesNotMatch(coverage.finding, /2 个可索引页面缺失/);
});

test('does not claim that orphan pages are healthy without an independent page inventory', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [
      page('https://example.com/', {
        links: [{
          url: 'https://example.com/products',
          internal: true,
          region: 'navigation',
          text: '产品中心'
        }]
      }),
      page('https://example.com/products')
    ],
    sitemapUrls: [],
    sitemapInventoryComplete: true,
    linkChecks: [],
    renderAnalysis: { status: 'unavailable', samples: [] }
  });

  const orphanPages = result.checks.find((check) => check.id === 'orphan-pages');

  assert.equal(orphanPages.status, 'unknown');
  assert.equal(orphanPages.finding, '暂时无法检查');
  assert.equal(orphanPages.value, '未获得有效 Sitemap 页面清单');
  assert.notEqual(orphanPages.finding, 'Sitemap 页面均有内部链接入口');
});

test('does not claim internal-link source quality without an independent page inventory', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [page('https://example.com/')],
    sitemapUrls: [],
    sitemapInventoryComplete: true,
    linkChecks: [],
    renderAnalysis: { status: 'unavailable', samples: [] }
  });

  const linkQuality = result.checks.find((check) => check.id === 'internal-link-quality');

  assert.equal(linkQuality.status, 'unknown');
  assert.equal(linkQuality.finding, '暂时无法检查');
  assert.equal(linkQuality.value, '未获得有效 Sitemap 页面清单');
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

test('treats unaudited and cross-origin hreflang targets as unverified instead of errors', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [
      page('https://example.com/zh', {
        hreflang: [
          { language: 'en', url: 'https://example.com/en' },
          { language: 'fr', url: 'https://example.fr/' }
        ]
      })
    ],
    sitemapUrls: [],
    linkChecks: [],
    renderAnalysis: { status: 'unavailable', samples: [] }
  });

  assert.deepEqual(result.hreflang.errors, []);
  assert.equal(result.hreflang.unverified.length, 2);
  assert.equal(result.checks.find((check) => check.id === 'hreflang').status, 'unknown');
});

test('does not report incomplete sitewide evidence as passed', () => {
  const result = analyzeSitewideEvidence({
    origin: 'https://example.com',
    pages: [page('https://example.com/')],
    sitemapUrls: ['https://example.com/'],
    linkChecks: [],
    renderAnalysis: { status: 'unavailable', samples: [] },
    truncated: true,
    linkInventoryComplete: false,
    sitemapInventoryComplete: false
  });

  ['duplicate-titles', 'duplicate-descriptions', 'canonical-conflicts', 'redirects',
    'broken-links', 'orphan-pages', 'internal-link-quality', 'sitemap-coverage',
    'url-consistency', 'hreflang', 'navigation-crawlability'].forEach((id) => {
    assert.equal(result.checks.find((check) => check.id === id).status, 'unknown', id);
  });
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
    mode: 'site',
    ruleVersion: 'rules-v1',
    site: { origin: 'https://example.com', truncated: false },
    issues: [{
      id: 'title',
      title: '页面标题',
      affectedPages: ['https://example.com/a']
    }],
    sitewide: {
      version: 'sitewide-audit-v2',
      checks: [],
      issues: [{
        id: 'broken-links',
        title: '失效内链与外链',
        affectedPages: ['https://example.com/']
      }]
    }
  };
  const current = {
    mode: 'site',
    ruleVersion: 'rules-v1',
    site: { origin: 'https://example.com', truncated: false },
    issues: [{
      id: 'title',
      title: '页面标题',
      affectedPages: ['https://example.com/a']
    }],
    sitewide: {
      version: 'sitewide-audit-v2',
      checks: [],
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

test('does not claim resolved issues when audit scope or evidence is not comparable', () => {
  const previous = {
    auditId: 10,
    mode: 'site',
    ruleVersion: 'rules-v1',
    site: { origin: 'https://example.com', truncated: false },
    issues: [],
    sitewide: {
      version: 'sitewide-audit-v2',
      checks: [],
      issues: [{ id: 'broken-links', title: '失效链接', affectedPages: ['https://example.com/'] }]
    }
  };
  const current = {
    mode: 'site',
    ruleVersion: 'rules-v2',
    site: { origin: 'https://example.com', truncated: false },
    issues: [],
    sitewide: { version: 'sitewide-audit-v2', checks: [], issues: [] }
  };

  const comparison = compareAuditIssues(current, previous);

  assert.equal(comparison.status, 'not_comparable');
  assert.deepEqual(comparison.resolved, []);
});

test('does not compare issue changes across scoring versions', () => {
  const base = {
    mode: 'site',
    ruleVersion: 'rules-v1',
    site: { origin: 'https://example.com', truncated: false },
    issues: [],
    sitewide: { version: 'sitewide-audit-v2', checks: [], issues: [] }
  };
  const previous = {
    ...base,
    auditId: 10,
    scoreVersion: 'score-v1'
  };
  const current = {
    ...base,
    scoreVersion: 'score-v2'
  };

  const comparison = compareAuditIssues(current, previous);

  assert.equal(comparison.status, 'not_comparable');
  assert.deepEqual(comparison.reason_codes, ['score_version']);
});

test('keeps previously failed checks unverified when current evidence is unknown', () => {
  const base = {
    mode: 'site',
    ruleVersion: 'rules-v1',
    site: { origin: 'https://example.com', truncated: false },
    issues: []
  };
  const previous = {
    ...base,
    auditId: 10,
    sitewide: {
      version: 'sitewide-audit-v2',
      checks: [],
      issues: [{ id: 'broken-links', title: '失效链接', affectedPages: ['https://example.com/'] }]
    }
  };
  const current = {
    ...base,
    sitewide: {
      version: 'sitewide-audit-v2',
      checks: [{ id: 'broken-links', status: 'unknown' }],
      issues: []
    }
  };

  const comparison = compareAuditIssues(current, previous);

  assert.equal(comparison.status, 'partial');
  assert.deepEqual(comparison.resolved, []);
  assert.deepEqual(comparison.unverified.map((item) => item.id), ['broken-links']);
});

test('keeps page-rule issues unverified when the current page crawl failed', () => {
  const base = {
    mode: 'site',
    ruleVersion: 'rules-v1',
    scoreVersion: 'score-v1',
    site: { origin: 'https://example.com', truncated: false }
  };
  const previous = {
    ...base,
    auditId: 10,
    pages: [{ url: 'https://example.com/a', status: 'completed' }],
    issues: [{ id: 'title', title: '页面标题', affectedPages: ['https://example.com/a'] }],
    sitewide: { version: 'sitewide-audit-v2', checks: [], issues: [] }
  };
  const current = {
    ...base,
    pages: [{ url: 'https://example.com/a', status: 'failed' }],
    issues: [{ id: 'http-status', title: '页面访问状态', affectedPages: ['https://example.com/a'] }],
    sitewide: { version: 'sitewide-audit-v2', checks: [], issues: [] }
  };

  const comparison = compareAuditIssues(current, previous);

  assert.equal(comparison.status, 'partial');
  assert.deepEqual(comparison.resolved, []);
  assert.deepEqual(comparison.unverified.map((item) => item.id), ['title']);
});

test('keeps a failed page sitewide occurrence unverified while the same check still fails elsewhere', () => {
  const base = {
    mode: 'site',
    ruleVersion: 'rules-v1',
    scoreVersion: 'score-v1',
    site: { origin: 'https://example.com', truncated: false },
    issues: []
  };
  const previous = {
    ...base,
    auditId: 10,
    pages: [
      { url: 'https://example.com/a', status: 'completed' },
      { url: 'https://example.com/b', status: 'completed' }
    ],
    sitewide: {
      version: 'sitewide-audit-v2',
      checks: [],
      issues: [{
        id: 'broken-links',
        title: '失效内链与外链',
        affectedPages: ['https://example.com/a', 'https://example.com/b']
      }]
    }
  };
  const current = {
    ...base,
    pages: [
      { url: 'https://example.com/a', status: 'failed' },
      { url: 'https://example.com/b', status: 'completed' }
    ],
    sitewide: {
      version: 'sitewide-audit-v2',
      checks: [{ id: 'broken-links', status: 'failed' }],
      issues: [{
        id: 'broken-links',
        title: '失效内链与外链',
        affectedPages: ['https://example.com/b']
      }]
    }
  };

  const comparison = compareAuditIssues(current, previous);

  assert.equal(comparison.status, 'partial');
  assert.deepEqual(comparison.resolved, []);
  assert.deepEqual(comparison.persisting.map((item) => item.url), ['https://example.com/b']);
  assert.deepEqual(comparison.unverified.map((item) => item.url), ['https://example.com/a']);
});
