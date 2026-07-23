const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateCrawlerAccess } = require('../services/RobotsAccessService');

const profiles = [
  { key: 'googlebot', label: 'Googlebot', token: 'Googlebot', category: 'search', affectsScore: true },
  { key: 'bingbot', label: 'Bingbot', token: 'bingbot', category: 'search', affectsScore: true },
  { key: 'baiduspider', label: 'Baiduspider', token: 'Baiduspider', category: 'search', affectsScore: true },
  { key: 'oai-searchbot', label: 'OAI-SearchBot', token: 'OAI-SearchBot', category: 'ai-search', affectsScore: true }
];

test('wildcard allow makes every crawler without a specific group allowed', () => {
  const result = evaluateCrawlerAccess({
    robotsResult: { statusCode: 200, body: 'User-agent: *\nAllow: /' },
    targetUrl: 'https://example.com/products/one?from=search',
    profiles
  });

  assert.equal(result.passed, true);
  assert.equal(result.allowed, 4);
  assert.equal(result.blocked, 0);
  assert.deepEqual(result.crawlers.map(({ key, status, matchedUserAgent }) => ({ key, status, matchedUserAgent })), [
    { key: 'googlebot', status: 'allowed', matchedUserAgent: '*' },
    { key: 'bingbot', status: 'allowed', matchedUserAgent: '*' },
    { key: 'baiduspider', status: 'allowed', matchedUserAgent: '*' },
    { key: 'oai-searchbot', status: 'allowed', matchedUserAgent: '*' }
  ]);
});

test('a specific crawler group overrides the wildcard group', () => {
  const result = evaluateCrawlerAccess({
    robotsResult: {
      statusCode: 200,
      body: 'User-agent: *\nAllow: /\n\nUser-agent: Googlebot\nDisallow: /products/'
    },
    targetUrl: 'https://example.com/products/one',
    profiles
  });

  assert.equal(result.passed, false);
  assert.equal(result.blocked, 1);
  assert.deepEqual(result.crawlers.map(({ key, status, matchedUserAgent }) => ({ key, status, matchedUserAgent })), [
    { key: 'googlebot', status: 'blocked', matchedUserAgent: 'Googlebot' },
    { key: 'bingbot', status: 'allowed', matchedUserAgent: '*' },
    { key: 'baiduspider', status: 'allowed', matchedUserAgent: '*' },
    { key: 'oai-searchbot', status: 'allowed', matchedUserAgent: '*' }
  ]);
});

test('the longest matching rule wins and allow wins an equal-length tie', () => {
  const result = evaluateCrawlerAccess({
    robotsResult: {
      statusCode: 200,
      body: [
        'User-agent: Googlebot',
        'Disallow: /catalog/',
        'Allow: /catalog/public/',
        'Disallow: /same',
        'Allow: /same'
      ].join('\n')
    },
    targetUrl: 'https://example.com/catalog/public/item',
    profiles: [profiles[0]]
  });
  const tie = evaluateCrawlerAccess({
    robotsResult: {
      statusCode: 200,
      body: 'User-agent: Googlebot\nDisallow: /same\nAllow: /same'
    },
    targetUrl: 'https://example.com/same',
    profiles: [profiles[0]]
  });

  assert.equal(result.crawlers[0].status, 'allowed');
  assert.equal(result.crawlers[0].matchedRule, 'Allow: /catalog/public/');
  assert.equal(tie.crawlers[0].status, 'allowed');
  assert.equal(tie.crawlers[0].matchedRule, 'Allow: /same');
});

test('supports wildcard, end-anchor and query matching in path rules', () => {
  const pdfResult = evaluateCrawlerAccess({
    robotsResult: { statusCode: 200, body: 'User-agent: *\nDisallow: /*.pdf$' },
    targetUrl: 'https://example.com/downloads/report.pdf',
    profiles: [profiles[0]]
  });
  const queryResult = evaluateCrawlerAccess({
    robotsResult: { statusCode: 200, body: 'User-agent: *\nDisallow: /*?preview=*' },
    targetUrl: 'https://example.com/article?preview=true',
    profiles: [profiles[0]]
  });
  const suffixResult = evaluateCrawlerAccess({
    robotsResult: { statusCode: 200, body: 'User-agent: *\nDisallow: /*.pdf$' },
    targetUrl: 'https://example.com/downloads/report.pdf?download=1',
    profiles: [profiles[0]]
  });

  assert.equal(pdfResult.crawlers[0].status, 'blocked');
  assert.equal(queryResult.crawlers[0].status, 'blocked');
  assert.equal(suffixResult.crawlers[0].status, 'allowed');
});

test('combines separate groups with the same most-specific user agent', () => {
  const result = evaluateCrawlerAccess({
    robotsResult: {
      statusCode: 200,
      body: [
        'User-agent: Googlebot',
        'Disallow: /first/',
        '',
        'User-agent: *',
        'Allow: /',
        '',
        'User-agent: Googlebot',
        'Disallow: /second/'
      ].join('\n')
    },
    targetUrl: 'https://example.com/second/page',
    profiles: [profiles[0]]
  });

  assert.equal(result.crawlers[0].status, 'blocked');
  assert.equal(result.crawlers[0].matchedUserAgent, 'Googlebot');
  assert.equal(result.crawlers[0].matchedRule, 'Disallow: /second/');
});

test('distinguishes absent, empty and unreachable robots files', () => {
  const absent = evaluateCrawlerAccess({
    robotsResult: { statusCode: 404, body: '' },
    targetUrl: 'https://example.com/',
    profiles: [profiles[0]]
  });
  const empty = evaluateCrawlerAccess({
    robotsResult: { statusCode: 200, body: '' },
    targetUrl: 'https://example.com/',
    profiles: [profiles[0]]
  });
  const unreachable = evaluateCrawlerAccess({
    robotsResult: { statusCode: 503, body: '' },
    targetUrl: 'https://example.com/',
    profiles: [profiles[0]]
  });
  const rateLimited = evaluateCrawlerAccess({
    robotsResult: { statusCode: 429, body: '' },
    targetUrl: 'https://example.com/',
    profiles: [profiles[0]]
  });

  assert.equal(absent.sourceStatus, 'unavailable');
  assert.equal(absent.crawlers[0].status, 'allowed');
  assert.match(absent.crawlers[0].matchedRule, /未声明抓取限制/);
  assert.equal(empty.sourceStatus, 'empty');
  assert.equal(empty.crawlers[0].status, 'allowed');
  assert.equal(unreachable.sourceStatus, 'unreachable');
  assert.equal(unreachable.passed, false);
  assert.equal(unreachable.crawlers[0].status, 'unknown');
  assert.equal(rateLimited.sourceStatus, 'unreachable');
  assert.equal(rateLimited.crawlers[0].status, 'unknown');
});

test('blocking an AI training crawler is reported without failing the SEO score check', () => {
  const result = evaluateCrawlerAccess({
    robotsResult: {
      statusCode: 200,
      body: 'User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /'
    },
    targetUrl: 'https://example.com/',
    profiles: [
      profiles[0],
      { key: 'gptbot', label: 'GPTBot', token: 'GPTBot', category: 'ai-training', affectsScore: false }
    ]
  });

  assert.equal(result.passed, true);
  assert.equal(result.blocked, 1);
  assert.equal(result.crawlers.find((crawler) => crawler.key === 'gptbot').status, 'blocked');
});

test('a non-empty robots file without a valid user-agent group is unknown, not healthy', () => {
  const result = evaluateCrawlerAccess({
    robotsResult: { statusCode: 200, body: 'Sitemap: https://example.com/sitemap.xml' },
    targetUrl: 'https://example.com/',
    profiles: [profiles[0]]
  });

  assert.equal(result.sourceStatus, 'invalid');
  assert.equal(result.passed, false);
  assert.equal(result.crawlers[0].status, 'unknown');
});
