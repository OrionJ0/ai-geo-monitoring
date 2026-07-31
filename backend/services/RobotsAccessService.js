const AUDIT_CRAWLER_USER_AGENT = 'GoodieAI-SEO-Audit';
const AUDIT_CRAWLER_PROFILE = Object.freeze({
  key: 'goodieai-seo-audit',
  label: 'GoodieAI SEO Audit',
  token: AUDIT_CRAWLER_USER_AGENT,
  category: 'audit',
  affectsScore: false,
  robotsPolicy: 'standard'
});

function parseGroups(body) {
  const groups = [];
  let current = null;
  let hasRules = false;

  String(body || '').replace(/^\uFEFF/, '').split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.replace(/#.*$/, '').trim();
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!match) return;
    const directive = match[1].toLowerCase();
    const value = match[2].trim();

    if (directive === 'user-agent') {
      if (!value) return;
      if (!current || hasRules) {
        current = { agents: [], rules: [] };
        groups.push(current);
        hasRules = false;
      }
      current.agents.push(value);
      return;
    }

    if ((directive === 'allow' || directive === 'disallow') && current) {
      hasRules = true;
      if (value) current.rules.push({ directive, pattern: value });
    }
  });

  return groups;
}

function groupsForToken(groups, token) {
  const normalizedToken = token.toLowerCase();
  const specific = groups.flatMap((group) => group.agents
    .filter((agent) => agent !== '*' && normalizedToken.includes(agent.toLowerCase()))
    .map((agent) => ({ group, agent })));
  if (specific.length) {
    const specificity = Math.max(...specific.map(({ agent }) => agent.length));
    return specific.filter(({ agent }) => agent.length === specificity);
  }
  return groups.flatMap((group) => group.agents
    .filter((agent) => agent === '*')
    .map((agent) => ({ group, agent })));
}

function escapeRegularExpression(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function matchRule(pattern, targetPath) {
  const endAnchored = pattern.endsWith('$');
  const pathPattern = endAnchored ? pattern.slice(0, -1) : pattern;
  const expression = pathPattern.split('*').map(escapeRegularExpression).join('.*');
  const matches = new RegExp(`^${expression}${endAnchored ? '$' : ''}`).test(targetPath);
  return {
    matches,
    specificity: Buffer.byteLength(pathPattern.replace(/\*/g, ''), 'utf8')
  };
}

function evaluateProfile(groups, profile, targetPath, sourceUrl) {
  const matches = groupsForToken(groups, profile.token);
  const rules = matches.flatMap(({ group }) => group.rules)
    .map((rule) => ({ ...rule, ...matchRule(rule.pattern, targetPath) }))
    .filter((rule) => rule.matches);
  const selected = rules.sort((a, b) => b.specificity - a.specificity
    || Number(b.directive === 'allow') - Number(a.directive === 'allow'))[0];
  const status = selected?.directive === 'disallow' ? 'blocked' : 'allowed';

  return {
    ...profile,
    status,
    matchedUserAgent: matches[0]?.agent || '',
    matchedRule: selected ? `${selected.directive === 'allow' ? 'Allow' : 'Disallow'}: ${selected.pattern}` : '未匹配限制规则',
    sourceUrl,
    targetPath
  };
}

function evaluateCrawlerAccess({ robotsResult, targetUrl, profiles = [] }) {
  const parsedUrl = new URL(targetUrl);
  const sourceUrl = `${parsedUrl.origin}/robots.txt`;
  const targetPath = `${parsedUrl.pathname}${parsedUrl.search}`;
  const statusCode = Number(robotsResult?.statusCode || 0);
  const body = String(robotsResult?.body || '');
  let sourceStatus = 'valid';
  let crawlers;

  if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
    sourceStatus = 'unavailable';
    crawlers = profiles.map((profile) => ({
      ...profile,
      status: 'allowed',
      matchedUserAgent: '',
      matchedRule: 'robots.txt 不存在或不可用，未声明抓取限制',
      sourceUrl,
      targetPath
    }));
  } else if (statusCode < 200 || statusCode >= 300) {
    sourceStatus = 'unreachable';
    crawlers = profiles.map((profile) => ({
      ...profile,
      status: 'unknown',
      matchedUserAgent: '',
      matchedRule: 'robots.txt 暂时无法访问，无法确认抓取权限',
      sourceUrl,
      targetPath
    }));
  } else if (!body.trim()) {
    sourceStatus = 'empty';
    crawlers = profiles.map((profile) => ({
      ...profile,
      status: 'allowed',
      matchedUserAgent: '',
      matchedRule: 'robots.txt 为空，未声明抓取限制',
      sourceUrl,
      targetPath
    }));
  } else {
    const groups = parseGroups(body);
    if (!groups.length) {
      sourceStatus = 'invalid';
      crawlers = profiles.map((profile) => ({
        ...profile,
        status: 'unknown',
        matchedUserAgent: '',
        matchedRule: 'robots.txt 缺少有效 User-agent，无法确认抓取权限',
        sourceUrl,
        targetPath
      }));
    } else {
      crawlers = profiles.map((profile) => evaluateProfile(groups, profile, targetPath, sourceUrl));
    }
  }
  const scoringCrawlers = crawlers.filter((crawler) => crawler.affectsScore);

  return {
    sourceUrl,
    sourceStatus,
    targetUrl: parsedUrl.toString(),
    targetPath,
    passed: scoringCrawlers.every((crawler) => crawler.status === 'allowed'),
    allowed: crawlers.filter((crawler) => crawler.status === 'allowed').length,
    blocked: crawlers.filter((crawler) => crawler.status === 'blocked').length,
    unknown: crawlers.filter((crawler) => crawler.status === 'unknown').length,
    crawlers
  };
}

function evaluateAuditCrawlerAccess({ robotsResult, targetUrl }) {
  const result = evaluateCrawlerAccess({
    robotsResult,
    targetUrl,
    profiles: [AUDIT_CRAWLER_PROFILE]
  });
  return {
    ...result.crawlers[0],
    sourceStatus: result.sourceStatus
  };
}

module.exports = {
  AUDIT_CRAWLER_USER_AGENT,
  evaluateAuditCrawlerAccess,
  evaluateCrawlerAccess
};
