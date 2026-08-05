const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const hookPath = path.resolve(
  __dirname,
  '../../src/lib/websiteData/useWebsiteFormConsultations.ts'
);
const dailyHookPath = path.resolve(
  __dirname,
  '../../src/lib/websiteData/useWebsiteFormConsultationDays.ts'
);
const sourceCatalogPath = path.resolve(
  __dirname,
  '../../src/lib/marketing/sourceCatalog.ts'
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
  assert.match(source, /ALL_FORM_RECORDS/u);
  assert.match(source, /formConsultationRecords/u);
  assert.doesNotMatch(source, /attributedFormSubmissionSessions/u);
  assert.match(source, /sourceBreakdown/u);
  assert.match(source, /10 \* 60 \* 1000/u);
});

test('website form contracts share the exact nine-key source catalog', () => {
  const source = fs.readFileSync(sourceCatalogPath, 'utf8');
  const aggregateHook = fs.readFileSync(hookPath, 'utf8');
  const dailyHook = fs.readFileSync(dailyHookPath, 'utf8');
  const expectedKeys = [
    'BAIDU_PAID', 'DIRECT', 'BAIDU_SEARCH', 'BING_SEARCH', 'GOOGLE_SEARCH',
    'OTHER_SEARCH', 'EXTERNAL_REFERRAL', 'UTM_CAMPAIGN', 'UNKNOWN'
  ];

  expectedKeys.forEach((key) => assert.match(source, new RegExp(`${key}:`)));
  ['ORGANIC_SEARCH', 'REFERRAL', 'CAMPAIGN', 'SOCIAL', 'UNATTRIBUTED']
    .forEach((key) => assert.doesNotMatch(
      source,
      new RegExp(`^\\s{2}${key}:`, 'mu')
    ));
  assert.match(aggregateHook, /MARKETING_SOURCE_KEYS/u);
  assert.match(dailyHook, /MARKETING_SOURCE_KEYS/u);
});

test('market overview labels website forms clearly and only merges exact source keys', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /useWebsiteFormConsultations/u);
  assert.match(source, /官网咨询/u);
  assert.match(source, /BAIDU_PAID/u);
  assert.match(source, /DIRECT/u);
  assert.match(source, /MARKETING_SOURCE_LABELS\.UNKNOWN/u);
  assert.match(source, /不包含 53KF 在线客服咨询/u);
  assert.doesNotMatch(source, />客服咨询<\/th>/u);
  assert.match(source, /websiteFormBySource\.get\(source\.sourceKey\)/u);
  assert.match(source, /官网成功表单记录/u);
});

test('website form hooks remember module DISABLED once per session and short-circuit reads', () => {
  const moduleStatePath = path.resolve(
    __dirname,
    '../../src/lib/websiteData/moduleState.ts'
  );
  const moduleState = fs.readFileSync(moduleStatePath, 'utf8');
  const aggregateHook = fs.readFileSync(hookPath, 'utf8');
  const dailyHook = fs.readFileSync(dailyHookPath, 'utf8');

  assert.match(moduleState, /rememberWebsiteFormDisabled/u);
  assert.match(moduleState, /readWebsiteFormDisabledMessage/u);
  [aggregateHook, dailyHook].forEach((source) => {
    assert.match(source, /readWebsiteFormDisabledMessage\(\)/u);
    assert.match(source, /rememberWebsiteFormDisabled\(/u);
    assert.match(source, /WEBSITE_FORM_MODULE_DISABLED/u);
    // 仍保持独立客户端的边界，不引入营销模块引用
    assert.doesNotMatch(source, /\/api\/marketing/u);
  });
  // 聚合 hook 的 10 分钟 interval 结构保留，仅在 DISABLED 时短路 read 体
  assert.match(aggregateHook, /10 \* 60 \* 1000/u);
});
