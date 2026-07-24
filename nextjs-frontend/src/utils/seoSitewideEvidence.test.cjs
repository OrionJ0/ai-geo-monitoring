const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCheckEvidence } = require('./seoSitewideEvidence.cjs');

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
