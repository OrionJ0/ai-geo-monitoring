const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const frontendDirectory = path.resolve(__dirname, '../..');
const marketingPage = fs.readFileSync(
  path.join(frontendDirectory, 'src/app/geo/market-overview/page.tsx'),
  'utf8'
);
const marketingCss = fs.readFileSync(
  path.join(
    frontendDirectory,
    'src/app/geo/market-overview/market-overview.module.css'
  ),
  'utf8'
);
const marketingSettings = fs.readFileSync(
  path.join(
    frontendDirectory,
    'src/app/admin/settings/BaiduMarketingSettings.tsx'
  ),
  'utf8'
);

test('market overview provides one live region and equivalent trend table', () => {
  assert.equal((marketingPage.match(/aria-live="polite"/gu) || []).length, 1);
  assert.match(marketingPage, /每日趋势等价数据表/);
  assert.match(marketingPage, /role="region"/);
  assert.match(marketingPage, /tabIndex=\{0\}/);
  assert.match(marketingPage, /aria-pressed/);
  assert.match(marketingPage, /scope="col"/);
  assert.match(marketingPage, /scope="row"/);
  assert.match(marketingPage, /tabIndex=\{0\} role="region" aria-label/);
});

test('market overview includes narrow viewport and reduced-motion rules', () => {
  assert.match(marketingCss, /@media \(max-width: 767px\)/);
  assert.match(marketingCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(marketingCss, /overflow-x: auto/);
});

test('market overview alert actions keep sufficient contrast on warning surfaces', () => {
  assert.match(
    marketingCss,
    /\.statusStack :global\(\.ant-alert-action a\)[\s\S]*color: #174ea6/u
  );
});

test('market overview keeps authoritative values out of floating point conversion', () => {
  assert.doesNotMatch(marketingPage, /\bparseInt\s*\(/u);
  assert.doesNotMatch(marketingPage, /\bparseFloat\s*\(/u);
  assert.doesNotMatch(marketingPage, /\bNumber\s*\(/u);
});

test('administrator UI exposes the complete account binding lifecycle', () => {
  assert.match(marketingSettings, /tongji-context/);
  assert.match(marketingSettings, /验证并保存用户名/);
  assert.match(marketingSettings, /统一 OAuth Token/);
  assert.doesNotMatch(marketingSettings, /tongji-credential/);
  assert.doesNotMatch(marketingSettings, /Data API Token/);
  assert.doesNotMatch(marketingSettings, /tongjiAccessToken/);
  assert.match(marketingSettings, /绑定搜索账户和统计站点/);
  assert.match(marketingSettings, /tongji-sites/);
  assert.match(marketingSettings, /tongjiSiteId: bindingTongjiSiteId/);
  assert.match(marketingSettings, /pausedLegacyBinding/);
  assert.match(marketingSettings, /tongjiSiteId: bindingTongjiSiteId \}/);
  assert.match(marketingSettings, /百度统计站点/);
  assert.match(marketingSettings, /\/baidu-bindings/);
  assert.match(marketingSettings, /action: 'pause' \| 'resume'/);
  assert.match(marketingSettings, /\/\$\{action\}/);
  assert.match(marketingSettings, /axios\.delete/);
  assert.match(marketingSettings, /解除绑定不会修改百度来源数据/);
});

test('administrator UI keeps auth-only pilot separate from data pilot binding', () => {
  assert.match(marketingSettings, /PILOT_READY/);
  assert.match(marketingSettings, /PILOT_DATA_READY/);
  assert.match(marketingSettings, /受限试点模式/);
  assert.match(marketingSettings, /真实数据试点模式/);
  assert.match(marketingSettings, /检查账户目录/);
  assert.match(marketingSettings, /!pilotAuthOnly/);
});
