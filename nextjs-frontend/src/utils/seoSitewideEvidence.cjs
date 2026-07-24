const ANCHOR_REASON_COPY = {
  missing_href: '使用 <a>，但缺少 href；爬虫无法读取目标地址',
  empty_href: '使用 <a href="">；目标地址为空',
  fragment_placeholder: '使用 <a href="#"> 占位，没有实际页面地址',
  javascript_url: 'href 使用 javascript:；不是标准页面链接',
  invalid_url: 'href 不是有效的 HTTP/HTTPS 页面地址',
};

function safeReportUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function buildNavigationEvidence(detail = {}) {
  if (detail.triggerText) {
    return {
      title: String(detail.triggerText || '未命名菜单'),
      explanation: `子链接只在悬浮或聚焦后出现，共 ${detail.links?.length || 0} 个`,
      occurrenceCount: 1,
      occurrencePages: detail.page ? [detail.page] : [],
      targetLinks: Array.isArray(detail.links) ? detail.links : [],
    };
  }

  const tag = String(detail.tag || 'element');
  const invalidAnchor = detail.type === 'invalid-anchor';
  return {
    title: String(detail.text || '无文本导航'),
    explanation: invalidAnchor
      ? ANCHOR_REASON_COPY[detail.reason] || `使用 <${tag}>，但没有可抓取的有效 href`
      : `使用 <${tag}> 处理点击，但没有 <a href>；目标地址无法从 HTML 读取`,
    occurrenceCount: Number(detail.sourcePageCount || (detail.page ? 1 : 0)),
    occurrencePages: Array.isArray(detail.sourcePages)
      ? detail.sourcePages
      : detail.page ? [detail.page] : [],
    targetLinks: [],
  };
}

function buildCheckEvidence(check = {}) {
  const details = Array.isArray(check.details) ? check.details : [];
  if (check.id === 'navigation-crawlability') {
    return details.map(buildNavigationEvidence);
  }
  if (check.id === 'orphan-pages') {
    return details.map((detail) => ({
      title: detail.url || '未命名页面',
      explanation: `由 Sitemap 发现，站内可抓取入链 ${detail.inboundCount ?? 0} 条`,
    }));
  }
  if (check.id === 'internal-link-quality') {
    return details.map((detail) => ({
      title: detail.url || '未命名页面',
      explanation: `仅 Footer 入链 · ${detail.source_page_count || 0} 个来源页面 · ${detail.inbound_count || 0} 条链接`,
    }));
  }
  if (check.id === 'url-consistency') {
    return details.map((detail) => ({
      title: detail.message || detail.type || 'URL 不一致',
      explanation: detail.target || '',
    }));
  }
  return [];
}

function normalizeSitewideCheckForDisplay(check = {}) {
  if (check.id !== 'navigation-crawlability' || check.status !== 'failed') return check;

  const details = Array.isArray(check.details) ? check.details : [];
  if (details.length === 0) return check;
  const interactionCount = details.filter((detail) => detail.triggerText).length;
  const invalidAnchorCount = details.filter((detail) => detail.type === 'invalid-anchor').length;
  const nonSemanticCount = details.filter(
    (detail) => !detail.triggerText && detail.type !== 'invalid-anchor'
  ).length;
  const unreadableTargetCount = invalidAnchorCount + nonSemanticCount;

  return {
    ...check,
    finding: `${unreadableTargetCount} 类导航入口无法从 HTML 直接读取跳转地址；${interactionCount} 组链接只在交互后出现`,
    value: `div/span 等点击跳转 ${nonSemanticCount} 类 · 无有效 href 的 a ${invalidAnchorCount} 类`,
  };
}

module.exports = {
  buildCheckEvidence,
  normalizeSitewideCheckForDisplay,
  safeReportUrl,
};
