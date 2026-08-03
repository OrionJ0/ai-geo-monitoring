const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const hookPath = path.resolve(
  __dirname,
  '../../src/lib/websiteData/useWebsiteFormConsultations.ts'
);
const pagePath = path.resolve(
  __dirname,
  '../../src/app/geo/market-overview/page.tsx'
);

test('website form consultations use an independent client and strict contract', () => {
  const source = fs.readFileSync(hookPath, 'utf8');

  assert.match(source, /\/api\/website-data\/projects\//u);
  assert.match(source, /\/form-consultations/u);
  assert.doesNotMatch(source, /\/api\/marketing/u);
  assert.match(source, /sourceSystem !== 'GATO_WEBSITE'/u);
  assert.match(source, /consultationType !== 'WEBSITE_FORM'/u);
  assert.match(source, /ATTRIBUTED_SESSION_SUBMISSIONS_ONLY/u);
  assert.match(source, /formRecordTotalAvailable !== false/u);
  assert.match(source, /sourceBreakdown/u);
  assert.match(source, /10 \* 60 \* 1000/u);
});

test('market overview labels website forms clearly and only merges exact source keys', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /useWebsiteFormConsultations/u);
  assert.match(source, />官网表单咨询</u);
  assert.match(source, /BAIDU_PAID/u);
  assert.match(source, /DIRECT/u);
  assert.match(source, /搜索引擎（官网表单来源未细分）/u);
  assert.match(source, /不包含 53KF 客服咨询/u);
  assert.doesNotMatch(source, />客服咨询<\/th>/u);
  assert.doesNotMatch(source, /ORGANIC_SEARCH[^\n]*(?:BAIDU_SEARCH|BING_SEARCH)/u);
});
