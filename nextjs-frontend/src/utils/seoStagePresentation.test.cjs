/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPriorityContent,
  buildStageGroups,
  sortPriorities,
} = require('./seoStagePresentation.cjs');

test('单页检测项只按四阶段归属展示', () => {
  const report = {
    scoreModel: 'technical-health-v4',
    health: {
      stages: [
        { key: 'access', label: '访问与发现', budget: 30, score: 26, ruleIds: ['http-status'] },
        { key: 'index', label: '索引资格', budget: 25, score: 20, ruleIds: ['canonical'] },
        { key: 'content', label: '内容理解', budget: 30, score: 22, ruleIds: ['title'] },
        { key: 'enhancement', label: '展示与增强', budget: 15, score: 12, ruleIds: ['viewport'] },
      ],
    },
    categories: [{
      key: 'metadata',
      label: '页面信息',
      checks: [
        {
          id: 'canonical',
          title: 'Canonical 链接',
          status: 'failed',
          severity: 'medium',
          finding: 'Canonical 链接缺失',
          value: '未检测到有效 URL',
        },
        {
          id: 'title',
          title: '页面标题',
          status: 'passed',
          severity: 'high',
          finding: '页面标题长度合理',
          value: '标题长度：20 字符',
        },
      ],
    }, {
      key: 'crawlability',
      label: '收录与抓取',
      checks: [{
        id: 'http-status',
        title: '页面访问状态',
        status: 'passed',
        severity: 'critical',
        finding: '页面返回成功状态',
        value: 'HTTP 200',
      }],
    }, {
      key: 'experience',
      label: '移动与可访问性',
      checks: [{
        id: 'viewport',
        title: '移动端 Viewport',
        status: 'passed',
        severity: 'high',
        finding: 'Viewport 配置有效',
        value: 'width=device-width',
      }],
    }],
  };

  const groups = buildStageGroups(report);

  assert.deepEqual(groups.map((stage) => stage.label), [
    '访问与发现',
    '索引资格',
    '内容理解',
    '展示与增强',
  ]);
  assert.deepEqual(groups.map((stage) => stage.checks.map((check) => check.id)), [
    ['http-status'],
    ['canonical'],
    ['title'],
    ['viewport'],
  ]);
  assert.equal(groups[1].checks[0].finding, 'Canonical 链接缺失');
  assert.equal(groups[1].checks[0].description, '检查页面是否声明有效的规范 URL。');
  assert.equal(groups[2].checks[0].finding, '页面标题长度合理');
});

test('全站报告根据阶段规则列出通过项和聚合问题', () => {
  const report = {
    mode: 'site',
    scoreModel: 'technical-health-v4',
    health: {
      stages: [{
        key: 'index',
        label: '索引资格',
        budget: 25,
        score: 19.4,
        ruleIds: ['indexability', 'canonical'],
      }],
      issues: [{
        id: 'canonical',
        title: 'Canonical 链接',
        status: 'failed',
        severity: 'medium',
        finding: 'Canonical 链接缺失',
        coverage: 1,
        affectedPages: ['https://example.com/'],
        applicablePages: 64,
        deduction: 5.5556,
      }],
    },
  };

  const [indexStage] = buildStageGroups(report);

  assert.deepEqual(indexStage.checks.map(({ id, title, status }) => ({ id, title, status })), [
    { id: 'indexability', title: '索引指令', status: 'passed' },
    { id: 'canonical', title: 'Canonical 链接', status: 'failed' },
  ]);
  assert.equal(indexStage.checks[1].coverage, 1);
  assert.equal(indexStage.checks[1].deduction, 5.5556);
});

test('阶段问题会兼容读取 priorities 且不被空 health.issues 覆盖', () => {
  const report = {
    health: {
      stages: [{
        key: 'access',
        label: '访问与发现',
        ruleIds: ['sitemap'],
      }],
      issues: [],
    },
    priorities: [{
      id: 'sitemap',
      severity: 'high',
      finding: 'Sitemap 没有有效 URL',
      coverage: 1,
    }],
  };

  const [stage] = buildStageGroups(report);

  assert.equal(stage.checks[0].status, 'failed');
  assert.equal(stage.checks[0].finding, 'Sitemap 没有有效 URL');
});

test('全站四阶段可以解释全部 22 个计分检测项', () => {
  const report = {
    mode: 'site',
    scoreModel: 'technical-health-v4',
    health: {
      stages: [
        {
          key: 'access',
          label: '访问与发现',
          ruleIds: [
            'http-status', 'https', 'robots-txt', 'crawler-access',
            'sitemap', 'crawlable-links', 'response-time', 'html-size',
          ],
        },
        {
          key: 'index',
          label: '索引资格',
          ruleIds: ['indexability', 'canonical'],
        },
        {
          key: 'content',
          label: '内容理解',
          ruleIds: [
            'title', 'meta-description', 'meta-keywords', 'h1',
            'heading-order', 'content-depth', 'language',
          ],
        },
        {
          key: 'enhancement',
          label: '展示与增强',
          ruleIds: [
            'viewport', 'image-alt', 'structured-data', 'open-graph', 'twitter-card',
          ],
        },
      ],
      issues: [],
    },
  };

  const groups = buildStageGroups(report);

  assert.deepEqual(groups.map((stage) => stage.checks.length), [8, 2, 7, 5]);
  assert.deepEqual(
    groups.flatMap((stage) => stage.checks.map((check) => check.title)),
    [
      '页面访问状态', 'HTTPS', 'robots.txt', '搜索与 AI 爬虫权限',
      'Sitemap.xml', '页面链接', '服务器响应时间', 'HTML 体积',
      '索引指令', 'Canonical 链接',
      '页面标题', 'Meta 描述', 'Keywords 标签', '标题结构',
      '标题层级', '正文信息量', '页面语言',
      '移动端 Viewport', '图片 Alt', 'JSON-LD 结构化数据', 'Open Graph', 'Twitter Card',
    ]
  );
});

test('四阶段检测账本可以按处理级别和通过状态筛选', () => {
  const report = {
    health: {
      stages: [{
        key: 'content',
        label: '内容理解',
        ruleIds: ['title', 'h1', 'meta-keywords'],
      }],
    },
    categories: [{
      checks: [
        { id: 'title', status: 'failed', severity: 'high' },
        { id: 'h1', status: 'passed', severity: 'high' },
        { id: 'meta-keywords', status: 'failed', severity: 'low' },
      ],
    }],
  };

  assert.deepEqual(
    buildStageGroups(report, 'urgent')[0].checks.map((check) => check.id),
    ['title']
  );
  assert.deepEqual(
    buildStageGroups(report, 'normal')[0].checks.map((check) => check.id),
    ['meta-keywords']
  );
  assert.deepEqual(
    buildStageGroups(report, 'passed')[0].checks.map((check) => check.id),
    ['h1']
  );
});

test('报告视图按阻断、阶段、严重级别和扣分稳定重排问题', () => {
  const priorities = [
    { id: 'heading-order', kind: 'issue', stage: 'content', severity: 'medium', deduction: 6 },
    { id: 'title', kind: 'issue', stage: 'content', severity: 'high', deduction: 1 },
    { id: 'canonical', kind: 'issue', stage: 'index', severity: 'medium', deduction: 5 },
    { id: 'sitemap', kind: 'issue', stage: 'access', severity: 'high', deduction: 3 },
    { id: 'homepage-noindex', kind: 'blocker', stage: 'blocker', severity: 'critical', cap: 39 },
  ];

  assert.deepEqual(sortPriorities(priorities).map((item) => item.id), [
    'homepage-noindex',
    'sitemap',
    'canonical',
    'title',
    'heading-order',
  ]);
  assert.deepEqual(priorities.map((item) => item.id), [
    'heading-order',
    'title',
    'canonical',
    'sitemap',
    'homepage-noindex',
  ]);
});

test('全站优先修复内容合并技术问题、跨页问题和缺失的平台标签', () => {
  const report = {
    priorities: [{
      id: 'title',
      title: '页面标题',
      kind: 'issue',
      stage: 'content',
      stageLabel: '内容理解',
      severity: 'high',
      finding: '3 个页面标题过短',
    }],
    sitewide: {
      checks: [{
        id: 'navigation-crawlability',
        title: '导航链接可抓取性',
        status: 'failed',
        severity: 'medium',
        finding: '6 类导航入口无法读取跳转地址',
        value: 'div/span 等点击跳转 6 类',
        affectedPages: ['https://example.com/'],
        recommendation: '使用带 href 的 a。',
      }],
    },
    platforms: [
      {
        key: 'google',
        label: 'Google',
        tag: 'google-site-verification',
        status: 'missing',
        sourceUrl: 'https://example.com/',
      },
      {
        key: 'bing',
        label: 'Bing',
        tag: 'msvalidate.01',
        status: 'detected',
        sourceUrl: 'https://example.com/',
      },
      {
        key: 'baidu',
        label: '百度',
        tag: 'baidu-site-verification',
        status: 'empty',
        sourceUrl: 'https://example.com/',
      },
    ],
  };

  const priorities = buildPriorityContent(report);

  assert.deepEqual(
    new Set(priorities.map((item) => item.id)),
    new Set(['title', 'navigation-crawlability', 'search-verification'])
  );
  assert.equal(
    priorities.find((item) => item.id === 'navigation-crawlability').sourceLabel,
    '跨页专项'
  );
  assert.equal(
    priorities.find((item) => item.id === 'search-verification').finding,
    'Google、百度的首页验证标签缺失或为空'
  );
  assert.deepEqual(
    priorities.find((item) => item.id === 'search-verification').platforms
      .map((platform) => platform.label),
    ['Google', '百度']
  );
});
