const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateTechnicalHealth,
  detectTechnicalHealthBlockers
} = require('../services/SeoHealthScoreService');
const {
  defaultSeoAuditRules,
  defaultSeoHealthScoreConfig,
  validateSeoHealthScoreConfig
} = require('../config/seoAuditRules');

const TEST_SCORE_CONFIG = {
  version: 'test-v4',
  homepageWeight: 3,
  informationalRuleIds: [],
  siteScopedRuleIds: [],
  stages: [
    { key: 'access', label: '访问与发现', budget: 30, ruleIds: ['http-status'] },
    { key: 'index', label: '索引资格', budget: 25, ruleIds: ['indexability'] },
    { key: 'content', label: '内容理解', budget: 30, ruleIds: ['title'] },
    { key: 'enhancement', label: '展示与增强', budget: 15, ruleIds: ['viewport'] }
  ]
};

const TEST_RULES = {
  checks: {
    'http-status': { severity: 'critical', weight: 1 },
    indexability: { severity: 'critical', weight: 1 },
    title: { severity: 'high', weight: 1 },
    viewport: { severity: 'high', weight: 1 }
  }
};

function instance(id, status, { url = 'https://example.com/', isHomepage = true } = {}) {
  return {
    url,
    isHomepage,
    check: {
      id,
      title: id,
      finding: `${id} ${status}`,
      status,
      severity: TEST_RULES.checks[id].severity,
      weight: TEST_RULES.checks[id].weight,
      value: status,
      category: 'technical',
      recommendation: `修复 ${id}`
    }
  };
}

test('技术健康分按四阶段预算扣分并返回主要瓶颈', () => {
  const result = calculateTechnicalHealth({
    instances: [
      instance('http-status', 'passed'),
      instance('indexability', 'passed'),
      instance('title', 'failed'),
      instance('viewport', 'passed')
    ],
    rules: TEST_RULES,
    scoreConfig: TEST_SCORE_CONFIG
  });

  assert.equal(result.score, 70);
  assert.equal(result.rawScore, 70);
  assert.equal(result.status, 'needs_improvement');
  assert.equal(result.bottleneck.key, 'content');
  assert.deepEqual(
    result.stages.map(({ key, score }) => [key, score]),
    [['access', 30], ['index', 25], ['content', 0], ['enhancement', 15]]
  );
});

test('全站同类问题按首页权重聚合为一条覆盖率扣分', () => {
  const innerPage = { url: 'https://example.com/product', isHomepage: false };
  const result = calculateTechnicalHealth({
    instances: [
      instance('http-status', 'passed'),
      instance('indexability', 'passed'),
      instance('title', 'failed'),
      instance('viewport', 'passed'),
      instance('http-status', 'passed', innerPage),
      instance('indexability', 'passed', innerPage),
      instance('title', 'passed', innerPage),
      instance('viewport', 'passed', innerPage)
    ],
    rules: TEST_RULES,
    scoreConfig: TEST_SCORE_CONFIG
  });

  assert.equal(result.rawScore, 77.5);
  assert.equal(result.issues.length, 1);
  assert.deepEqual(result.issues[0], {
    id: 'title',
    title: 'title',
    finding: 'title failed',
    status: 'failed',
    severity: 'high',
    stage: 'content',
    stageLabel: '内容理解',
    affectedPages: ['https://example.com/'],
    applicablePages: 2,
    coverage: 0.75,
    affectsHomepage: true,
    deduction: 22.5,
    value: 'failed',
    category: 'technical',
    weight: 1,
    recommendation: '修复 title',
    count: 1,
    findings: [{
      url: 'https://example.com/',
      finding: 'title failed',
      value: 'failed'
    }]
  });
});

test('确定的上游阻断会封顶且不能被其他通过项抵消', () => {
  const blocker = {
    id: 'homepage-noindex',
    title: '首页禁止索引',
    finding: '首页明确设置 noindex',
    cap: 39
  };
  const result = calculateTechnicalHealth({
    instances: [
      instance('http-status', 'passed'),
      instance('indexability', 'passed'),
      instance('title', 'passed'),
      instance('viewport', 'passed')
    ],
    blockers: [blocker],
    rules: TEST_RULES,
    scoreConfig: TEST_SCORE_CONFIG
  });

  assert.equal(result.rawScore, 100);
  assert.equal(result.score, 39);
  assert.equal(result.status, 'blocked');
  assert.equal(result.scoreCap, 39);
  assert.deepEqual(result.blockers, [blocker]);
});

test('关键证据不完整时不生成伪精确技术健康分', () => {
  const result = calculateTechnicalHealth({
    instances: [instance('http-status', 'failed')],
    evidenceComplete: false,
    unknownReasons: ['无法确认首页是否可访问'],
    rules: TEST_RULES,
    scoreConfig: TEST_SCORE_CONFIG
  });

  assert.equal(result.score, null);
  assert.equal(result.rawScore, null);
  assert.equal(result.status, 'unknown');
  assert.equal(result.bottleneck, null);
  assert.equal(result.stages.every((stage) => stage.score === null), true);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].id, 'http-status');
  assert.equal(result.issues[0].deduction, null);
  assert.deepEqual(result.unknownReasons, ['无法确认首页是否可访问']);
});

test('存在计分失败项时整数分不能因四舍五入达到 100', () => {
  const instances = [];
  for (let index = 0; index < 1000; index += 1) {
    const page = {
      url: `https://example.com/page-${index}`,
      isHomepage: false
    };
    instances.push(
      instance('http-status', 'passed', page),
      instance('indexability', 'passed', page),
      instance('title', index === 0 ? 'failed' : 'passed', page),
      instance('viewport', 'passed', page)
    );
  }

  const result = calculateTechnicalHealth({
    instances,
    rules: TEST_RULES,
    scoreConfig: TEST_SCORE_CONFIG
  });

  assert.equal(result.rawScore, 99.97);
  assert.equal(result.score, 99);
});

test('修复失败项且其他事实不变时技术健康分不会下降', () => {
  const before = calculateTechnicalHealth({
    instances: [
      instance('http-status', 'failed'),
      instance('indexability', 'passed'),
      instance('title', 'failed'),
      instance('viewport', 'passed')
    ],
    rules: TEST_RULES,
    scoreConfig: TEST_SCORE_CONFIG
  });
  const after = calculateTechnicalHealth({
    instances: [
      instance('http-status', 'passed'),
      instance('indexability', 'passed'),
      instance('title', 'failed'),
      instance('viewport', 'passed')
    ],
    rules: TEST_RULES,
    scoreConfig: TEST_SCORE_CONFIG
  });

  assert.equal(after.score >= before.score, true);
  assert.equal(after.rawScore > before.rawScore, true);
});

test('扩大同一问题覆盖率且其他事实不变时技术健康分不会上升', () => {
  const pages = [
    { url: 'https://example.com/', isHomepage: true },
    { url: 'https://example.com/a', isHomepage: false }
  ];
  const scoreWithFailures = (failedUrls) => calculateTechnicalHealth({
    instances: pages.flatMap((page) => [
      instance('http-status', 'passed', page),
      instance('indexability', 'passed', page),
      instance('title', failedUrls.includes(page.url) ? 'failed' : 'passed', page),
      instance('viewport', 'passed', page)
    ]),
    rules: TEST_RULES,
    scoreConfig: TEST_SCORE_CONFIG
  });

  const narrow = scoreWithFailures(['https://example.com/a']);
  const widespread = scoreWithFailures(['https://example.com/', 'https://example.com/a']);

  assert.equal(widespread.score <= narrow.score, true);
  assert.equal(widespread.rawScore < narrow.rawScore, true);
});

test('同一规则和 URL 的重复实例不会重复计分或重复列入事实', () => {
  const duplicated = instance('title', 'failed');
  const result = calculateTechnicalHealth({
    instances: [
      instance('http-status', 'passed'),
      instance('indexability', 'passed'),
      duplicated,
      { ...duplicated, check: { ...duplicated.check } },
      instance('viewport', 'passed')
    ],
    rules: TEST_RULES,
    scoreConfig: TEST_SCORE_CONFIG
  });

  assert.equal(result.score, 70);
  assert.equal(result.issues[0].count, 1);
  assert.deepEqual(result.issues[0].affectedPages, ['https://example.com/']);
});

test('相同事实和评分版本会产生完全相同的评分结果', () => {
  const input = {
    instances: [
      instance('http-status', 'passed'),
      instance('indexability', 'passed'),
      instance('title', 'failed'),
      instance('viewport', 'passed')
    ],
    rules: TEST_RULES,
    scoreConfig: TEST_SCORE_CONFIG
  };

  assert.deepEqual(
    calculateTechnicalHealth(input),
    calculateTechnicalHealth(input)
  );
});

test('v4 配置以四阶段覆盖全部计分规则并排除信息性标签', () => {
  const config = validateSeoHealthScoreConfig(defaultSeoHealthScoreConfig, defaultSeoAuditRules);
  const assignedRuleIds = config.stages.flatMap((stage) => stage.ruleIds);
  const scoringRuleIds = Object.keys(defaultSeoAuditRules.checks)
    .filter((id) => !config.informationalRuleIds.includes(id));

  assert.equal(config.version, '2026-07-23-v4');
  assert.equal(config.stages.reduce((sum, stage) => sum + stage.budget, 0), 100);
  assert.equal(new Set(assignedRuleIds).size, assignedRuleIds.length);
  assert.deepEqual([...assignedRuleIds].sort(), [...scoringRuleIds].sort());
  assert.equal(
    config.stages.find((stage) => stage.ruleIds.includes('sitemap')).key,
    'access'
  );
  assert.deepEqual(config.informationalRuleIds, ['search-verification']);
});

test('v4 配置会拒绝不可维护的阻断阈值与重复爬虫 key', () => {
  assert.throws(
    () => validateSeoHealthScoreConfig({
      ...defaultSeoHealthScoreConfig,
      blockerPolicy: {
        ...defaultSeoHealthScoreConfig.blockerPolicy,
        widespreadCoverage: 1.2
      }
    }, defaultSeoAuditRules),
    /widespreadCoverage/
  );
  assert.throws(
    () => validateSeoHealthScoreConfig({
      ...defaultSeoHealthScoreConfig,
      blockerPolicy: {
        ...defaultSeoHealthScoreConfig.blockerPolicy,
        traditionalSearchCrawlerKeys: ['googlebot', 'googlebot']
      }
    }, defaultSeoAuditRules),
    /traditionalSearchCrawlerKeys/
  );
});

test('问题优先级先列阻断，再按严重级别排列', () => {
  const result = calculateTechnicalHealth({
    instances: [
      instance('http-status', 'failed'),
      instance('indexability', 'passed'),
      instance('title', 'failed'),
      instance('viewport', 'passed')
    ],
    blockers: [{
      id: 'homepage-unavailable',
      title: '首页无法访问',
      finding: '首页返回 HTTP 503',
      cap: 20,
      affectedPages: ['https://example.com/'],
      coverage: 1
    }],
    rules: TEST_RULES,
    scoreConfig: TEST_SCORE_CONFIG
  });

  assert.deepEqual(
    result.priorities.map(({ id }) => id),
    ['homepage-unavailable', 'http-status', 'title']
  );
  assert.equal(result.priorities[0].kind, 'blocker');
  assert.equal(result.priorities[1].stage, 'access');
  assert.equal(result.priorities[2].stage, 'content');
});

test('按严重级别优先于实际扣分排列', () => {
  const rules = {
    checks: {
      'high-risk': { severity: 'high', weight: 1 },
      'medium-risk': { severity: 'medium', weight: 4 }
    }
  };
  const scoreConfig = {
    version: 'test-v4-severity-order',
    homepageWeight: 3,
    informationalRuleIds: [],
    siteScopedRuleIds: [],
    stages: [{
      key: 'content',
      label: '内容理解',
      budget: 100,
      ruleIds: ['high-risk', 'medium-risk']
    }]
  };
  const failedInstance = (id) => ({
    url: 'https://example.com/',
    isHomepage: true,
    check: {
      id,
      title: id,
      finding: `${id} failed`,
      status: 'failed',
      severity: rules.checks[id].severity,
      weight: rules.checks[id].weight,
      value: 'failed',
      category: 'technical',
      recommendation: `修复 ${id}`
    }
  });

  const result = calculateTechnicalHealth({
    instances: [
      failedInstance('high-risk'),
      failedInstance('medium-risk')
    ],
    rules,
    scoreConfig
  });

  const deductionById = new Map(result.issues.map((issue) => [issue.id, issue.deduction]));
  assert.equal(deductionById.get('high-risk') < deductionById.get('medium-risk'), true);
  assert.deepEqual(
    result.priorities.map(({ id }) => id),
    ['high-risk', 'medium-risk']
  );
});

test('首页明确 noindex 会形成可解释的索引阻断', () => {
  const blockers = detectTechnicalHealthBlockers({
    pages: [
      {
        url: 'https://example.com/',
        isHomepage: true,
        statusCode: 200,
        indexable: false,
        contentCharacters: 1000
      },
      {
        url: 'https://example.com/product',
        isHomepage: false,
        statusCode: 200,
        indexable: true,
        contentCharacters: 1000
      }
    ],
    crawlerAccess: { crawlers: [] },
    scoreConfig: defaultSeoHealthScoreConfig
  });

  assert.deepEqual(blockers, [{
    id: 'homepage-noindex',
    title: '首页禁止索引',
    finding: '首页明确设置 noindex',
    cap: 39,
    affectedPages: ['https://example.com/'],
    coverage: 0.75
  }]);
});

test('首页确认返回不可用状态会形成访问阻断', () => {
  const blockers = detectTechnicalHealthBlockers({
    pages: [{
      url: 'https://example.com/',
      isHomepage: true,
      statusCode: 503,
      indexable: true,
      contentCharacters: 0
    }],
    crawlerAccess: { crawlers: [] },
    scoreConfig: defaultSeoHealthScoreConfig
  });

  assert.equal(blockers[0].id, 'homepage-unavailable');
  assert.equal(blockers[0].cap, 20);
  assert.equal(blockers[0].coverage, 1);
});

test('首页状态无法确认时保持未知证据，不伪判为已确认的访问阻断', () => {
  const blockers = detectTechnicalHealthBlockers({
    pages: [{
      url: 'https://example.com/',
      isHomepage: true,
      statusCode: 0,
      indexable: null,
      contentCharacters: null
    }],
    crawlerAccess: { crawlers: [] },
    scoreConfig: defaultSeoHealthScoreConfig
  });

  assert.deepEqual(blockers, []);
});

test('明确 noindex 的加权覆盖率达到一半时形成大范围索引阻断', () => {
  const pages = [{
    url: 'https://example.com/',
    isHomepage: true,
    statusCode: 200,
    indexable: true,
    contentCharacters: 1000
  }];
  for (let index = 0; index < 4; index += 1) {
    pages.push({
      url: `https://example.com/page-${index}`,
      isHomepage: false,
      statusCode: 200,
      indexable: false,
      contentCharacters: 1000
    });
  }

  const blockers = detectTechnicalHealthBlockers({
    pages,
    crawlerAccess: { crawlers: [] },
    scoreConfig: defaultSeoHealthScoreConfig
  });

  assert.equal(blockers[0].id, 'widespread-noindex');
  assert.equal(blockers[0].cap, 39);
  assert.equal(blockers[0].coverage, 0.5714);
  assert.equal(blockers[0].affectedPages.length, 4);
});

test('robots 明确阻止全部主要传统搜索爬虫时形成访问阻断', () => {
  const blockers = detectTechnicalHealthBlockers({
    pages: [{
      url: 'https://example.com/',
      isHomepage: true,
      statusCode: 200,
      indexable: true,
      contentCharacters: 1000
    }],
    crawlerAccess: {
      crawlers: [
        { key: 'googlebot', status: 'blocked' },
        { key: 'bingbot', status: 'blocked' },
        { key: 'baiduspider', status: 'blocked' },
        { key: 'oai-searchbot', status: 'allowed' }
      ]
    },
    scoreConfig: defaultSeoHealthScoreConfig
  });

  assert.equal(blockers[0].id, 'all-traditional-search-crawlers-blocked');
  assert.equal(blockers[0].cap, 20);
});

test('无有效正文的加权覆盖率达到一半时形成内容阻断', () => {
  const pages = [{
    url: 'https://example.com/',
    isHomepage: true,
    statusCode: 200,
    indexable: true,
    contentCharacters: 1000
  }];
  for (let index = 0; index < 4; index += 1) {
    pages.push({
      url: `https://example.com/empty-${index}`,
      isHomepage: false,
      statusCode: 200,
      indexable: true,
      contentCharacters: 0
    });
  }

  const blockers = detectTechnicalHealthBlockers({
    pages,
    crawlerAccess: { crawlers: [] },
    scoreConfig: defaultSeoHealthScoreConfig
  });

  assert.equal(blockers[0].id, 'widespread-empty-content');
  assert.equal(blockers[0].cap, 59);
  assert.equal(blockers[0].coverage, 0.5714);
});

test('大范围阻断覆盖率只以可判断页面为分母，不被抓取失败页面稀释', () => {
  const pages = [{
    url: 'https://example.com/',
    isHomepage: true,
    statusCode: 200,
    indexable: true,
    contentCharacters: 1000
  }];
  for (let index = 0; index < 4; index += 1) {
    pages.push({
      url: `https://example.com/noindex-${index}`,
      isHomepage: false,
      statusCode: 200,
      indexable: false,
      contentCharacters: 0
    });
  }
  for (let index = 0; index < 10; index += 1) {
    pages.push({
      url: `https://example.com/unknown-${index}`,
      isHomepage: false,
      statusCode: 0,
      indexable: null,
      contentCharacters: null
    });
  }

  const blockers = detectTechnicalHealthBlockers({
    pages,
    crawlerAccess: { crawlers: [] },
    scoreConfig: defaultSeoHealthScoreConfig
  });

  assert.equal(blockers.find((blocker) => blocker.id === 'widespread-noindex').coverage, 0.5714);
  assert.equal(blockers.find((blocker) => blocker.id === 'widespread-empty-content').coverage, 0.5714);
});
