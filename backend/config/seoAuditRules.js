const defaultSeoAuditRules = Object.freeze({
  version: '2026-07-23-v3',
  crawl: Object.freeze({
    pageLimit: 200,
    concurrency: 3,
    sitemapLimit: 20,
    sitemapDepth: 3
  }),
  thresholds: Object.freeze({
    titleMinCharacters: 10,
    titleMaxCharacters: 60,
    descriptionMinCharacters: 50,
    descriptionMaxCharacters: 160,
    contentMinCharacters: 300,
    responseTimeMaxMs: 2000,
    htmlMaxBytes: 500 * 1024,
    keywordsMaxItems: 10
  }),
  crawlerProfiles: Object.freeze([
    Object.freeze({ key: 'googlebot', label: 'Googlebot', token: 'Googlebot', category: 'search', categoryLabel: '搜索引擎', affectsScore: true, robotsPolicy: 'standard', docsUrl: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers' }),
    Object.freeze({ key: 'bingbot', label: 'Bingbot', token: 'bingbot', category: 'search', categoryLabel: '搜索引擎', affectsScore: true, robotsPolicy: 'standard', docsUrl: 'https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0' }),
    Object.freeze({ key: 'baiduspider', label: 'Baiduspider', token: 'Baiduspider', category: 'search', categoryLabel: '搜索引擎', affectsScore: true, robotsPolicy: 'standard', docsUrl: 'https://www.baidu.com/search/robots_english.html' }),
    Object.freeze({ key: 'oai-searchbot', label: 'OAI-SearchBot', token: 'OAI-SearchBot', category: 'ai-search', categoryLabel: 'AI 搜索', affectsScore: true, robotsPolicy: 'standard', docsUrl: 'https://developers.openai.com/api/docs/bots' }),
    Object.freeze({ key: 'claude-searchbot', label: 'Claude-SearchBot', token: 'Claude-SearchBot', category: 'ai-search', categoryLabel: 'AI 搜索', affectsScore: true, robotsPolicy: 'standard', docsUrl: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler' }),
    Object.freeze({ key: 'perplexitybot', label: 'PerplexityBot', token: 'PerplexityBot', category: 'ai-search', categoryLabel: 'AI 搜索', affectsScore: true, robotsPolicy: 'standard', docsUrl: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers' }),
    Object.freeze({ key: 'chatgpt-user', label: 'ChatGPT-User', token: 'ChatGPT-User', category: 'user-triggered', categoryLabel: '用户触发访问', affectsScore: false, robotsPolicy: 'advisory', docsUrl: 'https://developers.openai.com/api/docs/bots' }),
    Object.freeze({ key: 'claude-user', label: 'Claude-User', token: 'Claude-User', category: 'user-triggered', categoryLabel: '用户触发访问', affectsScore: false, robotsPolicy: 'advisory', docsUrl: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler' }),
    Object.freeze({ key: 'perplexity-user', label: 'Perplexity-User', token: 'Perplexity-User', category: 'user-triggered', categoryLabel: '用户触发访问', affectsScore: false, robotsPolicy: 'advisory', docsUrl: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers' }),
    Object.freeze({ key: 'gptbot', label: 'GPTBot', token: 'GPTBot', category: 'ai-training', categoryLabel: 'AI 训练与数据使用', affectsScore: false, robotsPolicy: 'standard', docsUrl: 'https://developers.openai.com/api/docs/bots' }),
    Object.freeze({ key: 'google-extended', label: 'Google-Extended', token: 'Google-Extended', category: 'ai-training', categoryLabel: 'AI 训练与数据使用', affectsScore: false, robotsPolicy: 'control-token', docsUrl: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers' }),
    Object.freeze({ key: 'claudebot', label: 'ClaudeBot', token: 'ClaudeBot', category: 'ai-training', categoryLabel: 'AI 训练与数据使用', affectsScore: false, robotsPolicy: 'standard', docsUrl: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler' }),
    Object.freeze({ key: 'ccbot', label: 'CCBot', token: 'CCBot', category: 'ai-training', categoryLabel: 'AI 训练与数据使用', affectsScore: false, robotsPolicy: 'standard', docsUrl: 'https://commoncrawl.org/ccbot' })
  ]),
  checks: Object.freeze({
    'http-status': { severity: 'critical', weight: 14 },
    indexability: { severity: 'critical', weight: 14 },
    https: { severity: 'high', weight: 7 },
    'robots-txt': { severity: 'high', weight: 7 },
    'crawler-access': { severity: 'high', weight: 7 },
    sitemap: { severity: 'high', weight: 7 },
    'search-verification': { severity: 'low', weight: 1 },
    title: { severity: 'high', weight: 8 },
    'meta-description': { severity: 'high', weight: 8 },
    'meta-keywords': { severity: 'low', weight: 1 },
    canonical: { severity: 'medium', weight: 4 },
    h1: { severity: 'high', weight: 8 },
    'heading-order': { severity: 'medium', weight: 4 },
    'content-depth': { severity: 'low', weight: 2 },
    'crawlable-links': { severity: 'low', weight: 2 },
    viewport: { severity: 'high', weight: 7 },
    'image-alt': { severity: 'medium', weight: 5 },
    language: { severity: 'medium', weight: 4 },
    'structured-data': { severity: 'medium', weight: 5 },
    'open-graph': { severity: 'low', weight: 3 },
    'twitter-card': { severity: 'low', weight: 2 },
    'response-time': { severity: 'medium', weight: 5 },
    'html-size': { severity: 'medium', weight: 4 }
  })
});

const ALLOWED_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const ALLOWED_CRAWLER_CATEGORIES = new Set(['search', 'ai-search', 'user-triggered', 'ai-training']);
const ALLOWED_ROBOTS_POLICIES = new Set(['standard', 'advisory', 'control-token']);
const REQUIRED_CHECK_IDS = Object.keys(defaultSeoAuditRules.checks);

function validateSeoAuditRules(config) {
  if (!config || typeof config.version !== 'string' || !config.version.trim()) {
    throw new Error('SEO 规则配置缺少 version');
  }
  if (!config.thresholds || typeof config.thresholds !== 'object') {
    throw new Error('SEO 规则配置缺少 thresholds');
  }
  if (!config.crawl || typeof config.crawl !== 'object') {
    throw new Error('SEO 规则配置缺少 crawl');
  }
  if (!config.checks || typeof config.checks !== 'object') {
    throw new Error('SEO 规则配置缺少 checks');
  }
  if (!Array.isArray(config.crawlerProfiles) || !config.crawlerProfiles.length) {
    throw new Error('SEO 规则配置缺少 crawlerProfiles');
  }
  const profileKeys = new Set();
  config.crawlerProfiles.forEach((profile) => {
    if (!profile?.key || !profile.label || !profile.token || profileKeys.has(profile.key)) {
      throw new Error('SEO 爬虫 UA 配置的 key、label、token 必须完整且 key 唯一');
    }
    profileKeys.add(profile.key);
    if (!ALLOWED_CRAWLER_CATEGORIES.has(profile.category)) {
      throw new Error(`SEO 爬虫 UA ${profile.key} 的 category 无效`);
    }
    if (typeof profile.affectsScore !== 'boolean') {
      throw new Error(`SEO 爬虫 UA ${profile.key} 的 affectsScore 必须是布尔值`);
    }
    if (!ALLOWED_ROBOTS_POLICIES.has(profile.robotsPolicy)) {
      throw new Error(`SEO 爬虫 UA ${profile.key} 的 robotsPolicy 无效`);
    }
  });
  REQUIRED_CHECK_IDS.forEach((id) => {
    if (!config.checks[id]) throw new Error(`SEO 规则配置缺少检查项 ${id}`);
  });
  Object.entries(config.checks).forEach(([id, rule]) => {
    if (!ALLOWED_SEVERITIES.has(rule?.severity)) {
      throw new Error(`SEO 检查项 ${id} 的 severity 无效`);
    }
    if (!Number.isInteger(rule?.weight) || rule.weight < 0) {
      throw new Error(`SEO 检查项 ${id} 的 weight 必须是非负整数`);
    }
  });
  Object.entries(config.thresholds).forEach(([name, value]) => {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`SEO 阈值 ${name} 必须是非负数`);
    }
  });
  Object.entries(config.crawl).forEach(([name, value]) => {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`SEO 抓取配置 ${name} 必须是正整数`);
    }
  });
  return config;
}

module.exports = { defaultSeoAuditRules, validateSeoAuditRules };
