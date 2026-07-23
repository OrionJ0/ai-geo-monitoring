const SITEWIDE_VERSION = 'sitewide-audit-v1';

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

function check({ id, title, severity, groups, emptyFinding, recommendation }) {
  const affectedPages = Array.from(new Set(groups.flatMap((group) => group.pages)));
  return {
    id,
    title,
    severity,
    status: groups.length ? 'failed' : 'passed',
    finding: groups.length ? `${groups.length} 组重复内容` : emptyFinding,
    value: groups.length
      ? `${affectedPages.length} 个页面受影响`
      : '未发现跨页重复',
    affectedPages,
    details: groups,
    recommendation: groups.length ? recommendation : ''
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
  recommendation
}) {
  return {
    id,
    title,
    severity,
    status: failed ? 'failed' : 'passed',
    finding: failed ? finding : passedFinding,
    value: failed ? value : '未发现问题',
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

function sitemapAnalysis({ origin, pages, sitemapUrls, truncated }) {
  const sitemapSet = new Set(
    (Array.isArray(sitemapUrls) ? sitemapUrls : [])
      .map((url) => normalizedUrl(url))
      .filter(Boolean)
  );
  const pageByRequestedUrl = new Map(
    pages.map((page) => [normalizedUrl(page.url), page]).filter(([url]) => url)
  );
  const missingFromSitemap = pages
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
    inventory_complete: !truncated
  };
}

function orphanPages({ origin, pages, sitemapUrls }) {
  const homepage = normalizedUrl(`${origin}/`);
  const sitemapSet = new Set(
    (Array.isArray(sitemapUrls) ? sitemapUrls : [])
      .map((url) => normalizedUrl(url))
      .filter(Boolean)
  );
  const incoming = new Set();
  pages.forEach((page) => {
    const sourceUrl = normalizedUrl(page.finalUrl || page.url);
    (Array.isArray(page.links) ? page.links : [])
      .filter((link) => link.internal === true)
      .forEach((link) => {
        const target = normalizedUrl(link.url, sourceUrl);
        if (target && target !== sourceUrl) incoming.add(target);
      });
  });
  return pages
    .filter((page) => page.status === 'completed')
    .map((page) => normalizedUrl(page.finalUrl || page.url))
    .filter((url) => url && url !== homepage && sitemapSet.has(url) && !incoming.has(url));
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
        errors.push({
          type: 'target-not-audited',
          page: pageUrl,
          language: entry.language,
          target: entry.url,
          message: 'hreflang 目标不在本次可访问页面中'
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
  return { errors };
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

function analyzeSitewideEvidence({
  origin,
  pages = [],
  sitemapUrls = [],
  linkChecks = [],
  renderAnalysis,
  truncated = false
} = {}) {
  const duplicateTitles = duplicateGroups(pages, 'title');
  const duplicateDescriptions = duplicateGroups(pages, 'description');
  const canonical = canonicalAnalysis(pages);
  const redirects = redirectAnalysis(pages);
  const brokenLinks = brokenLinkAnalysis(linkChecks);
  const sitemap = sitemapAnalysis({ origin, pages, sitemapUrls, truncated });
  const orphans = orphanPages({ origin, pages, sitemapUrls });
  const hreflang = hreflangAnalysis(pages);
  const rendering = renderingAnalysis(renderAnalysis);
  const checks = [
    check({
      id: 'duplicate-titles',
      title: '重复页面标题',
      severity: 'high',
      groups: duplicateTitles,
      emptyFinding: '页面标题保持唯一',
      recommendation: '为每个可索引页面设置能准确概括其主题的唯一标题。'
    }),
    check({
      id: 'duplicate-descriptions',
      title: '重复 Meta 描述',
      severity: 'medium',
      groups: duplicateDescriptions,
      emptyFinding: 'Meta 描述保持唯一',
      recommendation: '为每个重要页面编写与该页面内容一致的独特 Meta 描述。'
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
      recommendation: '每个页面只声明一个最终规范 URL，避免 Canonical 链与循环。'
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
      recommendation: '把内部链接直接指向最终 URL，并消除循环和多跳重定向。'
    }),
    evidenceCheck({
      id: 'broken-links',
      title: '失效内链与外链',
      severity: 'high',
      failed: brokenLinks.internal.length > 0 || brokenLinks.external.length > 0,
      finding: `${brokenLinks.internal.length} 条失效内链，${brokenLinks.external.length} 条失效外链`,
      passedFinding: '抽查链接均可访问',
      value: `${brokenLinks.internal.length + brokenLinks.external.length} 个失效目标`,
      affectedPages: [...brokenLinks.internal, ...brokenLinks.external]
        .flatMap((link) => link.sourcePages || []),
      details: [...brokenLinks.internal, ...brokenLinks.external],
      recommendation: '修复或移除失效链接，并将重定向链接更新为最终可访问地址。'
    }),
    evidenceCheck({
      id: 'orphan-pages',
      title: '孤儿页面',
      severity: 'medium',
      failed: orphans.length > 0,
      finding: `${orphans.length} 个 Sitemap 页面没有内部入口`,
      passedFinding: 'Sitemap 页面均有内部链接入口',
      value: `${orphans.length} 个孤儿页面`,
      affectedPages: orphans,
      details: orphans.map((url) => ({ url })),
      recommendation: '从相关栏目、导航或正文为重要页面增加可抓取的内部链接。'
    }),
    evidenceCheck({
      id: 'sitemap-coverage',
      title: 'Sitemap 与可访问页面差异',
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
      recommendation: '把重要可索引页面加入 Sitemap，并移除失效、重定向或 noindex 条目。'
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
      details: hreflang.errors,
      recommendation: '使用有效语言代码、唯一目标 URL，并确保语言版本页面互相声明回链。'
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
    sitemap,
    hreflang,
    rendering
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
        const item = {
          id: issue.id,
          title: issue.title,
          scope,
          url: String(url || '')
        };
        occurrences.push({
          ...item,
          key: `${scope}:${item.id}:${item.url}`
        });
      });
    });
  });
  return occurrences.sort((left, right) => left.key.localeCompare(right.key));
}

function compareAuditIssues(currentReport, previousReport) {
  if (!previousReport) {
    return {
      status: 'no_baseline',
      previous_audit_id: null,
      previous_checked_at: null,
      added: [],
      resolved: [],
      persisting: []
    };
  }
  const current = issueOccurrences(currentReport);
  const previous = issueOccurrences(previousReport);
  const currentKeys = new Set(current.map((item) => item.key));
  const previousKeys = new Set(previous.map((item) => item.key));
  return {
    status: 'compared',
    previous_audit_id: previousReport.auditId || null,
    previous_checked_at: previousReport.checkedAt || null,
    added: current.filter((item) => !previousKeys.has(item.key)),
    resolved: previous.filter((item) => !currentKeys.has(item.key)),
    persisting: current.filter((item) => previousKeys.has(item.key))
  };
}

module.exports = {
  SITEWIDE_VERSION,
  analyzeSitewideEvidence,
  compareAuditIssues
};
