const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const contractDirectory = path.resolve(
  __dirname,
  '../../modules/marketing/contracts/baidu/baidu-marketing-pilot-2026-07-30'
);
const manifest = JSON.parse(fs.readFileSync(
  path.join(contractDirectory, 'manifest.json'),
  'utf8'
));

test('pilot contract records real response evidence without claiming production verification', () => {
  assert.equal(manifest.status, 'PILOT_VERIFIED');
  assert.equal(manifest.runtime.reportResponseParserImplemented, true);
  assert.equal(manifest.runtime.productionActivation, 'PILOT_DATA_ONLY');
  assert.deepEqual(manifest.productionAllowlist, []);
  assert.ok(manifest.blockers.length > 0);
  assert.deepEqual(
    manifest.oauth.authorization.approvedScopeValues,
    ['67,71,1004606,1002161']
  );
  assert.equal(manifest.searchPlanReport.response.pilotObservedRows, 777);
  assert.equal(manifest.searchPlanReport.response.pilotObservedPages, 4);
});

test('pilot fixtures preserve response shapes while using synthetic identities and values', () => {
  const report = JSON.parse(fs.readFileSync(
    path.join(
      contractDirectory,
      'fixtures/search-report.success.redacted.json'
    ),
    'utf8'
  ));
  const sites = JSON.parse(fs.readFileSync(
    path.join(
      contractDirectory,
      'fixtures/tongji-sites.success.redacted.json'
    ),
    'utf8'
  ));
  const trend = JSON.parse(fs.readFileSync(
    path.join(
      contractDirectory,
      'fixtures/tongji-trend.success.redacted.json'
    ),
    'utf8'
  ));

  assert.equal(report.header.status, 0);
  assert.equal(report.body.data[0].rows.length, 3);
  assert.equal(report.body.data[0].totalRowCount, 3);
  assert.ok(report.body.data[0].rows.every((row) => (
    row.userName === '脱敏搜索账户'
    && Number.isSafeInteger(row.userId)
    && Number.isSafeInteger(row.campaignId)
  )));
  assert.equal(sites.header.status, 0);
  assert.equal(sites.body.data[0].list.length, 2);
  assert.ok(sites.body.data[0].list.every((site) => (
    site.domain.endsWith('.example.test')
  )));
  assert.deepEqual(
    trend.body.data[0].result.fields,
    [
      'simple_date_title',
      'pv_count',
      'visit_count',
      'visitor_count'
    ]
  );
  assert.ok(
    trend.body.data[0].result.items[1].flat().includes('--'),
    '脱敏 fixture 应保留真实无数据标记'
  );
});
