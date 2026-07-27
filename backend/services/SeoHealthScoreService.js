function roundScore(value) {
  return Number(value.toFixed(4));
}

const SEVERITY_PRIORITY = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
});

function statusFromScore(score) {
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'healthy';
  if (score >= 60) return 'needs_improvement';
  return 'high_risk';
}

function pageWeight(instance, scoreConfig) {
  return instance.isHomepage ? scoreConfig.homepageWeight : 1;
}

function pageCoverage(pages, predicate, scoreConfig, isApplicable = () => true) {
  const applicablePages = pages.filter(isApplicable);
  const totalWeight = applicablePages.reduce(
    (sum, page) => sum + (page.isHomepage ? scoreConfig.homepageWeight : 1),
    0
  );
  const affected = applicablePages.filter(predicate);
  const affectedWeight = affected.reduce(
    (sum, page) => sum + (page.isHomepage ? scoreConfig.homepageWeight : 1),
    0
  );
  return {
    affected,
    coverage: totalWeight ? roundScore(affectedWeight / totalWeight) : 0
  };
}

function detectTechnicalHealthBlockers({
  pages,
  crawlerAccess = { crawlers: [] },
  scoreConfig
}) {
  const blockers = [];
  const homepage = pages.find((page) => page.isHomepage);
  if (
    homepage
    && Number.isInteger(homepage.statusCode)
    && homepage.statusCode >= 400
  ) {
    blockers.push({
      id: 'homepage-unavailable',
      title: '首页无法访问',
      finding: `首页返回 HTTP ${homepage.statusCode}`,
      cap: scoreConfig.blockerPolicy.homepageUnavailableCap,
      affectedPages: [homepage.url],
      coverage: 1
    });
  }
  const traditionalCrawlers = scoreConfig.blockerPolicy.traditionalSearchCrawlerKeys
    .map((key) => crawlerAccess.crawlers.find((crawler) => crawler.key === key))
    .filter(Boolean);
  if (
    traditionalCrawlers.length === scoreConfig.blockerPolicy.traditionalSearchCrawlerKeys.length
    && traditionalCrawlers.every((crawler) => crawler.status === 'blocked')
  ) {
    blockers.push({
      id: 'all-traditional-search-crawlers-blocked',
      title: '主要搜索爬虫全部被禁止',
      finding: 'robots 规则明确阻止 Google、Bing 和百度主要爬虫',
      cap: scoreConfig.blockerPolicy.allTraditionalSearchCrawlersBlockedCap,
      affectedPages: pages.map((page) => page.url),
      coverage: 1
    });
  }
  if (homepage && homepage.indexable === false) {
    const { coverage } = pageCoverage(
      pages,
      (page) => page.url === homepage.url,
      scoreConfig
    );
    blockers.push({
      id: 'homepage-noindex',
      title: '首页禁止索引',
      finding: '首页明确设置 noindex',
      cap: scoreConfig.blockerPolicy.homepageNoindexCap,
      affectedPages: [homepage.url],
      coverage
    });
  }
  const noindexCoverage = pageCoverage(
    pages,
    (page) => page.indexable === false,
    scoreConfig,
    (page) => typeof page.indexable === 'boolean'
  );
  if (
    noindexCoverage.coverage >= scoreConfig.blockerPolicy.widespreadCoverage
    && noindexCoverage.affected.some((page) => !page.isHomepage)
  ) {
    blockers.push({
      id: 'widespread-noindex',
      title: '大范围页面禁止索引',
      finding: `${noindexCoverage.affected.length} 个页面明确设置 noindex`,
      cap: scoreConfig.blockerPolicy.widespreadNoindexCap,
      affectedPages: noindexCoverage.affected.map((page) => page.url),
      coverage: noindexCoverage.coverage
    });
  }
  const emptyContentCoverage = pageCoverage(
    pages,
    (page) => page.contentCharacters === 0,
    scoreConfig,
    (page) => page.statusCode >= 200
      && page.statusCode < 400
      && Number.isFinite(page.contentCharacters)
  );
  if (emptyContentCoverage.coverage >= scoreConfig.blockerPolicy.widespreadCoverage) {
    blockers.push({
      id: 'widespread-empty-content',
      title: '大范围页面没有有效正文',
      finding: `${emptyContentCoverage.affected.length} 个页面无法解析出有效正文`,
      cap: scoreConfig.blockerPolicy.widespreadEmptyContentCap,
      affectedPages: emptyContentCoverage.affected.map((page) => page.url),
      coverage: emptyContentCoverage.coverage
    });
  }
  return blockers;
}

function calculateTechnicalHealth({
  instances,
  blockers = [],
  evidenceComplete = true,
  unknownReasons = [],
  rules,
  scoreConfig
}) {
  const uniqueInstances = new Map();
  instances.forEach((instance) => {
    const key = `${instance.check.id}\u0000${instance.url}`;
    const existing = uniqueInstances.get(key);
    if (!existing || (existing.check.status !== 'failed' && instance.check.status === 'failed')) {
      uniqueInstances.set(key, instance);
    }
  });
  const deduplicatedInstances = [...uniqueInstances.values()];
  const byRule = new Map();
  deduplicatedInstances.forEach((instance) => {
    const id = instance.check.id;
    if (!byRule.has(id)) byRule.set(id, []);
    byRule.get(id).push(instance);
  });

  const ruleResults = new Map();
  const stages = scoreConfig.stages.map((stage) => {
    const totalRuleWeight = stage.ruleIds.reduce(
      (sum, id) => sum + rules.checks[id].weight,
      0
    );
    const deduction = stage.ruleIds.reduce((sum, id) => {
      const ruleInstances = byRule.get(id) || [];
      const applicableWeight = ruleInstances.reduce(
        (total, instance) => total + pageWeight(instance, scoreConfig),
        0
      );
      const failedInstances = ruleInstances.filter((instance) => instance.check.status === 'failed');
      const failedWeight = failedInstances.reduce(
        (total, instance) => total + pageWeight(instance, scoreConfig),
        0
      );
      const coverage = applicableWeight ? failedWeight / applicableWeight : 0;
      const share = rules.checks[id].weight / totalRuleWeight;
      const ruleDeduction = stage.budget * share * coverage;
      ruleResults.set(id, {
        id,
        stage,
        coverage,
        deduction: ruleDeduction,
        instances: ruleInstances,
        failedInstances
      });
      return sum + ruleDeduction;
    }, 0);
    const score = roundScore(Math.max(0, stage.budget - deduction));
    return { ...stage, score, deduction: roundScore(deduction) };
  });

  const rawScore = roundScore(stages.reduce((sum, stage) => sum + stage.score, 0));
  const scoreCap = blockers.length ? Math.min(...blockers.map((blocker) => blocker.cap)) : null;
  const hasFailures = [...ruleResults.values()]
    .some((result) => result.failedInstances.length > 0);
  const roundedScore = Math.min(Math.round(rawScore), hasFailures ? 99 : 100);
  const score = Math.min(roundedScore, scoreCap ?? 100);
  const bottleneck = stages.reduce((lowest, stage) => {
    if (!lowest) return stage;
    return stage.score / stage.budget < lowest.score / lowest.budget ? stage : lowest;
  }, null);
  const issues = [...ruleResults.values()]
    .filter((result) => result.failedInstances.length > 0)
    .map((result) => {
      const first = result.failedInstances[0].check;
      return {
        id: result.id,
        title: first.title,
        finding: first.finding,
        status: 'failed',
        severity: first.severity,
        stage: result.stage.key,
        stageLabel: result.stage.label,
        affectedPages: [...new Set(result.failedInstances.map((instance) => instance.url))],
        applicablePages: new Set(result.instances.map((instance) => instance.url)).size,
        coverage: roundScore(result.coverage),
        affectsHomepage: result.failedInstances.some((instance) => instance.isHomepage),
        deduction: roundScore(result.deduction),
        value: first.value,
        category: first.category,
        weight: first.weight,
        recommendation: first.recommendation,
        count: result.failedInstances.length,
        findings: result.failedInstances.map((instance) => ({
          url: instance.url,
          finding: instance.check.finding,
          value: instance.check.value
        }))
      };
    })
    .sort((left, right) => {
      return (SEVERITY_PRIORITY[left.severity] ?? Number.MAX_SAFE_INTEGER)
        - (SEVERITY_PRIORITY[right.severity] ?? Number.MAX_SAFE_INTEGER)
        || right.deduction - left.deduction
        || Number(right.affectsHomepage) - Number(left.affectsHomepage)
        || right.coverage - left.coverage
        || left.id.localeCompare(right.id);
    });
  const blockerPriorities = blockers
    .map((blocker) => ({
      ...blocker,
      kind: 'blocker',
      status: 'failed',
      severity: 'critical',
      stage: 'blocker',
      stageLabel: '确定性阻断',
      affectsHomepage: blocker.affectedPages?.some(
        (url) => deduplicatedInstances.some((instance) => instance.url === url && instance.isHomepage)
      ) || false,
      deduction: null,
      recommendation: blocker.recommendation || null
    }))
    .sort((left, right) => left.cap - right.cap || left.id.localeCompare(right.id));
  const priorities = [
    ...blockerPriorities,
    ...issues.map((issue) => ({ ...issue, kind: 'issue' }))
  ];

  if (!evidenceComplete) {
    const unknownIssues = issues.map((issue) => ({ ...issue, deduction: null }));
    const unknownIssuesById = new Map(unknownIssues.map((issue) => [issue.id, issue]));
    return {
      score: null,
      rawScore: null,
      status: 'unknown',
      scoreCap: null,
      blockers,
      bottleneck: null,
      stages: stages.map((stage) => ({ ...stage, score: null, deduction: null })),
      issues: unknownIssues,
      priorities: priorities.map((priority) => (
        priority.kind === 'issue'
          ? { ...unknownIssuesById.get(priority.id), kind: 'issue' }
          : priority
      )),
      unknownReasons
    };
  }

  return {
    score,
    rawScore,
    status: blockers.length ? 'blocked' : statusFromScore(score),
    scoreCap,
    blockers,
    bottleneck,
    stages,
    issues,
    priorities
  };
}

module.exports = {
  calculateTechnicalHealth,
  detectTechnicalHealthBlockers
};
