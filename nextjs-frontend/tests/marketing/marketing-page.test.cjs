const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const frontendDirectory = path.resolve(__dirname, '../..');
const pagePath = path.join(
  frontendDirectory,
  'src/app/geo/marketing/page.tsx'
);

test('frontend package has a real executable test command', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(frontendDirectory, 'package.json'), 'utf8')
  );

  assert.equal(
    packageJson.scripts.test,
    'node --test tests/marketing/*.test.cjs'
  );
});

test('retired combined marketing page redirects to the formal market overview', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const settingsSource = fs.readFileSync(
    path.join(frontendDirectory, 'src/app/admin/settings/BaiduMarketingSettings.tsx'),
    'utf8'
  );

  assert.match(source, /redirect\(['"]\/geo\/market-overview['"]\)/);
  assert.doesNotMatch(source, /axios|\/dashboard|\/tongji-trend|营销监控/);
  assert.match(settingsSource, /href="\/geo\/market-overview"/);
  assert.doesNotMatch(settingsSource, /href="\/geo\/marketing"/);
});

test('workspace navigation exposes the new pages even before sources have data', () => {
  const navigation = fs.readFileSync(
    path.join(frontendDirectory, 'src/utils/geoNavigation.cjs'),
    'utf8'
  );

  assert.match(navigation, /\/geo\/market-overview/);
  assert.match(navigation, /\/geo\/ad-performance/);
  assert.match(navigation, /\/geo\/website-traffic/);
  assert.match(navigation, /\/geo\/consultations/);
  assert.match(navigation, /\/geo\/order-results/);
});

test('formal overview keeps dashboard ads and range Tongji on separate contracts', () => {
  const overviewHook = fs.readFileSync(
    path.join(frontendDirectory, 'src/lib/marketing/useMarketOverview.ts'),
    'utf8'
  );
  const page = fs.readFileSync(
    path.join(frontendDirectory, 'src/app/geo/market-overview/page.tsx'),
    'utf8'
  );

  assert.match(overviewHook, /\/dashboard/);
  assert.doesNotMatch(overviewHook + page, /\/tongji-trend|\/tongji-source-trends/);
  assert.match(page, /includeSourceComparison:\s*true/);
});
