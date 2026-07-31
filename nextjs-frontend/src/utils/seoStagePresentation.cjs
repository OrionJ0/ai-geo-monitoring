/* eslint-disable @typescript-eslint/no-require-imports */
const {
  normalizeSitewideCheckForDisplay,
} = require('./seoSitewideEvidence.cjs');

const CHECK_DEFINITIONS = {
  'http-status': {
    title: '页面访问状态',
    description: '检查页面能否稳定返回可读取的 HTTP 成功响应。',
  },
  https: {
    title: 'HTTPS',
    description: '检查页面是否通过 HTTPS 安全传输。',
  },
  'robots-txt': {
    title: 'robots.txt',
    description: '检查根目录 robots.txt 是否可访问、非空且格式可解析。',
  },
  'crawler-access': {
    title: '搜索与 AI 爬虫权限',
    description: '检查 robots 规则是否允许重要搜索与 AI 搜索爬虫访问。',
  },
  sitemap: {
    title: 'Sitemap 可用性',
    description: '检查 Sitemap 是否可访问、非空、格式有效并包含可用 URL。',
  },
  'crawlable-links': {
    title: '页面链接',
    description: '检查页面是否包含搜索引擎可发现的标准链接。',
  },
  'response-time': {
    title: '服务器响应时间',
    description: '检查服务器返回 HTML 的响应时间是否处于基础范围。',
  },
  'html-size': {
    title: 'HTML 体积',
    description: '检查 HTML 是否过大并增加下载、解析与抓取成本。',
  },
  indexability: {
    title: '索引指令',
    description: '检查页面是否通过 Meta Robots 或 X-Robots-Tag 设置 noindex。',
  },
  canonical: {
    title: 'Canonical 链接',
    description: '检查页面是否声明有效的规范 URL。',
  },
  title: {
    title: '页面标题',
    description: '检查 Title 是否存在、非空且长度处于基础范围。',
  },
  'meta-description': {
    title: 'Meta 描述',
    description: '检查页面描述是否存在、非空且长度处于基础范围。',
  },
  'meta-keywords': {
    title: 'Keywords 标签',
    description: '以低权重检查 Keywords 是否非空、适量且没有重复词。',
  },
  h1: {
    title: '标题结构',
    description: '检查页面是否有且仅有一个内容明确的 H1。',
  },
  'heading-order': {
    title: '标题层级',
    description: '检查 H1–H6 是否按连续层级组织而没有跳级。',
  },
  'content-depth': {
    title: '正文信息量',
    description: '检查页面是否具有能够表达主题的基础正文信息量。',
  },
  language: {
    title: '页面语言',
    description: '检查 HTML 是否声明可识别的页面语言。',
  },
  viewport: {
    title: '移动端 Viewport',
    description: '检查页面是否具备基础移动端视口配置。',
  },
  'image-alt': {
    title: '图片 Alt',
    description: '检查内容图片是否具有可理解的替代文本。',
  },
  'structured-data': {
    title: 'JSON-LD 结构化数据',
    description: '检查 JSON-LD 是否存在、非空且格式有效。',
  },
  'open-graph': {
    title: 'Open Graph',
    description: '检查分享标题、描述和图片等 Open Graph 信息。',
  },
  'twitter-card': {
    title: 'Twitter Card',
    description: '检查页面是否声明社交分享卡片类型。',
  },
};

const STAGE_PRIORITY = {
  access: 0,
  index: 1,
  content: 2,
  enhancement: 3,
};

const SEVERITY_PRIORITY = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const SITEWIDE_STAGE = {
  redirects: ['access', '访问与发现'],
  'broken-links': ['access', '访问与发现'],
  'orphan-pages': ['access', '访问与发现'],
  'internal-link-quality': ['access', '访问与发现'],
  'sitemap-coverage': ['access', '访问与发现'],
  'url-consistency': ['access', '访问与发现'],
  'navigation-crawlability': ['access', '访问与发现'],
  'canonical-conflicts': ['index', '索引资格'],
  hreflang: ['index', '索引资格'],
  'duplicate-titles': ['content', '内容理解'],
  'duplicate-descriptions': ['content', '内容理解'],
  'javascript-rendering': ['enhancement', '展示与增强'],
};

function checkMatchesFilter(check, filter) {
  if (filter === 'urgent') {
    return check.status === 'failed' && ['critical', 'high'].includes(check.severity);
  }
  if (filter === 'normal') {
    return check.status === 'failed' && ['medium', 'low'].includes(check.severity);
  }
  if (filter === 'passed') return check.status === 'passed';
  return true;
}

function buildStageGroups(report, filter = 'all') {
  const checksById = new Map(
    (report?.categories || [])
      .flatMap((category) => category.checks || [])
      .map((check) => [check.id, check])
  );
  const issuesById = new Map(
    [
      ...(report?.priorities || []),
      ...(report?.issues || []),
      ...(report?.health?.issues || []),
    ]
      .filter((issue) => issue.kind !== 'blocker')
      .map((issue) => [issue.id, issue])
  );

  return (report?.health?.stages || []).map((stage) => ({
    ...stage,
    checks: (stage.ruleIds || [])
      .map((id) => {
        const check = checksById.get(id);
        const issue = issuesById.get(id);
        const definition = CHECK_DEFINITIONS[id];
        if (!check && !issue && !definition) return null;
        return {
          id,
          ...check,
          ...issue,
          title: definition?.title || issue?.title || check?.title || id,
          description: definition?.description
            || issue?.description
            || check?.description
            || '检查该项技术事实是否满足基础要求。',
          status: issue ? 'failed' : check?.status || 'passed',
        };
      })
      .filter(Boolean)
      .filter((check) => checkMatchesFilter(check, filter)),
  }));
}

function buildInformationalChecks(report = {}) {
  return (Array.isArray(report.informationalChecks) ? report.informationalChecks : [])
    .filter((check) => check?.affectsScore === false);
}

function sortPriorities(priorities = []) {
  return [...priorities].sort((left, right) => {
    const blockerDifference = Number(right.kind === 'blocker') - Number(left.kind === 'blocker');
    if (blockerDifference) return blockerDifference;
    if (left.kind === 'blocker' && right.kind === 'blocker') {
      return Number(left.cap ?? 100) - Number(right.cap ?? 100)
        || String(left.id).localeCompare(String(right.id));
    }

    return (SEVERITY_PRIORITY[left.severity] ?? Number.MAX_SAFE_INTEGER)
      - (SEVERITY_PRIORITY[right.severity] ?? Number.MAX_SAFE_INTEGER)
      || Number(right.deduction || 0) - Number(left.deduction || 0)
      || Number(Boolean(right.affectsHomepage)) - Number(Boolean(left.affectsHomepage))
      || Number(right.coverage || 0) - Number(left.coverage || 0)
      || (STAGE_PRIORITY[left.stage] ?? Number.MAX_SAFE_INTEGER)
        - (STAGE_PRIORITY[right.stage] ?? Number.MAX_SAFE_INTEGER)
      || String(left.id).localeCompare(String(right.id));
  });
}

function buildPriorityContent(report = {}) {
  const technical = (
    Array.isArray(report.priorities) ? report.priorities : report.issues || []
  ).map((item) => ({
    ...item,
    sourceKind: 'technical',
    sourceLabel: item.kind === 'blocker' ? '核心阻断' : '页面技术',
  }));
  const seenIds = new Set(technical.map((item) => item.id));
  const sitewide = (Array.isArray(report.sitewide?.checks) ? report.sitewide.checks : [])
    .filter((check) => check.status === 'failed' && !seenIds.has(check.id))
    .map((check) => {
      const displayCheck = normalizeSitewideCheckForDisplay(check);
      const [stage, stageLabel] = SITEWIDE_STAGE[displayCheck.id]
        || ['enhancement', '跨页专项'];
      const detailPageCount = displayCheck.id === 'navigation-crawlability'
        ? Math.max(
            0,
            ...(displayCheck.details || []).map((detail) => Number(detail.sourcePageCount || 0))
          )
        : 0;
      seenIds.add(displayCheck.id);
      return {
        ...displayCheck,
        kind: 'issue',
        stage,
        stageLabel,
        sourceKind: 'sitewide',
        sourceLabel: '跨页专项',
        detailHref: `#sitewide-check-${displayCheck.id}`,
        count: Math.max(displayCheck.affectedPages?.length || 0, detailPageCount),
        applicablePages: report.site?.auditedPages || 0,
      };
    });
  const failedPlatforms = (Array.isArray(report.platforms) ? report.platforms : [])
    .filter((platform) => platform.status !== 'detected');
  const platformIssues = failedPlatforms.length > 0 && !seenIds.has('search-verification')
    ? [{
        id: 'search-verification',
        title: '搜索平台验证标签',
        status: 'failed',
        kind: 'issue',
        stage: 'access',
        stageLabel: '访问与发现',
        severity: 'low',
        sourceKind: 'platform',
        sourceLabel: '平台接入',
        detailHref: '#platform-status-title',
        finding: `${failedPlatforms.map((platform) => platform.label).join('、')}的首页验证标签缺失或为空`,
        value: failedPlatforms.map((platform) => (
          `${platform.label}：${platform.status === 'empty' ? '内容为空' : '缺失'}`
        )).join(' · '),
        recommendation: '在站点首页添加各搜索平台提供的非空 HTML 验证标签，并在对应站长平台完成验证。',
        affectedPages: Array.from(new Set(failedPlatforms.map((platform) => platform.sourceUrl).filter(Boolean))),
        count: failedPlatforms.length,
        applicablePages: report.platforms?.length || failedPlatforms.length,
        platforms: failedPlatforms,
      }]
    : [];

  return sortPriorities([...technical, ...sitewide, ...platformIssues]);
}

module.exports = {
  buildInformationalChecks,
  buildPriorityContent,
  buildStageGroups,
  sortPriorities,
};
