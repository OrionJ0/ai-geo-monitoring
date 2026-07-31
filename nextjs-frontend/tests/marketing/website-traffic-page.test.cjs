const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.resolve(
  __dirname,
  '../../src/app/geo/website-traffic/page.tsx'
);

test('traffic page uses the default project and only the independent Tongji endpoint', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /useDefaultProjectContext/);
  assert.match(source, /project\?\.id/);
  assert.match(source, /capabilities\.trafficRead/);
  assert.match(source, /\/tongji-trend/);
  assert.doesNotMatch(source, /\/dashboard|\/refresh-runs/);
  assert.doesNotMatch(source, /axios\.get\(['"]\/api\/geo-projects['"]\)/);
});

test('traffic page distinguishes source setup failures and provider no-data', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  for (const code of [
    'TONGJI_CONNECTION_MISSING',
    'TONGJI_CONNECTION_AMBIGUOUS',
    'BAIDU_TONGJI_SITE_MISSING',
    'BAIDU_TONGJI_SITE_AMBIGUOUS',
    'PROJECT_ARCHIVED'
  ]) {
    assert.match(source, new RegExp(code));
  }
  assert.match(source, /dataState === 'NO_DATA'/);
  assert.match(source, /不按 0 处理/);
});

test('traffic page shows exact daily values with an equivalent table', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /访客数（UV）/);
  assert.match(source, /访问次数/);
  assert.match(source, /浏览量（PV）/);
  assert.match(source, /groupDigits/);
  assert.match(source, /百度统计逐日数据表/);
  assert.match(source, /tabIndex=\{0\}/);
});

test('traffic page explicitly rejects cross-source attribution language', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /同期联合观察/);
  assert.match(source, /不构成.*归因/);
  assert.doesNotMatch(source, /广告带来|广告贡献|点击转化/);
});
