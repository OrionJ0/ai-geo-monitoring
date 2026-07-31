const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.resolve(
  __dirname,
  '../../src/app/geo/ad-performance/page.tsx'
);

test('advertising page resolves the explicit default project without a selector fallback', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /useDefaultProjectContext/);
  assert.match(source, /defaultContext\.project\?\.id/);
  assert.doesNotMatch(source, /axios\.get\(['"]\/api\/geo-projects['"]\)/);
  assert.doesNotMatch(source, /projects?\[0\]/);
  assert.doesNotMatch(source, /<select/);
});

test('advertising page uses the read capability and existing all-or-nothing snapshot APIs', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /capabilities\.adsRead/);
  assert.match(source, /\/dashboard/);
  assert.match(source, /\/refresh-runs/);
  assert.match(source, /\['QUEUED',\s*'RUNNING'\]/);
  assert.match(source, /snapshotFreshnessState === 'STALE'/);
  assert.match(source, /snapshotContentState === 'NONE'/);
});

test('advertising page preserves exact values and distinguishes account-scoped campaigns', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /BigInt\(row\.impressions\)/);
  assert.match(source, /formatScaled/);
  assert.match(source, /groupDigits/);
  assert.match(source, /campaign\.accountId.*campaign\.campaignId/s);
  assert.match(source, /逐日广告指标等价数据表/);
  assert.match(source, /aria-live="polite"/);
});

test('advertising page remains read-only and sends changes back to Baidu', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /前往百度营销（将离开本站）/);
  assert.doesNotMatch(source, /预算设置|修改预算|修改出价|编辑推广计划/);
  assert.doesNotMatch(source, /axios\.(?:put|patch|delete)\(/);
});
