const defaultSeoAuditRules = Object.freeze({
  version: '2026-07-23-v1',
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
  checks: Object.freeze({
    'http-status': { severity: 'critical', weight: 14 },
    indexability: { severity: 'critical', weight: 14 },
    https: { severity: 'high', weight: 7 },
    'robots-txt': { severity: 'high', weight: 7 },
    sitemap: { severity: 'medium', weight: 4 },
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
