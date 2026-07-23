const test = require('node:test');
const assert = require('node:assert/strict');

const VisibilityAnalysisService = require('../services/VisibilityAnalysisService');

test('builds brand terms from names, aliases, branded products, and model-like products', () => {
  const terms = VisibilityAnalysisService.buildBrandVisibilityTerms({
    name: '米其林',
    aliases: ['Michelin', 'michelin'],
    primary_keywords: ['静音轮胎', '米其林浩悦', 'Pilot Sport 5']
  });

  assert.deepEqual(terms, ['米其林', 'Michelin', '米其林浩悦', 'Pilot Sport 5']);
});

test('matches compact spellings and common model suffixes without assigning recommendation or rank', () => {
  assert.equal(VisibilityAnalysisService.termMatches('GoodieAI 适合监测品牌。', 'Goodie AI').length, 0);
  assert.equal(VisibilityAnalysisService.termRanges('GoodieAI 与 DeepSeekR1。', ['Goodie AI']).length, 1);
  assert.equal(VisibilityAnalysisService.termMatches('DeepSeekR1 适合代码推理。', 'DeepSeek').length, 1);
  assert.equal(typeof VisibilityAnalysisService.analyzeResponse, 'undefined');
  assert.equal(typeof VisibilityAnalysisService.isRecommended, 'undefined');
  assert.equal(typeof VisibilityAnalysisService.listItemPosition, 'undefined');
});

test('skips known generic Chinese word contexts but keeps actual brand references', () => {
  assert.equal(VisibilityAnalysisService.termMatches('这是一个比较理想的方案。', '理想').length, 0);
  assert.equal(VisibilityAnalysisService.termMatches('理想汽车发布了新车型。', '理想').length, 1);
  assert.equal(VisibilityAnalysisService.termMatches('小米粥适合早餐。', '小米').length, 0);
  assert.equal(VisibilityAnalysisService.termMatches('小米发布了新手机。', '小米').length, 1);
});

test('deduplicates overlapping variants when locating deterministic term ranges', () => {
  const ranges = VisibilityAnalysisService.termRanges('GoodieAI 提供 GEO 服务。', ['Goodie AI', 'GoodieAI']);

  assert.deepEqual(ranges, [{ start: 0, end: 8 }]);
});
