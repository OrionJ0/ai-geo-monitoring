/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCheckEvidence,
  buildNavigationSummary,
  normalizeSitewideCheckForDisplay,
  safeReportUrl,
} = require('./seoSitewideEvidence.cjs');

test('explains every navigation control and distinguishes occurrence pages from unknown targets', () => {
  const details = Array.from({ length: 6 }, (_, index) => ({
    type: 'non-semantic-navigation-control',
    tag: index % 2 ? 'span' : 'div',
    text: `导航 ${index + 1}`,
    reason: 'clickable_non_link',
    sourcePageCount: 125,
    sourcePages: [`https://example.com/page-${index}`]
  }));

  const evidence = buildCheckEvidence({
    id: 'navigation-crawlability',
    details
  });

  assert.equal(evidence.length, 6);
  assert.equal(evidence[0].title, '导航 1');
  assert.equal(
    evidence[0].explanation,
    '使用 <div> 处理点击，但没有 <a href>；目标地址无法从 HTML 读取'
  );
  assert.equal(evidence[0].occurrenceCount, 125);
  assert.deepEqual(evidence[0].occurrencePages, ['https://example.com/page-0']);
});

test('导航问题摘要只展示少量名称并合并重复出现范围', () => {
  const details = [
    ...Array.from({ length: 8 }, (_, index) => ({
      type: 'non-semantic-navigation-control',
      tag: index % 2 ? 'span' : 'div',
      text: `导航 ${index + 1}`,
      reason: 'clickable_non_link',
      sourcePageCount: 64,
      sourcePages: [`https://example.com/page-${index}`]
    })),
    {
      triggerText: '产品中心',
      page: 'https://example.com/',
      links: [{ url: 'https://example.com/products/a', text: '产品 A' }]
    }
  ];

  assert.deepEqual(buildNavigationSummary({ details }), {
    labels: ['导航 1', '导航 2', '导航 3', '导航 4', '导航 5', '导航 6'],
    hiddenCount: 2,
    occurrenceCount: 64,
    interactionCount: 1
  });
});

test('旧报告的导航术语会转换成直接说明 HTML 跳转地址不可读', () => {
  const check = normalizeSitewideCheckForDisplay({
    id: 'navigation-crawlability',
    status: 'failed',
    finding: '6 类无效或非语义化导航，1 组链接依赖用户交互',
    value: '6 个导航问题',
    details: [
      {
        type: 'non-semantic-navigation-control',
        tag: 'span',
        text: '产品中心',
        sourcePageCount: 64,
      },
      {
        type: 'invalid-anchor',
        tag: 'a',
        text: '新闻中心',
        reason: 'empty_href',
        sourcePageCount: 3,
      },
      {
        type: 'interaction-dependent-links',
        triggerText: '解决方案',
        links: ['https://example.com/solution'],
      },
      {
        tag: 'div',
        text: '服务与支持',
        page: 'https://example.com/',
      },
    ],
  });

  assert.equal(
    check.finding,
    '3 个导航项无法直接读取地址；另有 1 组链接仅在交互后出现'
  );
  assert.equal(check.value, '2 类 div/span 跳转 · 1 类 a 缺少有效 href');
});

test('非失败状态或没有明细的导航检查保留原始结论', () => {
  const passedCheck = {
    id: 'navigation-crawlability',
    status: 'passed',
    finding: '导航目标均可从带 href 的 a 标签直接读取',
    value: '未发现问题',
    details: [],
  };
  const legacyCheckWithoutDetails = {
    id: 'navigation-crawlability',
    status: 'failed',
    finding: '2 个导航问题',
    value: '旧报告未保存明细',
  };

  assert.deepEqual(normalizeSitewideCheckForDisplay(passedCheck), passedCheck);
  assert.deepEqual(
    normalizeSitewideCheckForDisplay(legacyCheckWithoutDetails),
    legacyCheckWithoutDetails
  );
});

test('仅有交互后链接时不显示空值或零值分类', () => {
  const check = normalizeSitewideCheckForDisplay({
    id: 'navigation-crawlability',
    status: 'failed',
    finding: '旧文案',
    value: '旧值',
    details: [{
      triggerText: '产品中心',
      links: [{ url: 'https://example.com/products', text: '全部产品' }],
    }],
  });

  assert.equal(check.finding, '1 组链接仅在交互后出现');
  assert.equal(check.value, '1 组交互后链接');
  assert.doesNotMatch(`${check.finding}${check.value}`, /\b0\b/);
});

test('报告中的外部链接只允许 HTTP 和 HTTPS 协议', () => {
  assert.equal(safeReportUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(safeReportUrl('javascript:alert(1)'), '');
  assert.equal(safeReportUrl('not-a-url'), '');
});
