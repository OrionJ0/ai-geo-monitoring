const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCheckEvidence,
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
    '3 类导航入口无法从 HTML 直接读取跳转地址；1 组链接只在交互后出现'
  );
  assert.equal(check.value, 'div/span 等点击跳转 2 类 · 无有效 href 的 a 1 类');
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

test('报告中的外部链接只允许 HTTP 和 HTTPS 协议', () => {
  assert.equal(safeReportUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(safeReportUrl('javascript:alert(1)'), '');
  assert.equal(safeReportUrl('not-a-url'), '');
});
