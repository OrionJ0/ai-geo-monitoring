const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixtureDirectory = path.resolve(
  __dirname,
  '../../../tests/fixtures/marketing-production-correctness'
);
const openApi = require(
  '../../modules/marketing/contracts/goodieai-marketing-ad-read.openapi.json'
);

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDirectory, name), 'utf8'));
}

function exactUnsigned(value) {
  return typeof value === 'string' && /^\d+$/u.test(value);
}

function exactSummary(value) {
  assert.deepEqual(Object.keys(value).sort(), [
    'clicks',
    'costAmountScaled',
    'impressions'
  ]);
  assert.ok(Object.values(value).every(exactUnsigned));
}

function days(from, to) {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`))
    / 86_400_000
  ) + 1;
}

test('脱敏双周期基线冻结 006 summary、revision 与等长相邻范围', () => {
  const ready = fixture('ad-periods-ready.json');
  const unavailable = fixture('ad-previous-unavailable.json');
  const requiredHierarchy = openApi.components.schemas.MarketingAdHierarchyResponse.required;
  const requiredKeywords = openApi.components.schemas.MarketingKeywordResponse.required;

  assert.equal(ready.dashboard.schemaVersion, 'marketing_dashboard_v2');
  assert.equal(ready.current.adHierarchy.schemaVersion, 'marketing_ad_hierarchy_v1');
  assert.equal(ready.current.keywords.schemaVersion, 'marketing_keywords_v1');
  assert.equal(ready.previous.adHierarchy.schemaVersion, 'marketing_ad_hierarchy_v1');
  assert.equal(ready.previous.keywords.schemaVersion, 'marketing_keywords_v1');
  for (const response of [ready.current.adHierarchy, ready.previous.adHierarchy]) {
    assert.ok(requiredHierarchy.every((field) => Object.hasOwn(response, field)));
    exactSummary(response.summary);
  }
  for (const response of [ready.current.keywords, ready.previous.keywords]) {
    assert.ok(requiredKeywords.every((field) => Object.hasOwn(response, field)));
    exactSummary(response.summary);
  }
  const responses = [
    ready.current.adHierarchy,
    ready.previous.adHierarchy,
    ready.current.keywords,
    ready.previous.keywords
  ];
  assert.ok(responses.every((response) => response.revision === ready.dashboard.revision));
  assert.ok(responses.every((response) => (
    response.coverage.currency === ready.dashboard.coverage.currency
    && response.coverage.costScale === ready.dashboard.coverage.costScale
  )));
  assert.equal(
    days(ready.current.range.from, ready.current.range.to),
    days(ready.previous.range.from, ready.previous.range.to)
  );
  assert.equal(
    Date.parse(`${ready.previous.range.to}T00:00:00.000Z`) + 86_400_000,
    Date.parse(`${ready.current.range.from}T00:00:00.000Z`)
  );
  assert.equal(unavailable.error.status, 422);
  assert.equal(unavailable.error.body.error.code, 'DASHBOARD_DATE_OUT_OF_RANGE');
  assert.equal(unavailable.current.revision, unavailable.dashboard.revision);
});

test('来源 83/82 基线冻结 additive partition 位置且不创造差额来源', () => {
  const value = fixture('tongji-source-partial-83-82.json');
  const classified = value.response.sourceComparison.rows.reduce(
    (sum, row) => sum + BigInt(row.summary.current || '0'),
    0n
  );
  assert.equal(value.response.summary.visits.current, '83');
  assert.equal(classified.toString(), '82');
  assert.equal(value.expectedPartition.state, 'PARTIAL');
  assert.equal(value.expectedPartition.unclassifiedVisits, '1');
  assert.equal(value.expectedPartition.reasonCode, 'SOURCE_COVERAGE_INCOMPLETE');
  assert.equal(value.additiveFieldPath, 'sourceComparison.partition');
  assert.deepEqual(
    value.response.sourceComparison.partition,
    value.expectedPartition
  );
  assert.equal(
    value.response.sourceComparison.rows.some((row) => (
      ['UNCLASSIFIED', 'OTHER'].includes(row.sourceKey)
    )),
    false
  );
});

test('页面基线保留稳定 page identity 并重现分页前同路径碰撞', () => {
  const value = fixture('tongji-page-path-collision.json');
  assert.deepEqual(value.response.rows.map((row) => row.pageId), ['1001', '1002']);
  assert.equal(new Set(value.response.rows.map((row) => row.key)).size, 2);
  assert.deepEqual(value.response.rows.map((row) => row.path), ['/', '/']);
  assert.ok(value.response.rows.every((row) => !Object.hasOwn(row, 'pathCollision')));
  assert.deepEqual(value.expectedOrder, ['1001', '1002']);
  assert.equal(value.identityRule.numeric, 'BigInt ascending');
  assert.equal(value.identityRule.opaque, 'Unicode code-point ascending');
});

test('null、零与超安全整数形状保持可区分', () => {
  const value = fixture('marketing-null-zero-decimal-shapes.json');
  assert.equal(value.exact.zero, '0');
  assert.equal(value.exact.beyondSafeInteger, '900719925474099312345');
  assert.equal(value.exact.missing, null);
  assert.ok(exactUnsigned(value.exact.zero));
  assert.ok(exactUnsigned(value.exact.beyondSafeInteger));
  assert.equal(value.trend.some((row) => row.visits === null), true);
  assert.equal(value.trend.some((row) => row.visits === '0'), true);
});

test('正确性 fixture 只含规范化虚构形状且没有秘密、个人信息或原始响应', () => {
  const names = fs.readdirSync(fixtureDirectory).filter((name) => name.endsWith('.json'));
  assert.deepEqual(names.sort(), [
    'ad-periods-ready.json',
    'ad-previous-unavailable.json',
    'marketing-null-zero-decimal-shapes.json',
    'tongji-page-path-collision.json',
    'tongji-source-partial-83-82.json'
  ]);
  const combined = names.map((name) => fs.readFileSync(
    path.join(fixtureDirectory, name),
    'utf8'
  )).join('\n');
  for (const forbidden of [
    /bearer\s+[a-z0-9._-]+/iu,
    /"(?:access|refresh)?token"\s*:/iu,
    /"(?:secret|authorization|cookie)"\s*:/iu,
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu,
    /(?:^|\D)1[3-9]\d{9}(?:\D|$)/u,
    /\b(?:\d{1,3}\.){3}\d{1,3}\b/u
  ]) assert.doesNotMatch(combined, forbidden);
  assert.doesNotMatch(combined, /rawResponse|tongjiUserName|sessionId/iu);
  assert.match(combined, /synthetic-/u);
});
