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
const {
  assertNormalResponse,
  classifyResponse
} = require('./SeoSiteClient');

function isLocalhostHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function normalizeSameOriginUrl(
  value,
  baseUrl,
  origin,
  { allowLocalhostRewrite = false, onLocalhostRewrite } = {}
) {
  try {
    const url = new URL(value, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;

    if (url.origin !== origin) {
      const urlHost = url.hostname.toLowerCase();
      const targetHost = new URL(origin).hostname.toLowerCase();
      if (
        allowLocalhostRewrite
        && isLocalhostHostname(urlHost)
        && !isLocalhostHostname(targetHost)
      ) {
        const rewritten = new URL(origin);
        rewritten.pathname = url.pathname;
        rewritten.search = url.search;
        rewritten.hash = '';
        if (onLocalhostRewrite) {
          onLocalhostRewrite({
            originalHost: url.host,
            rewritten: rewritten.toString()
          });
        }
        return rewritten.toString();
      }
      return null;
    }
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

function elementRegion($, element) {
  if ($(element).closest('footer').length) return 'footer';
  if ($(element).closest('header').length) return 'header';
  if ($(element).closest('nav, [role="navigation"], [role="menu"]').length) return 'navigation';
  if ($(element).closest('main, article').length) return 'content';
  return 'other';
}

function navigationIssues($, finalUrl) {
  const issues = [];
  $('a').each((_, element) => {
    const rawHref = $(element).attr('href');
    const href = String(rawHref || '').trim();
    let reason = '';
    if (typeof rawHref !== 'string') reason = 'missing_href';
    else if (!href) reason = 'empty_href';
    else if (href === '#') reason = 'fragment_placeholder';
    else if (/^javascript:/i.test(href)) reason = 'javascript_url';
    else if (!normalizeHttpUrl(href, finalUrl) && !/^(?:mailto|tel):/i.test(href)) {
      reason = 'invalid_url';
    }
    if (!reason) return;
    issues.push({
      type: 'invalid-anchor',
      tag: 'a',
      text: $(element).text().replace(/\s+/g, ' ').trim().slice(0, 160),
      region: elementRegion($, element),
      reason
    });
  });

  const candidates = $('header span, header div, nav span, nav div, [role="navigation"] span, [role="navigation"] div, [role="menu"] span, [role="menu"] div, [role="link"]')
    .toArray();
  const isClickableCandidate = (element) => {
    const tag = String(element?.tagName || '').toLowerCase();
    if (['a', 'button'].includes(tag)) return false;
    const role = String($(element).attr('role') || '').toLowerCase();
    const onclick = String($(element).attr('onclick') || '');
    const declaredTarget = String(
      $(element).attr('data-href') || $(element).attr('data-url') || ''
    ).trim();
    return role === 'link'
      || Boolean(declaredTarget)
      || /(?:window\.)?location(?:\.href)?\s*=|(?:window\.)?location\.(?:assign|replace)\s*\(|window\.open\s*\(/i.test(onclick);
  };
  candidates
    .filter(isClickableCandidate)
    .filter((element) => !$(element).find('span, div, [role="link"]').toArray().some(isClickableCandidate))
    .forEach((element) => {
      const text = $(element).text().replace(/\s+/g, ' ').trim().slice(0, 160);
      if (!text) return;
      issues.push({
        type: 'non-semantic-navigation-control',
        tag: String(element.tagName || '').toLowerCase(),
        text,
        region: elementRegion($, element),
        reason: 'clickable_non_link'
      });
    });

  return issues;
}

function createCachedClient(siteClient) {
  const pageCache = new Map();
  const probeCache = new Map();
  const cached = (cache, method, url, options = {}) => {
    const key = JSON.stringify([url, options.expectedKind || '', options.requestKind || '']);
    if (!cache.has(key)) {
      let pending;
      pending = Promise.resolve()
        .then(() => siteClient[method](url, options))
        .then((response) => {
          if (method === 'fetchPage' && response?.finalUrl) {
            const finalKey = JSON.stringify([
              response.finalUrl,
              options.expectedKind || '',
              options.requestKind || ''
            ]);
            if (!cache.has(finalKey)) cache.set(finalKey, pending);
          }
          return response;
        });
      cache.set(key, pending);
    }
    return cache.get(key);
  };
  return {
    fetchPage: (url, options) => cached(pageCache, 'fetchPage', url, options),
    probe: (url, options) => cached(probeCache, 'probe', url, options),
    getRequestDiagnostics: () => siteClient.getRequestDiagnostics?.(),
    recordRenderAttempts: (count) => siteClient.recordRenderAttempts?.(count),
    setStopReason: (stopReason) => siteClient.setStopReason?.(stopReason)
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

function isAuditStopError(error) {
  return ['SEO_AUDIT_BLOCKED_BY_WAF', 'SEO_AUDIT_RATE_LIMITED'].includes(error?.code);
}

function attachCrawlDiagnostics(error, client) {
  if (error?.stopReason) client.setStopReason?.(error.stopReason);
  if (error && !error.crawlDiagnostics) {
    error.crawlDiagnostics = client.getRequestDiagnostics?.() || null;
  }
  return error;
}

async function probeTrustedResource(client, url, expectedKind) {
  let result;
  try {
    result = await client.probe(url, {
      expectedKind,
      requestKind: expectedKind
    });
  } catch (error) {
    if (isAuditStopError(error)) throw attachCrawlDiagnostics(error, client);
    return { statusCode: 0, body: '', classification: null };
  }

  const responseClassification = result.classification || classifyResponse(result, expectedKind);
  if (['waf_blocked', 'rate_limited'].includes(responseClassification.outcome)) {
    try {
      assertNormalResponse({ ...result, classification: responseClassification }, expectedKind);
    } catch (error) {
      throw attachCrawlDiagnostics(error, client);
    }
  }
  if (responseClassification.outcome !== 'normal') {
    return { ...result, body: '', classification: responseClassification };
  }
  return { ...result, classification: responseClassification };
}

function createSeoSiteAuditService({
  siteClient,
  renderService,
  networkScope = 'public',
  ruleConfig = defaultSeoAuditRules,
  scoreConfig = defaultSeoHealthScoreConfig
} = {}) {
  const privateTarget = networkScope === 'private';
  const client = createCachedClient(siteClient || require('./SeoSiteClient'));
  const renderer = renderService || (privateTarget
    ? {
        async sample() {
          return { status: 'unavailable', reason: 'private_target_not_rendered', samples: [] };
        }
      }
    : siteClient
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
      const entryResponse = await client.fetchPage(requestedUrl);
      try {
        assertNormalResponse(entryResponse, 'page');
      } catch (error) {
        throw attachCrawlDiagnostics(error, client);
      }
      const entryFinalUrl = normalizeHttpUrl(entryResponse.finalUrl || requestedUrl, requestedUrl) || requestedUrl;
      const origin = new URL(entryFinalUrl).origin;
      const discovered = [];
      const discoveredSet = new Set();
      const aliasesByResolved = new Map();
      const resolvedByRequested = new Map();
      const redirectAliases = new Map();
      const recordAlias = (requested, resolved, redirectChain = []) => {
        const normalizedRequested = normalizeHttpUrl(requested, requested) || requested;
        const normalizedResolved = normalizeHttpUrl(resolved, requested) || resolved;
        resolvedByRequested.set(normalizedRequested, normalizedResolved);
        if (!aliasesByResolved.has(normalizedResolved)) {
          aliasesByResolved.set(normalizedResolved, new Set());
        }
        if (normalizedRequested !== normalizedResolved) {
          aliasesByResolved.get(normalizedResolved).add(normalizedRequested);
          redirectAliases.set(normalizedRequested, {
            requestedUrl: normalizedRequested,
            resolvedUrl: normalizedResolved,
            redirectChain: Array.isArray(redirectChain) ? redirectChain : []
          });
        }
      };
      recordAlias(requestedUrl, entryFinalUrl, entryResponse.redirectChain);
      const sitemapLocalhostRewrites = [];
      const trackRewrite = (meta) => sitemapLocalhostRewrites.push(meta);
      const normalizeOpts = {
        allowLocalhostRewrite: privateTarget,
        onLocalhostRewrite: trackRewrite
      };
      const addPage = (value, baseUrl = entryFinalUrl) => {
        const normalized = normalizeSameOriginUrl(value, baseUrl, origin, normalizeOpts);
        if (!normalized || discoveredSet.has(normalized)) return false;
        discoveredSet.add(normalized);
        discovered.push(normalized);
        return true;
      };
      discoveredSet.add(entryFinalUrl);
      discovered.push(entryFinalUrl);
      if (new URL(entryFinalUrl).pathname !== '/') addPage(`${origin}/`);

      await emit(onProgress, { phase: 'discovering', discoveredPages: discovered.length, auditedPages: 0, failedPages: 0 });

      const robotsUrl = `${origin}/robots.txt`;
      const defaultSitemapUrl = `${origin}/sitemap.xml`;
      const robots = await probeTrustedResource(client, robotsUrl, 'robots');
      await probeTrustedResource(client, defaultSitemapUrl, 'sitemap');
      const declaredSitemaps = [...String(robots.body || '').matchAll(/^sitemap\s*:\s*(\S+)/gim)].map((match) => match[1]);
      const sitemapQueue = [defaultSitemapUrl, ...declaredSitemaps]
        .map((url) => ({ url: normalizeSameOriginUrl(url, origin, origin, normalizeOpts), depth: 0 }))
        .filter((entry) => entry.url);
      const visitedSitemaps = new Set();
      const sitemapUrls = new Set();
      const sitemapReferences = [];

      while (
        sitemapQueue.length
        && visitedSitemaps.size < rules.crawl.sitemapLimit
        && discovered.length < maxPages
      ) {
        const current = sitemapQueue.shift();
        if (visitedSitemaps.has(current.url)) continue;
        visitedSitemaps.add(current.url);
        const result = await probeTrustedResource(client, current.url, 'sitemap');
        if (result.statusCode < 200 || result.statusCode >= 300 || !String(result.body || '').trim()) continue;
        const parsed = sitemapLocations(result.body);
        if (parsed.type === 'urlset') {
          parsed.locations.forEach((url) => {
            const normalized = normalizeSameOriginUrl(url, current.url, origin, normalizeOpts);
            if (!normalized) {
              sitemapReferences.push({
                source: current.url,
                url: normalizeHttpUrl(url, current.url) || url,
                kind: 'url'
              });
              return;
            }
            sitemapUrls.add(normalized);
            addPage(normalized, current.url);
          });
        } else if (parsed.type === 'index' && current.depth < rules.crawl.sitemapDepth) {
          parsed.locations.forEach((url) => {
            const normalized = normalizeSameOriginUrl(url, current.url, origin, normalizeOpts);
            if (!normalized) {
              sitemapReferences.push({
                source: current.url,
                url: normalizeHttpUrl(url, current.url) || url,
                kind: 'sitemap'
              });
              return;
            }
            if (!visitedSitemaps.has(normalized)) {
              sitemapQueue.push({ url: normalized, depth: current.depth + 1 });
            }
          });
        }
      }
      const sitemapInventoryComplete = sitemapQueue.length === 0;

      await emit(onProgress, { phase: 'crawling', discoveredPages: discovered.length, auditedPages: 0, failedPages: 0 });

      const pages = [];
      const checkInstances = [];
      const siteChecksSeen = new Set();
      const errors = [];
      const resolvedClaims = new Set();
      let cursor = 0;

      const auditPage = async (url) => {
        let resolvedUrl = url;
        try {
          const response = await client.fetchPage(url);
          resolvedUrl = normalizeHttpUrl(response.finalUrl || url, url) || url;
          recordAlias(url, resolvedUrl, response.redirectChain);
          if (new URL(resolvedUrl).origin !== origin) {
            pages.push({
              url,
              finalUrl: resolvedUrl,
              aliases: [],
              status: 'redirected_external',
              statusCode: response.statusCode,
              durationMs: response.durationMs,
              redirectChain: Array.isArray(response.redirectChain) ? response.redirectChain : [],
              issues: []
            });
            return;
          }
          if (resolvedClaims.has(resolvedUrl)) return;
          resolvedClaims.add(resolvedUrl);
          assertNormalResponse(response, 'page');
          const finalUrl = resolvedUrl;
          const $ = cheerio.load(response.html || '');
          const links = [];
          $('a[href]').each((_, element) => {
            const normalized = normalizeHttpUrl($(element).attr('href'), finalUrl);
            if (!normalized) return;
            const internal = new URL(normalized).origin === origin;
            links.push({
              url: normalized,
              internal,
              text: $(element).text().replace(/\s+/g, ' ').trim().slice(0, 160),
              region: elementRegion($, element)
            });
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
          const openGraphUrl = $('meta[property="og:url"]').first().attr('content')?.trim() || '';
          const pageNavigationIssues = navigationIssues($, finalUrl);

          const report = await pageAudit.audit(url);
          const checks = pageChecks(report);
          const isHomepage = new URL(resolvedUrl).pathname === '/';
          checks.forEach((check) => {
            if (siteScopedChecks.has(check.id)) {
              if (siteChecksSeen.has(check.id)) return;
              siteChecksSeen.add(check.id);
            }
            checkInstances.push({ url: resolvedUrl, isHomepage, check });
          });
          pages.push({
            url: resolvedUrl,
            finalUrl: resolvedUrl,
            aliases: [],
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
            openGraphUrl,
            hreflang,
            links,
            navigationIssues: pageNavigationIssues,
            redirectChain: Array.isArray(response.redirectChain) ? response.redirectChain : [],
            issues: report.health.issues.map(compactIssue),
            platforms: report.platforms,
            crawlerAccess: report.crawlerAccess
          });
        } catch (error) {
          if (isAuditStopError(error)) throw attachCrawlDiagnostics(error, client);
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
          const isHomepage = new URL(resolvedUrl).pathname === '/';
          checkInstances.push({ url: resolvedUrl, isHomepage, check: failedCheck });
          pages.push({
            url: resolvedUrl,
            finalUrl: resolvedUrl,
            aliases: [],
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

      pages.forEach((page) => {
        if (page.status === 'redirected_external') return;
        page.aliases = Array.from(aliasesByResolved.get(page.finalUrl || page.url) || []).sort();
      });
      const discoveredOrder = new Map();
      discovered.slice(0, maxPages).forEach((url, index) => {
        const identity = resolvedByRequested.get(url) || url;
        if (!discoveredOrder.has(identity)) discoveredOrder.set(identity, index);
      });
      pages.sort((left, right) => (
        (discoveredOrder.get(left.finalUrl || left.url) ?? Number.MAX_SAFE_INTEGER)
        - (discoveredOrder.get(right.finalUrl || right.url) ?? Number.MAX_SAFE_INTEGER)
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
        (page.aliases || []).forEach((alias) => pageByUrl.set(alias, page));
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
      const eligibleLinkTargets = Array.from(linkTargets.values())
        .filter((entry) => entry.internal);
      const checkedPageTargets = eligibleLinkTargets.filter((entry) => (
        entry.internal && pageByUrl.has(entry.url)
      ));
      const checkedPageTargetUrls = new Set(checkedPageTargets.map((entry) => entry.url));
      const probeBudget = Math.min(
        rules.crawl.linkProbeLimit,
        Math.max(
          rules.crawl.linkProbeMinimum,
          successfulPages.length * rules.crawl.linkProbesPerPage
        )
      );
      const probeTargets = eligibleLinkTargets
        .filter((entry) => !checkedPageTargetUrls.has(entry.url))
        .sort((left, right) => Number(right.internal) - Number(left.internal))
        .slice(0, probeBudget);
      const linkEntries = [...checkedPageTargets, ...probeTargets];
      const linkInventoryComplete = eligibleLinkTargets.length <= linkEntries.length;
      const linkChecks = [];
      const probeLink = async (entry) => {
        if (entry.internal) {
          const targetPage = pageByUrl.get(entry.url);
          if (targetPage) {
            linkChecks.push({
              ...entry,
              statusCode: targetPage.statusCode,
              finalUrl: targetPage.finalUrl || targetPage.url,
              errorCode: targetPage.status === 'failed' ? targetPage.errorCode : null
            });
            return;
          }
        }
        try {
          const response = await client.probe(entry.url, {
            expectedKind: 'link_probe',
            requestKind: 'link_probe'
          });
          const responseClassification = response.classification
            || classifyResponse(response, 'link_probe');
          if (['waf_blocked', 'rate_limited'].includes(responseClassification.outcome)) {
            assertNormalResponse({ ...response, classification: responseClassification }, 'link_probe');
          }
          linkChecks.push({
            ...entry,
            statusCode: response.statusCode,
            finalUrl: response.finalUrl || entry.url,
            redirectChain: response.redirectChain || []
          });
        } catch (error) {
          if (isAuditStopError(error) && new URL(entry.url).origin === origin) {
            throw attachCrawlDiagnostics(error, client);
          }
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
      client.recordRenderAttempts?.(renderEntries.length);
      const renderAnalysis = await renderer.sample(renderEntries).catch((error) => ({
        status: 'unavailable',
        reason: error.code || 'renderer_failed',
        samples: []
      }));
      const sitewide = analyzeSitewideEvidence({
        origin,
        pages,
        sitemapUrls: Array.from(sitemapUrls),
        declaredSitemaps,
        sitemapReferences,
        sitemapLocalhostRewrites,
        linkChecks,
        renderAnalysis,
        truncated,
        linkInventoryComplete,
        sitemapInventoryComplete
      });

      const totalWeight = checkInstances.reduce((sum, { check }) => sum + check.weight, 0);
      const failedPages = pages.filter((page) => page.status === 'failed').length;
      const firstPage = successfulPages.find((page) => page.isHomepage) || successfulPages[0];
      const healthPages = pages
        .filter((page) => page.status !== 'redirected_external')
        .map((page) => ({
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
      const scopeUrls = pages
        .filter((page) => page.status !== 'redirected_external')
        .map((page) => page.finalUrl || page.url);
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
      const persistedPages = pages.map(({
        links: _links,
        navigationIssues: _navigationIssues,
        ...page
      }) => page);
      client.setStopReason?.(truncated ? 'page_limit' : 'completed');
      const crawlDiagnostics = client.getRequestDiagnostics?.() || null;

      const report = {
        mode: 'site',
        scoreVersion: scoring.version,
        scoreModel: 'technical-health-v4',
        ruleVersion: rules.version,
        requestedUrl,
        finalUrl: entryFinalUrl,
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
          truncated,
          sitemapLocalhostRewrites,
          redirectAliases: Array.from(redirectAliases.values())
            .sort((left, right) => left.requestedUrl.localeCompare(right.requestedUrl)),
          ...(crawlDiagnostics ? { crawlDiagnostics } : {})
        },
        platforms: firstPage.platforms,
        crawlerAccess: firstPage.crawlerAccess,
        health,
        priorities,
        issues,
        pages: persistedPages,
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
