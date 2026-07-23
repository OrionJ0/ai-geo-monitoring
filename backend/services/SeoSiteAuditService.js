const cheerio = require('cheerio');
const { createSeoAuditService, normalizeWebsiteUrl } = require('./SeoAuditService');
const { defaultSeoAuditRules, validateSeoAuditRules } = require('../config/seoAuditRules');

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const SITE_SCOPED_CHECKS = new Set(['robots-txt', 'sitemap', 'search-verification']);

function gradeFromScore(score) {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 60) return 'needs_improvement';
  return 'poor';
}

function normalizeSameOriginUrl(value, baseUrl, origin) {
  try {
    const url = new URL(value, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) return null;
    if (url.username || url.password) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function createCachedClient(siteClient) {
  const pageCache = new Map();
  const probeCache = new Map();
  const cached = (cache, method, url) => {
    if (!cache.has(url)) cache.set(url, Promise.resolve().then(() => siteClient[method](url)));
    return cache.get(url);
  };
  return {
    fetchPage: (url) => cached(pageCache, 'fetchPage', url),
    probe: (url) => cached(probeCache, 'probe', url)
  };
}

function sitemapLocations(body) {
  const xml = cheerio.load(String(body || ''), { xmlMode: true });
  if (xml('sitemapindex').length) {
    return {
      type: 'index',
      locations: xml('sitemapindex > sitemap > loc').map((_, element) => xml(element).text().trim()).get()
    };
  }
  if (xml('urlset').length) {
    return {
      type: 'urlset',
      locations: xml('urlset > url > loc').map((_, element) => xml(element).text().trim()).get()
    };
  }
  return { type: 'invalid', locations: [] };
}

function pageChecks(report) {
  return report.categories.flatMap((category) => category.checks);
}

function compactIssue(check) {
  return {
    id: check.id,
    title: check.title,
    category: check.category,
    severity: check.severity,
    weight: check.weight,
    finding: check.finding,
    value: check.value,
    recommendation: check.recommendation
  };
}

function aggregateIssues(instances) {
  const aggregated = new Map();
  instances.filter(({ check }) => check.status === 'failed').forEach(({ url, check }) => {
    if (!aggregated.has(check.id)) {
      aggregated.set(check.id, {
        ...compactIssue(check),
        count: 0,
        affectedPages: [],
        findings: []
      });
    }
    const issue = aggregated.get(check.id);
    issue.count += 1;
    issue.affectedPages.push(url);
    issue.findings.push({ url, finding: check.finding, value: check.value });
  });
  return [...aggregated.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || b.count - a.count || b.weight - a.weight);
}

function createSeoSiteAuditService({ siteClient, ruleConfig = defaultSeoAuditRules } = {}) {
  const client = createCachedClient(siteClient || require('./SeoSiteClient'));
  const rules = validateSeoAuditRules(ruleConfig);
  const pageAudit = createSeoAuditService({ siteClient: client, ruleConfig: rules });

  async function emit(onProgress, progress) {
    if (!onProgress) return;
    try {
      await onProgress(progress);
    } catch {
      // Progress persistence must not invalidate an otherwise usable audit report.
    }
  }

  return {
    async audit(inputUrl, { onProgress, maxPages = rules.crawl.pageLimit } = {}) {
      if (!Number.isInteger(maxPages) || maxPages <= 0) {
        const error = new Error('全站检测页数上限必须是正整数');
        error.code = 'INVALID_PAGE_LIMIT';
        error.status = 400;
        throw error;
      }

      const startedAt = Date.now();
      const requestedUrl = normalizeWebsiteUrl(inputUrl);
      const origin = new URL(requestedUrl).origin;
      const discovered = [];
      const discoveredSet = new Set();
      const addPage = (value, baseUrl = requestedUrl) => {
        const normalized = normalizeSameOriginUrl(value, baseUrl, origin);
        if (!normalized || discoveredSet.has(normalized)) return false;
        discoveredSet.add(normalized);
        discovered.push(normalized);
        return true;
      };
      addPage(requestedUrl);

      await emit(onProgress, { phase: 'discovering', discoveredPages: discovered.length, auditedPages: 0, failedPages: 0 });

      const robotsUrl = `${origin}/robots.txt`;
      const defaultSitemapUrl = `${origin}/sitemap.xml`;
      const robots = await client.probe(robotsUrl).catch(() => ({ statusCode: 0, body: '' }));
      const declaredSitemaps = [...String(robots.body || '').matchAll(/^sitemap\s*:\s*(\S+)/gim)].map((match) => match[1]);
      const sitemapQueue = [defaultSitemapUrl, ...declaredSitemaps]
        .map((url) => ({ url: normalizeSameOriginUrl(url, origin, origin), depth: 0 }))
        .filter((entry) => entry.url);
      const visitedSitemaps = new Set();

      while (sitemapQueue.length && visitedSitemaps.size < rules.crawl.sitemapLimit) {
        const current = sitemapQueue.shift();
        if (visitedSitemaps.has(current.url)) continue;
        visitedSitemaps.add(current.url);
        const result = await client.probe(current.url).catch(() => ({ statusCode: 0, body: '' }));
        if (result.statusCode < 200 || result.statusCode >= 300 || !String(result.body || '').trim()) continue;
        const parsed = sitemapLocations(result.body);
        if (parsed.type === 'urlset') {
          parsed.locations.forEach((url) => addPage(url, current.url));
        } else if (parsed.type === 'index' && current.depth < rules.crawl.sitemapDepth) {
          parsed.locations.forEach((url) => {
            const normalized = normalizeSameOriginUrl(url, current.url, origin);
            if (normalized && !visitedSitemaps.has(normalized)) {
              sitemapQueue.push({ url: normalized, depth: current.depth + 1 });
            }
          });
        }
      }

      await emit(onProgress, { phase: 'crawling', discoveredPages: discovered.length, auditedPages: 0, failedPages: 0 });

      const pages = [];
      const checkInstances = [];
      const siteChecksSeen = new Set();
      const errors = [];
      let cursor = 0;

      const auditPage = async (url) => {
        try {
          const response = await client.fetchPage(url);
          const finalUrl = response.finalUrl || url;
          const $ = cheerio.load(response.html || '');
          $('a[href]').each((_, element) => addPage($(element).attr('href'), finalUrl));

          const report = await pageAudit.audit(url);
          const checks = pageChecks(report);
          checks.forEach((check) => {
            if (SITE_SCOPED_CHECKS.has(check.id)) {
              if (siteChecksSeen.has(check.id)) return;
              siteChecksSeen.add(check.id);
            }
            checkInstances.push({ url, check });
          });
          pages.push({
            url,
            finalUrl: report.finalUrl,
            status: 'completed',
            statusCode: report.statusCode,
            durationMs: report.durationMs,
            score: report.score,
            title: report.page.title,
            issues: report.priorities.map(compactIssue),
            platforms: report.platforms
          });
        } catch (error) {
          errors.push(error);
          const configured = rules.checks['http-status'];
          const failedCheck = {
            id: 'http-status',
            category: 'crawlability',
            title: '页面访问状态',
            status: 'failed',
            severity: configured.severity,
            weight: configured.weight,
            finding: '页面无法访问',
            value: error.message,
            recommendation: '修复页面访问错误，确保目标 URL 可稳定返回 2xx。'
          };
          checkInstances.push({ url, check: failedCheck });
          pages.push({
            url,
            status: 'failed',
            statusCode: 0,
            durationMs: 0,
            score: 0,
            errorCode: error.code || 'AUDIT_FAILED',
            errorMessage: error.message,
            issues: [compactIssue(failedCheck)]
          });
        }
      };

      while (cursor < discovered.length && cursor < maxPages) {
        const available = Math.min(
          rules.crawl.concurrency,
          maxPages - cursor,
          discovered.length - cursor
        );
        const batch = discovered.slice(cursor, cursor + available);
        cursor += batch.length;
        await Promise.all(batch.map(auditPage));
        const failedPages = pages.filter((page) => page.status === 'failed').length;
        await emit(onProgress, {
          phase: 'crawling',
          discoveredPages: discovered.length,
          auditedPages: pages.length,
          failedPages
        });
      }

      const successfulPages = pages.filter((page) => page.status === 'completed');
      if (!successfulPages.length) throw errors[0] || new Error('没有可检测的页面');

      const totalWeight = checkInstances.reduce((sum, { check }) => sum + check.weight, 0);
      const passedWeight = checkInstances
        .filter(({ check }) => check.status === 'passed')
        .reduce((sum, { check }) => sum + check.weight, 0);
      const score = totalWeight ? Math.round((passedWeight / totalWeight) * 100) : 0;
      const issues = aggregateIssues(checkInstances);
      const failedPages = pages.length - successfulPages.length;
      const truncated = discovered.length > maxPages;
      const firstPage = successfulPages[0];

      const report = {
        mode: 'site',
        scoreVersion: rules.version,
        requestedUrl,
        finalUrl: `${origin}/`,
        checkedAt: new Date().toISOString(),
        statusCode: firstPage.statusCode,
        durationMs: Date.now() - startedAt,
        score,
        grade: gradeFromScore(score),
        summary: {
          total: checkInstances.length,
          totalWeight,
          passed: checkInstances.filter(({ check }) => check.status === 'passed').length,
          issues: issues.length,
          issueInstances: checkInstances.filter(({ check }) => check.status === 'failed').length,
          critical: issues.filter((issue) => issue.severity === 'critical').length,
          high: issues.filter((issue) => issue.severity === 'high').length,
          medium: issues.filter((issue) => issue.severity === 'medium').length,
          low: issues.filter((issue) => issue.severity === 'low').length
        },
        site: {
          origin,
          discoveredPages: discovered.length,
          auditedPages: pages.length,
          successfulPages: successfulPages.length,
          failedPages,
          limit: maxPages,
          truncated
        },
        platforms: firstPage.platforms,
        priorities: issues,
        issues,
        pages
      };
      await emit(onProgress, {
        phase: 'completed',
        discoveredPages: discovered.length,
        auditedPages: pages.length,
        failedPages
      });
      return report;
    }
  };
}

module.exports = { createSeoSiteAuditService, normalizeSameOriginUrl, sitemapLocations };
