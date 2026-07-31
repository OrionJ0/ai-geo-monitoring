const SITEWIDE_VERSION = 'sitewide-audit-v4';

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function duplicateGroups(pages, field) {
  const groups = new Map();
  pages
    .filter((page) => page.status === 'completed')
    .forEach((page) => {
      const normalized = normalizedText(page[field]);
      if (!normalized) return;
      const current = groups.get(normalized) || {
        value: String(page[field] || '').replace(/\s+/g, ' ').trim(),
        pages: []
      };
      current.pages.push(page.finalUrl || page.url);
      groups.set(normalized, current);
    });
  return Array.from(groups.values()).filter((group) => group.pages.length > 1);
}

function check({ id, title, severity, groups, emptyFinding, recommendation, complete = true }) {
  const affectedPages = Array.from(new Set(groups.flatMap((group) => group.pages)));
  const failed = groups.length > 0;
  return {
    id,
    title,
    severity,
    status: failed ? 'failed' : (complete ? 'passed' : 'unknown'),
    finding: failed
      ? `${groups.length} 组重复内容`
      : (complete ? emptyFinding : '审计范围不完整，无法确认全站没有重复'),
    value: failed
      ? `${affectedPages.length} 个页面受影响`
      : (complete ? '未发现跨页重复' : '证据不完整'),
    affectedPages,
    details: groups,
    recommendation: failed ? recommendation : ''
  };
}

function normalizedUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function canonicalAnalysis(pages) {
  const canonicalByPage = new Map();
  const clusterMap = new Map();
  const conflicts = [];
  const successful = pages.filter((page) => page.status === 'completed');

  successful.forEach((page) => {
    const pageUrl = normalizedUrl(page.finalUrl || page.url);
    const canonicals = Array.from(new Set(
      (Array.isArray(page.canonicalUrls) ? page.canonicalUrls : [])
        .map((value) => normalizedUrl(value, pageUrl))
        .filter(Boolean)
    ));
    if (canonicals.length) canonicalByPage.set(pageUrl, canonicals[0]);
    canonicals.forEach((canonicalUrl) => {
      const group = clusterMap.get(canonicalUrl) || [];
      group.push(pageUrl);
      clusterMap.set(canonicalUrl, group);
    });
    if (canonicals.length > 1) {
      conflicts.push({
        type: 'multiple',
        page: pageUrl,
        targets: canonicals,
        message: '同一页面声明了多个 Canonical 目标'
      });
    }
  });

  canonicalByPage.forEach((target, source) => {
    const nextTarget = canonicalByPage.get(target);
    if (nextTarget && nextTarget !== target) {
      conflicts.push({
        type: 'chain',
        page: source,
        targets: [target, nextTarget],
        message: 'Canonical 目标继续指向另一个规范页面'
      });
    }
  });

  const loopKeys = new Set();
  canonicalByPage.forEach((_target, start) => {
    const path = [];
    const positions = new Map();
    let current = start;
    while (canonicalByPage.has(current)) {
      if (positions.has(current)) {
        const loop = path.slice(positions.get(current));
        if (loop.length > 1) {
          const key = [...loop].sort().join('|');
          if (!loopKeys.has(key)) {
            loopKeys.add(key);
            conflicts.push({
              type: 'loop',
              page: loop[0],
              targets: [...loop, loop[0]],
              message: 'Canonical 声明形成循环'
            });
          }
        }
        break;
      }
      positions.set(current, path.length);
      path.push(current);
      const next = canonicalByPage.get(current);
      if (!next || next === current) break;
      current = next;
    }
  });

  return {
    clusters: Array.from(clusterMap.entries())
      .filter(([, groupPages]) => groupPages.length > 1)
      .map(([canonicalUrl, groupPages]) => ({
        canonicalUrl,
        pages: Array.from(new Set(groupPages))
      })),
    conflicts
  };
}

function evidenceCheck({
  id,
  title,
  severity,
  failed,
  finding,
  passedFinding,
  value,
  affectedPages,
  details,
  recommendation,
  complete = true,
  unknownFinding = '审计证据不完整，无法确认全站状态',
  unknownValue = '证据不完整'
}) {
  const status = failed ? 'failed' : (complete ? 'passed' : 'unknown');
  return {
    id,
    title,
    severity,
    status,
    finding: failed ? finding : (complete ? passedFinding : unknownFinding),
    value: failed ? value : (complete ? '未发现问题' : unknownValue),
    affectedPages: failed ? Array.from(new Set(affectedPages || [])) : [],
    details: details || [],
    recommendation: failed ? recommendation : ''
  };
}

function redirectAnalysis(pages) {
  return {
    chains: pages
      .filter((page) => (
        page.errorCode !== 'REDIRECT_LOOP'
        && Array.isArray(page.redirectChain)
        && page.redirectChain.length > 1
      ))
      .map((page) => ({
        page: page.url,
        finalUrl: page.finalUrl || page.url,
        hops: page.redirectChain
      })),
    loops: pages
      .filter((page) => page.errorCode === 'REDIRECT_LOOP')
      .map((page) => ({
        page: page.url,
        hops: Array.isArray(page.redirectChain) ? page.redirectChain : []
      }))
  };
}

function brokenLinkAnalysis(linkChecks) {
  const broken = (Array.isArray(linkChecks) ? linkChecks : [])
    .filter((link) => link.skipped !== true)
    .filter((link) => {
      const statusCode = Number(link.statusCode || 0);
      return Boolean(link.errorCode) || statusCode === 0 || statusCode >= 400;
    });
  return {
    internal: broken.filter((link) => link.internal === true),
    external: broken.filter((link) => link.internal !== true)
  };
}

function sitemapAnalysis({ origin, pages, sitemapUrls, truncated, inventoryComplete = true }) {
  const sitemapSet = new Set(
    (Array.isArray(sitemapUrls) ? sitemapUrls : [])
      .map((url) => normalizedUrl(url))
      .filter(Boolean)
  );
  const pageByRequestedUrl = new Map(
    pages.map((page) => [normalizedUrl(page.url), page]).filter(([url]) => url)
  );
  const missingFromSitemap = (inventoryComplete ? pages : [])
    .filter((page) => page.status === 'completed' && page.indexable !== false)
    .map((page) => normalizedUrl(page.finalUrl || page.url))
    .filter((url) => url && new URL(url).origin === origin && !sitemapSet.has(url));
  const invalidEntries = [];
  sitemapSet.forEach((url) => {
    const page = pageByRequestedUrl.get(url);
    if (!page) {
      if (!truncated) invalidEntries.push({ url, reason: 'not_audited' });
      return;
    }
    if (page.status !== 'completed' || Number(page.statusCode || 0) >= 400) {
      invalidEntries.push({ url, reason: 'unavailable' });
      return;
    }
    if (page.indexable === false) {
      invalidEntries.push({ url, reason: 'noindex' });
      return;
    }
    const finalUrl = normalizedUrl(page.finalUrl || page.url);
    if (finalUrl && finalUrl !== url) {
      invalidEntries.push({ url, reason: 'redirected', finalUrl });
    }
  });
  return {
    missing_from_sitemap: Array.from(new Set(missingFromSitemap)),
    invalid_entries: invalidEntries,
    inventory_complete: !truncated && inventoryComplete
  };
}

const INTERNAL_LINK_REGIONS = ['header', 'navigation', 'content', 'footer', 'other'];

function internalLinkQuality({ origin, pages, sitemapUrls }) {
  const homepage = normalizedUrl(`${origin}/`);
  const sitemapSet = new Set(
    (Array.isArray(sitemapUrls) ? sitemapUrls : [])
      .map((url) => normalizedUrl(url))
      .filter(Boolean)
  );
  const incoming = new Map();
  pages.forEach((page) => {
    const sourceUrl = normalizedUrl(page.finalUrl || page.url);
    (Array.isArray(page.links) ? page.links : [])
      .filter((link) => link.internal === true)
      .forEach((link) => {
        const target = normalizedUrl(link.url, sourceUrl);
        if (!target || target === sourceUrl) return;
        const region = INTERNAL_LINK_REGIONS.includes(link.region) ? link.region : 'other';
        const text = String(link.text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        const evidence = incoming.get(target) || new Map();
        const key = `${sourceUrl}|${region}|${text}`;
        if (!evidence.has(key)) {
          evidence.set(key, {
            source_url: sourceUrl,
            region,
            text
          });
        }
        incoming.set(target, evidence);
      });
  });

  const pageEvidence = pages
    .filter((page) => page.status === 'completed')
    .map((page) => normalizedUrl(page.finalUrl || page.url))
    .filter((url) => url && url !== homepage && sitemapSet.has(url))
    .map((url) => {
      const sources = Array.from(incoming.get(url)?.values() || []);
      const sourcePages = new Set(sources.map((source) => source.source_url));
      const regions = Object.fromEntries(INTERNAL_LINK_REGIONS.map((region) => [
        region,
        sources.filter((source) => source.region === region).length
      ]));
      const classification = sources.length === 0
        ? 'orphan'
        : sources.every((source) => source.region === 'footer')
          ? 'footer_only'
          : 'structural';
      return {
        url,
        inbound_count: sources.length,
        source_page_count: sourcePages.size,
        regions,
        classification,
        sources: sources.slice(0, 50)
      };
    });

  return {
    pages: pageEvidence,
    orphan_pages: pageEvidence
      .filter((page) => page.classification === 'orphan')
      .map((page) => page.url),
    footer_only_pages: pageEvidence
      .filter((page) => page.classification === 'footer_only')
      .map((page) => page.url)
  };
}

function isValidHreflang(value) {
  const language = String(value || '').trim();
  return /^x-default$/i.test(language)
    || /^[a-z]{2,3}(?:-[a-z]{2}|-[a-z]{4}(?:-[a-z]{2})?)?$/i.test(language);
}

function hreflangAnalysis(pages) {
  const successful = pages.filter((page) => page.status === 'completed');
  const pageByUrl = new Map(
    successful
      .map((page) => [normalizedUrl(page.finalUrl || page.url), page])
      .filter(([url]) => url)
  );
  const errors = [];
  const unverified = [];
  successful.forEach((page) => {
    const pageUrl = normalizedUrl(page.finalUrl || page.url);
    const entries = (Array.isArray(page.hreflang) ? page.hreflang : [])
      .map((entry) => ({
        language: String(entry?.language || '').trim(),
        url: normalizedUrl(entry?.url, pageUrl)
      }));
    const byLanguage = new Map();
    entries.forEach((entry) => {
      if (!isValidHreflang(entry.language)) {
        errors.push({
          type: 'invalid-language',
          page: pageUrl,
          language: entry.language,
          target: entry.url,
          message: 'hreflang 语言代码无效'
        });
      }
      if (!entry.url) {
        errors.push({
          type: 'invalid-target',
          page: pageUrl,
          language: entry.language,
          target: '',
          message: 'hreflang 目标 URL 无效'
        });
        return;
      }
      const languageKey = entry.language.toLowerCase();
      const targets = byLanguage.get(languageKey) || new Set();
      targets.add(entry.url);
      byLanguage.set(languageKey, targets);

      const targetPage = pageByUrl.get(entry.url);
      if (!targetPage) {
        unverified.push({
          type: 'target-not-audited',
          page: pageUrl,
          language: entry.language,
          target: entry.url,
          message: 'hreflang 目标未进入本次审计范围，无法验证回链'
        });
        return;
      }
      const hasReturn = (Array.isArray(targetPage.hreflang) ? targetPage.hreflang : [])
        .some((candidate) => normalizedUrl(candidate?.url, entry.url) === pageUrl);
      if (!hasReturn) {
        errors.push({
          type: 'missing-return',
          page: pageUrl,
          language: entry.language,
          target: entry.url,
          message: 'hreflang 目标页面缺少回链'
        });
      }
    });
    byLanguage.forEach((targets, language) => {
      if (targets.size > 1) {
        errors.push({
          type: 'duplicate-language',
          page: pageUrl,
          language,
          targets: Array.from(targets),
          message: '同一语言声明了多个 hreflang 目标'
        });
      }
    });
  });
  return { errors, unverified };
}

function renderingAnalysis(renderAnalysis) {
  const analysis = renderAnalysis
    && typeof renderAnalysis === 'object'
    && !Array.isArray(renderAnalysis)
    ? renderAnalysis
    : { status: 'unavailable', reason: 'renderer_not_configured', samples: [] };
  const samples = Array.isArray(analysis.samples) ? analysis.samples : [];
  const completedSamples = samples.filter((sample) => sample?.rendered);
  const failures = samples
    .filter((sample) => !sample?.rendered)
    .map((sample) => ({
      url: sample?.url || '',
      errorCode: sample?.errorCode || 'render_failed'
    }));
  const differences = completedSamples.map((sample) => {
    const source = sample.source || {};
    const rendered = sample.rendered || {};
    const fields = [];
    if (normalizedText(source.title) !== normalizedText(rendered.title)) fields.push('title');
    if (normalizedText(source.description) !== normalizedText(rendered.description)) fields.push('description');
    const sourceCharacters = Number(source.contentCharacters || 0);
    const renderedCharacters = Number(rendered.contentCharacters || 0);
    if (
      Math.abs(renderedCharacters - sourceCharacters) >= 100
      && renderedCharacters > sourceCharacters * 1.25
    ) {
      fields.push('content');
    }
    if (Math.abs(Number(rendered.linkCount || 0) - Number(source.linkCount || 0)) >= 2) {
      fields.push('links');
    }
    return {
      url: sample.url,
      fields,
      source,
      rendered
    };
  }).filter((entry) => entry.fields.length > 0);
  return {
    status: analysis.status || 'unavailable',
    reason: analysis.reason || '',
    samples: completedSamples,
    failures,
    differences
  };
}

function navigationCrawlability(pages, rendering) {
  const staticIssueMap = new Map();
  pages
    .filter((page) => page.status === 'completed')
    .forEach((page) => {
      const sourceUrl = normalizedUrl(page.finalUrl || page.url);
      (Array.isArray(page.navigationIssues) ? page.navigationIssues : []).forEach((issue) => {
        const normalizedIssue = {
          type: String(issue?.type || 'non-semantic-navigation-control'),
          tag: String(issue?.tag || ''),
          text: String(issue?.text || '').replace(/\s+/g, ' ').trim().slice(0, 160),
          region: String(issue?.region || 'navigation'),
          reason: String(issue?.reason || 'clickable_non_link')
        };
        const key = JSON.stringify(normalizedIssue);
        const entry = staticIssueMap.get(key) || {
          ...normalizedIssue,
          sourcePageCount: 0,
          sourcePages: [],
          sourcePageKeys: new Set()
        };
        if (sourceUrl && !entry.sourcePageKeys.has(sourceUrl)) {
          entry.sourcePageKeys.add(sourceUrl);
          entry.sourcePageCount += 1;
          if (entry.sourcePages.length < 50) entry.sourcePages.push(sourceUrl);
        }
        staticIssueMap.set(key, entry);
      });
    });

  const renderedControls = [];
  const interactionDependentLinks = [];
  (Array.isArray(rendering?.samples) ? rendering.samples : []).forEach((sample) => {
    const navigation = sample?.rendered?.navigation;
    (Array.isArray(navigation?.nonSemanticControls) ? navigation.nonSemanticControls : [])
      .forEach((control) => {
        renderedControls.push({
          page: sample.url,
          tag: String(control?.tag || ''),
          text: String(control?.text || '').replace(/\s+/g, ' ').trim().slice(0, 160),
          reason: String(control?.reason || 'clickable_non_link')
        });
      });
    (Array.isArray(navigation?.interactionDependentLinks)
      ? navigation.interactionDependentLinks
      : [])
      .forEach((entry) => {
        interactionDependentLinks.push({
          page: sample.url,
          triggerText: String(entry?.triggerText || '').replace(/\s+/g, ' ').trim().slice(0, 160),
          links: (Array.isArray(entry?.links) ? entry.links : []).map((link) => ({
            url: normalizedUrl(link?.url, sample.url),
            text: String(link?.text || '').replace(/\s+/g, ' ').trim().slice(0, 160)
          })).filter((link) => link.url)
        });
      });
  });
  const staticControlKeys = new Set(Array.from(staticIssueMap.values()).map((issue) => (
    `${issue.tag}|${issue.text}|${issue.reason}`
  )));
  const renderedOnlyControls = renderedControls.filter((control) => (
    !staticControlKeys.has(`${control.tag}|${control.text}|${control.reason}`)
  ));

  return {
    static_issues: Array.from(staticIssueMap.values()).map(({
      sourcePageKeys: _sourcePageKeys,
      ...issue
    }) => issue),
    rendered_controls: renderedOnlyControls,
    interaction_dependent_links: interactionDependentLinks
  };
}

function isNonPublicHostname(value) {
  const hostname = String(value || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '::1'
    || /^127\./.test(hostname)
    || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^169\.254\./.test(hostname)
  ) {
    return true;
  }
  const match = hostname.match(/^172\.(\d{1,3})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function urlConsistencyAnalysis({
  origin,
  pages,
  declaredSitemaps,
  sitemapReferences,
  sitemapLocalhostRewrites = []
}) {
  const expectedOrigin = new URL(origin).origin;
  const issues = [];
  const rewrittenHosts = new Set(
    sitemapLocalhostRewrites.map((entry) => {
      try {
        return new URL(`http://${entry.originalHost}`).host;
      } catch {
        return String(entry.originalHost || '').toLowerCase();
      }
    })
  );
  const wasLocalhostRewritten = (urlString) => {
    try {
      return rewrittenHosts.has(new URL(urlString).host);
    } catch {
      return false;
    }
  };

  if (isNonPublicHostname(new URL(expectedOrigin).hostname)) {
    const hasRewrites = sitemapLocalhostRewrites.length > 0;
    issues.push({
      type: 'non-public-origin',
      page: `${expectedOrigin}/`,
      target: expectedOrigin,
      expectedOrigin,
      message: hasRewrites
        ? `检测入口使用 localhost、回环地址或私网地址；已自动将 ${sitemapLocalhostRewrites.length} 个 localhost Sitemap 引用替换为检测入口地址`
        : '检测入口使用 localhost、回环地址或私网地址'
    });
  }

  const compareOrigin = ({ type, page, target, message }) => {
    const normalized = normalizedUrl(target, page || `${expectedOrigin}/`);
    if (!normalized) {
      issues.push({
        type: `${type}-invalid`,
        page: page || '',
        target: String(target || ''),
        expectedOrigin,
        message: `${message} URL 无效`
      });
      return;
    }
    if (new URL(normalized).origin !== expectedOrigin) {
      issues.push({
        type,
        page: page || '',
        target: normalized,
        expectedOrigin,
        message
      });
    }
  };

  (Array.isArray(declaredSitemaps) ? declaredSitemaps : []).forEach((url) => {
    if (wasLocalhostRewritten(url)) return;
    compareOrigin({
      type: 'robots-sitemap-origin',
      page: `${expectedOrigin}/robots.txt`,
      target: url,
      message: 'robots.txt 声明的 Sitemap 与检测入口不同源'
    });
  });
  (Array.isArray(sitemapReferences) ? sitemapReferences : []).forEach((entry) => {
    if (wasLocalhostRewritten(entry?.url)) return;
    compareOrigin({
      type: entry?.kind === 'sitemap' ? 'sitemap-index-origin' : 'sitemap-entry-origin',
      page: entry?.source || '',
      target: entry?.url,
      message: entry?.kind === 'sitemap'
        ? 'Sitemap index 子清单与检测入口不同源'
        : 'Sitemap 页面条目与检测入口不同源'
    });
  });
  pages
    .filter((page) => page.status === 'completed')
    .forEach((page) => {
      const pageUrl = normalizedUrl(page.finalUrl || page.url);
      (Array.isArray(page.canonicalUrls) ? page.canonicalUrls : []).forEach((url) => {
        compareOrigin({
          type: 'canonical-origin',
          page: pageUrl,
          target: url,
          message: 'Canonical 与检测入口不同源'
        });
      });
      if (page.openGraphUrl) {
        compareOrigin({
          type: 'open-graph-origin',
          page: pageUrl,
          target: page.openGraphUrl,
          message: 'og:url 与检测入口不同源'
        });
      }
    });

  return {
    expected_origin: expectedOrigin,
    issues,
    localhost_rewrites: sitemapLocalhostRewrites
  };
}

function analyzeSitewideEvidence({
  origin,
  pages = [],
  sitemapUrls = [],
  declaredSitemaps = [],
  sitemapReferences = [],
  sitemapLocalhostRewrites = [],
  linkChecks = [],
  renderAnalysis,
  truncated = false,
  linkInventoryComplete = true,
  sitemapInventoryComplete = true
} = {}) {
  const hasFailedPages = pages.some((page) => page.status === 'failed');
  const siteInventoryComplete = !truncated && !hasFailedPages;
  const duplicateTitles = duplicateGroups(pages, 'title');
  const duplicateDescriptions = duplicateGroups(pages, 'description');
  const canonical = canonicalAnalysis(pages);
  const redirects = redirectAnalysis(pages);
  const brokenLinks = brokenLinkAnalysis(linkChecks);
  const hasUsableSitemap = Array.isArray(sitemapUrls) && sitemapUrls.length > 0;
  brokenLinks.coverage = {
    checked_targets: Array.isArray(linkChecks) ? linkChecks.length : 0,
    complete: siteInventoryComplete && linkInventoryComplete
  };
  const sitemap = sitemapAnalysis({
    origin,
    pages,
    sitemapUrls,
    truncated,
    inventoryComplete: sitemapInventoryComplete && hasUsableSitemap
  });
  const linkQuality = internalLinkQuality({ origin, pages, sitemapUrls });
  const orphans = linkQuality.orphan_pages;
  const hreflang = hreflangAnalysis(pages);
  const rendering = renderingAnalysis(renderAnalysis);
  const navigation = navigationCrawlability(pages, rendering);
  const invalidAnchorCount = navigation.static_issues
    .filter((issue) => issue.type === 'invalid-anchor').length;
  const nonLinkNavigationCount = navigation.static_issues
    .filter((issue) => issue.type !== 'invalid-anchor').length
    + navigation.rendered_controls.length;
  const directNavigationIssueCount = invalidAnchorCount + nonLinkNavigationCount;
  const navigationIssueCount = navigation.static_issues.length
    + navigation.rendered_controls.length
    + navigation.interaction_dependent_links.length;
  const navigationFinding = [
    directNavigationIssueCount > 0
      ? `${directNavigationIssueCount} 个导航项无法直接读取地址`
      : '',
    navigation.interaction_dependent_links.length > 0
      ? `${directNavigationIssueCount > 0 ? '另有 ' : ''}${navigation.interaction_dependent_links.length} 组链接仅在交互后出现`
      : ''
  ].filter(Boolean).join('；');
  const navigationValue = [
    nonLinkNavigationCount > 0 ? `${nonLinkNavigationCount} 类 div/span 跳转` : '',
    invalidAnchorCount > 0 ? `${invalidAnchorCount} 类 a 缺少有效 href` : ''
  ].filter(Boolean).join(' · ')
    || `${navigation.interaction_dependent_links.length} 组交互后链接`;
  const urlConsistency = urlConsistencyAnalysis({
    origin,
    pages,
    declaredSitemaps,
    sitemapReferences,
    sitemapLocalhostRewrites
  });
  const checks = [
    check({
      id: 'duplicate-titles',
      title: '重复页面标题',
      severity: 'high',
      groups: duplicateTitles,
      emptyFinding: '页面标题保持唯一',
      recommendation: '为每个可索引页面设置能准确概括其主题的唯一标题。',
      complete: siteInventoryComplete
    }),
    check({
      id: 'duplicate-descriptions',
      title: '重复 Meta 描述',
      severity: 'medium',
      groups: duplicateDescriptions,
      emptyFinding: 'Meta 描述保持唯一',
      recommendation: '为每个重要页面编写与该页面内容一致的独特 Meta 描述。',
      complete: siteInventoryComplete
    }),
    evidenceCheck({
      id: 'canonical-conflicts',
      title: 'Canonical 冲突与聚类',
      severity: 'high',
      failed: canonical.conflicts.length > 0,
      finding: `${canonical.conflicts.length} 个 Canonical 冲突`,
      passedFinding: '未发现 Canonical 多声明、链或循环',
      value: `${canonical.clusters.length} 个重复页聚类`,
      affectedPages: canonical.conflicts.flatMap((conflict) => [
        conflict.page,
        ...(conflict.targets || [])
      ]),
      details: canonical.conflicts,
      recommendation: '每个页面只声明一个最终规范 URL，避免 Canonical 链与循环。',
      complete: siteInventoryComplete
    }),
    evidenceCheck({
      id: 'redirects',
      title: '重定向链与循环',
      severity: 'high',
      failed: redirects.chains.length > 0 || redirects.loops.length > 0,
      finding: `${redirects.chains.length} 条重定向链，${redirects.loops.length} 个循环`,
      passedFinding: '未发现重定向链或循环',
      value: `${redirects.chains.length + redirects.loops.length} 个入口受影响`,
      affectedPages: [
        ...redirects.chains.map((entry) => entry.page),
        ...redirects.loops.map((entry) => entry.page)
      ],
      details: [...redirects.loops, ...redirects.chains],
      recommendation: '把内部链接直接指向最终 URL，并消除循环和多跳重定向。',
      complete: siteInventoryComplete
    }),
    evidenceCheck({
      id: 'broken-links',
      title: '失效内链',
      severity: 'high',
      failed: brokenLinks.internal.length > 0,
      finding: `${brokenLinks.internal.length} 条失效内链`,
      passedFinding: '抽查内链均可访问',
      value: `${brokenLinks.internal.length} 个失效内链目标`,
      affectedPages: brokenLinks.internal
        .flatMap((link) => link.sourcePages || []),
      details: brokenLinks.internal,
      recommendation: '修复或移除失效内链，并将重定向链接更新为最终可访问地址。',
      complete: siteInventoryComplete && linkInventoryComplete,
      unknownFinding: '内链抽查未覆盖完整站点，无法确认没有失效内链',
      unknownValue: `已检查 ${brokenLinks.coverage.checked_targets} 个唯一内链目标，证据不完整`
    }),
    evidenceCheck({
      id: 'orphan-pages',
      title: '疑似孤儿页面',
      severity: 'medium',
      failed: siteInventoryComplete && sitemapInventoryComplete && orphans.length > 0,
      finding: `${orphans.length} 个 Sitemap 页面未发现可抓取内部入口`,
      passedFinding: 'Sitemap 页面均有内部链接入口',
      value: `${orphans.length} 个疑似孤儿页面`,
      affectedPages: orphans,
      details: orphans.map((url) => ({
        url,
        discoveredBy: 'sitemap',
        inboundCount: 0
      })),
      recommendation: '从相关栏目、导航或正文为重要页面增加可抓取的内部链接。',
      complete: siteInventoryComplete && sitemapInventoryComplete && hasUsableSitemap,
      unknownFinding: hasUsableSitemap
        ? '站点或 Sitemap 清单不完整，无法可靠判断孤儿页面'
        : '暂时无法检查',
      unknownValue: hasUsableSitemap
        ? '证据不完整'
        : '未获得有效 Sitemap 页面清单'
    }),
    evidenceCheck({
      id: 'internal-link-quality',
      title: '内部链接来源质量',
      severity: 'low',
      failed: linkQuality.footer_only_pages.length > 0,
      finding: `${linkQuality.footer_only_pages.length} 个 Sitemap 页面仅有 Footer 入链`,
      passedFinding: 'Sitemap 页面具有导航、栏目、正文或其他结构性入链',
      value: `${linkQuality.footer_only_pages.length} 个页面仅依赖 Footer`,
      affectedPages: linkQuality.footer_only_pages,
      details: linkQuality.pages.filter((page) => page.classification === 'footer_only'),
      recommendation: '从主导航、栏目列表、面包屑、正文或相关推荐为重要页面增加上下文内链。',
      complete: siteInventoryComplete && sitemapInventoryComplete && hasUsableSitemap,
      unknownFinding: hasUsableSitemap
        ? '站点或 Sitemap 清单不完整，无法可靠判断内链来源质量'
        : '暂时无法检查',
      unknownValue: hasUsableSitemap
        ? '证据不完整'
        : '未获得有效 Sitemap 页面清单'
    }),
    evidenceCheck({
      id: 'sitemap-coverage',
      title: 'Sitemap 页面覆盖',
      severity: 'high',
      failed: sitemap.missing_from_sitemap.length > 0 || sitemap.invalid_entries.length > 0,
      finding: `${sitemap.missing_from_sitemap.length} 个可索引页面缺失，${sitemap.invalid_entries.length} 个条目无效`,
      passedFinding: 'Sitemap 与本次可访问页面一致',
      value: `${sitemap.missing_from_sitemap.length + sitemap.invalid_entries.length} 个差异`,
      affectedPages: [
        ...sitemap.missing_from_sitemap,
        ...sitemap.invalid_entries.map((entry) => entry.url)
      ],
      details: [
        ...sitemap.missing_from_sitemap.map((url) => ({ url, reason: 'missing_from_sitemap' })),
        ...sitemap.invalid_entries
      ],
      recommendation: '把重要可索引页面加入 Sitemap，并移除失效、重定向或 noindex 条目。',
      complete: sitemap.inventory_complete && !hasFailedPages,
      unknownFinding: hasUsableSitemap
        ? 'Sitemap 或抓取清单不完整，无法确认两者完全一致'
        : '暂时无法检查',
      unknownValue: hasUsableSitemap
        ? '证据不完整'
        : '未获得有效 Sitemap 页面清单'
    }),
    evidenceCheck({
      id: 'url-consistency',
      title: '站点 URL 一致性',
      severity: 'high',
      failed: urlConsistency.issues.length > 0,
      finding: `${urlConsistency.issues.length} 个 Sitemap、Canonical、Open Graph 或站点来源不一致问题`,
      passedFinding: 'Sitemap、Canonical、Open Graph 与检测入口同源且使用公开地址',
      value: `${urlConsistency.issues.length} 个 URL 配置问题`,
      affectedPages: urlConsistency.issues.map((issue) => issue.page || issue.target),
      details: urlConsistency.issues,
      recommendation: '使用统一的公开 HTTPS 站点地址生成 robots、Sitemap、Canonical 与 og:url，正式环境不得使用 localhost 或私网地址。',
      complete: siteInventoryComplete && sitemapInventoryComplete,
      unknownFinding: '站点或 Sitemap 清单不完整，无法确认 URL 配置完全一致'
    }),
    evidenceCheck({
      id: 'hreflang',
      title: 'hreflang 国际化声明',
      severity: 'medium',
      failed: hreflang.errors.length > 0,
      finding: `${hreflang.errors.length} 个 hreflang 错误`,
      passedFinding: 'hreflang 语言、目标与回链有效',
      value: `${hreflang.errors.length} 个错误`,
      affectedPages: hreflang.errors.map((error) => error.page),
      details: [...hreflang.errors, ...hreflang.unverified],
      recommendation: '使用有效语言代码、唯一目标 URL，并确保语言版本页面互相声明回链。',
      complete: siteInventoryComplete && hreflang.unverified.length === 0,
      unknownFinding: '部分 hreflang 目标不在本次审计范围，无法验证回链',
      unknownValue: `${hreflang.unverified.length} 个目标未验证`
    }),
    evidenceCheck({
      id: 'navigation-crawlability',
      title: '导航链接可抓取性',
      severity: 'medium',
      failed: navigationIssueCount > 0,
      finding: navigationFinding,
      passedFinding: '导航目标均可从带 href 的 a 标签直接读取',
      value: navigationValue,
      affectedPages: [
        ...navigation.static_issues.flatMap((issue) => issue.sourcePages),
        ...navigation.rendered_controls.map((entry) => entry.page),
        ...navigation.interaction_dependent_links.map((entry) => entry.page)
      ],
      details: [
        ...navigation.static_issues,
        ...navigation.rendered_controls,
        ...navigation.interaction_dependent_links
      ],
      recommendation: '凡是跳转到新 URL 的入口都使用带 href 的 a/Link；只负责展开菜单的控件使用 button；子菜单链接保留在初始 DOM 中。',
      complete: navigationIssueCount > 0 || rendering.status === 'completed',
      unknownFinding: '未取得完整浏览器导航证据，无法确认交互菜单均可抓取'
    }),
    (
      rendering.status === 'unavailable'
      || (rendering.status === 'partial' && rendering.differences.length === 0)
    )
      ? {
          id: 'javascript-rendering',
          title: 'JavaScript 渲染抽样',
          severity: 'medium',
          status: 'unknown',
          finding: '未取得完整的浏览器渲染证据',
          value: rendering.status === 'partial'
            ? `${rendering.samples.length} 个成功，${rendering.failures.length} 个失败`
            : rendering.reason || '渲染器不可用',
          affectedPages: [],
          details: rendering.failures,
          recommendation: ''
        }
      : evidenceCheck({
          id: 'javascript-rendering',
          title: 'JavaScript 渲染抽样',
          severity: 'medium',
          failed: rendering.differences.length > 0,
          finding: `${rendering.differences.length} 个抽样页面依赖客户端渲染`,
          passedFinding: '源码与浏览器渲染后的关键 SEO 内容一致',
          value: rendering.failures.length
            ? `${rendering.samples.length} 个成功，${rendering.failures.length} 个失败，${rendering.differences.length} 个差异`
            : `${rendering.samples.length} 个样本，${rendering.differences.length} 个差异`,
          affectedPages: rendering.differences.map((entry) => entry.url),
          details: rendering.differences,
          recommendation: '确保标题、描述、正文和关键内链可在服务器返回的 HTML 中直接读取。'
        })
  ];

  return {
    version: SITEWIDE_VERSION,
    checks,
    issues: checks.filter((item) => item.status === 'failed'),
    duplicate_titles: duplicateTitles,
    duplicate_descriptions: duplicateDescriptions,
    canonical,
    redirects,
    broken_links: brokenLinks,
    orphan_pages: orphans,
    internal_link_quality: linkQuality,
    sitemap,
    url_consistency: urlConsistency,
    hreflang,
    rendering,
    navigation_crawlability: navigation
  };
}

function issueOccurrences(report) {
  const collections = [
    ['page-rule', Array.isArray(report?.issues) ? report.issues : []],
    ['sitewide', Array.isArray(report?.sitewide?.issues) ? report.sitewide.issues : []]
  ];
  const occurrences = [];
  collections.forEach(([scope, issues]) => {
    issues.forEach((issue) => {
      const pages = Array.isArray(issue.affectedPages) && issue.affectedPages.length
        ? issue.affectedPages
        : [''];
      pages.forEach((url) => {
        const matchingDetails = scope === 'sitewide' && Array.isArray(issue.details)
          ? issue.details.filter((detail) => (
              String(detail?.page || detail?.url || '') === String(url || '')
              || (Array.isArray(detail?.sourcePages) && detail.sourcePages.includes(url))
            ))
          : [];
        const evidence = matchingDetails
          .map((detail) => JSON.stringify({
            type: detail?.type || '',
            target: detail?.target || detail?.url || '',
            targets: Array.isArray(detail?.targets) ? detail.targets : [],
            reason: detail?.reason || ''
          }))
          .sort()
          .join('|');
        const item = {
          id: issue.id,
          title: issue.title,
          scope,
          url: String(url || ''),
          ...(evidence ? { evidence } : {})
        };
        occurrences.push({
          ...item,
          key: `${scope}:${item.id}:${item.url}:${evidence}`
        });
      });
    });
  });
  return occurrences.sort((left, right) => left.key.localeCompare(right.key));
}

function comparisonIncompatibilities(currentReport, previousReport) {
  const reasons = [];
  if (currentReport?.mode !== 'site' || previousReport?.mode !== 'site') reasons.push('mode');
  if (String(currentReport?.ruleVersion || '') !== String(previousReport?.ruleVersion || '')) {
    reasons.push('rule_version');
  }
  if (String(currentReport?.scoreVersion || '') !== String(previousReport?.scoreVersion || '')) {
    reasons.push('score_version');
  }
  if (String(currentReport?.sitewide?.version || '') !== String(previousReport?.sitewide?.version || '')) {
    reasons.push('sitewide_version');
  }
  if (String(currentReport?.site?.origin || '') !== String(previousReport?.site?.origin || '')) {
    reasons.push('origin');
  }
  if (currentReport?.site?.truncated === true || previousReport?.site?.truncated === true) {
    reasons.push('truncated_scope');
  }
  return reasons;
}

function compareAuditIssues(currentReport, previousReport) {
  if (!previousReport) {
    return {
      status: 'no_baseline',
      previous_audit_id: null,
      previous_checked_at: null,
      added: [],
      resolved: [],
      persisting: [],
      unverified: []
    };
  }
  const incompatibilities = comparisonIncompatibilities(currentReport, previousReport);
  if (incompatibilities.length) {
    return {
      status: 'not_comparable',
      reason_codes: incompatibilities,
      previous_audit_id: previousReport.auditId || null,
      previous_checked_at: previousReport.checkedAt || null,
      added: [],
      resolved: [],
      persisting: [],
      unverified: []
    };
  }
  const current = issueOccurrences(currentReport);
  const previous = issueOccurrences(previousReport);
  const currentKeys = new Set(current.map((item) => item.key));
  const previousKeys = new Set(previous.map((item) => item.key));
  const unknownSitewideIds = new Set(
    (Array.isArray(currentReport?.sitewide?.checks) ? currentReport.sitewide.checks : [])
      .filter((item) => item?.status === 'unknown')
      .map((item) => item.id)
  );
  const failedPageUrls = new Set(
    (Array.isArray(currentReport?.pages) ? currentReport.pages : [])
      .filter((page) => page?.status === 'failed')
      .flatMap((page) => [page?.url, page?.finalUrl])
      .map((url) => normalizedUrl(url))
      .filter(Boolean)
  );
  const unverified = previous.filter((item) => (
    item.scope === 'sitewide'
    && (
      unknownSitewideIds.has(item.id)
      || failedPageUrls.has(normalizedUrl(item.url))
    )
    && !currentKeys.has(item.key)
  ) || (
    item.scope === 'page-rule'
    && failedPageUrls.has(normalizedUrl(item.url))
    && !currentKeys.has(item.key)
  ));
  const unverifiedKeys = new Set(unverified.map((item) => item.key));
  return {
    status: unverified.length ? 'partial' : 'compared',
    previous_audit_id: previousReport.auditId || null,
    previous_checked_at: previousReport.checkedAt || null,
    added: current.filter((item) => !previousKeys.has(item.key)),
    resolved: previous.filter((item) => !currentKeys.has(item.key) && !unverifiedKeys.has(item.key)),
    persisting: current.filter((item) => previousKeys.has(item.key)),
    unverified
  };
}

module.exports = {
  SITEWIDE_VERSION,
  analyzeSitewideEvidence,
  compareAuditIssues
};
