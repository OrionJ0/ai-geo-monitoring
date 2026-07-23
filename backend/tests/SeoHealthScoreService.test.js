const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateTechnicalHealth } = require('../services/SeoHealthScoreService');
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
      value: status
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
    severity: 'high',
    stage: 'content',
    stageLabel: '内容理解',
    affectedPages: ['https://example.com/'],
    applicablePages: 2,
    coverage: 0.75,
    affectsHomepage: true,
    deduction: 22.5,
    value: 'failed'
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
