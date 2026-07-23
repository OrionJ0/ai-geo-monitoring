const cheerio = require('cheerio');
const { createSeoAuditService, normalizeWebsiteUrl } = require('./SeoAuditService');
const {
  defaultSeoAuditRules,
  defaultSeoHealthScoreConfig,
  validateSeoAuditRules,
  validateSeoHealthScoreConfig
} = require('../config/seoAuditRules');
const {
  calculateTechnicalHealth,
  detectTechnicalHealthBlockers
} = require('./SeoHealthScoreService');
const {
  analyzeSitewideEvidence,
  compareAuditIssues
} = require('./SeoSitewideAnalysisService');
const { createSeoRenderService } = require('./SeoRenderService');

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

function normalizeHttpUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
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

function createSeoSiteAuditService({
  siteClient,
  renderService,
  ruleConfig = defaultSeoAuditRules,
  scoreConfig = defaultSeoHealthScoreConfig
} = {}) {
  const client = createCachedClient(siteClient || require('./SeoSiteClient'));
  const renderer = renderService || (siteClient
    ? {
        async sample() {
          return { status: 'unavailable', reason: 'renderer_not_injected', samples: [] };
        }
      }
    : createSeoRenderService());
  const rules = validateSeoAuditRules(ruleConfig);
  const scoring = validateSeoHealthScoreConfig(scoreConfig, rules);
  const siteScopedChecks = new Set(scoring.siteScopedRuleIds);
  const pageAudit = createSeoAuditService({
    siteClient: client,
    ruleConfig: rules,
    scoreConfig: scoring
  });

  async function emit(onProgress, progress) {
    if (!onProgress) return;
    try {
      await onProgress(progress);
    } catch {
      // Progress persistence must not invalidate an otherwise usable audit report.
    }
  }

  return {
    async audit(inputUrl, {
      onProgress,
      maxPages = rules.crawl.pageLimit,
      previousReport = null
    } = {}) {
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
      addPage(`${origin}/`);

      await emit(onProgress, { phase: 'discovering', discoveredPages: discovered.length, auditedPages: 0, failedPages: 0 });

      const robotsUrl = `${origin}/robots.txt`;
      const defaultSitemapUrl = `${origin}/sitemap.xml`;
      const robots = await client.probe(robotsUrl).catch(() => ({ statusCode: 0, body: '' }));
      const declaredSitemaps = [...String(robots.body || '').matchAll(/^sitemap\s*:\s*(\S+)/gim)].map((match) => match[1]);
      const sitemapQueue = [defaultSitemapUrl, ...declaredSitemaps]
        .map((url) => ({ url: normalizeSameOriginUrl(url, origin, origin), depth: 0 }))
        .filter((entry) => entry.url);
      const visitedSitemaps = new Set();
      const sitemapUrls = new Set();

      while (sitemapQueue.length && visitedSitemaps.size < rules.crawl.sitemapLimit) {
        const current = sitemapQueue.shift();
        if (visitedSitemaps.has(current.url)) continue;
        visitedSitemaps.add(current.url);
        const result = await client.probe(current.url).catch(() => ({ statusCode: 0, body: '' }));
        if (result.statusCode < 200 || result.statusCode >= 300 || !String(result.body || '').trim()) continue;
        const parsed = sitemapLocations(result.body);
        if (parsed.type === 'urlset') {
          parsed.locations.forEach((url) => {
            const normalized = normalizeSameOriginUrl(url, current.url, origin);
            if (!normalized) return;
            sitemapUrls.add(normalized);
            addPage(normalized, current.url);
          });
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
          const links = [];
          $('a[href]').each((_, element) => {
            const normalized = normalizeHttpUrl($(element).attr('href'), finalUrl);
            if (!normalized) return;
            const internal = new URL(normalized).origin === origin;
            links.push({ url: normalized, internal });
            if (internal) addPage(normalized, finalUrl);
          });
          const canonicalUrls = $('link[rel~="canonical"][href]')
            .map((_, element) => normalizeHttpUrl($(element).attr('href'), finalUrl))
            .get()
            .filter(Boolean);
          const hreflang = $('link[rel~="alternate"][hreflang][href]')
            .map((_, element) => ({
              language: $(element).attr('hreflang')?.trim() || '',
              url: normalizeHttpUrl($(element).attr('href'), finalUrl) || ''
            }))
            .get();
          const description = $('meta[name="description"]').first().attr('content')?.trim() || '';

          const report = await pageAudit.audit(url);
          const checks = pageChecks(report);
          const isHomepage = new URL(report.finalUrl).pathname === '/';
          checks.forEach((check) => {
            if (siteScopedChecks.has(check.id)) {
              if (siteChecksSeen.has(check.id)) return;
              siteChecksSeen.add(check.id);
            }
            checkInstances.push({ url, isHomepage, check });
          });
          pages.push({
            url,
            finalUrl: report.finalUrl,
            status: 'completed',
            statusCode: report.statusCode,
            durationMs: report.durationMs,
            score: report.score,
            title: report.page.title,
            description,
            contentCharacters: report.page.contentCharacters,
            indexable: report.page.indexable,
            isHomepage,
            canonicalUrls,
            hreflang,
            links,
            redirectChain: Array.isArray(response.redirectChain) ? response.redirectChain : [],
            issues: report.health.issues.map(compactIssue),
            platforms: report.platforms,
            crawlerAccess: report.crawlerAccess
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
          const isHomepage = new URL(url).pathname === '/';
          checkInstances.push({ url, isHomepage, check: failedCheck });
          pages.push({
            url,
            isHomepage,
            status: 'failed',
            statusCode: 0,
            durationMs: 0,
            score: 0,
            errorCode: error.code || 'AUDIT_FAILED',
            errorMessage: error.message,
            redirectChain: Array.isArray(error.redirectChain) ? error.redirectChain : [],
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

      const discoveredOrder = new Map(
        discovered.slice(0, maxPages).map((url, index) => [url, index])
      );
      pages.sort((left, right) => (
        (discoveredOrder.get(left.url) ?? Number.MAX_SAFE_INTEGER)
        - (discoveredOrder.get(right.url) ?? Number.MAX_SAFE_INTEGER)
      ));
      checkInstances.sort((left, right) => (
        (discoveredOrder.get(left.url) ?? Number.MAX_SAFE_INTEGER)
        - (discoveredOrder.get(right.url) ?? Number.MAX_SAFE_INTEGER)
        || left.check.id.localeCompare(right.check.id)
      ));

      const successfulPages = pages.filter((page) => page.status === 'completed');
      if (!successfulPages.length) throw errors[0] || new Error('没有可检测的页面');
      const truncated = discovered.length > maxPages;
      const pageByUrl = new Map();
      pages.forEach((page) => {
        pageByUrl.set(page.url, page);
        if (page.finalUrl) pageByUrl.set(page.finalUrl, page);
      });
      const linkTargets = new Map();
      successfulPages.forEach((page) => {
        (Array.isArray(page.links) ? page.links : []).forEach((link) => {
          const entry = linkTargets.get(link.url) || {
            url: link.url,
            internal: link.internal,
            sourcePages: []
          };
          if (!entry.sourcePages.includes(page.finalUrl || page.url)) {
            entry.sourcePages.push(page.finalUrl || page.url);
          }
          linkTargets.set(link.url, entry);
        });
      });
      const linkEntries = Array.from(linkTargets.values()).slice(0, rules.crawl.linkProbeLimit);
      const linkChecks = [];
      const probeLink = async (entry) => {
        if (entry.internal) {
          const targetPage = pageByUrl.get(entry.url);
          if (!targetPage) {
            linkChecks.push({ ...entry, skipped: true, reason: 'outside_audit_limit' });
            return;
          }
          linkChecks.push({
            ...entry,
            statusCode: targetPage.statusCode,
            finalUrl: targetPage.finalUrl || targetPage.url,
            errorCode: targetPage.status === 'failed' ? targetPage.errorCode : null
          });
          return;
        }
        try {
          const response = await client.probe(entry.url);
          linkChecks.push({
            ...entry,
            statusCode: response.statusCode,
            finalUrl: response.finalUrl || entry.url,
            redirectChain: response.redirectChain || []
          });
        } catch (error) {
          linkChecks.push({
            ...entry,
            statusCode: 0,
            errorCode: error.code || 'LINK_PROBE_FAILED'
          });
        }
      };
      for (let index = 0; index < linkEntries.length; index += rules.crawl.concurrency) {
        await Promise.all(linkEntries.slice(index, index + rules.crawl.concurrency).map(probeLink));
      }
      const renderEntries = successfulPages
        .slice(0, rules.crawl.renderSampleLimit)
        .map((page) => ({
          url: page.finalUrl || page.url,
          source: {
            title: page.title || '',
            description: page.description || '',
            contentCharacters: page.contentCharacters || 0,
            linkCount: Array.isArray(page.links) ? page.links.length : 0
          }
        }));
      const renderAnalysis = await renderer.sample(renderEntries).catch((error) => ({
        status: 'unavailable',
        reason: error.code || 'renderer_failed',
        samples: []
      }));
      const sitewide = analyzeSitewideEvidence({
        origin,
        pages,
        sitemapUrls: Array.from(sitemapUrls),
        linkChecks,
        renderAnalysis,
        truncated
      });

      const totalWeight = checkInstances.reduce((sum, { check }) => sum + check.weight, 0);
      const failedPages = pages.length - successfulPages.length;
      const firstPage = successfulPages.find((page) => page.isHomepage) || successfulPages[0];
      const healthPages = pages.map((page) => ({
        url: page.finalUrl || page.url,
        isHomepage: page.isHomepage,
        statusCode: page.statusCode,
        indexable: page.status === 'completed' ? page.indexable : null,
        contentCharacters: page.status === 'completed' ? page.contentCharacters : null
      }));
      const blockers = detectTechnicalHealthBlockers({
        pages: healthPages,
        crawlerAccess: firstPage.crawlerAccess,
        scoreConfig: scoring
      });
      const homepagePage = pages.find((page) => page.isHomepage);
      const scoringCrawlers = firstPage.crawlerAccess?.crawlers
        ?.filter((crawler) => crawler.affectsScore) || [];
      const unknownReasons = [];
      if (homepagePage?.status === 'failed') {
        unknownReasons.push('首页访问失败，无法确认首页技术状态');
      }
      if (scoringCrawlers.some((crawler) => crawler.status === 'unknown')) {
        unknownReasons.push('robots.txt 证据不足，无法确认重要搜索与 AI 搜索爬虫权限');
      }
      const scoredHealth = calculateTechnicalHealth({
        instances: checkInstances,
        blockers,
        evidenceComplete: unknownReasons.length === 0,
        unknownReasons,
        rules,
        scoreConfig: scoring
      });
      const scopeUrls = pages.map((page) => page.finalUrl || page.url);
      const expandSiteScope = (issue) => siteScopedChecks.has(issue.id) ? {
        ...issue,
        count: scopeUrls.length,
        affectedPages: scopeUrls,
        applicablePages: scopeUrls.length
      } : issue;
      const issues = scoredHealth.issues.map(expandSiteScope);
      const issuesById = new Map(issues.map((issue) => [issue.id, issue]));
      const priorities = scoredHealth.priorities.map((priority) => (
        priority.kind === 'issue' && issuesById.has(priority.id)
          ? { ...issuesById.get(priority.id), kind: 'issue' }
          : priority
      ));
      const health = { ...scoredHealth, issues, priorities };

      const report = {
        mode: 'site',
        scoreVersion: scoring.version,
        scoreModel: 'technical-health-v4',
        ruleVersion: rules.version,
        requestedUrl,
        finalUrl: `${origin}/`,
        checkedAt: new Date().toISOString(),
        statusCode: firstPage.statusCode,
        durationMs: Date.now() - startedAt,
        score: health.score,
        grade: health.status,
        summary: {
          total: checkInstances.length,
          totalWeight,
          passed: checkInstances.filter(({ check }) => check.status === 'passed').length,
          issues: issues.length,
          issueInstances: checkInstances.filter(({ check }) => check.status === 'failed').length,
          critical: issues.filter((issue) => issue.severity === 'critical').length,
          high: issues.filter((issue) => issue.severity === 'high').length,
          medium: issues.filter((issue) => issue.severity === 'medium').length,
          low: issues.filter((issue) => issue.severity === 'low').length,
          sitewideIssues: sitewide.issues.length
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
        crawlerAccess: firstPage.crawlerAccess,
        health,
        priorities,
        issues,
        pages,
        sitewide
      };
      report.comparison = compareAuditIssues(report, previousReport);
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
